// 出方案（#9 #10）：slot × poi × 成员全量计算 → 主角否决 → 帕累托前沿 → 挑 2–3 个标签不同的方案 → 审计哈希。
// 必须确定性：不用 Math.random、不依赖对象键顺序、now 只从 opts 来。
import type {
  Experience,
  Ju,
  LatLng,
  LedgerEntry,
  MapProvider,
  Member,
  Fallback,
  MyExperience,
  NeedResult,
  Risk,
  WeatherDay,
  Plan,
  Poi,
  Proposal,
  ProposalLabel,
  Segment,
  Slot,
  TraceEvent,
} from "../types";
import { estimateCommute, haversineKm, round1 } from "../map/geo";
import { fairCenter } from "./center";
import { categoryMatches, categoryWords } from "./category";
import { isHotpotCategory } from "./diet";
import { CARE_FLOOR, experienceDetail, HARD_DIET, queueMinutes, slotTimes, type PlanContext, type PrivateFlags, type SoftCost } from "./experience";
import { planRepairs, type AskDraft } from "./repair";
import { applyGive } from "./avatar/give";
import { planMember } from "./avatar/mandate";
import { negotiate, type NegotiateResult } from "./avatar/negotiate";
import { openFits, risksFor, slotWeather, weatherEffects, type Effects, type SlotWeather } from "./external";
import { poiIndoor } from "./needs";
import { fairnessWeights } from "./fairness";
import { generateSlots } from "./slots";
import { bjIso, canonicalJson, chainName, cmpStr, hmToMin, hmacHex, minToHm, sha256Hex, slotLabel } from "./util";
import { activityByKey, type ActivityInfo, type ActivityProfile } from "./activities";
import { buildPrograms, moodSummary, poolSummary, programExperience, segmentTimes, WALK_MAX_MIN, type Program, type ProgramRow, type SegRun } from "./program";
import { segmentsInWindows, shapeLabel } from "./shape";
import { dietConflictReason } from "./diet";

export const ALGORITHM_VERSION = "juzhang-planner/3.0";
export const SEARCH_RADIUS_M = 3000;
export const SEARCH_RADIUS_WIDE_M = 6000;
export const MIN_RESULTS = 5;
export const SHORTLIST = 8;
export const MAX_PROPOSALS = 3;

export const LABEL_TEXT: Record<ProposalLabel, string> = {
  "most-people": "人最全",
  "most-comfortable": "大家最舒服",
  cheapest: "最省钱",
  balanced: "最均衡",
};

/** 综合分权重：加权最低满意度（公平）为主 */
export const SCORE_WEIGHTS = { fairMin: 0.45, avg: 0.25, attend: 0.3 } as const;
/** 被跨局账本照顾的门槛 */
const CARED_WEIGHT = 1.1;

export type TraceFn = (kind: TraceEvent["kind"], text: string) => void;

/** 一个候选（slot × poi）的全量计算结果；pubs / mines / flags 与 members 一一对应 */
export type Candidate = {
  idx: number;
  slot: Slot;
  poi: Poi;
  pubs: Experience[];
  mines: { utility: number; notes: string[]; needs: NeedResult[]; cared: boolean }[];
  flags: PrivateFlags[];
  /** v5 协商用：每人每条软偏好的扣分（只在服务端内部用） */
  softs: SoftCost[][];
  attend: number;
  /** v5 第一级：被照顾到的人数（能来 + 硬约束满足 + 满意度 ≥ 保底线） */
  cared: number;
  /** 被照顾到的人的公平权重之和（人数相同时，之前吃亏多的人被照顾到算得多一点） */
  caredW: number;
  /** v5 第二级：每人的加权损失 w_i·(100 − u_i)，从大到小（来不了 = 损失 100·w_i） */
  losses: number[];
  /** v5 第三级：纳什福利 Σ log(1 + u_i) */
  nash: number;
  /** 到场者里最低的（含私密）满意度 */
  minU: number;
  avgU: number;
  /** 加权最低满意度 = 100 - max_i w_i·(100 - u_i) */
  wMin: number;
  cost: number;
  score: number;
  vetoed: boolean;
  /** v5 外部因素：现场风险（公开事实） */
  risks: Risk[];
  /** v5 外部因素：方案不成立的原因（打烊前来不及 / 户外遇上中雨以上），成立时为空 */
  infeasible?: string;
  /** v5 外部因素：这个时间段的天气 */
  wx: SlotWeather;
  /** v6 活动层：节目 key（"climbing+homestyle"）。v5 单品类时没有 */
  program?: string;
  /** v6 活动层：节目的每一段（单段节目也有一段，用来显示活动名）。v5 单品类时没有 */
  segments?: Segment[];
  /** v6 两段式：每人的公开到场情况（两段都在 / 只第一段 / 只第二段 / 来不了），与 members 一一对应 */
  parts?: ProgramRow["part"][];
};

export function inMembersOf(members: Member[]): Member[] {
  return members.filter((m) => m.status === "in");
}

export function keywordsOf(ju: Ju): string[] {
  const kws = (ju.spec.poiKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (kws.length === 0 && ju.spec.category?.trim()) kws.push(ju.spec.category.trim());
  return kws;
}

/** 搜店半径：先 3km，品类命中不足再 6km、10km */
export const SEARCH_RADII_M = [SEARCH_RADIUS_M, SEARCH_RADIUS_WIDE_M, 10000];
/** 品类命中少于这个数才放宽到相近的店 */
export const MIN_MATCHED = 3;

/**
 * 公平中心附近搜店，并按品类过滤（店名或高德 type 命中 poiKeywords / category 及常见写法）。
 * 命中的店不足 5 家就扩大半径重搜；最大半径仍不足 3 家才放宽（命中的排前面），并给出公开安全的说明 relaxNote。
 */
export async function searchPois(
  ju: Ju,
  center: LatLng,
  map: MapProvider,
): Promise<{ pois: Poi[]; radiusM: number; keywords: string[]; found: number; dropped: number; relaxNote?: string }> {
  const keywords = keywordsOf(ju);
  if (keywords.length === 0) throw new Error("没有场地关键词，无法搜店");
  const words = categoryWords(ju.spec);
  let best: { all: Poi[]; matched: Poi[]; radiusM: number } | undefined;
  for (const radiusM of SEARCH_RADII_M) {
    const raw = await map.searchAround(center, keywords, radiusM, ju.spec.city);
    const uniq = new Map<string, Poi>();
    for (const p of raw) if (p?.id && !uniq.has(p.id)) uniq.set(p.id, p);
    const all = [...uniq.values()];
    const matched = all.filter((p) => categoryMatches(p, words));
    if (!best || matched.length > best.matched.length || (matched.length === best.matched.length && all.length > best.all.length))
      best = { all, matched, radiusM };
    if (matched.length >= MIN_RESULTS) break;
  }
  const { all, matched, radiusM } = best!;
  const label = keywords.join("/");
  if (matched.length >= MIN_MATCHED || all.length === matched.length)
    return { pois: matched, radiusM, keywords, found: all.length, dropped: all.length - matched.length };
  const rest = all.filter((p) => !matched.includes(p));
  return {
    pois: [...matched, ...rest],
    radiusM,
    keywords,
    found: all.length,
    dropped: 0,
    relaxNote: `附近 ${radiusM / 1000} km 内只找到 ${matched.length} 家「${label}」，放宽到相近的店一起比较`,
  };
}

/** 预筛：同品牌只留离大家最近的一家；按"到各人直线距离的最大值"取前 n 家 */
export function shortlistPois(pois: Poi[], origins: LatLng[], n = SHORTLIST): Poi[] {
  const ranked = pois
    .map((poi) => ({ poi, far: origins.length ? Math.max(...origins.map((o) => haversineKm(o, poi))) : 0 }))
    .sort((a, b) => a.far - b.far || cmpStr(a.poi.id, b.poi.id));
  const chains = new Set<string>();
  const out: Poi[] = [];
  for (const r of ranked) {
    const key = chainName(r.poi.name);
    if (chains.has(key)) continue;
    chains.add(key);
    out.push(r.poi);
    if (out.length >= n) break;
  }
  return out;
}

/** 通勤矩阵 [poi][member]（分钟）；单家失败用直线估算兜底 */
export async function commuteMatrix(map: MapProvider, origins: LatLng[], pois: Poi[]): Promise<number[][]> {
  return Promise.all(
    pois.map(async (poi) => {
      let rows: { minutes: number }[];
      try {
        rows = await map.commute(origins, poi);
        if (rows.length !== origins.length) throw new Error("通勤结果条数不对");
      } catch {
        rows = origins.map((o) => estimateCommute(o, poi));
      }
      return rows.map((r, i) => (Number.isFinite(r?.minutes) ? Math.max(0, Math.round(r.minutes)) : estimateCommute(origins[i], poi).minutes));
    }),
  );
}

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 每人一行的体验（evaluateCandidate / 节目计算共用） */
type Row = Pick<ProgramRow, "pub" | "mine" | "flags" | "soft">;

/** 某个候选的全量计算 */
export function evaluateCandidate(
  members: Member[],
  slot: Slot,
  poi: Poi,
  commutes: number[],
  weights: number[],
  ctx: PlanContext,
  idx: number,
  fallbackCost: number,
  eff?: Effects,
): Candidate {
  const rows: Row[] = members.map((m, i) => {
    const d = experienceDetail(m, slot, poi, commutes[i], ctx);
    // 天气（公开事实）：户外 + 小雨 / 高温 / 严寒 / 大风，所有到场的人一起扣
    if (eff?.penalty && d.pub.status !== "absent") {
      const u = Math.max(0, d.mine.utility - eff.penalty);
      d.mine = { ...d.mine, utility: u, cared: d.mine.cared && u >= CARE_FLOOR, notes: eff.note ? [...d.mine.notes, eff.note] : d.mine.notes };
    }
    return d;
  });
  return aggregateCandidate(members, slot, poi, rows, weights, idx, poi.costPerPerson ?? fallbackCost);
}

/** 每人的体验 → 三级准则要用的聚合数（到场、照顾到几个人、加权损失、纳什福利…） */
export function aggregateCandidate(members: Member[], slot: Slot, poi: Poi, rows: Row[], weights: number[], idx: number, cost: number): Candidate {
  const pubs: Experience[] = rows.map((r) => r.pub);
  const mines: Candidate["mines"] = rows.map((r) => r.mine);
  const flags: PrivateFlags[] = rows.map((r) => r.flags);
  const softs: SoftCost[][] = rows.map((r) => r.soft);
  const here = members.map((_, i) => i).filter((i) => pubs[i].status !== "absent");
  const attend = here.length;
  const caredIdx = members.map((_, i) => i).filter((i) => mines[i].cared);
  const losses = members.map((_, i) => weights[i] * (100 - (pubs[i].status === "absent" ? 0 : mines[i].utility))).sort((a, b) => b - a);
  const nash = members.reduce((s, _, i) => s + Math.log(1 + (pubs[i].status === "absent" ? 0 : mines[i].utility)), 0);
  const us = here.map((i) => mines[i].utility);
  const minU = attend ? Math.min(...us) : 0;
  const avgU = attend ? Math.round(us.reduce((s, u) => s + u, 0) / attend) : 0;
  const wMin = attend ? Math.round(100 - Math.max(...here.map((i) => weights[i] * (100 - mines[i].utility)))) : 0;
  const vetoed = attend === 0 || members.some((m, i) => m.role === "must" && pubs[i].status === "absent");
  const n = Math.max(1, members.length);
  const raw =
    SCORE_WEIGHTS.fairMin * Math.max(0, wMin) + SCORE_WEIGHTS.avg * avgU + SCORE_WEIGHTS.attend * 100 * (attend / n);
  return {
    idx,
    slot,
    poi,
    pubs,
    mines,
    flags,
    softs,
    attend,
    cared: caredIdx.length,
    caredW: Math.round(caredIdx.reduce((s, i) => s + weights[i], 0) * 100) / 100,
    losses: losses.map((l) => Math.round(l * 10) / 10),
    nash: Math.round(nash * 1000) / 1000,
    minU,
    avgU,
    wMin,
    cost,
    score: attend ? Math.round(Math.max(0, Math.min(100, raw))) : 0,
    vetoed,
    risks: [],
    wx: { kind: "unknown", label: "" },
  };
}

/** a 是否帕累托支配 b（到场人数 ↑、加权最低满意度 ↑、人均价 ↓） */
export function dominates(a: Candidate, b: Candidate): boolean {
  const ge = a.attend >= b.attend && a.wMin >= b.wMin && a.cost <= b.cost;
  const gt = a.attend > b.attend || a.wMin > b.wMin || a.cost < b.cost;
  return ge && gt;
}

export function paretoFront(cands: Candidate[]): Candidate[] {
  return cands.filter((c) => !cands.some((o) => o !== c && dominates(o, c)));
}

// ---------------- 决策准则（docs/DECISION.md 第 4 节）----------------

/** leximin 里差距多少以内算打平：避免为了零点几分牺牲整体。不能太大：大家都还不错时满意度挤在 85–99，
 *  3 分的容差会把公平账本（之前吃亏多的人权重更高）的作用整个吞掉 */
export const LEXIMIN_EPS = 1;

/**
 * 三级准则：先保底，再求好。返回负数 = a 更好。
 * 0. 主角来不了的方案永远排最后
 * 1. 照顾到的人最多；人数相同看公平权重之和
 * 2. 最吃亏的人损失最小（逐个比较从大到小的加权损失，差距 ≤ 3 算打平）
 * 3. 纳什福利最大（大家都还不错，胜过几个人特别爽）
 * 最后按候选下标（确定性）
 */
export function decisionCompare(a: Candidate, b: Candidate): number {
  if (a.vetoed !== b.vetoed) return a.vetoed ? 1 : -1;
  if (a.cared !== b.cared) return b.cared - a.cared;
  if (Math.abs(a.caredW - b.caredW) > 1e-9) return b.caredW - a.caredW;
  const n = Math.min(a.losses.length, b.losses.length);
  for (let i = 0; i < n; i++) {
    const d = a.losses[i] - b.losses[i];
    if (Math.abs(d) > LEXIMIN_EPS) return d;
  }
  if (Math.abs(a.nash - b.nash) > 1e-9) return b.nash - a.nash;
  return a.idx - b.idx;
}

// ---------------- 方案挑选 ----------------

type Cmp = (a: Candidate, b: Candidate) => number;
const CRIT: Record<ProposalLabel, Cmp> = {
  balanced: (a, b) => b.score - a.score || b.wMin - a.wMin || b.attend - a.attend || a.cost - b.cost || a.idx - b.idx,
  "most-people": (a, b) => b.attend - a.attend || b.wMin - a.wMin || b.score - a.score || a.idx - b.idx,
  "most-comfortable": (a, b) => b.wMin - a.wMin || b.avgU - a.avgU || b.score - a.score || a.idx - b.idx,
  cheapest: (a, b) => a.cost - b.cost || b.wMin - a.wMin || b.score - a.score || a.idx - b.idx,
};

/** 在某个标签的维度上，c 是否比所有已选方案都更好（"实质"由 meaningfullyDifferent 把关） */
function strictlyBetter(label: ProposalLabel, c: Candidate, chosen: Candidate[]): boolean {
  switch (label) {
    case "most-people":
      return chosen.every((x) => c.attend > x.attend);
    case "most-comfortable":
      return chosen.every((x) => c.wMin > x.wMin);
    case "cheapest":
      return chosen.every((x) => c.cost < x.cost);
    default:
      return true;
  }
}

/**
 * 两个方案是否有实质差异（不允许"只差一点的同时段店"）：
 * 不同日期一定算；同一天要么到场人数不同，要么（换了店的前提下）人均差 ≥ 15、加权最低满意度差 ≥ 8（不同时段 ≥ 5）、开始时间差 ≥ 60 分钟之一。
 */
export function meaningfullyDifferent(a: Candidate, b: Candidate): boolean {
  // v6：干的事不一样（桌游 vs 攀岩 → 家常菜）本身就是实质差异
  if ((a.program ?? "") !== (b.program ?? "")) return true;
  if (a.slot.id === b.slot.id && (a.poi.id === b.poi.id || chainName(a.poi.name) === chainName(b.poi.name))) return false;
  const ta = slotTimes(a.slot);
  const tb = slotTimes(b.slot);
  if (ta.date !== tb.date) return true;
  if (a.attend !== b.attend) return true;
  // 同一天同一家店只换个时间，不算实质差异
  if (a.poi.id === b.poi.id || chainName(a.poi.name) === chainName(b.poi.name)) return false;
  if (Math.abs(a.cost - b.cost) >= 15) return true;
  const sameSlot = a.slot.id === b.slot.id;
  if (Math.abs(a.wMin - b.wMin) >= (sameSlot ? 8 : 5)) return true;
  return !sameSlot && Math.abs(ta.start - tb.start) >= 60;
}

/** 推荐 = 三级准则的第一名（在全部候选里挑）；备选在前沿上挑 1–2 个标签不同、有实质差异的 */
export function pickProposals(front: Candidate[], pool: Candidate[], forced?: Candidate): { c: Candidate; label: ProposalLabel }[] {
  if (front.length === 0 && pool.length === 0) return [];
  const rec = forced ?? [...pool].sort(decisionCompare)[0] ?? [...front].sort(CRIT.balanced)[0];
  const chosen: { c: Candidate; label: ProposalLabel }[] = [{ c: rec, label: "balanced" }];
  for (const label of ["most-people", "cheapest", "most-comfortable"] as ProposalLabel[]) {
    if (chosen.length >= MAX_PROPOSALS) break;
    const cs = chosen.map((x) => x.c);
    const ok = (c: Candidate) => !cs.includes(c) && strictlyBetter(label, c, cs) && cs.every((x) => meaningfullyDifferent(c, x));
    const pick = [...front].sort(CRIT[label]).find(ok) ?? [...pool].sort(CRIT[label]).find(ok);
    if (pick) chosen.push({ c: pick, label });
  }
  if (chosen.length >= 2) return chosen;

  // 推荐方案在各维度上都不输：从剩下的候选里按综合分补一个有实质差异的（通常是另一个时间），
  // 它是"备选"，推荐方案改用自己最突出的那个标签
  const rest = [...pool].sort(CRIT.balanced).filter((c) => c !== rec);
  const alt = rest.find((c) => meaningfullyDifferent(c, rec));
  if (!alt) return chosen;
  chosen[0].label = rec.attend > alt.attend ? "most-people" : rec.wMin >= alt.wMin ? "most-comfortable" : "cheapest";
  chosen.push({ c: alt, label: "balanced" });
  return chosen;
}

// ---------------- 公开文案（只用公开数据 + 聚合计数） ----------------

/** k 个人有某件事：1 人只说"有人"，否则说人数 */
export function someone(k: number, rest: string): string {
  return k === 1 ? `有人${rest}` : `${k} 人${rest}`;
}

export function proposalIdFor(slot: Slot, poi: Poi): string {
  return `p_${sha256Hex(`${slot.id}|${poi.id}`).slice(0, 10)}`;
}

/** 候选的方案 id：v5 = 时间 × 店；v6 活动层 = 时间 × 每段（活动 + 店），同一家店的不同节目不会撞 id */
export function proposalIdOf(c: Pick<Candidate, "slot" | "poi" | "segments">): string {
  if (!c.segments?.length) return proposalIdFor(c.slot, c.poi);
  return `p_${sha256Hex(`${c.slot.id}|${c.segments.map((s) => `${s.activity}:${s.poi.id}`).join("|")}`).slice(0, 10)}`;
}

/** 公开显示的人均：两段式 = 两段合计；其余 = 这家店的人均（可能未知） */
function shownCost(c: Candidate): number | undefined {
  return c.segments && c.segments.length > 1 ? c.cost : c.poi.costPerPerson;
}

/** 两段之间走路几分钟（一段时为 undefined） */
function walkOf(c: Pick<Candidate, "segments">): number | undefined {
  const sg = c.segments;
  if (!sg || sg.length < 2) return undefined;
  return Math.round((new Date(sg[1].start).getTime() - new Date(sg[0].end).getTime()) / 60000);
}

/** 只来第二段的人（公开事实：几点到场本来就看得见） */
function secondOnly(c: Candidate, i: number): boolean {
  return c.parts?.[i] === "second";
}

function attendIdx(c: Candidate): number[] {
  return c.pubs.map((_, i) => i).filter((i) => c.pubs[i].status !== "absent");
}

export function headlineFor(c: Candidate, members: Member[]): string {
  const n = members.length;
  const parts: string[] = [c.attend === n ? `${n} 人全到` : `${c.attend} 人到场`];
  const lates = attendIdx(c)
    .filter((i) => !secondOnly(c, i))
    .map((i) => c.pubs[i].lateMin)
    .filter((x) => x > 0);
  if (lates.length === 1) parts.push(`1 人晚到 ${lates[0]} 分钟`);
  else if (lates.length > 1) parts.push(`${lates.length} 人晚到（最多 ${Math.max(...lates)} 分钟）`);
  const second = attendIdx(c).filter((i) => secondOnly(c, i)).length;
  if (second) parts.push(`${second} 人直接来第二段`);
  const cost = shownCost(c);
  if (cost !== undefined) parts.push(c.segments && c.segments.length > 1 ? `两段人均 ${cost}` : `人均 ${cost}`);
  // v6 活动层：先说干什么
  if (c.segments?.length) parts.unshift(c.segments.map((s) => s.activityName).join(" → "));
  return parts.join("，");
}

function textsFor(
  c: Candidate,
  members: Member[],
  weights: number[],
  ref: Candidate | undefined,
  ctx: PlanContext,
): { tradeoffs: string[]; highlights: string[] } {
  const here = attendIdx(c);
  const tradeoffs: string[] = [];
  const highlights: string[] = [];
  const absentNames = members.filter((_, i) => c.pubs[i].status === "absent").map((m) => m.name);
  if (absentNames.length) tradeoffs.push(`${absentNames.join("、")}这个时间来不了`);
  const early = here.filter((i) => c.pubs[i].leaveAt);
  if (early.length) tradeoffs.push(`${early.length} 人需要提前走`);
  const maxLate = Math.max(0, ...here.filter((i) => !secondOnly(c, i)).map((i) => c.pubs[i].lateMin));
  if (maxLate >= 15) tradeoffs.push(`有人要晚到 ${maxLate} 分钟`);
  const second = here.filter((i) => secondOnly(c, i)).length;
  if (second) tradeoffs.push(someone(second, "只赶得上第二段"));
  const commutes = here.map((i) => c.pubs[i].commuteMin);
  const maxCommute = commutes.length ? Math.max(...commutes) : 0;
  if (maxCommute >= 40) tradeoffs.push(`最远的人路上 ${maxCommute} 分钟`);
  const q =
    c.segments && c.segments.length > 1
      ? Math.max(...c.segments.map((s) => queueMinutes({ id: c.slot.id, start: s.start, end: s.end }, s.poi)))
      : queueMinutes(c.slot, c.poi);
  if (q > 0) tradeoffs.push(`饭点可能要排队 ${q} 分钟`);
  // 私密因素只给聚合计数
  const over = here.filter((i) => c.flags[i].overBudget).length;
  if (over) tradeoffs.push(someone(over, "觉得偏贵"));
  const diet = here.filter((i) => c.flags[i].dietConflict).length;
  if (diet) tradeoffs.push(someone(diet, "的忌口和这家冲突"));
  const pass = here.filter((i) => c.flags[i].verdict === "pass").length;
  if (pass) tradeoffs.push(someone(pass, "刷卡时不太想去这家"));
  const cost = shownCost(c);
  const refCost = ref ? shownCost(ref) : undefined;
  if (ref && ref !== c && cost !== undefined && refCost !== undefined) {
    const d = cost - refCost;
    if (d >= 5) tradeoffs.push(`比推荐方案每人贵 ${d} 元`);
  }

  if (c.attend === members.length && members.length > 1) highlights.push("全员到齐");
  const budgeted = here.filter((i) => (members[i].private?.budgetMax ?? 0) > 0).length;
  if (cost !== undefined) {
    if (budgeted > 0 && over === 0) highlights.push(`人均 ${cost}，大家都在预算内`);
    if (ref && ref !== c && refCost !== undefined && refCost - cost >= 5) highlights.push(`比推荐方案每人省 ${refCost - cost} 元`);
  }
  const walk = walkOf(c);
  if (walk !== undefined) highlights.push(`两段的店走路 ${walk} 分钟`);
  const want = here.filter((i) => c.flags[i].verdict === "love" || c.flags[i].verdict === "like").length;
  if (want) highlights.push(someone(want, "刷卡点了想去"));
  if (here.some((i) => c.flags[i].yuanyang) && !diet) highlights.push("有鸳鸯锅，不吃辣的也能吃");
  if (c.poi.rating !== undefined && c.poi.rating >= 4.6) highlights.push(`评分 ${c.poi.rating}`);
  if (commutes.length > 1 && maxCommute <= 25) highlights.push(`最远的人也只要 ${maxCommute} 分钟`);
  const cared = here.filter((i) => weights[i] >= CARED_WEIGHT);
  const med = median(commutes) ?? 0;
  if (cared.length && cared.every((i) => c.pubs[i].commuteMin <= med)) highlights.push("这次让之前跑得远的朋友少跑点");
  if (!highlights.length && ctx.spec.category) highlights.push(`${c.slot && slotLabel(c.slot.start)}开局`);
  return { tradeoffs, highlights };
}

export function toProposal(
  c: Candidate,
  label: ProposalLabel,
  members: Member[],
  weights: number[],
  ref: Candidate | undefined,
  ctx: PlanContext,
  recommended: boolean,
): Proposal {
  const { tradeoffs, highlights } = textsFor(c, members, weights, ref, ctx);
  return {
    id: proposalIdOf(c),
    label,
    labelText: LABEL_TEXT[label],
    slot: c.slot,
    poi: c.poi,
    experiences: c.pubs,
    attendCount: c.attend,
    minUtility: c.minU,
    avgUtility: c.avgU,
    score: c.score,
    headline: headlineFor(c, members),
    tradeoffs,
    highlights,
    recommended,
    cared: c.cared,
    ...(c.risks.length ? { risks: c.risks } : {}),
    ...(c.segments?.length ? { segments: c.segments } : {}),
  };
}

/**
 * 推荐理由：三级准则各一句（docs/DECISION.md 第 6 节"解释"）。
 * 隐私：只用公开体验（迟到 / 早走 / 通勤，本来就公开）和聚合人数，绝不提任何人的私密因素。
 */
export function whyLines(c: Candidate, members: Member[]): string[] {
  const n = members.length;
  const out: string[] = [];
  out.push(c.cared === n ? `${n} 个人都照顾到了` : `照顾到 ${c.cared}/${n} 人`);
  const here = c.pubs.filter((e) => e.status !== "absent");
  const absent = n - here.length;
  if (here.length) {
    // 公开满意度最低的那位（只看公开因素）
    const worst = [...here].sort((a, b) => a.utility - b.utility || cmpStr(a.memberId, b.memberId))[0];
    const maxCommute = Math.max(...here.map((e) => e.commuteMin));
    if (worst.status === "full") out.push(`每个到场的人都全程在，最远的路上 ${maxCommute} 分钟`);
    else out.push(`最吃亏的那位：${worst.notes.filter((x) => !/路上/.test(x)).join("，") || `路上 ${worst.commuteMin} 分钟`}`);
  }
  if (absent) out.push(`${absent} 位朋友这个时间来不了`);
  const second = c.pubs.filter((_, i) => secondOnly(c, i)).length;
  if (second) out.push(`${someone(second, "只能晚到")}，直接来第二段`);
  return out;
}

/**
 * v6 点菜提醒：本人写的、挑店用不上的忌口（"不吃香菜""对芒果过敏"，规则是 custom 的饮食需求）。
 * 挑店不看它，但定下来后写在决定书 / 群公告 / 订位话术里提醒点菜；只说人数（1 人 = "有人"），不说是谁。
 * 只算在局里、说了来的人；同样的话合并计数；按文字排序（确定性，和谁写的无关）。
 */
export function remindersFor(members: Member[]): string[] {
  const count = new Map<string, number>();
  for (const m of members) {
    if (m.status !== "in" || m.private?.rsvp === "no") continue;
    const mine = new Set<string>();
    for (const n of m.private?.needs ?? []) if (n.dim === "food" && n.rule.t === "custom") mine.add(reminderText(n.text));
    for (const t of mine) if (t) count.set(t, (count.get(t) ?? 0) + 1);
  }
  return [...count.entries()]
    .sort(([a], [b]) => cmpStr(a, b))
    .map(([t, k]) => (k === 1 ? `有人${t}` : `${k} 人${t}`))
    .slice(0, 6);
}

/** "我不吃香菜" → "不吃香菜"；"花生过敏" → "对花生过敏" */
function reminderText(raw: string): string {
  let t = raw.trim().replace(/[。！!，,\s]+$/u, "").replace(/^(我|本人|自己)/, "");
  const allergy = /^对?(.+?)过敏$/.exec(t);
  if (allergy) t = `对${allergy[1]}过敏`;
  return t.slice(0, 20);
}

/** 约束的聚合说明：只有 1 人有某约束时只说"有人" */
export function constraintSummariesFor(members: Member[], ju: Ju, maxCost: number | undefined): string[] {
  const out: string[] = [];
  const tight = members.filter((m) => {
    const b = m.private?.budgetMax;
    return b !== undefined && b > 0 && (maxCost === undefined || b < maxCost);
  }).length;
  if (tight) out.push(`${someone(tight, "预算偏紧")}，已按大家都舒服的价位筛选`);
  const tags = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"] as const;
  const hotpot = isHotpotCategory(ju.spec.category);
  for (const t of tags) {
    const k = members.filter((m) => (m.private?.dietTags ?? []).includes(t)).length;
    if (!k) continue;
    out.push(t === "不吃辣" && hotpot ? `${someone(k, "不吃辣")}，会点鸳鸯锅` : `${someone(k, t)}，已避开冲突的店`);
  }
  const homeBy = members.filter((m) => Object.values(m.private?.availability ?? {}).some((d) => d?.homeBy)).length;
  if (homeBy) out.push(`${someone(homeBy, "得早点回去")}，方案都算好了离开时间`);
  const earliest = hmToMin(ju.spec.earliest) ?? 18 * 60;
  const lateFrom = members.filter((m) =>
    Object.values(m.private?.availability ?? {}).some((d) => (hmToMin(d?.from) ?? 0) > earliest - 30),
  ).length;
  if (lateFrom) out.push(`${someone(lateFrom, "要晚一点才能出发")}，已经算进到达时间`);
  const notes = members.filter((m) => (m.private?.notes ?? []).length > 0).length;
  if (notes) out.push(`${someone(notes, "私下提了小要求")}，局长都算进去了`);
  return out;
}

export function auditInput(
  ju: Ju,
  members: Member[],
  ledgers: Record<string, LedgerEntry[]>,
  profiles?: Record<string, ActivityProfile>,
): unknown {
  return {
    algorithmVersion: ALGORITHM_VERSION,
    juId: ju.id,
    spec: ju.spec,
    slots: ju.slots,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      isOrganizer: m.isOrganizer,
      location: m.location ? { lat: m.location.lat, lng: m.location.lng } : null,
      private: {
        availability: m.private?.availability ?? {},
        dietTags: m.private?.dietTags ?? [],
        budgetMax: m.private?.budgetMax,
        notes: m.private?.notes ?? [],
        swipes: m.private?.swipes ?? {},
        // v6 活动层：没有时是 undefined，规范化 JSON 会去掉，v5 的输入哈希不变
        mood: m.private?.mood,
        activityOpen: m.private?.activityOpen,
      },
    })),
    ledgers: Object.fromEntries(members.map((m) => [m.id, ledgers[m.id] ?? []])),
    ...(profiles && Object.keys(profiles).length
      ? { profiles: Object.fromEntries(members.filter((m) => profiles[m.id]).map((m) => [m.id, profiles[m.id]])) }
      : {}),
  };
}

/** 方案的输出哈希（不含 computedAt，复算时能对上） */
export function outputHashOf(plan: Omit<Plan, "audit" | "computedAt"> & { audit?: Partial<Plan["audit"]> }): string {
  const a = plan.audit ?? {};
  return sha256Hex(
    canonicalJson({
      proposals: plan.proposals.map((p) => ({ ...p, blurb: undefined })),
      recommendation: plan.recommendation,
      caredFor: plan.caredFor,
      constraintSummaries: plan.constraintSummaries,
      center: plan.center,
      candidates: a.candidates,
      evaluations: a.evaluations,
      paretoSize: a.paretoSize,
      algorithmVersion: a.algorithmVersion,
    }),
  );
}

/** 共用的"候选全量计算"流水线（planJu 和 replanStable 都用） */
export async function computeCandidates(
  ju: Ju,
  members: Member[],
  map: MapProvider,
  ledgers: Record<string, LedgerEntry[]>,
  trace: TraceFn,
  only?: { slots?: Slot[]; pois?: Poi[] },
  extra: { profiles?: Record<string, ActivityProfile> } = {},
): Promise<CandidateSet> {
  // v6：发起人没定干什么 / 给了多个候选 → 先走活动层。指定了时间或店（重算原方案、切备案）时仍按单店算
  if (!only && activityMode(ju.spec)) return computeActivityCandidates(ju, members, map, ledgers, trace, extra.profiles ?? {});
  const slots = only?.slots ?? (ju.slots?.length ? ju.slots : generateSlots(ju.spec));
  if (slots.length === 0) throw new Error("没有候选时间，无法出方案");
  const located = members.filter((m) => m.location && Number.isFinite(m.location.lat) && Number.isFinite(m.location.lng));
  const center = fairCenter(located.map((m) => m.location!));
  const origins: LatLng[] = members.map((m) => (m.location ? { lat: m.location.lat, lng: m.location.lng } : center));
  if (located.length >= 2 && !only?.pois) {
    const r = Math.max(...located.map((m) => haversineKm(center, m.location!)));
    trace("compute", `以 ${located.length} 个出发地求公平集合点（最小包围圆），离集合点最远的人直线 ${round1(r)} km`);
  }

  let pois: Poi[];
  if (only?.pois) pois = only.pois;
  else {
    const found = await searchPois(ju, center, map);
    if (found.pois.length === 0)
      throw new Error(`公平集合点 ${SEARCH_RADII_M[SEARCH_RADII_M.length - 1] / 1000} 公里内没找到「${found.keywords.join("/")}」`);
    pois = shortlistPois(found.pois, located.length ? origins : [center]);
    trace(
      "search",
      `在公平集合点 ${found.radiusM / 1000} km 内搜「${found.keywords.join("/")}」，找到 ${found.found} 家` +
        (found.dropped ? `，去掉 ${found.dropped} 家不是「${found.keywords.join("/")}」的店` : "") +
        `，按"最远的人也不太远"预筛出 ${pois.length} 家`,
    );
    if (found.relaxNote) trace("warn", found.relaxNote);
  }

  const matrix = await commuteMatrix(map, origins, pois);
  const all = matrix.flat();
  if (all.length) trace("compute", `查了 ${pois.length} 家店 × ${members.length} 人 = ${all.length} 条通勤，最远单程 ${Math.max(...all)} 分钟`);

  const w = fairnessWeights(Object.fromEntries(members.map((m) => [m.id, ledgers[m.id] ?? []])));
  const weights = members.map((m) => w[m.id] ?? 1);
  const ctx: PlanContext = { spec: ju.spec };
  const costs = pois.map((p) => p.costPerPerson).filter((x): x is number => typeof x === "number");
  const fallbackCost = Math.round(median(costs) ?? ju.spec.budgetPerPerson ?? 100);

  // v5 外部因素：天气（集合点附近，4 天内）+ 营业时间 + 室内 / 户外
  let forecast: WeatherDay[] = [];
  if (map.weather) {
    try {
      forecast = await map.weather(center);
    } catch {
      forecast = [];
    }
  }
  const dates = [...new Set(slots.map((sl) => slotWeather(forecast, sl).label))];
  const known = dates.map((label) => ({ label, w: slots.map((sl) => slotWeather(forecast, sl)).find((x) => x.label === label)! })).filter((x) => x.w.half);
  if (known.length) trace("search", `查了天气：${known.map((x) => `${x.label}${x.w.half!.text} ${x.w.half!.temp}℃`).join("，")}`);
  else if (pois.some((p) => poiIndoor(p) === false)) trace("warn", "候选日期还没有天气预报（只能看 4 天内），户外的店会准备室内备案");

  const cands: Candidate[] = [];
  let idx = 0;
  for (const slot of slots)
    pois.forEach((poi, pi) => {
      const { start, end } = slotTimes(slot);
      const wx = slotWeather(forecast, slot);
      const eff = weatherEffects(wx, poi);
      const open = openFits(poi.openTime, start, end);
      const commutes = eff.commuteFactor === 1 ? matrix[pi] : matrix[pi].map((c) => Math.round(c * eff.commuteFactor));
      const c = evaluateCandidate(members, slot, poi, commutes, weights, ctx, idx++, fallbackCost, eff);
      c.wx = wx;
      c.risks = risksFor(slot, poi, wx, open, queueMinutes(slot, poi));
      if (open.fit === "no") c.infeasible = open.closeAt ? `店 ${open.closeAt} 打烊，来不及` : "那个时间不营业";
      else if (eff.infeasible) c.infeasible = eff.reason;
      cands.push(c);
    });
  // 硬过滤：打烊前来不及、户外遇上中雨以上的组合直接不成立；全都不成立时保留原样，交给风险提示
  const feasible = cands.filter((c) => !c.infeasible);
  const closed = cands.filter((c) => c.infeasible?.includes("打烊") || c.infeasible?.includes("营业")).length;
  const rained = cands.length - feasible.length - closed;
  if (feasible.length && feasible.length < cands.length) {
    trace("filter", [closed ? `${closed} 个组合打烊前来不及` : "", rained ? `${rained} 个户外组合遇上坏天气` : ""].filter(Boolean).join("，") + "，直接排除");
  }
  return { slots, pois, center, located, cands: feasible.length ? feasible : cands, weights, ctx, matrix, total: cands.length };
}

/** computeCandidates 的结果 */
export type CandidateSet = {
  slots: Slot[];
  pois: Poi[];
  center: LatLng;
  located: Member[];
  cands: Candidate[];
  weights: number[];
  ctx: PlanContext;
  matrix: number[][];
  /** 一共算了多少个组合（含不成立的） */
  total: number;
  /** v6 活动层排出的节目（只在活动层模式下有） */
  programs?: Program[];
};

// ---------------- v6 活动层（docs/AVATAR.md 第 3 节）----------------

/** 发起人没定干什么（open），或给了 ≥ 2 个认识的候选活动 → 走活动层；否则和 v5 完全一样 */
export function activityMode(spec: Ju["spec"]): boolean {
  if (spec.open) return true;
  return (spec.activities ?? []).filter((k) => activityByKey(k)).length >= 2;
}

/** 活动层最多搜几次店（每种活动一次，命中太少时放宽一次）；加上通勤和天气，总地图调用不超过 v5 的 2 倍 */
export const MAX_ACTIVITY_SEARCHES = 6;
/** 活动层最多查几家店的通勤（v5 是 SHORTLIST = 8 家） */
export const MAX_ACTIVITY_POIS = 10;
const WALK_KMH = 4.5;

/** 两家店之间步行几分钟（直线 × 1.25 绕路系数） */
export function walkMinutes(a: LatLng, b: LatLng): number {
  return Math.max(1, Math.ceil(((haversineKm(a, b) * 1.25) / WALK_KMH) * 60));
}

/** 某种活动在公平集合点附近的店：有清真的朋友时只搜清真的；命中太少且还有搜索次数时放宽到 6km */
export async function searchActivityPois(
  act: ActivityInfo,
  center: LatLng,
  map: MapProvider,
  city: string,
  halal: boolean,
  allowWide: boolean,
): Promise<{ pois: Poi[]; calls: number; radiusM: number }> {
  const keywords = halal && act.halalKeywords?.length ? act.halalKeywords : act.poiKeywords;
  const words = [
    ...new Set([...categoryWords({ category: act.name, poiKeywords: act.poiKeywords }), ...act.aliases.map((a) => a.toLowerCase()), ...(halal ? ["清真"] : [])]),
  ].sort();
  let best: { all: Poi[]; matched: Poi[]; radiusM: number } | undefined;
  let calls = 0;
  for (const radiusM of allowWide ? [SEARCH_RADIUS_M, SEARCH_RADIUS_WIDE_M] : [SEARCH_RADIUS_M]) {
    calls++;
    const raw = await map.searchAround(center, keywords, radiusM, city);
    const uniq = new Map<string, Poi>();
    for (const p of raw) if (p?.id && !uniq.has(p.id)) uniq.set(p.id, p);
    const all = [...uniq.values()];
    const matched = all.filter((p) => categoryMatches(p, words));
    if (!best || matched.length > best.matched.length) best = { all, matched, radiusM };
    if (matched.length >= MIN_MATCHED) break;
  }
  const { all, matched, radiusM } = best!;
  const pois = matched.length >= MIN_MATCHED || all.length === matched.length ? matched : [...matched, ...all.filter((p) => !matched.includes(p))];
  return { pois, calls, radiusM };
}

/** 一个节目落到店上的组合：每段一家店 + 两段之间走路的分钟 */
type Combo = { pois: Poi[]; walk: number };

/** 有清真 / 素食的朋友时，这家店和几个人的饮食底线冲突（只在内部挑第二家店用） */
function hardDietClashes(poi: Poi, act: ActivityInfo, members: Member[]): number {
  if (!act.food) return 0;
  return members.filter((m) => (m.private?.dietTags ?? []).some((t) => HARD_DIET.includes(t) && dietConflictReason(t, poi))).length;
}

/**
 * v6 活动层的候选全量计算：活动层（不调地图）排出前 K 个节目 → 每种活动搜一次店 → 每个节目预筛几家店
 * （两段式配上步行 15 分钟内的第二家）→ 节目 × 开始时间 × 店，每人每段分别算到场与满意度。
 * 地图调用：天气 1 + 搜店 ≤ MAX_ACTIVITY_SEARCHES + 通勤 ≤ MAX_ACTIVITY_POIS（第二段的店离第一段步行 15 分钟内，通勤按第一段估）。
 */
async function computeActivityCandidates(
  ju: Ju,
  members: Member[],
  map: MapProvider,
  ledgers: Record<string, LedgerEntry[]>,
  trace: TraceFn,
  profiles: Record<string, ActivityProfile>,
): Promise<CandidateSet> {
  const spec = ju.spec;
  const starts = ju.slots?.length ? ju.slots : generateSlots(spec);
  if (starts.length === 0) throw new Error("没有候选时间，无法出方案");
  const located = members.filter((m) => m.location && Number.isFinite(m.location.lat) && Number.isFinite(m.location.lng));
  const center = fairCenter(located.map((m) => m.location!));
  const origins: LatLng[] = members.map((m) => (m.location ? { lat: m.location.lat, lng: m.location.lng } : center));
  if (located.length >= 2) {
    const r = Math.max(...located.map((m) => haversineKm(center, m.location!)));
    trace("compute", `以 ${located.length} 个出发地求公平集合点（最小包围圆），离集合点最远的人直线 ${round1(r)} km`);
  }
  const w = fairnessWeights(Object.fromEntries(members.map((m) => [m.id, ledgers[m.id] ?? []])));
  const weights = members.map((m) => w[m.id] ?? 1);
  const ctx: PlanContext = { spec };

  // 1. 天气先查（户外活动要看）
  let forecast: WeatherDay[] = [];
  if (map.weather) {
    try {
      forecast = await map.weather(center);
    } catch {
      forecast = [];
    }
  }

  // 2. 活动层：每人对每种活动的契合度 → 三级准则排出前 K 个节目（只说聚合）
  const pp = buildPrograms(members, spec, forecast, { profiles, weights });
  trace("listen", poolSummary(spec));
  const ms = moodSummary(pp.split);
  if (ms) trace("listen", ms);
  if (pp.rainedOut) trace("filter", `${pp.rainedOut} 种户外活动那几天预报有大雨，先不考虑`);
  if (pp.blocked) trace("filter", `有人的底线（饮食 / 身体 / 预算）和 ${pp.blocked} 种活动冲突，这些活动排到后面`);
  const hasPair = pp.programs.some((p) => p.segs.length > 1);
  if (hasPair) {
    const why = spec.shape?.length
      ? "按发起人的安排"
      : [pp.split.diverged ? "大家这次的状态不太一样" : "", pp.split.late ? someone(pp.split.late, "只能晚到") : ""].filter(Boolean).join("，");
    trace("compute", `${why}，考虑分两段：一段玩、一段吃，第二家店离第一家步行 ${WALK_MAX_MIN} 分钟以内${pp.split.late ? "，晚到的朋友可以直接来第二段" : ""}`);
  }
  if (pp.programs.length === 0) throw new Error("候选的活动这几天都不成立（户外遇上大雨），换个活动或日期吧");
  trace("decide", `活动层按三级准则排出 ${pp.programs.length} 个节目：${pp.programs.map((p) => p.label).join(" / ")}，接下来逐个搜店`);

  // 3. 每种活动搜一次店（有清真的朋友时吃饭的活动只搜清真店，不多调地图）
  const halalCrowd = members.some((m) => (m.private?.dietTags ?? []).includes("清真"));
  const acts: ActivityInfo[] = [];
  for (const p of pp.programs) for (const s of p.segs) if (!acts.includes(s.act)) acts.push(s.act);
  const found = new Map<string, Poi[]>();
  let searches = 0;
  for (let k = 0; k < acts.length; k++) {
    const a = acts[k];
    if (searches >= MAX_ACTIVITY_SEARCHES) break;
    const allowWide = searches + (acts.length - k) < MAX_ACTIVITY_SEARCHES;
    const r = await searchActivityPois(a, center, map, spec.city, halalCrowd && a.food && !!a.halalKeywords?.length, allowWide);
    searches += r.calls;
    found.set(a.key, r.pois);
  }

  // 4. 每个节目预筛几家店；两段式给每家第一段的店配一家步行 15 分钟内的第二段
  const perProgram = Math.max(2, Math.min(4, Math.floor(MAX_ACTIVITY_POIS / pp.programs.length)));
  const ref = located.length ? origins : [center];
  const kept: { pr: Program; combos: Combo[] }[] = [];
  const dropped: string[] = [];
  for (const pr of pp.programs) {
    const first = found.get(pr.segs[0].act.key) ?? [];
    let combos: Combo[] = [];
    if (pr.segs.length === 1) combos = shortlistPois(first, ref, perProgram).map((p) => ({ pois: [p], walk: 0 }));
    else {
      const second = found.get(pr.segs[1].act.key) ?? [];
      for (const p1 of shortlistPois(first, ref, perProgram * 3)) {
        if (combos.length >= perProgram) break;
        const near = second
          .filter((p2) => p2.id !== p1.id)
          .map((p2) => ({ p2, walk: walkMinutes(p1, p2), clash: hardDietClashes(p2, pr.segs[1].act, members) }))
          .filter((x) => x.walk <= WALK_MAX_MIN)
          .sort((a, b) => a.clash - b.clash || (b.p2.rating ?? 0) - (a.p2.rating ?? 0) || a.walk - b.walk || cmpStr(a.p2.id, b.p2.id));
        if (near.length) combos.push({ pois: [p1, near[0].p2], walk: near[0].walk });
      }
    }
    if (combos.length) kept.push({ pr, combos });
    else dropped.push(pr.label);
  }
  if (dropped.length) trace("warn", `「${dropped.join("」「")}」附近没找到合适的店${dropped.some((d) => d.includes("→")) ? "（或第二家不在步行 15 分钟内）" : ""}，先不考虑`);
  if (kept.length === 0) throw new Error(`公平集合点附近没找到「${pp.programs.map((p) => p.label).join("/")}」的店`);

  // 5. 通勤：只查第一段的店（第二段的店就在旁边，去 / 回程按同一个通勤估）
  const pois: Poi[] = [];
  for (const k of kept) for (const c of k.combos) if (!pois.some((p) => p.id === c.pois[0].id)) pois.push(c.pois[0]);
  const matrix = await commuteMatrix(map, origins, pois);
  const flat = matrix.flat();
  trace(
    "search",
    `为 ${kept.length} 个节目在公平集合点附近搜了 ${found.size} 类店，预筛出 ${pois.length} 家，查了 ${flat.length} 条通勤，最远单程 ${flat.length ? Math.max(...flat) : 0} 分钟`,
  );
  const dates = [...new Set(starts.map((sl) => slotWeather(forecast, sl).label))];
  const known = dates.map((label) => ({ label, w: starts.map((sl) => slotWeather(forecast, sl)).find((x) => x.label === label)! })).filter((x) => x.w.half);
  if (known.length) trace("search", `查了天气：${known.map((x) => `${x.label}${x.w.half!.text} ${x.w.half!.temp}℃`).join("，")}`);

  // 6. 节目 × 开始时间 × 店：每人每段分别算
  const cands: Candidate[] = [];
  let idx = 0;
  for (const { pr, combos } of kept)
    for (const st of starts) {
      const { date, start } = slotTimes(st);
      for (const combo of combos) {
        const times = segmentTimes(start, pr.segs, combo.walk);
        const runs: SegRun[] = pr.segs.map((sg, k) => {
          const slot: Slot = { id: st.id, start: bjIso(date, times[k].start), end: bjIso(date, times[k].end) };
          return { act: sg.act, poi: combo.pois[k], slot, eff: weatherEffects(slotWeather(forecast, slot), combo.pois[k]) };
        });
        const slot: Slot = { id: st.id, start: runs[0].slot.start, end: runs[runs.length - 1].slot.end };
        const factor = runs[0].eff?.commuteFactor ?? 1;
        const row = matrix[pois.findIndex((p) => p.id === combo.pois[0].id)];
        const commutes = factor === 1 ? row : row.map((c) => Math.round(c * factor));
        const rows = members.map((m, i) => programExperience(m, runs, commutes[i], ctx, profiles[m.id]));
        const cost = runs.reduce((s, r) => s + (r.poi.costPerPerson ?? Math.round((r.act.cost[0] + r.act.cost[1]) / 2)), 0);
        const c = aggregateCandidate(members, slot, combo.pois[0], rows, weights, idx++, cost);
        c.program = pr.key;
        c.segments = runs.map((r) => ({ activity: r.act.key, activityName: r.act.name, poi: r.poi, start: r.slot.start, end: r.slot.end }));
        if (runs.length > 1) c.parts = rows.map((r) => r.part);
        c.wx = slotWeather(forecast, runs[0].slot);
        const risks: Risk[] = [];
        for (const r of runs) {
          const t = slotTimes(r.slot);
          const open = openFits(r.poi.openTime, t.start, t.end);
          for (const rk of risksFor(r.slot, r.poi, slotWeather(forecast, r.slot), open, queueMinutes(r.slot, r.poi)))
            if (!risks.some((x) => x.kind === rk.kind && x.text === rk.text)) risks.push(rk);
          if (!c.infeasible && open.fit === "no") c.infeasible = open.closeAt ? `${r.poi.name} ${open.closeAt} 打烊，来不及` : `${r.poi.name}那个时间不营业`;
          else if (!c.infeasible && r.eff?.infeasible) c.infeasible = r.eff.reason;
        }
        // 两段时，第一段结束得早就不是"夜归"；risksFor 已按每段自己的结束时间算
        c.risks = risks;
        cands.push(c);
      }
    }
  // 发起人说的安排带时段（"下午玩、晚上吃"）：每段的开始时间要落在那个时段里（吃饭真的在饭点）
  if (spec.shape?.some((p) => p.when)) {
    const fits = (c: Candidate) => segmentsInWindows((c.segments ?? []).map((sg) => slotTimes({ id: "", start: sg.start, end: sg.end }).start), spec.shape!);
    const timed = cands.filter((c) => !c.infeasible && fits(c)).length;
    if (timed) {
      let off = 0;
      for (const c of cands)
        if (!c.infeasible && !fits(c)) {
          c.infeasible = "不在说好的时段里";
          off++;
        }
      if (off) trace("filter", `${off} 个组合的时间和「${shapeLabel(spec.shape)}」对不上（比如吃饭不在饭点），不考虑`);
    } else trace("warn", `没有组合能让每段都落在「${shapeLabel(spec.shape)}」的时段里，先按最接近的排`);
  }
  const feasible = cands.filter((c) => !c.infeasible);
  const closed = cands.filter((c) => c.infeasible?.includes("打烊") || c.infeasible?.includes("营业")).length;
  const offTime = cands.filter((c) => c.infeasible === "不在说好的时段里").length;
  const rained = cands.length - feasible.length - closed - offTime;
  if (feasible.length && feasible.length < cands.length - offTime && (closed || rained)) {
    trace("filter", [closed ? `${closed} 个组合打烊前来不及` : "", rained ? `${rained} 个户外组合遇上坏天气` : ""].filter(Boolean).join("，") + "，直接排除");
  }
  return {
    slots: starts,
    pois,
    center,
    located,
    cands: feasible.length ? feasible : cands,
    weights,
    ctx,
    matrix,
    total: cands.length,
    programs: kept.map((k) => k.pr),
  };
}

/** 方案的"在哪"：v5 = 店名；单段节目 = 活动 + 店；两段 = 两段各自的时间、活动、店 */
export function whereText(p: Pick<Proposal, "slot" | "poi" | "segments">): string {
  const sg = p.segments;
  if (!sg?.length) return `${slotLabel(p.slot.start)} 在${p.poi.name}`;
  if (sg.length === 1) return `${slotLabel(p.slot.start)} ${sg[0].activityName}，在${sg[0].poi.name}`;
  return `${slotLabel(sg[0].start)} ${sg[0].activityName}（${sg[0].poi.name}）→ ${minToHm(slotTimes({ id: "", start: sg[1].start, end: sg[1].end }).start)} ${sg[1].activityName}（${sg[1].poi.name}）`;
}

/**
 * v6 补偿（AVATAR.md 第 4 节第 3 轮）：推荐方案是两段式、又有人让了步时，在"同一时间、同一个第一段、照顾到的人一样多"的
 * 候选里，挑让过步的人满意度之和最高的第二段（打平按三级准则）。不会为了补偿少照顾一个人。
 * conceded：让过步的人在 members 里的下标。
 */
export function compensate(rec: Candidate, pool: Candidate[], conceded: number[]): Candidate {
  if (rec.segments?.length !== 2 || !conceded.length) return rec;
  const first = rec.segments[0];
  const alts = pool.filter(
    (c) =>
      !c.vetoed &&
      !c.infeasible &&
      c.slot.id === rec.slot.id &&
      c.segments?.length === 2 &&
      c.segments[0].activity === first.activity &&
      c.segments[0].poi.id === first.poi.id &&
      c.cared === rec.cared &&
      Math.abs(c.caredW - rec.caredW) <= 1e-9,
  );
  const gain = (c: Candidate) => conceded.reduce((s, i) => s + (c.mines[i]?.utility ?? 0), 0);
  return [...alts].sort((a, b) => gain(b) - gain(a) || decisionCompare(a, b))[0] ?? rec;
}

/** v5 备案：户外方案碰上小雨 / 还没有预报时，挑同一时间最好的室内（或不是户外的）店 */
export function fallbackFor(c: Candidate, pool: Candidate[]): Fallback | undefined {
  if (poiIndoor(c.poi) !== false || (c.wx.kind !== "light" && c.wx.kind !== "unknown")) return undefined;
  const alt = pool.filter((x) => x.slot.id === c.slot.id && poiIndoor(x.poi) !== false && !x.infeasible).sort(decisionCompare)[0];
  if (!alt) return undefined;
  return {
    trigger: c.wx.kind === "unknown" ? "到时候下雨（前一天局长再确认天气）" : "雨下大了（中雨及以上）",
    poi: alt.poi,
    proposalId: proposalIdOf(alt),
  };
}

/**
 * 出方案。只用 status=in 的成员；返回的 plan 不含 blurb（由 B1 的 polishPlan 写）。
 * mine：memberId -> 每个方案下本人的真实体验（含私密因素），只给本人看。
 */
export async function planJu(
  ju: Ju,
  members: Member[],
  map: MapProvider,
  opts: {
    auditSecret: string;
    onTrace?: TraceFn;
    ledgers?: Record<string, LedgerEntry[]>;
    now?: Date;
    /** v5 让步账：memberId -> 最近答应过让步的次数（越多越不先问） */
    concessions?: Record<string, number>;
    /** v6 活动层：memberId -> 档案里的活动口味、身体限制（Profile 的子集）。不传 = 只看本次说的 */
    profiles?: Record<string, ActivityProfile>;
  },
): Promise<{ plan: Plan; mine: Record<string, MyExperience[]>; asks: AskDraft[]; avatar: Pick<NegotiateResult, "logs" | "conceded"> }> {
  const trace: TraceFn = (k, t) => {
    try {
      opts.onTrace?.(k, t);
    } catch {
      /* 思考流回调出错不影响出方案 */
    }
  };
  const inMembers = inMembersOf(members);
  if (inMembers.length === 0) throw new Error("局里还没有人，无法出方案");
  const ledgers = opts.ledgers ?? {};
  const n = inMembers.length;

  const shared = inMembers.filter(
    (m) =>
      Object.keys(m.private?.availability ?? {}).length > 0 ||
      (m.private?.dietTags ?? []).length > 0 ||
      m.private?.budgetMax !== undefined ||
      (m.private?.notes ?? []).length > 0,
  ).length;
  const withLoc = inMembers.filter((m) => m.location).length;
  trace(
    "listen",
    `${n} 位朋友在局里，${withLoc} 人给了出发地` + (shared ? `，${shared} 人私下跟局长说了自己的情况` : ""),
  );

  const profiles = opts.profiles ?? {};
  // v6 分身谈判：按授权书算（底线最多 3 条，多的降成"想要"；坚持风格的想要更用力），再对"不让就照顾不到"的人启用 give
  const planMembers = inMembers.map(planMember);
  const { slots, pois, center, cands: baseCands, weights, ctx, total, programs } = await computeCandidates(ju, planMembers, map, ledgers, trace, undefined, { profiles });
  const given = applyGive(planMembers, baseCands, weights, ctx, opts.concessions ?? {}, profiles);
  const cands = given.cands;

  if (programs)
    trace("compute", `计算了 ${programs.length} 个节目 × ${slots.length} 个开始时间 × 预筛的店 = ${total} 个组合 × ${n} 个人 = ${total * n} 次体验（两段的每人每段分别算）`);
  else trace("compute", `计算了 ${slots.length} 个时段 × ${pois.length} 家店 × ${n} 个人 = ${slots.length * pois.length * n} 次体验`);

  let pool = cands.filter((c) => !c.vetoed && c.attend > 0);
  const hasMust = inMembers.some((m) => m.role === "must");
  const vetoed = cands.filter((c) => c.vetoed && c.attend > 0).length;
  if (hasMust && vetoed) trace("filter", `主角来不了的 ${vetoed} 个候选直接否决`);
  if (pool.length === 0) {
    pool = cands.filter((c) => c.attend > 0);
    if (pool.length === 0) throw new Error("还没有人能在任何候选时间到场，无法出方案");
    trace("warn", "主角在所有候选时间都来不了，先按其他人出方案，建议和主角再确认时间");
  }

  // 私密约束的聚合影响（不给阈值、不点名）
  const tightShops = pois.filter((p) => pool.some((c) => c.poi === p && c.flags.some((f) => f.overBudget))).length;
  if (tightShops) trace("filter", `有人预算偏紧，${tightShops} 家店对部分朋友超预算，综合分相应下降`);
  if (pool.some((c) => c.flags.some((f) => f.yuanyang))) trace("filter", "有人不吃辣，火锅按鸳鸯锅算");
  const caredCount = weights.filter((w) => w >= CARED_WEIGHT).length;
  if (caredCount) trace("compute", `参考跨局账本：${caredCount} 位朋友前几次吃亏较多，这次在公平计算里权重更高`);

  const front = paretoFront(pool);
  trace("compute", `帕累托前沿（到场人数 × 加权最低满意度 × 人均价）上剩 ${front.length} 个候选`);

  // v6 补偿：让过步的人（自动让步 + 私下答应过的），两段式时第二段按他们的口味挑
  const rec0 = [...pool].sort(decisionCompare)[0];
  const conceded = rec0
    ? [...new Set([...(given.uses.get(rec0) ?? []).map((u) => u.i), ...inMembers.flatMap((m, i) => ((m.private?.asks ?? []).some((a) => a.status === "yes") ? [i] : []))])]
    : [];
  const recC = rec0 && compensate(rec0, pool, conceded);
  if (recC && recC !== rec0) trace("decide", `第二段换成「${recC.segments![1].activityName}」：照顾到的人一样多，更合让过步的朋友的口味`);
  const picked = pickProposals(front, pool, recC);
  const rec = picked[0].c;
  const proposals = picked.map((p, i) => {
    const prop = toProposal(p.c, p.label, inMembers, weights, rec, { spec: ju.spec }, i === 0);
    const fb = fallbackFor(p.c, pool);
    return fb ? { ...prop, fallback: fb } : prop;
  });
  const fbCount = proposals.filter((p) => p.fallback).length;
  if (fbCount) trace("decide", `${fbCount} 个户外方案准备了室内备案`);
  trace("decide", `挑出 ${proposals.length} 个标签不同的方案：${proposals.map((p) => p.labelText).join(" / ")}`);

  const top = proposals[0];
  const why = whyLines(rec, inMembers);
  trace("decide", `三级准则：先看照顾到几个人（${rec.cared}/${n}），再看最吃亏的人，最后看大家整体`);
  const recommendation =
    `推荐「${top.labelText}」：${whereText(top)}。${why.join("；")}` +
    (caredCount && rec.pubs.some((e, i) => weights[i] >= CARED_WEIGHT && e.status !== "absent") ? "；也照顾了之前吃亏多的朋友。" : "。");
  const caredFor = caredCount ? `这次优先照顾了前几次跑得最远的 ${caredCount} 位朋友` : undefined;
  const maxCost = Math.max(0, ...pois.map((p) => p.costPerPerson ?? 0)) || undefined;
  const constraintSummaries = constraintSummariesFor(inMembers, ju, maxCost);
  const reminders = remindersFor(inMembers);
  if (reminders.length) trace("decide", `点菜提醒（挑店不看，定了以后写在决定书上）：${reminders.join("、")}`);

  const candidates = programs ? total : slots.length * pois.length;
  const audit = {
    inputHash: hmacHex(opts.auditSecret, canonicalJson(auditInput(ju, inMembers, ledgers, profiles))),
    outputHash: "",
    candidates,
    evaluations: candidates * n,
    paretoSize: front.length,
    algorithmVersion: ALGORITHM_VERSION,
  };
  // v5 极端情况：没能照顾到所有人 → 诊断 + 找一个问题就能照顾到的人（局长私下去问）
  const repair = planRepairs(planMembers, pool, rec, ctx, opts.concessions ?? {}, decisionCompare);
  if (repair.diagnosis) {
    trace("warn", `没有完美方案：${repair.diagnosis.reasons.join("，")}`);
    if (repair.asks.length) trace("decide", `局长私下去问 ${repair.asks.length} 位朋友能不能让一小步，问完自动重算`);
    for (const sg of repair.diagnosis.suggestions) trace("decide", `建议发起人：${sg}`);
  }
  const yes = inMembers.filter((m) => (m.private?.asks ?? []).some((a) => a.status === "yes")).length;
  const coordination = yes ? `局长私下协调了 ${yes} 位朋友` : undefined;
  // v6 五轮谈判：公开记录（大屏直播）+ 每人私下的"分身替你做了什么"
  const basePool = baseCands.filter((c) => !c.vetoed && c.attend > 0);
  const baseRec = [...(basePool.length ? basePool : baseCands.filter((c) => c.attend > 0))].sort(decisionCompare)[0] ?? rec;
  const talk = negotiate({
    members: inMembers,
    planMembers,
    baseRec,
    basePool: basePool.length ? basePool : baseCands,
    given,
    pool,
    rec,
    proposal: proposals[0],
    asks: repair.asks,
    diagnosis: repair.diagnosis,
    why,
    counts: { slots: slots.length, pois: pois.length, ...(programs ? { programs: programs.length } : {}) },
    now: opts.now ?? new Date(),
  });
  trace("decide", talk.negotiation.outcome);
  const body = {
    proposals,
    recommendation,
    why,
    caredFor,
    constraintSummaries,
    center,
    ...(repair.diagnosis ? { diagnosis: repair.diagnosis } : {}),
    ...(coordination ? { coordination } : {}),
    negotiation: talk.negotiation,
    ...(reminders.length ? { reminders } : {}),
  };
  audit.outputHash = outputHashOf({ ...body, audit });
  const plan: Plan = { ...body, audit, computedAt: (opts.now ?? new Date()).toISOString() };
  if (!caredFor) delete plan.caredFor;
  trace("decide", `推荐「${top.labelText}」：${programs ? whereText(top) : `${slotLabel(top.slot.start)} ${top.poi.name}`}，${top.attendCount} 人到场`);
  trace("done", `审计：输出哈希 ${audit.outputHash.slice(0, 8)}…（输入另有 HMAC 存证），同样的输入一定得到同样的结论`);

  const mine: Record<string, MyExperience[]> = {};
  inMembers.forEach((m, i) => {
    mine[m.id] = picked.map((p, k) => ({
      proposalId: proposals[k].id,
      utility: p.c.mines[i].utility,
      notes: p.c.mines[i].notes,
      needs: p.c.mines[i].needs,
      cared: p.c.mines[i].cared,
    }));
  });
  return { plan, mine, asks: repair.asks, avatar: { logs: talk.logs, conceded: talk.conceded } };
}

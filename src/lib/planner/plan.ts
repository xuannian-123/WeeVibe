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
  Slot,
  TraceEvent,
} from "../types";
import { estimateCommute, haversineKm, round1 } from "../map/geo";
import { fairCenter } from "./center";
import { categoryMatches, categoryWords } from "./category";
import { isHotpotCategory } from "./diet";
import { CARE_FLOOR, experienceDetail, queueMinutes, slotTimes, type PlanContext, type PrivateFlags, type SoftCost } from "./experience";
import { planRepairs, type AskDraft } from "./repair";
import { openFits, risksFor, slotWeather, weatherEffects, type Effects, type SlotWeather } from "./external";
import { poiIndoor } from "./needs";
import { fairnessWeights } from "./fairness";
import { generateSlots } from "./slots";
import { canonicalJson, chainName, cmpStr, hmToMin, hmacHex, sha256Hex, slotLabel } from "./util";

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
  const pubs: Experience[] = [];
  const mines: Candidate["mines"] = [];
  const flags: PrivateFlags[] = [];
  const softs: SoftCost[][] = [];
  members.forEach((m, i) => {
    const d = experienceDetail(m, slot, poi, commutes[i], ctx);
    // 天气（公开事实）：户外 + 小雨 / 高温 / 严寒 / 大风，所有到场的人一起扣
    if (eff?.penalty && d.pub.status !== "absent") {
      const u = Math.max(0, d.mine.utility - eff.penalty);
      d.mine = { ...d.mine, utility: u, cared: d.mine.cared && u >= CARE_FLOOR, notes: eff.note ? [...d.mine.notes, eff.note] : d.mine.notes };
    }
    pubs.push(d.pub);
    mines.push(d.mine);
    flags.push(d.flags);
    softs.push(d.soft);
  });
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
    cost: poi.costPerPerson ?? fallbackCost,
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
export function pickProposals(front: Candidate[], pool: Candidate[]): { c: Candidate; label: ProposalLabel }[] {
  if (front.length === 0 && pool.length === 0) return [];
  const rec = [...pool].sort(decisionCompare)[0] ?? [...front].sort(CRIT.balanced)[0];
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

function attendIdx(c: Candidate): number[] {
  return c.pubs.map((_, i) => i).filter((i) => c.pubs[i].status !== "absent");
}

export function headlineFor(c: Candidate, members: Member[]): string {
  const n = members.length;
  const parts: string[] = [c.attend === n ? `${n} 人全到` : `${c.attend} 人到场`];
  const lates = attendIdx(c)
    .map((i) => c.pubs[i].lateMin)
    .filter((x) => x > 0);
  if (lates.length === 1) parts.push(`1 人晚到 ${lates[0]} 分钟`);
  else if (lates.length > 1) parts.push(`${lates.length} 人晚到（最多 ${Math.max(...lates)} 分钟）`);
  if (c.poi.costPerPerson !== undefined) parts.push(`人均 ${c.poi.costPerPerson}`);
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
  const maxLate = Math.max(0, ...here.map((i) => c.pubs[i].lateMin));
  if (maxLate >= 15) tradeoffs.push(`有人要晚到 ${maxLate} 分钟`);
  const commutes = here.map((i) => c.pubs[i].commuteMin);
  const maxCommute = commutes.length ? Math.max(...commutes) : 0;
  if (maxCommute >= 40) tradeoffs.push(`最远的人路上 ${maxCommute} 分钟`);
  const q = queueMinutes(c.slot, c.poi);
  if (q > 0) tradeoffs.push(`饭点可能要排队 ${q} 分钟`);
  // 私密因素只给聚合计数
  const over = here.filter((i) => c.flags[i].overBudget).length;
  if (over) tradeoffs.push(someone(over, "觉得偏贵"));
  const diet = here.filter((i) => c.flags[i].dietConflict).length;
  if (diet) tradeoffs.push(someone(diet, "的忌口和这家冲突"));
  const pass = here.filter((i) => c.flags[i].verdict === "pass").length;
  if (pass) tradeoffs.push(someone(pass, "刷卡时不太想去这家"));
  if (ref && ref !== c && c.poi.costPerPerson !== undefined && ref.poi.costPerPerson !== undefined) {
    const d = c.poi.costPerPerson - ref.poi.costPerPerson;
    if (d >= 5) tradeoffs.push(`比推荐方案每人贵 ${d} 元`);
  }

  if (c.attend === members.length && members.length > 1) highlights.push("全员到齐");
  const budgeted = here.filter((i) => (members[i].private?.budgetMax ?? 0) > 0).length;
  if (c.poi.costPerPerson !== undefined) {
    if (budgeted > 0 && over === 0) highlights.push(`人均 ${c.poi.costPerPerson}，大家都在预算内`);
    if (ref && ref !== c && ref.poi.costPerPerson !== undefined && ref.poi.costPerPerson - c.poi.costPerPerson >= 5)
      highlights.push(`比推荐方案每人省 ${ref.poi.costPerPerson - c.poi.costPerPerson} 元`);
  }
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
    id: proposalIdFor(c.slot, c.poi),
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
    else out.push(`最吃亏的朋友也只是${worst.notes.filter((x) => !/路上/.test(x)).join("、") || `路上 ${worst.commuteMin} 分钟`}`);
  }
  if (absent) out.push(`${absent} 位朋友这个时间来不了`);
  return out;
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

export function auditInput(ju: Ju, members: Member[], ledgers: Record<string, LedgerEntry[]>): unknown {
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
      },
    })),
    ledgers: Object.fromEntries(members.map((m) => [m.id, ledgers[m.id] ?? []])),
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
) {
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
  return { slots, pois, center, located, cands: feasible.length ? feasible : cands, weights, ctx, matrix };
}

/** v5 备案：户外方案碰上小雨 / 还没有预报时，挑同一时间最好的室内（或不是户外的）店 */
export function fallbackFor(c: Candidate, pool: Candidate[]): Fallback | undefined {
  if (poiIndoor(c.poi) !== false || (c.wx.kind !== "light" && c.wx.kind !== "unknown")) return undefined;
  const alt = pool.filter((x) => x.slot.id === c.slot.id && poiIndoor(x.poi) !== false && !x.infeasible).sort(decisionCompare)[0];
  if (!alt) return undefined;
  return {
    trigger: c.wx.kind === "unknown" ? "到时候下雨（前一天局长再确认天气）" : "雨下大了（中雨及以上）",
    poi: { id: alt.poi.id, name: alt.poi.name, address: alt.poi.address },
    proposalId: proposalIdFor(alt.slot, alt.poi),
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
  },
): Promise<{ plan: Plan; mine: Record<string, MyExperience[]>; asks: AskDraft[] }> {
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

  const { slots, pois, center, cands, weights, ctx } = await computeCandidates(ju, inMembers, map, ledgers, trace);

  trace("compute", `计算了 ${slots.length} 个时段 × ${pois.length} 家店 × ${n} 个人 = ${slots.length * pois.length * n} 次体验`);

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

  const picked = pickProposals(front, pool);
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
    `推荐「${top.labelText}」：${slotLabel(top.slot.start)} 在${top.poi.name}。${why.join("；")}` +
    (caredCount && rec.pubs.some((e, i) => weights[i] >= CARED_WEIGHT && e.status !== "absent") ? "；也照顾了之前吃亏多的朋友。" : "。");
  const caredFor = caredCount ? `这次优先照顾了前几次跑得最远的 ${caredCount} 位朋友` : undefined;
  const maxCost = Math.max(0, ...pois.map((p) => p.costPerPerson ?? 0)) || undefined;
  const constraintSummaries = constraintSummariesFor(inMembers, ju, maxCost);

  const candidates = slots.length * pois.length;
  const audit = {
    inputHash: hmacHex(opts.auditSecret, canonicalJson(auditInput(ju, inMembers, ledgers))),
    outputHash: "",
    candidates,
    evaluations: candidates * n,
    paretoSize: front.length,
    algorithmVersion: ALGORITHM_VERSION,
  };
  // v5 极端情况：没能照顾到所有人 → 诊断 + 找一个问题就能照顾到的人（局长私下去问）
  const repair = planRepairs(inMembers, pool, rec, ctx, opts.concessions ?? {}, decisionCompare);
  if (repair.diagnosis) {
    trace("warn", `没有完美方案：${repair.diagnosis.reasons.join("，")}`);
    if (repair.asks.length) trace("decide", `局长私下去问 ${repair.asks.length} 位朋友能不能让一小步，问完自动重算`);
    for (const sg of repair.diagnosis.suggestions) trace("decide", `建议发起人：${sg}`);
  }
  const yes = inMembers.filter((m) => (m.private?.asks ?? []).some((a) => a.status === "yes")).length;
  const coordination = yes ? `局长私下协调了 ${yes} 位朋友` : undefined;
  const body = {
    proposals,
    recommendation,
    why,
    caredFor,
    constraintSummaries,
    center,
    ...(repair.diagnosis ? { diagnosis: repair.diagnosis } : {}),
    ...(coordination ? { coordination } : {}),
  };
  audit.outputHash = outputHashOf({ ...body, audit });
  const plan: Plan = { ...body, audit, computedAt: (opts.now ?? new Date()).toISOString() };
  if (!caredFor) delete plan.caredFor;
  trace("decide", `推荐「${top.labelText}」：${slotLabel(top.slot.start)} ${top.poi.name}，${top.attendCount} 人到场`);
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
  return { plan, mine, asks: repair.asks };
}

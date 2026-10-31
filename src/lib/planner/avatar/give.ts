// v6 give 进计算（docs/AVATAR.md 4.1）：give 是"预先批准的让步"，不是免费的。
// 对每个候选、每个"不让就照顾不到"的人，在他授权的范围内找让得最少的那组让步（只在需要时启用）：
//   时间 → 晚到 / 少待的门槛放宽；预算 → 有效预算 budgetMax + budgetUp；通勤 → "单程别超过 X 分钟"放宽 commuteUp。
// 用到 give 的人算"被照顾到"（这一步是他预先批准的），但他的满意度仍按他真实的要求算（超了的预算 / 多走的路照常扣分，
// 本人看到的也是真实的那一份），再记一笔让步代价进第二、三级准则——所以三级准则自然会"能不让就不让、要让就让得最少的人"；
// 最近让过步的人代价更高（让步账）。时间上的让步不一样：晚到 / 少待本来就是他在现场的真实体验，公开体验照常显示。
// v6 活动层（A）的节目候选（一段 / 两段）按 programExperience 重算本人那一行，其余人的行原样保留。
// 确定性：枚举顺序固定（GIVE_DIMS），不依赖成员 id。
import type { Give, Member } from "../../types";
import { activityByKey, type ActivityProfile } from "../activities";
import { CARE_FLOOR, MIN_STAY_MIN, ABSENT_LATE_MIN, experienceDetail, slotTimes, timeFit, type PlanContext } from "../experience";
import { weatherEffects } from "../external";
import { SCORE_WEIGHTS, type Candidate } from "../plan";
import { programExperience, type ProgramRow, type SegRun } from "../program";
import { GIVE_DIMS, giveInEffect, hasGive, withGive } from "./mandate";

/** 某人在某个候选里用了多少 give（每一维实际用掉的量） */
export type GiveUse = {
  /** 在 members 里的下标 */
  i: number;
  memberId: string;
  used: Partial<Give>;
  /** 让步代价（满意度分） */
  penalty: number;
};

/** 让步代价：每用一维 2 分起步，再按用掉的量加；最近让过步的人更贵（× (1 + 0.5 × 次数)） */
export const CONCEDE_BASE = 2;
export const CONCEDE_PER_UNIT: Give = { lateMin: 0.15, stayCutMin: 0.15, budgetUp: 0.1, commuteUp: 0.2 };

export function concedePenalty(used: Partial<Give>, concessions = 0): number {
  let p = 0;
  for (const k of GIVE_DIMS) {
    const v = used[k] ?? 0;
    if (v > 0) p += CONCEDE_BASE + CONCEDE_PER_UNIT[k] * v;
  }
  return Math.round(p * (1 + 0.5 * Math.max(0, concessions)) * 10) / 10;
}

type One = Pick<ProgramRow, "pub" | "mine" | "flags" | "soft"> & { part?: ProgramRow["part"] };

/** 节目候选的每一段（从候选上的 segments 还原；活动库里找不到就返回 undefined，这个候选不启用 give） */
function runsOf(c: Candidate): SegRun[] | undefined {
  if (!c.program || !c.segments?.length) return undefined;
  const runs: SegRun[] = [];
  for (const sg of c.segments) {
    const act = activityByKey(sg.activity);
    if (!act) return undefined;
    runs.push({ act, poi: sg.poi, slot: { id: c.slot.id, start: sg.start, end: sg.end }, eff: weatherEffects(c.wx, sg.poi) });
  }
  return runs;
}

/** 单人单候选的体验（含天气扣分，和 evaluateCandidate / 节目计算一致） */
function evalOne(m: Member, c: Candidate, i: number, ctx: PlanContext, profile?: ActivityProfile): One {
  if (c.program) {
    const runs = runsOf(c);
    if (runs) return programExperience(m, runs, c.pubs[i].commuteMin, ctx, profile);
  }
  const d: One = experienceDetail(m, c.slot, c.poi, c.pubs[i].commuteMin, ctx);
  const eff = weatherEffects(c.wx, c.poi);
  if (eff.penalty && d.pub.status !== "absent") {
    const u = Math.max(0, d.mine.utility - eff.penalty);
    d.mine = { ...d.mine, utility: u, cared: d.mine.cared && u >= CARE_FLOOR };
  }
  return d;
}

/** 这次让步每一维实际用掉多少（没用到的维度为 0；最多用到授权的量——超出的部分照常算进满意度，不算分身让的） */
function usedOf(m: Member, c: Candidate, i: number, d: One, dims: (keyof Give)[], give: Give): Partial<Give> {
  const used: Partial<Give> = {};
  const { start, end } = slotTimes(c.slot);
  for (const k of dims) {
    if (k === "lateMin") {
      const base = Math.max(ABSENT_LATE_MIN, m.private?.relax?.maxLateMin ?? 0);
      used.lateMin = Math.max(0, d.pub.lateMin - base);
    } else if (k === "stayCutMin") {
      const base = Math.min(MIN_STAY_MIN, end - start, m.private?.relax?.minStayMin ?? MIN_STAY_MIN);
      used.stayCutMin = Math.max(0, base - d.pub.stayMin);
    } else if (k === "budgetUp") {
      const b = m.private?.budgetMax;
      const cost = c.poi.costPerPerson;
      used.budgetUp = b !== undefined && b > 0 && cost !== undefined ? Math.max(0, cost - b) : 0;
    } else {
      const over = (m.private?.needs ?? [])
        .filter((n) => n.kind === "soft" && n.rule.t === "maxCommute")
        .map((n) => (n.rule.t === "maxCommute" ? d.pub.commuteMin - n.rule.minutes : 0));
      used.commuteUp = Math.max(0, ...over);
    }
    used[k] = Math.min(used[k]!, give[k]);
  }
  return used;
}

/** 哪些维度可能有用：来不了 → 时间；被预算拖下去 → 预算；被通勤拖下去 → 通勤 */
function relevantDims(m: Member, c: Candidate, i: number, give: Give): (keyof Give)[] {
  const out: (keyof Give)[] = [];
  if (c.pubs[i].status === "absent") {
    const tf = timeFit(m, c.slot, c.pubs[i].commuteMin);
    if (tf.dayOk) {
      const { start, end } = slotTimes(c.slot);
      if (give.lateMin > 0 && tf.late > Math.max(ABSENT_LATE_MIN, m.private?.relax?.maxLateMin ?? 0)) out.push("lateMin");
      if (give.stayCutMin > 0 && tf.stay < Math.min(MIN_STAY_MIN, end - start, m.private?.relax?.minStayMin ?? MIN_STAY_MIN)) out.push("stayCutMin");
    }
  }
  const softs = c.softs[i] ?? [];
  if (give.budgetUp > 0 && softs.some((s) => s.key === "budget")) out.push("budgetUp");
  const commuteKeys = new Set((m.private?.needs ?? []).filter((n) => n.kind === "soft" && n.rule.t === "maxCommute").map((n) => n.id));
  if (give.commuteUp > 0 && softs.some((s) => commuteKeys.has(s.key))) out.push("commuteUp");
  // 来不了时预算 / 通勤的扣分还没算（softs 为空）：一起试试
  if (c.pubs[i].status === "absent") {
    if (give.budgetUp > 0 && !out.includes("budgetUp") && m.private?.budgetMax !== undefined) out.push("budgetUp");
    if (give.commuteUp > 0 && !out.includes("commuteUp") && commuteKeys.size) out.push("commuteUp");
  }
  return GIVE_DIMS.filter((k) => out.includes(k));
}

/** 非空子集，先小后大，同样大小按 GIVE_DIMS 顺序 */
function subsets<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << xs.length; mask++) out.push(xs.filter((_, b) => mask & (1 << b)));
  return out.sort((a, b) => a.length - b.length);
}

const TIME_DIMS: (keyof Give)[] = ["lateMin", "stayCutMin"];

/**
 * 某人在某候选里让得最少的那组让步；让了也照顾不到 → undefined。
 * member = 套上这组 give 的成员；truth = 只放宽时间门槛（人到了现场）、预算 / 通勤仍按本人原话算的真实体验。
 */
export function cheapestGive(
  m: Member,
  c: Candidate,
  i: number,
  ctx: PlanContext,
  concessions = 0,
  profile?: ActivityProfile,
): { member: Member; use: GiveUse; truth: One; row: One } | undefined {
  if (c.mines[i].cared || c.flags[i].hard) return undefined;
  if (c.program && !runsOf(c)) return undefined;
  const give = giveInEffect(m);
  if (!hasGive(give)) return undefined;
  const dims = relevantDims(m, c, i, give);
  let best: { member: Member; use: GiveUse; sub: (keyof Give)[]; row: One } | undefined;
  for (const sub of subsets(dims)) {
    const trial = withGive(m, give, sub);
    const d = evalOne(trial, c, i, ctx, profile);
    if (d.pub.status === "absent" || !d.mine.cared) continue;
    const used = usedOf(m, c, i, d, sub, give);
    // 子集里有没用上的维度 = 不是最小的让步（更小的子集已经试过）
    if (sub.some((k) => !(used[k]! > 0))) continue;
    const penalty = concedePenalty(used, concessions);
    if (!best || penalty < best.use.penalty - 1e-9) best = { member: trial, use: { i, memberId: m.id, used, penalty }, sub, row: d };
  }
  if (!best) return undefined;
  const truth = evalOne(withGive(m, give, best.sub.filter((k) => TIME_DIMS.includes(k))), c, i, ctx, profile);
  return { member: best.member, use: best.use, truth, row: best.row };
}

/** 重算三级准则用到的数：真实满意度减让步代价进第二级（加权损失）和第三级（纳什福利）；和 evaluateCandidate 的口径一致 */
function aggregate(c: Candidate, uses: GiveUse[], weights: number[], members: Member[]): Candidate {
  const pen = new Map(uses.map((u) => [u.i, u.penalty]));
  const attend = c.pubs.filter((e) => e.status !== "absent").length;
  const vetoed = attend === 0 || members.some((m, i) => m.role === "must" && c.pubs[i].status === "absent");
  const u = (i: number) => (c.pubs[i].status === "absent" ? 0 : Math.max(0, c.mines[i].utility - (pen.get(i) ?? 0)));
  const idx = c.pubs.map((_, i) => i);
  const caredIdx = idx.filter((i) => c.mines[i].cared);
  const us = idx.filter((i) => c.pubs[i].status !== "absent").map((i) => c.mines[i].utility);
  const avgU = us.length ? Math.round(us.reduce((s, x) => s + x, 0) / us.length) : 0;
  const losses = idx.map((i) => weights[i] * (100 - u(i))).sort((a, b) => b - a);
  const nash = idx.reduce((s, i) => s + Math.log(1 + u(i)), 0);
  const here = idx.filter((i) => c.pubs[i].status !== "absent");
  const wMin = here.length ? Math.round(100 - Math.max(...here.map((i) => weights[i] * (100 - u(i))))) : 0;
  const n = Math.max(1, c.pubs.length);
  const raw = SCORE_WEIGHTS.fairMin * Math.max(0, wMin) + SCORE_WEIGHTS.avg * avgU + SCORE_WEIGHTS.attend * 100 * (attend / n);
  return {
    ...c,
    attend,
    vetoed,
    cared: caredIdx.length,
    caredW: Math.round(caredIdx.reduce((s, i) => s + weights[i], 0) * 100) / 100,
    minU: us.length ? Math.min(...us) : 0,
    avgU,
    losses: losses.map((l) => Math.round(l * 10) / 10),
    nash: Math.round(nash * 1000) / 1000,
    wMin,
    score: attend ? Math.round(Math.max(0, Math.min(100, raw))) : 0,
  };
}

export type Given = {
  cands: Candidate[];
  /** 候选 -> 这个候选里用到 give 的人 */
  uses: Map<Candidate, GiveUse[]>;
  /** 候选 -> 套上 give 之后的成员（谈判写本人记录、协商问问题都用它） */
  variants: Map<Candidate, Member[]>;
};

/**
 * 对所有候选启用"需要时才用"的 give：返回新的候选（原候选不改）。
 * members 是规划用的有效成员（planMember），与候选里的 pubs / mines 一一对应。
 */
export function applyGive(
  members: Member[],
  cands: Candidate[],
  weights: number[],
  ctx: PlanContext,
  concessions: Record<string, number> = {},
  profiles: Record<string, ActivityProfile> = {},
): Given {
  const uses = new Map<Candidate, GiveUse[]>();
  const variants = new Map<Candidate, Member[]>();
  if (!members.some((m) => hasGive(giveInEffect(m)))) {
    for (const c of cands) {
      uses.set(c, []);
      variants.set(c, members);
    }
    return { cands, uses, variants };
  }
  const out = cands.map((c) => {
    const vs = [...members];
    const us: GiveUse[] = [];
    const truths = new Map<number, One>();
    const rows = new Map<number, One>();
    members.forEach((m, i) => {
      const g = cheapestGive(m, c, i, ctx, concessions[m.id] ?? 0, profiles[m.id]);
      if (!g) return;
      vs[i] = g.member;
      us.push(g.use);
      truths.set(i, g.truth);
      rows.set(i, g.row);
    });
    if (!us.length) {
      uses.set(c, us);
      variants.set(c, members);
      return c;
    }
    // 用了 give 的人：公开体验（到没到、晚到多久）按让步后的算；被照顾到，但私密体验（满意度、逐条需求、扣分）用真实的那一份。
    // 其余人的行原样保留
    const pubs = c.pubs.map((x, i) => rows.get(i)?.pub ?? x);
    const mines = c.mines.map((x, i) => (truths.has(i) ? { ...truths.get(i)!.mine, cared: true } : x));
    const flags = c.flags.map((x, i) => (truths.has(i) ? truths.get(i)!.flags : x));
    const softs = c.softs.map((x, i) => (truths.has(i) ? truths.get(i)!.soft : x));
    const parts = c.parts ? c.parts.map((x, i) => rows.get(i)?.part ?? x) : undefined;
    // 保留候选上别的字段（风险、天气、不成立原因、节目分段，以及以后加的字段），只换掉体验和三级准则用到的数
    const next = aggregate({ ...c, pubs, mines, flags, softs, ...(parts ? { parts } : {}) }, us, weights, members);
    uses.set(next, us);
    variants.set(next, vs);
    return next;
  });
  return { cands: out, uses, variants };
}

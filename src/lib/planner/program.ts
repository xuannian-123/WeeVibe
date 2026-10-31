// v6 节目（docs/AVATAR.md 3.3 / 3.4）：节目 = 一段或两段。
// - buildPrograms：在活动层（不调地图）按三级准则排出前 K（≤ 4）个节目；大家心情分化、或有人只能晚到时才考虑两段
// - programExperience：落到具体的店和时间后，每人每段分别算到场与满意度，再合成整个节目的体验
//   两段式的"被照顾到" = 两段里至少完整参加一段 + 硬约束都满足 + 满意度 ≥ 保底线（只来得了第二段的人算部分照顾）
// 隐私：公开体验只由时间、通勤和活动的公开属性（能不能中途加入）算出；心情 / 预算 / 忌口 / 偏好只进本人那份。
// 确定性：只用规则和数字，平局按活动库顺序。
import type { Experience, JuSpec, Member, Mood, NeedResult, Poi, Slot, WeatherDay } from "../types";
import {
  ACTIVITY_LIB,
  candidatePool,
  grade,
  gradeCompare,
  MOOD_TEXT,
  pairMood,
  personalDelta,
  PREFER_BONUS,
  scoreActivities,
  type ActivityFit,
  type ActivityInfo,
  type ActivityProfile,
  type ActivityScore,
  type Graded,
} from "./activities";
import { budgetDegree, CARE_FLOOR, experienceDetail, slotTimes, type PlanContext, type PrivateFlags, type SoftCost } from "./experience";
import type { Effects } from "./external";
import { softPenalty } from "./needs";
import { clamp, hmToMin, minToHm } from "./util";

/** 活动层最多排出几个节目去搜店 */
export const MAX_PROGRAMS = 4;
/** 两段之间最多走几分钟 */
export const WALK_MAX_MIN = 15;
/** 两段式里只赶上一段：满意度扣这么多（少玩了一段） */
export const PARTIAL_PENALTY = 10;
/** 两段式每段的时长上限（分钟）：玩的一段 / 吃的一段 */
export const PAIR_PLAY_MAX = 150;
export const PAIR_EAT_MAX = 120;
/** "完整参加一段"：晚到 + 早走加起来不超过这么多分钟 */
export const FULL_SEG_SLACK = 30;

export type ProgramSeg = { act: ActivityInfo; minutes: number };

/** 一个节目（活动层的评分 + 每段的活动和时长） */
export type Program = Graded & {
  /** "climbing" / "climbing+homestyle" */
  key: string;
  segs: ProgramSeg[];
  /** 总时长（不含两段之间走路） */
  minutes: number;
  /** "攀岩 → 家常菜" */
  label: string;
};

/** 心情分布与"只能晚到"的人数（只用来决定要不要考虑两段；对外只说聚合） */
export type SplitInfo = {
  moods: Record<Mood, number>;
  /** 有人想动 / 想嗨，也有人想安静 / 想躺 */
  diverged: boolean;
  /** 在最晚的开始时间之后还要 45 分钟以上才到得了的人数 */
  late: number;
};

export type ProgramPlan = {
  programs: Program[];
  scores: ActivityScore[];
  split: SplitInfo;
  /** 有人的底线（饮食 / 身体 / 预算）和多少种活动冲突 */
  blocked: number;
  /** 天气不成立的户外活动数 */
  rainedOut: number;
};

const ENERGETIC: Mood[] = ["hype", "active"];
const CALM: Mood[] = ["chill", "lazy"];

export function moodSplit(members: Member[]): Pick<SplitInfo, "moods" | "diverged"> {
  const moods: Record<Mood, number> = { hype: 0, chill: 0, active: 0, lazy: 0 };
  for (const m of members) if (m.private?.mood) moods[m.private.mood]++;
  const up = ENERGETIC.reduce((s, k) => s + moods[k], 0);
  const down = CALM.reduce((s, k) => s + moods[k], 0);
  return { moods, diverged: up > 0 && down > 0 };
}

/** 估计的通勤（活动层不调地图） */
const TYPICAL_COMMUTE = 20;

/** 只能晚到的人：每个能来的日子都是最晚开始时间 + 45 分钟之后才到得了（但还赶得上后半场） */
export function lateJoiners(members: Member[], spec: JuSpec): number {
  const latest = hmToMin(spec.latest) ?? 20 * 60;
  let n = 0;
  for (const m of members) {
    const av = m.private?.availability ?? {};
    const days = (spec.dates ?? []).map((d) => av[d]).filter((d) => !!d);
    if (!Object.keys(av).length || !days.length) continue;
    const arrive = Math.min(...days.map((d) => (hmToMin(d!.from) ?? 0) + TYPICAL_COMMUTE));
    if (arrive > latest + 45 && arrive < latest + PAIR_PLAY_MAX + PAIR_EAT_MAX - 30) n++;
  }
  return n;
}

/** 两段的先后：下午 / 运动量大 / 不能中途加入的先玩后吃；晚上先吃再玩（晚到的人能直接来第二段） */
export function pairOrder(play: ActivityInfo, eat: ActivityInfo, spec: Pick<JuSpec, "earliest">): [ActivityInfo, ActivityInfo] {
  const start = hmToMin(spec.earliest) ?? 18 * 60;
  const playFirst = start < 16 * 60 + 30 || play.energy >= 2 || !play.lateJoin;
  return playFirst ? [play, eat] : [eat, play];
}

/** 两段式节目里某个人的契合度：两段按时长加权；一段碰底线就只来另一段（部分照顾）；想去的类型两段里命中一段就算 */
export function pairFit(a: ActivityFit, am: number, b: ActivityFit, bm: number): { fit: number; hard: boolean } {
  if (a.hard && b.hard) return { fit: 0, hard: true };
  const pref = (fs: ActivityFit[]) => {
    const ps = fs.map((f) => f.prefer).filter((p): p is NonNullable<ActivityFit["prefer"]> => !!p);
    if (!ps.length) return 0;
    return ps.some((p) => p.hit) ? PREFER_BONUS : -Math.max(...ps.map((p) => p.penalty));
  };
  if (a.hard) return { fit: clamp(Math.round(b.base - PARTIAL_PENALTY + pref([b])), 0, 100), hard: false };
  if (b.hard) return { fit: clamp(Math.round(a.base - PARTIAL_PENALTY + pref([a])), 0, 100), hard: false };
  const avg = (a.base * am + b.base * bm) / (am + bm) - (a.mood * am + b.mood * bm) / (am + bm) + pairMood(a.mood, b.mood);
  return { fit: clamp(Math.round(avg + pref([a, b])), 0, 100), hard: false };
}

const progLabel = (segs: ProgramSeg[]) => segs.map((s) => s.act.name).join(" → ");

/**
 * 活动层排节目（不调地图）：单段节目按三级准则取前几名（同一类最多 2 个，免得三个全是吃饭）；
 * 心情分化或有人只能晚到时，再加两个"玩 + 吃"的两段式节目。最多 MAX_PROGRAMS 个，按三级准则排好。
 */
export function buildPrograms(
  members: Member[],
  spec: JuSpec,
  forecast: WeatherDay[] = [],
  opts: { profiles?: Record<string, ActivityProfile>; weights?: number[] } = {},
): ProgramPlan {
  const weights = members.map((_, i) => opts.weights?.[i] ?? 1);
  const scores = scoreActivities(members, spec, forecast, { ...opts, weights });
  const { moods, diverged } = moodSplit(members);
  const late = lateJoiners(members, spec);
  const split: SplitInfo = { moods, diverged, late };
  const live = scores.filter((s) => !s.excluded);
  const blocked = live.filter((s) => s.hard.some(Boolean)).length;
  const rainedOut = scores.length - live.length;

  const single = (s: ActivityScore): Program => ({ ...s, key: s.key, segs: [{ act: s.act, minutes: s.act.minutes }], minutes: s.act.minutes, label: s.act.name });
  const wantPairs = diverged || late > 0;
  const singleQuota = wantPairs ? 2 : 3;
  const singles: Program[] = [];
  const perGroup: Record<string, number> = {};
  for (const s of live) {
    if (singles.length >= singleQuota) break;
    if ((perGroup[s.act.group] ?? 0) >= 2) continue;
    perGroup[s.act.group] = (perGroup[s.act.group] ?? 0) + 1;
    singles.push(single(s));
  }

  const pairs: Program[] = [];
  if (wantPairs) {
    const eats = live.filter((s) => s.act.food);
    // 本身就要大半天的（剧本杀、徒步、露营）不拆两段
    const plays = live.filter((s) => !s.act.food && s.act.minutes <= PAIR_PLAY_MAX + 30);
    const all: Program[] = [];
    for (const p of plays)
      for (const e of eats) {
        const [first, second] = pairOrder(p.act, e.act, spec);
        const segs: ProgramSeg[] = [first, second].map((a) => ({ act: a, minutes: Math.min(a.minutes, a.food ? PAIR_EAT_MAX : PAIR_PLAY_MAX + 30) }));
        const d = (a: ActivityInfo) => (a === p.act ? p.detail : e.detail);
        const rows = members.map((_, i) => pairFit(d(segs[0].act)[i], segs[0].minutes, d(segs[1].act)[i], segs[1].minutes));
        // 平局次序排在所有单段节目之后
        const order = ACTIVITY_LIB.length * (1 + ACTIVITY_LIB.indexOf(p.act)) + ACTIVITY_LIB.indexOf(e.act);
        const g = grade(rows.map((r) => r.fit), rows.map((r) => r.hard), weights, order);
        all.push({ ...g, key: segs.map((s) => s.act.key).join("+"), segs, minutes: segs[0].minutes + segs[1].minutes, label: progLabel(segs) });
      }
    all.sort(gradeCompare);
    // 两个两段式节目别用同一个"玩"
    const usedPlay = new Set<string>();
    for (const pr of all) {
      if (pairs.length >= MAX_PROGRAMS - singles.length) break;
      const play = pr.segs.find((s) => !s.act.food)!.act.key;
      if (usedPlay.has(play)) continue;
      usedPlay.add(play);
      pairs.push(pr);
      if (pairs.length >= 2) break;
    }
  }
  const programs = [...singles, ...pairs].sort(gradeCompare).slice(0, MAX_PROGRAMS);
  return { programs, scores, split, blocked, rainedOut };
}

/** 活动层的公开说法（只说聚合；1 人时不说具体是哪种状态） */
export function moodSummary(split: SplitInfo): string | undefined {
  const parts: string[] = [];
  let singles = 0;
  for (const k of ["active", "hype", "chill", "lazy"] as Mood[]) {
    const n = split.moods[k];
    if (n >= 2) parts.push(`有 ${n} 位朋友${MOOD_TEXT[k]}`);
    else if (n === 1) singles++;
  }
  if (singles) parts.push(parts.length ? "还有人状态不太一样" : "有人说了这次的状态");
  return parts.length ? parts.join("，") : undefined;
}

/** 活动池（发起人给的候选）的公开说法 */
export function poolSummary(spec: JuSpec): string {
  const pool = candidatePool(spec);
  if (pool.length === ACTIVITY_LIB.length && !(spec.activities ?? []).length) return `发起人让局长定干什么，局长从 ${pool.length} 种活动里挑`;
  return `发起人给了 ${pool.length} 个候选：${pool.map((a) => a.name).join(" / ")}`;
}

// ---------------------------------------------------------------- 落到具体的店和时间

/** 节目的一段落到某家店、某个时间 */
export type SegRun = {
  act: ActivityInfo;
  poi: Poi;
  /** 这一段的时间（id 用整个节目的开始时间） */
  slot: Slot;
  /** 天气作用（户外 + 小雨等） */
  eff?: Effects;
};

/** 一个人在整个节目里的体验 */
export type ProgramRow = {
  pub: Experience;
  mine: { utility: number; notes: string[]; needs: NeedResult[]; cared: boolean };
  flags: PrivateFlags;
  soft: SoftCost[];
  /** 公开的到场情况：两段都在 / 只第一段 / 只第二段 / 来不了（单段节目：both 或 none） */
  part: "both" | "first" | "second" | "none";
};

/**
 * 一段的体验。mine.utility 这里还没加心情、也没截到 0–100：v5 的满意度在条件好的时候本来就贴着 100，
 * 先截再加会把"心情对路"的加分全截掉，所以心情在整个节目合成时只加一次、最后再截。
 */
type Detail = ReturnType<typeof experienceDetail> & { mood: number };

/** 不是吃饭的一段：忌口不适用（桌游馆不用是清真店） */
function forSeg(m: Member, act: ActivityInfo, dropBudget: boolean): Member {
  if (!m.private) return m;
  const dropDiet = !act.food && m.private.dietTags.length > 0;
  if (!dropDiet && !(dropBudget && m.private.budgetMax !== undefined)) return m;
  return {
    ...m,
    private: { ...m.private, ...(dropDiet ? { dietTags: [] } : {}), ...(dropBudget ? { budgetMax: undefined } : {}) },
  };
}

/** 一段的 v5 单店体验 + 天气 + 心情 / 口味 / 身体（后两样只进本人那份） */
function segDetail(m: Member, run: SegRun, commute: number, ctx: PlanContext, profile: ActivityProfile | undefined, dropBudget: boolean): Detail {
  const d = experienceDetail(forSeg(m, run.act, dropBudget), run.slot, run.poi, commute, ctx);
  if (d.pub.status === "absent") return { ...d, mood: 0 };
  let u = d.mine.utility;
  const notes = [...d.mine.notes];
  const flags = { ...d.flags };
  if (run.eff?.penalty) {
    u -= run.eff.penalty;
    if (run.eff.note) notes.push(run.eff.note);
  }
  const pd = personalDelta(m, run.act, profile);
  u += pd.delta - pd.mood;
  notes.push(...pd.notes);
  if (pd.hard) flags.hard = true;
  return { ...d, mood: pd.mood, flags, mine: { ...d.mine, utility: u } };
}

const RESULT_RANK: Record<NeedResult["result"], number> = { met: 0, noted: 1, unknown: 2, partial: 3, unmet: 4 };

/** 两段的需求结果合并：同一条需求取更差的那段；"想去 X"取更好的那段（两段里命中一段就算） */
function mergeNeeds(lists: NeedResult[][], preferTexts: Set<string>): NeedResult[] {
  const out: NeedResult[] = [];
  for (const list of lists)
    for (const r of list) {
      const i = out.findIndex((x) => x.text === r.text);
      if (i < 0) out.push(r);
      else {
        const better = RESULT_RANK[r.result] < RESULT_RANK[out[i].result];
        if (preferTexts.has(r.text) ? better : RESULT_RANK[r.result] > RESULT_RANK[out[i].result]) out[i] = r;
      }
    }
  return out;
}

const absentRow = (m: Member, commute: number): ProgramRow => ({
  pub: { memberId: m.id, status: "absent", lateMin: 0, stayMin: 0, commuteMin: Math.max(0, Math.round(commute)), utility: 0, notes: ["这个时间来不了"] },
  mine: { utility: 0, notes: ["这个时间你来不了"], needs: [{ text: "这个时间能来", result: "unmet", detail: "这个时间你来不了" }], cared: false },
  flags: { overBudget: false, dietConflict: false, yuanyang: false, hard: false },
  soft: [],
  part: "none",
});

const segLen = (run: SegRun) => {
  const t = slotTimes(run.slot);
  return t.end - t.start;
};

/**
 * 某个人在一个节目里的体验。runs = 1 段或 2 段（第二段紧接第一段 + 走路）；commute = 到第一段那家店的通勤，
 * 两段的店相距步行 15 分钟以内，第二段的去 / 回程按同一个通勤估。
 */
export function programExperience(
  m: Member,
  runs: SegRun[],
  commute: number,
  ctx: PlanContext,
  profile?: ActivityProfile,
): ProgramRow {
  if (runs.length === 1) {
    const d = segDetail(m, runs[0], commute, ctx, profile, false);
    if (d.pub.status === "absent") return { pub: d.pub, mine: d.mine, flags: d.flags, soft: d.soft, part: "none" };
    const utility = Math.round(clamp(d.mine.utility + d.mood, 0, 100));
    return { pub: d.pub, mine: { ...d.mine, utility, cared: !d.flags.hard && utility >= CARE_FLOOR }, flags: d.flags, soft: d.soft, part: "both" };
  }
  const [r1, r2] = runs;
  const ctxNoBudget: PlanContext = { ...ctx, spec: { ...ctx.spec, budgetPerPerson: undefined } };
  const d1 = segDetail(m, r1, commute, ctxNoBudget, profile, true);
  const d2 = segDetail(m, r2, commute, ctxNoBudget, profile, true);
  const p1 = d1.pub.status !== "absent";
  // 不能中途加入的活动（剧本杀、电影…）：没赶上第一段的人，第二段也得准时到
  const p2 = d2.pub.status !== "absent" && (p1 || r2.act.lateJoin || d2.pub.lateMin <= 10);
  if (!p1 && !p2) return absentRow(m, commute);

  const len1 = segLen(r1);
  const len2 = segLen(r2);
  const t1 = slotTimes(r1.slot);
  const commuteMin = d1.pub.commuteMin;
  const commuteNote = commuteMin >= 40 ? [`路上 ${commuteMin} 分钟`] : [];

  // ---- 公开：只由时间、通勤、活动能不能中途加入算出 ----
  let pub: Experience;
  let part: ProgramRow["part"];
  if (p1 && p2) {
    part = "both";
    const late = d1.pub.lateMin;
    const leaveAt = d2.pub.leaveAt;
    pub = {
      memberId: m.id,
      status: late > 0 && leaveAt ? "lateEarly" : late > 0 ? "late" : leaveAt ? "early" : "full",
      arriveAt: d1.pub.arriveAt,
      lateMin: late,
      ...(leaveAt ? { leaveAt } : {}),
      stayMin: d1.pub.stayMin + d2.pub.stayMin,
      commuteMin,
      utility: Math.round((d1.pub.utility * len1 + d2.pub.utility * len2) / (len1 + len2)),
      notes: [...(late > 0 ? [`晚到 ${late} 分钟`] : []), ...(leaveAt ? [`${leaveAt} 需先走`] : []), ...commuteNote],
    };
  } else if (p1) {
    part = "first";
    const late = d1.pub.lateMin;
    const leaveAt = d1.pub.leaveAt ?? minToHm(t1.end);
    pub = {
      memberId: m.id,
      status: late > 0 ? "lateEarly" : "early",
      arriveAt: d1.pub.arriveAt,
      lateMin: late,
      leaveAt,
      stayMin: d1.pub.stayMin,
      commuteMin,
      utility: Math.max(0, d1.pub.utility - PARTIAL_PENALTY),
      notes: [...(late > 0 ? [`晚到 ${late} 分钟`] : []), `只参加第一段（${r1.act.name}），${leaveAt} 需先走`, ...commuteNote],
    };
  } else {
    part = "second";
    const arrive = hmToMin(d2.pub.arriveAt) ?? t1.start;
    const late = Math.max(0, (arrive < t1.start - 6 * 60 ? arrive + 1440 : arrive) - t1.start);
    const leaveAt = d2.pub.leaveAt;
    pub = {
      memberId: m.id,
      status: leaveAt ? "lateEarly" : "late",
      arriveAt: d2.pub.arriveAt,
      lateMin: late,
      ...(leaveAt ? { leaveAt } : {}),
      stayMin: d2.pub.stayMin,
      commuteMin,
      utility: Math.max(0, d2.pub.utility - PARTIAL_PENALTY),
      notes: [`直接来第二段（${r2.act.name}）`, ...(leaveAt ? [`${leaveAt} 需先走`] : []), ...commuteNote],
    };
  }

  // ---- 私密：每段分别算，碰底线的那段当作不去（只来另一段 = 部分照顾） ----
  const segs = [
    { d: d1, here: p1, run: r1, len: len1 },
    { d: d2, here: p2, run: r2, len: len2 },
  ];
  const ok = segs.filter((s) => s.here && !s.d.flags.hard);
  const counted = ok.length ? ok : segs.filter((s) => s.here);
  const hard = ok.length === 0;
  const total = counted.reduce((s, x) => s + x.len, 0);
  let u = counted.reduce((s, x) => s + x.d.mine.utility * x.len, 0) / total;
  // 心情：只来一段就看那一段；两段都在按 pairMood 合成（有一段对路就算对路），而不是按时长平均
  if (counted.length === 1) u += counted[0].d.mood - PARTIAL_PENALTY;
  else u += pairMood(counted[0].d.mood, counted[1].d.mood);

  // "想去 X"：两段里命中一段就算满足，把按时长摊进来的扣分加回去
  const p = m.private;
  const waived = new Set(p?.waived ?? []);
  const preferNeeds = (p?.needs ?? []).filter((n) => n.rule.t === "preferCategory" && n.kind === "soft" && !waived.has(n.id));
  if (counted.length === 2)
    for (const n of preferNeeds) {
      const costs = counted.map((x) => x.d.soft.find((s) => s.key === n.id)?.cost ?? 0);
      if (Math.min(...costs) === 0) u += counted.reduce((s, x, k) => s + costs[k] * x.len, 0) / total;
    }

  // 预算按两段合计算（各段单独算会把每段都当成整顿饭的预算）
  const notes: string[] = [];
  const results: NeedResult[][] = counted.map((x) => x.d.mine.needs);
  const flags: PrivateFlags = {
    overBudget: false,
    dietConflict: counted.some((x) => x.d.flags.dietConflict),
    yuanyang: counted.some((x) => x.d.flags.yuanyang),
    hard,
    ...(counted.find((x) => x.d.flags.verdict)?.d.flags.verdict ? { verdict: counted.find((x) => x.d.flags.verdict)!.d.flags.verdict } : {}),
  };
  const soft: SoftCost[] = counted.flatMap((x) => x.d.soft);
  const sumCost = counted.reduce((s, x) => s + (x.run.poi.costPerPerson ?? Math.round((x.run.act.cost[0] + x.run.act.cost[1]) / 2)), 0);
  if (p?.budgetMax !== undefined && p.budgetMax > 0) {
    const text = `人均 ${p.budgetMax} 以内`;
    const degree = budgetDegree(sumCost, p.budgetMax);
    if (degree > 0) {
      const c = softPenalty("money", p.budgetStrength ?? 2, degree);
      if (!waived.has("budget")) {
        u -= c;
        soft.push({ key: "budget", cost: c, text, detail: `两段合计人均 ${sumCost}，比你说的多 ${sumCost - p.budgetMax}` });
      }
      flags.overBudget = true;
      notes.push(`两段合计人均 ${sumCost}，超出你说的 ${p.budgetMax}`);
      results.push([{ text, result: degree < 0.5 ? "partial" : "unmet", detail: `两段合计人均 ${sumCost}` }]);
    } else {
      notes.push(`两段合计人均 ${sumCost}，在你的预算内`);
      results.push([{ text, result: "met", detail: `两段合计人均 ${sumCost}` }]);
    }
  } else if (ctx.spec.budgetPerPerson && ctx.spec.budgetPerPerson > 0) {
    const over = (sumCost - ctx.spec.budgetPerPerson) / ctx.spec.budgetPerPerson;
    if (over > 0.2) {
      u -= Math.min(15, (over - 0.2) * 40);
      notes.push(`两段合计人均 ${sumCost}，比说好的 ${ctx.spec.budgetPerPerson} 贵一些`);
    }
  }
  if (part === "first") notes.unshift(`你只赶得上第一段（${r1.act.name}）`);
  if (part === "second") notes.unshift(`你直接来第二段（${r2.act.name}）`);
  if (part !== "both") results.unshift([{ text: "这个时间能来", result: "partial", detail: pub.notes.join("，") }]);
  if (ok.length === 1 && counted.length === 1 && part === "both") notes.unshift(`${segs.find((s) => s.d.flags.hard)!.run.act.name}那段和你的底线冲突，你只参加${ok[0].run.act.name}`);
  for (const x of counted) for (const nt of x.d.mine.notes) {
    const line = `${x.run.act.name}：${nt}`;
    if (!notes.includes(line)) notes.push(line);
  }
  const utility = Math.round(clamp(u, 0, 100));
  // 完整参加一段：这一段晚到 + 早走加起来不超过 30 分钟
  const full = counted.some((x) => x.len - x.d.pub.stayMin <= FULL_SEG_SLACK);
  const preferTexts = new Set(preferNeeds.map((n) => n.text));
  return {
    pub,
    mine: { utility, notes, needs: mergeNeeds(results, preferTexts), cared: full && !hard && utility >= CARE_FLOOR },
    flags,
    soft,
    part,
  };
}

/** 一段节目在某个开始时间的时间表：第二段 = 第一段结束 + 走路 */
export function segmentTimes(startMin: number, segs: ProgramSeg[], walkMin: number): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let t = startMin;
  segs.forEach((s, k) => {
    if (k > 0) t += walkMin;
    out.push({ start: t, end: t + s.minutes });
    t += s.minutes;
  });
  return out;
}

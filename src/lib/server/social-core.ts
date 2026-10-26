// v4 局内编排的状态机：纯内存操作（不碰数据库）。DB 层（social.ts）、定局后的变化（after/changes.ts）
// 和反事实检验（privacy.ts）共用这一份，所以检验测到的就是线上跑的逻辑。
//
// 流程：局前私下标"和谁熟不熟 / 今天电量 / 公开兴趣 / 悄悄回避"（#17 #18）→ 定局后局长排座（#18）
//      → 每一轮私下反馈"拘谨 / 刚好 / 太吵"，局长据此调整下一轮（#19）→ 局后私下选"和谁聊得来"，双方都选了才揭晓（#20）
//      → 同桌过的人、聊得来的人记进各自的档案，再约时局长记得（#21）。
import type { JuPrivate } from "../db";
import {
  GROUPING_VERSION,
  adjustText,
  canonicalInput,
  firstRoundWhy,
  majorityFeel,
  nextIntensity,
  normalizeInterests,
  pairKey,
  pickFormat,
  planFormats,
  solveGrouping,
  symmetricFamiliarity,
  tableTopics,
  type FormatContext,
  type GroupingInput,
  type GroupingResult,
} from "../planner";
import type { Familiarity, FeelCounts, Ju, Member, Proposal, RoundFeel, Seating, SeatingRound, SocialEnergy } from "../types";
import { HttpError } from "./http";
import { announceAt, appendTraceAt, emptyPrivate, inOnly, notify } from "./ju-core";

export const SEAT_ROUNDS_MAX = 3;
/** 反馈少于这个数时，公开视图里不给具体数字（免得能对上是谁） */
export const FEEL_MIN_PUBLIC = 3;
/** 上一轮多数人觉得拘谨时，未来轮次锚点的加强倍数 */
export const STIFF_ANCHOR_BOOST = 1.6;

const confirmedOf = (ju: Ju): Proposal | undefined => ju.plan?.proposals.find((p) => p.id === ju.confirmedProposalId);

/** 默认每桌几人：吃饭 5 人一桌，其他活动 4 人一组 */
export function defaultTableSize(ju: Ju): number {
  return /火锅|烧烤|烤肉|日料|聚餐|吃饭|饭|自助|串|料理|餐/.test(ju.spec.category) ? 5 : 4;
}

/** 会到场、要排座的人：在局里、定局方案里不是"来不了"、现场没被标没到 */
export function seatPeople(ju: Ju, members: Member[]): Member[] {
  const p = confirmedOf(ju);
  const absentInPlan = new Set((p?.experiences ?? []).filter((e) => e.status === "absent").map((e) => e.memberId));
  const absent = new Set(ju.seating?.absentIds ?? []);
  return inOnly(members).filter((m) => !absentInPlan.has(m.id) && !absent.has(m.id));
}

/** 互选成功的对（两个人都在 people 里） */
function mutualPairs(people: Member[]): [string, string][] {
  const ids = new Set(people.map((m) => m.id));
  const out: [string, string][] = [];
  for (const m of people) for (const o of m.private?.matches ?? []) if (ids.has(o) && m.id < o) out.push([m.id, o]);
  return out;
}

export function groupingInputFor(
  people: Member[],
  opts: { rounds: number; tableSize: number; fixed?: string[][][]; prev?: string[][][]; anchorBoost?: number },
): GroupingInput {
  const ids = people.map((m) => m.id);
  const marks: Record<string, Record<string, Familiarity> | undefined> = {};
  for (const m of people) marks[m.id] = m.private?.know;
  const input: GroupingInput = {
    people: people.map((m) => ({ id: m.id, energy: m.private?.energy ?? "mid", interests: normalizeInterests(m.interests) })),
    fam: symmetricFamiliarity(marks, ids),
    together: mutualPairs(people),
    // 每人最多 1 个回避对象
    avoid: people.flatMap((m) => (m.private?.avoid ?? []).slice(0, 1).map((t) => [m.id, t] as [string, string])),
    rounds: opts.rounds,
    tableSize: opts.tableSize,
  };
  if (opts.fixed?.length) input.fixed = opts.fixed;
  if (opts.prev?.length) input.prev = opts.prev;
  if (opts.anchorBoost && opts.anchorBoost !== 1) input.anchorBoost = opts.anchorBoost;
  return input;
}

function formatContext(ju: Ju, people: Member[], input: GroupingInput): FormatContext {
  const n = people.length;
  const pairs = (n * (n - 1)) / 2;
  return {
    category: ju.spec.category,
    people: n,
    knownRatio: pairs ? Object.keys(input.fam).length / pairs : 0,
    lowEnergy: people.filter((m) => m.private?.energy === "low").length,
    key: ju.admin?.auditSecret ?? ju.id,
  };
}

function interestsById(people: Member[]): Map<string, string[]> {
  return new Map(people.map((m) => [m.id, normalizeInterests(m.interests)]));
}

function toRounds(ju: Ju, res: GroupingResult, people: Member[], keep: SeatingRound[]): SeatingRound[] {
  const key = ju.admin?.auditSecret ?? ju.id;
  const interests = interestsById(people);
  return res.rounds.map((tables, i) => {
    if (keep[i] && keep[i].status !== "upcoming") return keep[i];
    return {
      index: i,
      format: keep[i]?.format ?? { key: "free", name: "自由聊", intensity: 1, minutes: 30, how: "" },
      tables: tables.map((ids, t) => {
        const id = `r${i}t${t}`;
        return { id, memberIds: ids, topics: tableTopics(ids.map((x) => interests.get(x) ?? []), key, id) };
      }),
      status: "upcoming",
      ...(keep[i]?.adjust ? { adjust: keep[i].adjust } : {}),
    };
  });
}

function seatingAudit(res: GroupingResult): Seating["audit"] {
  return {
    inputHash: res.inputHash,
    outputHash: res.outputHash,
    restarts: res.restarts,
    evaluations: res.evaluations,
    algorithmVersion: GROUPING_VERSION,
  };
}

function solveFor(ju: Ju, input: GroupingInput, priv: JuPrivate): GroupingResult {
  if (!ju.admin?.auditSecret) throw new HttpError(500, "局缺少审计密钥");
  const res = solveGrouping(input, ju.admin.auditSecret);
  priv.seatSnapshot = { input: canonicalInput(input), decoys: res.decoys };
  return res;
}

const tableNo = (id: string) => Number(id.split("t").at(-1)) + 1;

/** 给每个排进去的人发一条"你在几号桌"的私信 */
function notifySeats(ju: Ju, people: Member[], round: SeatingRound, now: Date, lead: string): void {
  const byId = new Map(people.map((m) => [m.id, m]));
  for (const t of round.tables) {
    for (const id of t.memberIds) {
      const m = byId.get(id);
      if (!m) continue;
      const mates = t.memberIds.filter((x) => x !== id).map((x) => byId.get(x)?.name).filter(Boolean);
      notify(m, "seat", `${lead}：你在 ${tableNo(t.id)} 号桌${mates.length ? `，和${mates.join("、")}` : ""}。玩「${round.format.name}」。`, now);
    }
  }
}

// ---------------------------------------------------------------- 排座（#18）

export function computeSeating(
  ju: Ju,
  members: Member[],
  priv: JuPrivate,
  opts: { rounds?: number; tableSize?: number; now: Date },
): void {
  if (ju.status !== "confirmed") throw new HttpError(409, "定局之后才能排座");
  if (ju.seating && ju.seating.current >= 0) throw new HttpError(409, "已经开始了，中途有变化局长会自动微调");
  const people = seatPeople(ju, members);
  if (people.length < 3) throw new HttpError(400, "至少 3 个人才需要排座");
  const rounds = Math.max(1, Math.min(SEAT_ROUNDS_MAX, Math.round(opts.rounds ?? ju.seating?.rounds.length ?? 2)));
  const tableSize = Math.max(2, Math.min(8, Math.round(opts.tableSize ?? ju.seating?.tableSize ?? defaultTableSize(ju))));
  const input = groupingInputFor(people, { rounds, tableSize });
  const res = solveFor(ju, input, priv);
  const fctx = formatContext(ju, people, input);
  const formats = planFormats(fctx, rounds);
  const shells: SeatingRound[] = formats.map((format, i) => ({ index: i, format, tables: [], status: "upcoming" }));
  shells[0].adjust = firstRoundWhy(fctx);
  const now = opts.now;
  const version = (ju.seating?.version ?? 0) + 1;
  ju.seating = {
    rounds: toRounds(ju, res, people, shells),
    current: -1,
    tableSize,
    metrics: res.stats,
    audit: seatingAudit(res),
    absentIds: [],
    computedAt: now.toISOString(),
    version,
  };
  const s = ju.seating;
  appendTraceAt(ju, "compute", `排座：${people.length} 个人 × ${rounds} 轮，${s.rounds[0].tables.length} 桌，评估了 ${res.evaluations} 次换位`, now);
  appendTraceAt(
    ju,
    "decide",
    `${s.metrics.everyoneAnchored ? "第一轮每个人桌上都有认识的人；" : ""}预计新认识 ${s.metrics.newPairs} 对${s.metrics.matchPairs ? `，互选的 ${s.metrics.matchesSeated} 对都安排同桌了` : ""}`,
    now,
  );
  announceAt(
    ju,
    `【局长排座】${people.length} 个人分 ${s.rounds[0].tables.length} 桌、玩 ${rounds} 轮。第一轮「${s.rounds[0].format.name}」，每桌都有认识的人，也都有还没说过话的朋友。座位局长已经私信给每个人了。`,
    now,
  );
  notifySeats(ju, people, s.rounds[0], now, version > 1 ? "座位重新排了一下" : "座位排好啦");
}

/**
 * 重排还没开始的轮次（中途有人没来 / 有人加入 / 上一轮多数人拘谨）。
 * 已经进行过和正在进行的轮次原样保留；未来轮次尽量少改（prev = 上一版）。返回未来轮次是否有变化。
 */
export function reseatUpcoming(ju: Ju, members: Member[], priv: JuPrivate, now: Date, opts: { anchorBoost?: number; reason?: string } = {}): boolean {
  const s = ju.seating;
  if (!s) return false;
  const firstUpcoming = s.rounds.findIndex((r) => r.status === "upcoming");
  if (firstUpcoming < 0) return false;
  const people = seatPeople(ju, members);
  if (people.length < 2) return false;
  const fixed = s.rounds.slice(0, firstUpcoming).map((r) => r.tables.map((t) => t.memberIds));
  const prev = s.rounds.map((r) => r.tables.map((t) => t.memberIds));
  const input = groupingInputFor(people, {
    rounds: s.rounds.length,
    tableSize: s.tableSize,
    fixed,
    prev,
    ...(opts.anchorBoost ? { anchorBoost: opts.anchorBoost } : {}),
  });
  const res = solveFor(ju, input, priv);
  const before = JSON.stringify(prev.slice(firstUpcoming));
  s.rounds = toRounds(ju, res, people, s.rounds);
  s.metrics = res.stats;
  s.audit = seatingAudit(res);
  s.version += 1;
  s.computedAt = now.toISOString();
  const changed = JSON.stringify(s.rounds.slice(firstUpcoming).map((r) => r.tables.map((t) => t.memberIds))) !== before;
  if (changed) appendTraceAt(ju, "compute", `${opts.reason ?? "人有变化"}，重排了后面的座位，已经坐过的不动`, now);
  return changed;
}

// ---------------------------------------------------------------- 轮次推进 + 反馈（#19）

/** 这一轮私下感受的原始计数（只算这一轮排进去的人） */
export function feelCounts(round: SeatingRound, members: Member[]): FeelCounts {
  const ids = new Set(round.tables.flatMap((t) => t.memberIds));
  const c: FeelCounts = { stiff: 0, ok: 0, loud: 0, total: 0 };
  for (const m of members) {
    if (!ids.has(m.id)) continue;
    const f = m.private?.feel?.[String(round.index)];
    if (!f) continue;
    c[f]++;
    c.total++;
  }
  return c;
}

/** 发起人点"开始 / 下一轮"：结束当前轮（写入聚合反馈），按反馈调整下一轮的玩法和座位 */
export function advanceRound(ju: Ju, members: Member[], priv: JuPrivate, now: Date): void {
  const s = ju.seating;
  if (!s) throw new HttpError(409, "还没排座");
  if (s.current >= s.rounds.length) throw new HttpError(409, "所有轮次都结束了");
  const people = seatPeople(ju, members);

  if (s.current < 0) {
    s.current = 0;
    s.rounds[0].status = "live";
    appendTraceAt(ju, "decide", `第 1 轮开始：「${s.rounds[0].format.name}」`, now);
    announceAt(ju, `【第 1 轮】按局长排的座位坐好～这一轮玩「${s.rounds[0].format.name}」：${s.rounds[0].format.how}`, now);
    return;
  }

  const cur = s.rounds[s.current];
  cur.status = "done";
  const raw = feelCounts(cur, members);
  if (raw.total >= FEEL_MIN_PUBLIC) cur.feedback = raw;
  const next = s.current + 1;

  if (next >= s.rounds.length) {
    s.current = s.rounds.length;
    appendTraceAt(ju, "done", `${s.rounds.length} 轮都玩完了，这次新认识了 ${s.metrics.newPairs} 对`, now);
    announceAt(ju, `【散场】${s.rounds.length} 轮都玩完啦，这次新认识了 ${s.metrics.newPairs} 对朋友。和谁聊得来？私下告诉局长，双方都选了才会揭晓。`, now);
    return;
  }

  const maj = majorityFeel(raw);
  let reseated = false;
  if (maj) {
    // 上一轮多数人拘谨：未来轮次的锚点加强（每桌留熟人），重排还没开始的座位
    if (maj === "stiff") reseated = reseatUpcoming(ju, members, priv, now, { anchorBoost: STIFF_ANCHOR_BOOST, reason: "上一轮有点拘谨" });
    const fctx = formatContext(ju, people, groupingInputFor(people, { rounds: 1, tableSize: s.tableSize }));
    let level = nextIntensity(cur.format.intensity, maj);
    const used = s.rounds.slice(0, next).map((r) => r.format.key);
    for (let i = next; i < s.rounds.length; i++) {
      if (i > next) level = nextIntensity(level, undefined);
      s.rounds[i].format = pickFormat(fctx, level, i, [...used, ...s.rounds.slice(next, i).map((r) => r.format.key)]);
    }
    s.rounds[next].adjust = adjustText(raw.total >= FEEL_MIN_PUBLIC ? raw : { ...raw, total: Math.min(raw.total, FEEL_MIN_PUBLIC - 1) }, s.rounds[next].format, reseated);
  }
  s.current = next;
  s.rounds[next].status = "live";
  appendTraceAt(ju, "decide", `第 ${next + 1} 轮开始：「${s.rounds[next].format.name}」${maj ? `（收到 ${raw.total} 条反馈）` : ""}`, now);
  announceAt(ju, `【第 ${next + 1} 轮】换桌啦～${s.rounds[next].adjust ?? `这一轮玩「${s.rounds[next].format.name}」。`}`, now);
  notifySeats(ju, people, s.rounds[next], now, `第 ${next + 1} 轮`);
}

/** 成员私下反馈这一轮的感受（只能给正在进行的那一轮） */
export function setFeel(ju: Ju, me: Member, round: number, feel: RoundFeel): void {
  const s = ju.seating;
  if (!s || s.current < 0 || s.current >= s.rounds.length) throw new HttpError(409, "现在没有正在进行的一轮");
  if (round !== s.current) throw new HttpError(409, "这一轮已经过去了");
  if (!s.rounds[round].tables.some((t) => t.memberIds.includes(me.id))) throw new HttpError(409, "这一轮没有排到你");
  const p = (me.private ??= emptyPrivate());
  p.feel = { ...(p.feel ?? {}), [String(round)]: feel };
}

/** 发起人标某人没到 / 又到了：重排还没开始的轮次 */
export function markAbsent(ju: Ju, members: Member[], priv: JuPrivate, memberId: string, absent: boolean, now: Date): void {
  const s = ju.seating;
  if (!s) throw new HttpError(409, "还没排座");
  if (!inOnly(members).some((m) => m.id === memberId)) throw new HttpError(404, "局里没有这个人");
  const has = s.absentIds.includes(memberId);
  if (absent === has) return;
  s.absentIds = absent ? [...s.absentIds, memberId] : s.absentIds.filter((x) => x !== memberId);
  const changed = reseatUpcoming(ju, members, priv, now, { reason: absent ? "有朋友没到" : "有朋友到了" });
  if (changed) {
    const up = s.rounds.find((r) => r.status === "upcoming");
    if (up) notifySeats(ju, seatPeople(ju, members), up, now, `人有变化，第 ${up.index + 1} 轮的座位调了一下`);
  }
}

// ---------------------------------------------------------------- 私下标记（#17 #18）

export type SocialPatch = {
  know?: Record<string, Familiarity>;
  energy?: SocialEnergy;
  avoid?: string[];
  interests?: string[];
};

/** 写本人的熟悉度 / 电量 / 回避 / 公开兴趣。allowed = 当前对外可见的其他成员 */
export function applySocial(me: Member, patch: SocialPatch, allowed: Set<string>): void {
  const p = (me.private ??= emptyPrivate());
  if (patch.know) {
    const know = { ...(p.know ?? {}) };
    const touched: string[] = [];
    for (const [id, v] of Object.entries(patch.know)) {
      if (id === me.id || !allowed.has(id) || (v !== 0 && v !== 1 && v !== 2)) continue;
      know[id] = v;
      touched.push(id);
    }
    p.know = know;
    if (p.knowAuto) p.knowAuto = p.knowAuto.filter((x) => !touched.includes(x));
  }
  if (patch.energy) p.energy = patch.energy;
  if (patch.avoid) p.avoid = patch.avoid.filter((id) => id !== me.id && allowed.has(id)).slice(0, 1);
  if (patch.interests) me.interests = normalizeInterests(patch.interests);
}

// ---------------------------------------------------------------- 局后：聊得来（#20）

/** 重新算 me 的"聊得来"互选。返回新成立的配对 */
export function recomputeClicks(members: Member[], me: Member, now: Date): Member[] {
  const fresh: Member[] = [];
  const mine = new Set(me.private?.clicked ?? []);
  for (const other of members) {
    if (other.id === me.id || !other.private || !me.private) continue;
    const mutual = mine.has(other.id) && (other.private.clicked ?? []).includes(me.id);
    const had = (me.private.clickMatches ?? []).includes(other.id);
    if (mutual && !had) {
      me.private.clickMatches = [...(me.private.clickMatches ?? []), other.id];
      if (!(other.private.clickMatches ?? []).includes(me.id)) other.private.clickMatches = [...(other.private.clickMatches ?? []), me.id];
      fresh.push(other);
      notify(me, "click", `你和${other.name}都觉得这次聊得来 🤝 下次局长还安排你们一起。`, now);
      notify(other, "click", `你和${me.name}都觉得这次聊得来 🤝 下次局长还安排你们一起。`, now);
    } else if (!mutual && had) {
      me.private.clickMatches = (me.private.clickMatches ?? []).filter((x) => x !== other.id);
      other.private.clickMatches = (other.private.clickMatches ?? []).filter((x) => x !== me.id);
    }
  }
  return fresh;
}

/** 双方都在局里、互相选了聊得来的对数（聚合） */
export function clickPairCount(members: Member[]): number {
  const inIds = new Set(inOnly(members).map((m) => m.id));
  const pairs = new Set<string>();
  for (const m of members) {
    if (!inIds.has(m.id)) continue;
    for (const o of m.private?.clickMatches ?? []) if (inIds.has(o)) pairs.add(pairKey(m.id, o));
  }
  return pairs.size;
}

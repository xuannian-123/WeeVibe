// 局的状态机：纯内存操作（不碰数据库），DB 层（ju.ts / intake.ts / seed.ts）和反事实检验（privacy.ts）共用。
// 所以反事实检验测到的，就是线上真实跑的那一份逻辑。
import { pushNotice, pushNoticeOnce } from "./after/inbox";
import { autofillFromProfile, planJu } from "../planner";
import type { AskDraft } from "../planner/repair";
import type { ActivityProfile } from "../planner/activities";
import type { JuPrivate, PlanSnapshot } from "../db";
import type {
  AvatarLogEntry,
  DietTag,
  Ju,
  LedgerEntry,
  MapProvider,
  Member,
  MemberPrivate,
  NegotiationAsk,
  Notice,
  Plan,
  Profile,
  PublicFacts,
  TraceEvent,
} from "../types";
import { guardPlan, publicFacts, quorumHidden, rulePolish } from "./firewall";
import { HttpError } from "./http";
import { confirmedText, planText, quorumMetText } from "./ju-text";

// ---------------------------------------------------------------- 时间 / 思考流 / 公告

/** 叠加 admin.clockOffsetMin 的"演示时钟" */
export function nowFor(ju: Ju): Date {
  return new Date(Date.now() + (ju.admin?.clockOffsetMin ?? 0) * 60_000);
}

const TRACE_MAX = 80;
const ANNOUNCE_MAX = 40;

/** 追加一条思考流。id 由局 id + 递增序号构成（确定性：同样的操作序列得到同样的 id） */
export function appendTraceAt(ju: Ju, kind: TraceEvent["kind"], text: string, at: Date): void {
  const last = ju.trace.at(-1)?.id ?? "";
  const seq = Number(last.split("-t").at(-1)) || 0;
  ju.trace.push({ id: `${ju.id}-t${seq + 1}`, at: at.toISOString(), kind, text });
  if (ju.trace.length > TRACE_MAX) ju.trace.splice(0, ju.trace.length - TRACE_MAX);
}

export function announceAt(ju: Ju, text: string, at: Date): void {
  ju.announcements.push({ at: at.toISOString(), text });
  if (ju.announcements.length > ANNOUNCE_MAX) ju.announcements.splice(0, ju.announcements.length - ANNOUNCE_MAX);
}

export function notify(m: Member, kind: Notice["kind"], text: string, now: Date): void {
  if (!m.private) m.private = emptyPrivate();
  pushNotice(m, kind, text, now);
}

/** 进入下一阶段时，上一阶段的催促私信作废（标成已读），不再挂在别人顶上 */
export function expireNudges(members: Member[]): void {
  for (const m of members) for (const n of m.private?.inbox ?? []) if (n.kind === "nudge") n.read = true;
}

export function emptyPrivate(): MemberPrivate {
  return {
    chat: [],
    availability: {},
    dietTags: [],
    notes: [],
    swipes: {},
    autoFilled: [],
    wants: [],
    matches: [],
    billFacts: {},
    inbox: [],
  };
}

export const inOnly = (ms: Member[]) => ms.filter((m) => m.status === "in");

// ---------------------------------------------------------------- 名额 / 圈层（#2）

export function isTierOpen(ju: Ju, tier: number): boolean {
  if (tier <= 1) return true;
  return !!ju.admin?.tiers.find((t) => t.tier === tier)?.openedAt;
}

/** 名额还剩几个（没设上限 = 无穷） */
export function capacityLeft(ju: Ju, members: Member[]): number {
  if (!ju.capacity) return Infinity;
  return ju.capacity - inOnly(members).length;
}

/** 新来的 / 想回来的人：圈没开放或名额满 → 候补 */
export function admitStatus(ju: Ju, members: Member[], tier: number): "in" | "waitlist" {
  if (!isTierOpen(ju, tier)) return "waitlist";
  return capacityLeft(ju, members) > 0 ? "in" : "waitlist";
}

/**
 * 候补转正：按 (tier, joinedAt) 顺序，只转已开放圈层的人，直到名额用完。
 * 私信不提圈层，只说"名额确认了"。返回转正的人。
 */
export function promoteWaitlist(ju: Ju, members: Member[], now: Date, priv?: JuPrivate): Member[] {
  // 注意：定局后的转正由 B3 的 onMembershipChangedAfterConfirm 调本函数（和桌数调整、revision 私信一起），
  // B2 这边的调用点在定局后不调它，避免同一个人收到两条私信
  if (ju.status === "cancelled") return [];
  const queue = members
    .filter((m) => m.status === "waitlist" && isTierOpen(ju, m.secret?.tier ?? 1))
    .sort((a, b) => (a.secret?.tier ?? 1) - (b.secret?.tier ?? 1) || a.joinedAt.localeCompare(b.joinedAt) || (a.id < b.id ? -1 : 1));
  const promoted: Member[] = [];
  for (const m of queue) {
    if (capacityLeft(ju, members) <= 0) break;
    m.status = "in";
    promoted.push(m);
    notify(m, "promoted", "好消息！名额确认了，你已经在局里了 🎉", now);
    if (priv) markChanged(ju, priv, m.id);
  }
  return promoted;
}

// ---------------------------------------------------------------- 门限成局（#1）

/** rsvp=yes 的在局人数达到门槛 → met：公开名单揭晓、发公告、给大家发私信 */
export function evalQuorum(ju: Ju, members: Member[], now: Date): boolean {
  const q = ju.quorum;
  if (!q || q.state !== "pending" || ju.status === "cancelled") return false;
  const have = inOnly(members).filter((m) => m.private?.rsvp === "yes").length;
  if (have < q.min) return false;
  q.state = "met";
  q.metAt = now.toISOString();
  appendTraceAt(ju, "decide", `门限达成：${have} 位朋友私下说了"来"，局正式成立，名单揭晓`, now);
  announceAt(ju, quorumMetText(publicFacts(ju, members)), now);
  for (const m of inOnly(members)) notify(m, "quorum", `凑齐啦！${have} 位朋友都说了来，「${ju.title}」正式成局 🎉`, now);
  return true;
}

/** 门限截止还没达成 → failed，悄悄作废：不发群公告，只私下告诉说了"来"的人 */
export function failQuorumIfDue(ju: Ju, members: Member[], now: Date): boolean {
  const q = ju.quorum;
  if (!q || q.state !== "pending" || !q.deadline || now.getTime() < Date.parse(q.deadline)) return false;
  q.state = "failed";
  ju.status = "cancelled";
  appendTraceAt(ju, "done", "门限截止，这次没凑齐，局长悄悄收起了这个局", now);
  for (const m of members) {
    if (m.private?.rsvp === "yes" || m.isOrganizer) {
      notify(m, "quorum", "这次没凑齐，局长悄悄把局收起来了。放心，没有人知道谁说了来、谁没说。", now);
    }
  }
  return true;
}

// ---------------------------------------------------------------- 攒批重算（#4）

/** 方案出来之后的成员变化只记数，不立即重算（CONTRACT 第二节第 6 条） */
export function markChanged(ju: Ju, priv: JuPrivate, memberId: string): void {
  if (!ju.plan || ju.status !== "voting") return;
  if (!priv.pendingMembers.includes(memberId)) priv.pendingMembers.push(memberId);
  ju.pendingChanges = priv.pendingMembers.length;
}

export const BATCH_MIN_CHANGES = 2;
export const BATCH_MIN_INTERVAL_MS = 3 * 60_000;

export function lastPlanAt(ju: Ju, priv: JuPrivate): number {
  return Date.parse(priv.snapshot?.now ?? ju.plan?.computedAt ?? "") || 0;
}

/** pendingChanges ≥ 2 且距上次重算 ≥ 3 分钟 */
export function batchDue(ju: Ju, priv: JuPrivate, now: Date): boolean {
  return (
    ju.status === "voting" &&
    !!ju.plan &&
    priv.pendingMembers.length >= BATCH_MIN_CHANGES &&
    now.getTime() - lastPlanAt(ju, priv) >= BATCH_MIN_INTERVAL_MS
  );
}

// ---------------------------------------------------------------- 互选（#2）

/** 重新算 me 和其他人的互选。返回新成立的配对（对方 Member） */
export function recomputeMatches(members: Member[], me: Member, now: Date): Member[] {
  const fresh: Member[] = [];
  const myWants = new Set(me.private?.wants ?? []);
  for (const other of members) {
    if (other.id === me.id || !other.private || !me.private) continue;
    const mutual = myWants.has(other.id) && other.private.wants.includes(me.id);
    const had = me.private.matches.includes(other.id);
    if (mutual && !had) {
      me.private.matches.push(other.id);
      if (!other.private.matches.includes(me.id)) other.private.matches.push(me.id);
      fresh.push(other);
      notify(me, "match", `你和${other.name}互相都想认识，局长会安排你们坐一起 ✨`, now);
      notify(other, "match", `你和${me.name}互相都想认识，局长会安排你们坐一起 ✨`, now);
    } else if (!mutual && had) {
      me.private.matches = me.private.matches.filter((x) => x !== other.id);
      other.private.matches = other.private.matches.filter((x) => x !== me.id);
    }
  }
  return fresh;
}

// ---------------------------------------------------------------- 预填（#6）

/** 局长按档案替他预填（说"都行"，或截止时还没完成入局）。只填空着的字段 */
export function autofillMember(ju: Ju, m: Member, profile: Profile | undefined): boolean {
  if (!m.private) m.private = emptyPrivate();
  const p = m.private;
  const fill = autofillFromProfile(profile, ju);
  let changed = false;
  const mark = (k: MemberPrivate["autoFilled"][number]) => {
    if (!p.autoFilled.includes(k)) p.autoFilled.push(k);
    changed = true;
  };
  if (Object.keys(p.availability).length === 0 && Object.keys(fill.availability).length > 0) {
    p.availability = { ...fill.availability };
    mark("availability");
  }
  if (p.budgetMax === undefined && fill.budgetMax !== undefined) {
    p.budgetMax = fill.budgetMax;
    mark("budget");
  }
  if (p.dietTags.length === 0 && fill.dietTags.length > 0) {
    p.dietTags = [...fill.dietTags] as DietTag[];
    mark("diet");
  }
  if (!m.location && profile?.lastLocation) {
    m.location = { ...profile.lastLocation };
    changed = true;
  }
  return changed;
}

/** 截止 / 发起人出方案时，还没完成入局的人由局长预填，发 autofill 私信 */
export function autofillPending(ju: Ju, members: Member[], profiles: Record<string, Profile | undefined>, now: Date): number {
  let n = 0;
  for (const m of inOnly(members)) {
    if (m.intake === "done") continue;
    autofillMember(ju, m, m.profileId ? profiles[m.profileId] : undefined);
    if (!m.private!.rsvp) m.private!.rsvp = "yes";
    m.intake = "done";
    n++;
    notify(m, "autofill", "时间快到了，局长按你平时的习惯先帮你填好了，点进来 10 秒就能确认或修改～", now);
  }
  if (n > 0) appendTraceAt(ju, "listen", `${n} 位朋友还没聊完，局长按大家平时的习惯先预填了`, now);
  return n;
}

// ---------------------------------------------------------------- 出方案

export type PlanDeps = {
  map: MapProvider;
  now: Date;
  /** memberId -> 账本（从档案取） */
  ledgers: Record<string, LedgerEntry[]>;
  /** v5 让步账：memberId -> 最近答应过让步的次数 */
  concessions?: Record<string, number>;
  /** 公开 LLM 润色（B1 polishPlan）；不传 = 规则版 */
  polish?: (facts: PublicFacts, plan: Plan) => Promise<Plan>;
  /** v6 实时谈判：给了就由分身们一句句谈（锁外跑），没给 = 直接用规则版记录 */
  onLive?: (juId: string, computedAt: string) => void;
  /** 是否发群公告（反事实检验里也发，因为公告是公开输出的一部分） */
  announce?: boolean;
  /** v6 活动层：档案（profileId -> Profile），出方案时取每人的活动口味 / 身体限制（不传 = 只看本次说的） */
  profiles?: Record<string, Profile | undefined>;
  /** v6 让步账：谈判里自动让了步的人（DB 层记进档案的 concessions；不传 = 不记，反事实检验里就是这样） */
  onConcede?: (m: Member, juId: string, now: Date) => void;
};

type MapLog = Record<string, unknown>;

/** 包一层地图：记录每次调用的返回值，复算时回放 */
type CoreMethod = Exclude<keyof MapProvider, "weather" | "cityOfIp" | "cityAt">;

export function recordingMap(map: MapProvider, log: MapLog): MapProvider {
  const wrap =
    <K extends CoreMethod>(k: K) =>
    async (...args: unknown[]) => {
      const key = `${k}:${JSON.stringify(args)}`;
      const r = await (map[k] as (...a: unknown[]) => Promise<unknown>)(...args);
      log[key] = structuredClone(r);
      return r;
    };
  return {
    searchPlaces: wrap("searchPlaces") as MapProvider["searchPlaces"],
    reverseGeocode: wrap("reverseGeocode") as MapProvider["reverseGeocode"],
    searchAround: wrap("searchAround") as MapProvider["searchAround"],
    commute: wrap("commute") as MapProvider["commute"],
    transitRoute: wrap("transitRoute") as MapProvider["transitRoute"],
    // 天气也要记下来：复算时用当时的预报，否则天气一变哈希就对不上
    weather: async (center) => {
      const key = `weather:${JSON.stringify([center])}`;
      const r = map.weather ? await map.weather(center) : [];
      log[key] = structuredClone(r);
      return r;
    },
  };
}

/** 回放地图：有记录就用记录，没有再问真地图 */
export function replayMap(log: MapLog, fallback: MapProvider): MapProvider {
  const wrap =
    <K extends CoreMethod>(k: K) =>
    async (...args: unknown[]) => {
      const key = `${k}:${JSON.stringify(args)}`;
      if (key in log) return structuredClone(log[key]);
      return (fallback[k] as (...a: unknown[]) => Promise<unknown>)(...args);
    };
  return {
    searchPlaces: wrap("searchPlaces") as MapProvider["searchPlaces"],
    reverseGeocode: wrap("reverseGeocode") as MapProvider["reverseGeocode"],
    searchAround: wrap("searchAround") as MapProvider["searchAround"],
    commute: wrap("commute") as MapProvider["commute"],
    transitRoute: wrap("transitRoute") as MapProvider["transitRoute"],
    weather: async (center) => {
      const key = `weather:${JSON.stringify([center])}`;
      if (key in log) return structuredClone(log[key]) as Awaited<ReturnType<NonNullable<MapProvider["weather"]>>>;
      return fallback.weather ? fallback.weather(center) : [];
    },
  };
}

/** 调 C 的 planJu：同一份输入，出方案和复算走的是同一个函数 */
export async function runPlanner(
  ju: Ju,
  members: Member[],
  map: MapProvider,
  ledgers: Record<string, LedgerEntry[]>,
  now: Date,
  concessions: Record<string, number> = {},
  profiles: Record<string, ActivityProfile> = {},
) {
  if (!ju.admin?.auditSecret) throw new HttpError(500, "局缺少审计密钥");
  return planJu(ju, inOnly(members), map, {
    auditSecret: ju.admin.auditSecret,
    onTrace: (kind, text) => appendTraceAt(ju, kind, text, now),
    ledgers,
    now,
    concessions,
    profiles,
  });
}

/** memberId -> 档案里的活动口味 / 身体限制（只取活动层要用的两项；没有档案的人不出现） */
export function activityProfilesOf(members: Member[], profiles: Record<string, Profile | undefined> | undefined): Record<string, ActivityProfile> {
  const out: Record<string, ActivityProfile> = {};
  for (const m of members) {
    const p = m.profileId ? profiles?.[m.profileId] : undefined;
    if (!p || (!p.activityTastes && !p.body)) continue;
    out[m.id] = { ...(p.activityTastes ? { activityTastes: { ...p.activityTastes } } : {}), ...(p.body ? { body: [...p.body] } : {}) };
  }
  return out;
}

/**
 * 出方案 / 重算：C planJu → B1 polishPlan(publicFacts) → 防火墙兜底 → 存 plan、每人的 mine、输入快照。
 * 重算时思考流只说"有 N 位朋友更新了情况"。
 */
export async function computePlan(ju: Ju, members: Member[], priv: JuPrivate, deps: PlanDeps): Promise<void> {
  const ins = inOnly(members);
  if (ins.length === 0) throw new HttpError(400, "还没有人入局，先把链接发到群里吧");
  const now = deps.now;
  const replan = !!ju.plan;
  if (replan) {
    const n = priv.pendingMembers.length;
    appendTraceAt(ju, "listen", n > 0 ? `有 ${n} 位朋友更新了情况，局长重新算一遍` : "局长重新算一遍", now);
  } else {
    appendTraceAt(ju, "listen", `${ins.length} 位朋友都跟局长聊过了，开始出方案`, now);
  }

  // 快照：规划输入原样留一份（含私密数据，只在 ju_private 里）
  const snapJu = structuredClone(ju);
  const snapMembers = structuredClone(ins);
  const mapLog: MapLog = {};
  const activityProfiles = activityProfilesOf(ins, deps.profiles);

  let result: Awaited<ReturnType<typeof planJu>>;
  try {
    result = await runPlanner(ju, ins, recordingMap(deps.map, mapLog), deps.ledgers, now, deps.concessions ?? {}, activityProfiles);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, (e as Error)?.message || "出方案失败");
  }
  const { plan, mine, asks, avatar } = result;

  let polished: Plan;
  if (deps.polish) {
    let out: Plan | undefined;
    try {
      out = await deps.polish(publicFacts({ ...ju, plan }, members), structuredClone(plan));
    } catch (e) {
      console.warn(`[ju ${ju.id}] polishPlan 失败，用规则版：${(e as Error)?.message ?? e}`);
    }
    polished = guardPlan(ju, members, plan, out);
  } else {
    polished = rulePolish(plan);
  }

  const prevVotes = ju.votes;
  ju.plan = polished;
  ju.status = "voting";
  // 票保留：还在局里、投的方案还在
  const ids = new Set(polished.proposals.map((p) => p.id));
  const inIds = new Set(ins.map((m) => m.id));
  ju.votes = {};
  for (const [mid, pid] of Object.entries(prevVotes ?? {})) if (inIds.has(mid) && ids.has(pid)) ju.votes[mid] = pid;

  priv.mine = mine;
  const snapshot: PlanSnapshot = {
    ju: snapJu,
    members: snapMembers,
    ledgers: deps.ledgers,
    now: now.toISOString(),
    mapLog,
    ...(deps.concessions && Object.keys(deps.concessions).length ? { concessions: deps.concessions } : {}),
    ...(Object.keys(activityProfiles).length ? { profiles: activityProfiles } : {}),
  };
  priv.snapshot = snapshot;
  priv.pendingMembers = [];
  ju.pendingChanges = 0;
  priv.firstPlanAt ??= now.toISOString();

  // v6 实时谈判：公开记录先清空、标 live，后台由分身们一句句谈；超出授权的问题等分身自己决定要不要问主人
  const live = !!deps.onLive && !!polished.negotiation;
  if (live) {
    priv.live = { computedAt: polished.computedAt, template: structuredClone(polished.negotiation!), speakers: avatar.speakers, codes: avatar.codes, asks };
    polished.negotiation = { ...polished.negotiation!, events: [], status: "live" };
  } else delete priv.live;

  if (deps.announce !== false) announceAt(ju, planText(publicFacts(ju, members), replan), now);
  expireNudges(members);
  applyAvatar(ju, ins, avatar, now, deps.onConcede);
  if (!live) issueAsks(ins, asks, now);
  for (const m of ins) {
    if (live) {
      notify(m, "avatar", replan ? "有朋友更新了情况，分身们重新谈一轮——点开看直播" : "人齐了，分身们开始谈判了——点开看直播", now);
      continue;
    }
    if (ju.votes[m.id]) continue;
    notify(m, "nudge", replan ? "局长更新了方案，去看看还投不投原来那个？" : `局长出了 ${polished.proposals.length} 个方案，去投一票吧，过半就自动定局。`, now);
  }
  if (live) deps.onLive!(ju.id, polished.computedAt);
}

// ---------------------------------------------------------------- v6 分身：替你做了什么

/** 本人视图里最多留多少条 */
export const AVATAR_LOG_MAX = 30;
/** 结果公布后多久内可以撤回自动让步 */
export const REVOKE_WINDOW_MS = 30 * 60_000;

/**
 * 把这次谈判写进每个人的 avatarLog（只进本人 private）：这次重新生成的条目替换上一版；
 * 撤回过的自动让步（这一维 give 视为 0）和分身来问过的事保留。新的自动让步发一条站内信（kind = avatar），同一件事只发一次。
 */
export function applyAvatar(
  ju: Ju,
  members: Member[],
  avatar: { logs: Record<string, AvatarLogEntry[]>; conceded: string[] },
  now: Date,
  onConcede?: PlanDeps["onConcede"],
): void {
  for (const m of members) {
    const fresh = avatar.logs[m.id];
    if (!fresh) continue;
    const p = (m.private ??= emptyPrivate());
    const kept = (p.avatarLog ?? []).filter((e) => e.revoked || e.kind === "ask");
    const ids = new Set(kept.map((e) => e.id));
    p.avatarLog = [...kept, ...fresh.filter((e) => !ids.has(e.id))].slice(-AVATAR_LOG_MAX);
    for (const e of fresh) {
      if (e.kind !== "concede") continue;
      pushNoticeOnce(m, "avatar", `${ju.id}-${e.id}`, `你的分身${e.text}。不同意的话，30 分钟内可以在「分身替你做了什么」里撤回。`, now);
    }
  }
  if (onConcede) for (const id of avatar.conceded) {
    const m = members.find((x) => x.id === id);
    if (m) onConcede(m, ju.id, now);
  }
}

// ---------------------------------------------------------------- v5 协商：局长私下问（v6：由"你的分身"来问）

/** 把规划器给的问题草稿私下发出去（站内信 + 私聊里的是 / 否按钮）。只进本人 private */
export function issueAsks(members: Member[], drafts: AskDraft[], now: Date): number {
  let n = 0;
  for (const d of drafts) {
    const m = members.find((x) => x.id === d.memberId);
    if (!m) continue;
    const p = (m.private ??= emptyPrivate());
    if ((p.asks ?? []).some((a) => a.status === "pending")) continue;
    const ask: NegotiationAsk = {
      id: `a${(p.asks?.length ?? 0) + 1}`,
      kind: d.kind,
      text: d.text,
      ...(d.relax ? { relax: d.relax } : {}),
      ...(d.needKey ? { needKey: d.needKey } : {}),
      status: "pending",
      at: now.toISOString(),
    };
    p.asks = [...(p.asks ?? []), ask];
    notify(m, "ask", `你的分身来问你：${d.text}`, now);
    p.avatarLog = [...(p.avatarLog ?? []), { id: `ask-${ask.id}`, at: ask.at, kind: "ask" as const, text: `这一步超出了你给分身的授权，分身来问你：${d.text}` }].slice(
      -AVATAR_LOG_MAX,
    );
    n++;
  }
  return n;
}

/** 本人回答了：答应就放宽（时间门槛 / 这次不计较某条软偏好）；所有问题都答完了就重算 */
export function applyAnswer(m: Member, askId: string, yes: boolean, now: Date): NegotiationAsk {
  const p = (m.private ??= emptyPrivate());
  const ask = (p.asks ?? []).find((a) => a.id === askId);
  if (!ask) throw new HttpError(404, "没有这个问题");
  if (ask.status !== "pending") throw new HttpError(409, "这个问题已经回答过了");
  ask.status = yes ? "yes" : "no";
  ask.answeredAt = now.toISOString();
  if (yes && ask.relax) {
    p.relax = {
      maxLateMin: Math.max(p.relax?.maxLateMin ?? 0, ask.relax.maxLateMin ?? 0) || undefined,
      minStayMin: Math.min(p.relax?.minStayMin ?? 60, ask.relax.minStayMin ?? 60),
    };
    if (!p.relax.maxLateMin) delete p.relax.maxLateMin;
  }
  if (yes && ask.needKey) p.waived = [...new Set([...(p.waived ?? []), ask.needKey])];
  const log = (p.avatarLog ?? []).find((e) => e.id === `ask-${ask.id}`);
  if (log && !/你回答了/.test(log.text)) log.text += yes ? "——你回答了「可以」，分身照这个去谈" : "——你回答了「不行」，分身换别的办法";
  return ask;
}

export const pendingAsks = (members: Member[]) => members.some((m) => (m.private?.asks ?? []).some((a) => a.status === "pending"));

// ---------------------------------------------------------------- 投票 / 定局

export function confirmProposal(ju: Ju, members: Member[], proposalId: string, now: Date, how: "vote" | "admin" | "deadline"): void {
  if (!ju.plan?.proposals.some((p) => p.id === proposalId)) throw new HttpError(400, "这个方案不在候选里");
  ju.status = "confirmed";
  ju.confirmedProposalId = proposalId;
  expireNudges(members);
  const why = how === "vote" ? "过半朋友投给了同一个方案" : how === "deadline" ? "截止时间到，按局长推荐定局" : "发起人拍板";
  appendTraceAt(ju, "done", `定局：${why}`, now);
  announceAt(ju, confirmedText(publicFacts(ju, members)), now);
}

/** 记一票；在场者过半投同一方案就自动定局。返回是否定局 */
export function castVote(ju: Ju, members: Member[], me: Member, proposalId: string, now: Date): boolean {
  if (ju.status !== "voting" || !ju.plan) throw new HttpError(409, ju.status === "confirmed" ? "已经定局了" : "现在还不能投票");
  if (me.status !== "in") throw new HttpError(409, "你现在不在局里，不能投票");
  if (!ju.plan.proposals.some((p) => p.id === proposalId)) throw new HttpError(400, "这个方案不在候选里");
  ju.votes[me.id] = proposalId;
  const ins = inOnly(members);
  const n = ins.filter((m) => ju.votes[m.id] === proposalId).length;
  if (n * 2 > ins.length) {
    confirmProposal(ju, members, proposalId, now, "vote");
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- 成员状态

/**
 * 改一个人的 in / out（本人退出、私下说不来、想回来）。
 * 返回值告诉调用方：定局后的变化要交给 B3 的 onMembershipChangedAfterConfirm（锁外调用）。
 */
export function setMemberStatus(
  ju: Ju,
  members: Member[],
  m: Member,
  want: "in" | "out",
  now: Date,
  priv: JuPrivate,
): { changed: boolean; afterConfirm: boolean; promoted: Member[] } {
  const before = m.status;
  let promoted: Member[] = [];
  if (want === "out") {
    if (before === "out") return { changed: false, afterConfirm: false, promoted };
    m.status = "out";
    if (ju.votes[m.id]) delete ju.votes[m.id];
    if (before === "in") {
      markChanged(ju, priv, m.id);
      if (ju.status !== "confirmed") promoted = promoteWaitlist(ju, members, now, priv);
    }
  } else {
    if (before === "in") return { changed: false, afterConfirm: false, promoted };
    if (before === "waitlist") return { changed: false, afterConfirm: false, promoted }; // 候补只能等转正
    m.status = m.isOrganizer ? "in" : admitStatus(ju, members, m.secret?.tier ?? 1);
    if (m.private && m.private.rsvp === "no") m.private.rsvp = "yes";
    if (m.status === "in") markChanged(ju, priv, m.id);
  }
  const changedInOut = (before === "in") !== (m.status === "in") || promoted.length > 0;
  return { changed: before !== m.status, afterConfirm: ju.status === "confirmed" && changedInOut, promoted };
}

// ---------------------------------------------------------------- 定时推进（截止 / 攒批）

export type AdvanceDeps = Omit<PlanDeps, "now"> & { profiles: Record<string, Profile | undefined> };

/**
 * 幂等：到点的事情做掉。返回是否有改动。
 * - 门限截止未达成 → 悄悄作废
 * - 收集中 + 截止时间到 → 没完成入局的人预填，出方案
 * - 投票中 + 截止时间到（且第一次出方案早于截止）→ 有攒着的变化先重算，再按推荐定局
 * - 投票中 + pendingChanges ≥ 2 且距上次重算 ≥ 3 分钟 → 攒批重算
 */
/** 人齐了自动开谈的最少人数（两三个人的局直接让发起人点） */
export const AUTO_START_MIN = 3;

export async function advance(ju: Ju, members: Member[], priv: JuPrivate, now: Date, deps: AdvanceDeps): Promise<boolean> {
  let dirty = failQuorumIfDue(ju, members, now);
  if (ju.status === "cancelled") return dirty;
  const deadlinePassed = !!ju.deadline && now.getTime() >= Date.parse(ju.deadline);

  // v6 人齐了自动开谈：在局里的人（至少 3 位）都交了授权书，不等发起人点
  const ins = inOnly(members);
  if (ju.status === "collecting" && !quorumHidden(ju) && ins.length >= AUTO_START_MIN && ins.every((m) => m.intake === "done")) {
    appendTraceAt(ju, "listen", `人齐了：${ins.length} 位朋友都把授权书交给了分身，开谈`, now);
    await computePlan(ju, members, priv, { ...deps, now });
    return true;
  }

  if (ju.status === "collecting" && deadlinePassed && !quorumHidden(ju) && inOnly(members).length > 0) {
    appendTraceAt(ju, "listen", "截止时间到了", now);
    autofillPending(ju, members, deps.profiles, now);
    await computePlan(ju, members, priv, { ...deps, now });
    return true;
  }

  if (ju.status === "voting" && ju.plan) {
    const firstPlanBeforeDeadline = !!priv.firstPlanAt && !!ju.deadline && Date.parse(priv.firstPlanAt) < Date.parse(ju.deadline);
    if (deadlinePassed && firstPlanBeforeDeadline) {
      if (priv.pendingMembers.length > 0) await computePlan(ju, members, priv, { ...deps, now });
      const rec = ju.plan.proposals.find((p) => p.recommended) ?? ju.plan.proposals[0];
      if (rec) confirmProposal(ju, members, rec.id, now, "deadline");
      return true;
    }
    if (batchDue(ju, priv, now)) {
      await computePlan(ju, members, priv, { ...deps, now });
      dirty = true;
    }
  }
  return dirty;
}

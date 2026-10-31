// 业务逻辑（DB 层）：route 文件只做参数解析，真正的事都在这里；状态机本身在 ju-core.ts（纯内存）。
// 同一个局的所有写操作经 withJuLock 串行化（planJu / LLM 是 async，避免并发覆盖）。
// 给 B3 用的导出：withJuLock / loadJu / nowFor / memberByToken / appendTrace / announce / advanceJu / mutateJu。
import { randomBytes } from "node:crypto";
import { customAlphabet, nanoid } from "nanoid";
import * as db from "../db";
import type { JuPrivate } from "../db";
import { groupMessages, parseChatScreenshot, parsePrompt, polishPlan } from "../llm";
import { getMapProvider } from "../map";
import { generateSlots } from "../planner";
import type {
  ChatScreenshotParse,
  GroupMessages,
  Ju,
  JuSpec,
  JuState,
  LedgerEntry,
  Member,
  Profile,
  SeedMember,
  Slot,
  TraceEvent,
} from "../types";
import { decorateItinerary } from "./after/actions";
import { onMembershipChangedAfterConfirm } from "./after/changes";
import { cachedItinerary } from "./after/scheduler";
import { findByToken, guardMessages, publicFacts, publicState, quorumHidden, safeEqual } from "./firewall";
import { HttpError } from "./http";
import {
  advance,
  announceAt,
  appendTraceAt,
  autofillPending,
  castVote,
  computePlan,
  confirmProposal,
  evalQuorum,
  markChanged,
  nowFor,
  promoteWaitlist,
  replayMap,
  runPlanner,
  setMemberStatus,
  type AdvanceDeps,
} from "./ju-core";
import { createdText, ruleGroupMessages } from "./ju-text";
import { getProfile, rememberVote } from "./profile";
import type { CreateJuInput, PatchJuInput, PatchMemberInput } from "./schemas";

export { nowFor };

export const AVATARS = ["🐱", "🦊", "🐼", "🐸", "🐯", "🐰", "🐧", "🦄", "🐨", "🐶", "🐻", "🐹"];
export const TIER_LABELS = ["核心圈", "好友圈", "扩展圈"];

const juId = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 8);

export function defaultCity(): string {
  return (process.env.DEMO_CITY ?? "").trim() || "上海";
}

/** 发起人那句话没提城市时用哪个城市：先按 IP 猜（全国），猜不到再用兜底城市 */
export async function cityGuess(ip: string | undefined): Promise<{ city: string; from: "ip" | "default" }> {
  if (ip) {
    const map = getMapProvider();
    const c = map.cityOfIp ? await map.cityOfIp(ip).catch(() => undefined) : undefined;
    if (c) return { city: c, from: "ip" };
  }
  return { city: defaultCity(), from: "default" };
}

/** 城市是不是发起人亲口说的：原话里出现了这个城市名 */
export function withCityFrom(spec: JuSpec, text: string, guessed: "ip" | "default"): JuSpec {
  const said = !!spec.city && text.includes(spec.city.replace(/市$/, ""));
  return { ...spec, cityFrom: said ? "said" : guessed };
}

export type Viewer = { memberToken?: string; adminToken?: string };

// ---------------------------------------------------------------- 锁

const g = globalThis as unknown as { __juLocks?: Map<string, Promise<unknown>> };
const locks = (g.__juLocks ??= new Map());

/** 同一个局串行执行。注意：不可重入，锁里不要再调会拿锁的函数（如 B3 的 onMembershipChangedAfterConfirm） */
export async function withJuLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  try {
    return await run;
  } finally {
    if (locks.get(id) === tail) locks.delete(id);
  }
}

// ---------------------------------------------------------------- 读

export function loadJu(id: string): Ju {
  const ju = db.getJu(id);
  if (!ju) throw new HttpError(404, "局不存在");
  return ju;
}

export function loadMembers(id: string): Member[] {
  return db.listMembers(id);
}

/** 按 x-member-token 找人：没带 401，带错 403（常数时间比较） */
export function memberByToken(juId: string, token: string): Member {
  loadJu(juId);
  if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
  const m = findByToken(db.listMembers(juId), token);
  if (!m) throw new HttpError(403, "成员身份不对");
  return m;
}

export function isAdminToken(juId: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = db.getAdminToken(juId);
  return expected !== null && safeEqual(expected, token);
}

/** 追加一条思考流（用演示时钟），调用方负责保存 */
export function appendTrace(ju: Ju, kind: TraceEvent["kind"], text: string): void {
  appendTraceAt(ju, kind, text, nowFor(ju));
}

/** #8 追加一条群公告（用演示时钟），调用方负责保存 */
export function announce(ju: Ju, text: string): void {
  announceAt(ju, text, nowFor(ju));
}

export function getState(id: string, viewer?: Viewer): JuState {
  const ju = loadJu(id);
  return publicState(ju, db.listMembers(id), viewer);
}

/** GET /api/ju/:id：在 getState 基础上，定局后给本人视图附上行程卡（B3 的 cachedItinerary + decorateItinerary） */
export async function getStateFull(id: string, viewer?: Viewer): Promise<JuState> {
  const ju = loadJu(id);
  const members = db.listMembers(id);
  const st = publicState(ju, members, viewer);
  const p = ju.status === "confirmed" ? ju.plan?.proposals.find((x) => x.id === ju.confirmedProposalId) : undefined;
  const me = st.me ? members.find((m) => m.id === st.me!.id) : undefined;
  if (p && me && me.status === "in" && st.mine) {
    try {
      st.mine.itinerary = decorateItinerary(ju, me, await cachedItinerary(ju, me, p));
    } catch (e) {
      console.warn(`[ju ${id}] 行程卡生成失败：${(e as Error)?.message ?? e}`);
    }
  }
  return st;
}

// ---------------------------------------------------------------- 写：统一的"加锁 → 读 → 改 → 存"

export type MutateCtx = {
  ju: Ju;
  members: Member[];
  priv: JuPrivate;
  now: Date;
  /** 置为 true：定局后在场名单变了，锁释放后交给 B3 的 onMembershipChangedAfterConfirm */
  afterConfirm?: string;
  /** 置为 false：不保存 */
  save?: boolean;
};

/** 加锁读出局 + 全部成员 + 私密区，跑 fn，事务保存。B3 也可以用 */
export async function mutateJu<T>(id: string, fn: (ctx: MutateCtx) => Promise<T> | T): Promise<T> {
  let hook: string | undefined;
  const r = await withJuLock(id, async () => {
    const ju = loadJu(id);
    const ctx: MutateCtx = { ju, members: db.listMembers(id), priv: db.getJuPrivate(id), now: nowFor(ju) };
    const out = await fn(ctx);
    if (ctx.save !== false) {
      db.tx(() => {
        db.saveJu(ctx.ju);
        for (const m of ctx.members) db.upsertMember(m);
        db.saveJuPrivate(id, ctx.priv);
      });
    }
    hook = ctx.afterConfirm;
    return out;
  });
  if (hook) {
    try {
      await onMembershipChangedAfterConfirm(id, hook);
    } catch (e) {
      console.warn(`[ju ${id}] onMembershipChangedAfterConfirm 失败：${(e as Error)?.message ?? e}`);
    }
  }
  return r;
}

export function profilesFor(members: Member[]): Record<string, Profile | undefined> {
  const out: Record<string, Profile | undefined> = {};
  for (const m of members) if (m.profileId) out[m.profileId] = getProfile(m.profileId) ?? undefined;
  return out;
}

/** memberId -> 档案里的账本（#10） */
export function ledgersFor(members: Member[]): Record<string, LedgerEntry[]> {
  const out: Record<string, LedgerEntry[]> = {};
  for (const m of members) {
    if (m.status !== "in" || !m.profileId) continue;
    const p = getProfile(m.profileId);
    if (p?.ledger.length) out[m.id] = p.ledger;
  }
  return out;
}

/** v5 让步账：memberId -> 最近 6 局里答应过让步的次数（从档案取） */
export function concessionsFor(members: Member[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of members) {
    if (m.status !== "in" || !m.profileId) continue;
    const n = (getProfile(m.profileId)?.concessions ?? []).slice(-6).length;
    if (n) out[m.id] = n;
  }
  return out;
}

export function planDeps(members: Member[]): AdvanceDeps {
  return {
    map: getMapProvider(),
    ledgers: ledgersFor(members),
    concessions: concessionsFor(members),
    profiles: profilesFor(members),
    polish: polishPlan,
  };
}

// ---------------------------------------------------------------- 解析 / 建局

export async function previewParse(prompt: string, ip?: string): Promise<{ title: string; spec: JuSpec; slots: Slot[] }> {
  const g = await cityGuess(ip);
  const parsed = await parsePrompt(prompt, new Date(), g.city);
  const spec = withCityFrom(parsed.spec, prompt, g.from);
  return { title: parsed.title, spec, slots: generateSlots(spec) };
}

export async function previewScreenshot(image: string, ip?: string): Promise<ChatScreenshotParse & { slots: Slot[] }> {
  const g = await cityGuess(ip);
  const r = await parseChatScreenshot(image, new Date(), g.city);
  const spec: JuSpec = { ...r.spec, cityFrom: r.spec.city === g.city ? g.from : "said" };
  return { ...r, spec, slots: generateSlots(spec) };
}

export async function createJu(input: CreateJuInput, extra: { prevJuId?: string; ip?: string } = {}): Promise<{
  id: string;
  adminToken: string;
  tierLinks: { tier: number; label: string; token: string }[];
}> {
  const now = new Date();
  let title: string;
  let spec: JuSpec;
  if (input.spec) {
    spec = input.spec as JuSpec;
    title = input.title ?? `${spec.category}局`;
  } else {
    if (!input.prompt) throw new HttpError(400, "请说一句话描述这个局，或者直接传 spec");
    const g = await cityGuess(extra.ip);
    const parsed = await parsePrompt(input.prompt, now, g.city);
    spec = withCityFrom(parsed.spec, input.prompt, g.from);
    title = input.title ?? parsed.title;
  }
  const slots = generateSlots(spec);
  if (slots.length === 0) throw new HttpError(400, "没有可选的时间，检查一下日期和时间段");

  const tierCount = input.tiers ?? 1;
  const tiers = Array.from({ length: tierCount }, (_, i) => ({
    token: nanoid(16),
    tier: i + 1,
    label: TIER_LABELS[i] ?? `扩展圈${i + 1}`,
    ...(i === 0 ? { openedAt: now.toISOString() } : {}),
  }));
  const seeds: SeedMember[] | undefined = input.seeds?.map((s, i) => ({
    id: `s${i + 1}`,
    name: s.name,
    said: s.said,
    ...(s.quote ? { quote: s.quote } : {}),
    ...(s.hint ? { hint: s.hint } : {}),
  }));

  const ju: Ju = {
    id: juId(),
    title,
    rawPrompt: input.prompt,
    ...(input.organizerName ? { organizerName: input.organizerName } : {}),
    spec,
    slots,
    status: "collecting",
    createdAt: now.toISOString(),
    ...(input.deadline ? { deadline: input.deadline } : {}),
    votes: {},
    trace: [],
    ...(input.quorum
      ? { quorum: { min: input.quorum.min, state: "pending" as const, ...(input.quorum.deadline ? { deadline: input.quorum.deadline } : {}) } }
      : {}),
    ...(input.capacity ? { capacity: input.capacity } : {}),
    ...(seeds?.length ? { seeds } : {}),
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    ...(extra.prevJuId ? { prevJuId: extra.prevJuId } : {}),
    admin: { tiers, auditSecret: randomBytes(32).toString("hex"), clockOffsetMin: 0 },
  };
  appendTraceAt(
    ju,
    "listen",
    `收到需求：${spec.category}，${spec.dates.length} 天 × ${slots.length} 个时段${ju.quorum ? `，凑够 ${ju.quorum.min} 人才成局` : ""}`,
    now,
  );
  announceAt(ju, createdText(publicFacts(ju, [])), now);
  const adminToken = nanoid(24);
  db.insertJu(ju, adminToken);
  return { id: ju.id, adminToken, tierLinks: tiers.map((t) => ({ tier: t.tier, label: t.label, token: t.token })) };
}

export function patchJu(id: string, patch: PatchJuInput, viewer: Viewer): Promise<JuState> {
  return mutateJu(id, (ctx) => {
    const { ju, members, now } = ctx;
    if (patch.title !== undefined) ju.title = patch.title;
    if (patch.deadline !== undefined) {
      if (patch.deadline === null) delete ju.deadline;
      else ju.deadline = patch.deadline;
    }
    if (patch.capacity !== undefined) {
      if (patch.capacity === null) delete ju.capacity;
      else ju.capacity = patch.capacity;
      if (ju.status === "confirmed") ctx.afterConfirm = "名额有调整";
      else if (promoteWaitlist(ju, members, now, ctx.priv).length) evalQuorum(ju, members, now);
    }
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

// ---------------------------------------------------------------- 出方案 / 复核

/** 发起人点"出方案"（也是攒批重算的触发条件之一） */
export function makePlan(id: string, viewer: Viewer): Promise<JuState> {
  return mutateJu(id, async (ctx) => {
    const { ju, members, priv, now } = ctx;
    if (ju.status === "cancelled") throw new HttpError(409, "局已取消");
    if (ju.status === "confirmed") throw new HttpError(409, "已经定局了，有变化局长会自动微调");
    if (quorumHidden(ju)) throw new HttpError(409, "还没凑够人数，成局之后才能出方案");
    const deps = planDeps(members);
    autofillPending(ju, members, deps.profiles, now);
    await computePlan(ju, members, priv, { ...deps, now });
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

/** #9 一键复算：用出方案时的输入快照（含当时的地图返回）重跑，比对 outputHash */
export async function verifyPlan(id: string): Promise<{ ok: boolean; inputHash: string; outputHash: string; recomputedOutputHash: string }> {
  const ju = loadJu(id);
  const priv = db.getJuPrivate(id);
  if (!ju.plan || !priv.snapshot) throw new HttpError(409, "还没出方案");
  const snap = structuredClone(priv.snapshot);
  const { plan } = await runPlanner(
    snap.ju,
    snap.members,
    replayMap(snap.mapLog, getMapProvider()),
    snap.ledgers,
    new Date(snap.now),
    snap.concessions ?? {},
  );
  const a = ju.plan.audit;
  return {
    ok: plan.audit.outputHash === a.outputHash && plan.audit.inputHash === a.inputHash,
    inputHash: a.inputHash,
    outputHash: a.outputHash,
    recomputedOutputHash: plan.audit.outputHash,
  };
}

// ---------------------------------------------------------------- 投票 / 定局

export function vote(id: string, token: string, proposalId: string, viewer: Viewer): Promise<JuState> {
  return mutateJu(id, (ctx) => {
    const me = findByToken(ctx.members, token);
    if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
    if (!me) throw new HttpError(403, "成员身份不对");
    castVote(ctx.ju, ctx.members, me, proposalId, ctx.now);
    // v6：投了哪个方案 → 分身猜一点口味（只写本人档案）
    rememberVote(me, ctx.ju, proposalId, ctx.now);
    return publicState(ctx.ju, ctx.members, viewer, { mine: ctx.priv.mine });
  });
}

export function confirm(id: string, proposalId: string, viewer: Viewer): Promise<JuState> {
  return mutateJu(id, (ctx) => {
    const { ju } = ctx;
    if (ju.status === "cancelled") throw new HttpError(409, "局已取消");
    if (ju.status === "confirmed") throw new HttpError(409, "已经定局了");
    if (!ju.plan) throw new HttpError(409, "还没出方案");
    confirmProposal(ju, ctx.members, proposalId, ctx.now, "admin");
    return publicState(ju, ctx.members, viewer, { mine: ctx.priv.mine });
  });
}

// ---------------------------------------------------------------- 成员 / 圈层

/** 本人：{ status: in | out }；发起人：{ role } */
export function patchMember(id: string, mid: string, body: PatchMemberInput, viewer: Viewer): Promise<JuState> {
  const admin = isAdminToken(id, viewer.adminToken);
  return mutateJu(id, (ctx) => {
    const { ju, members, now, priv } = ctx;
    const target = members.find((m) => m.id === mid);
    if (!target) throw new HttpError(404, "成员不存在");
    const self = findByToken(members, viewer.memberToken);
    const isSelf = !!self && self.id === mid;
    if (!admin && !isSelf) {
      throw new HttpError(viewer.memberToken || viewer.adminToken ? 403 : 401, "只能改自己，或由发起人修改");
    }
    if (body.role !== undefined) {
      if (!admin) throw new HttpError(403, "只有发起人能标主角");
      if (target.role !== body.role) {
        target.role = body.role;
        markChanged(ju, priv, target.id);
      }
    }
    if (body.status !== undefined) {
      if (!isSelf) throw new HttpError(403, "来不来只能本人说了算");
      const r = setMemberStatus(ju, members, target, body.status, now, priv);
      if (body.status === "out" && target.private) target.private.rsvp = "no";
      if (r.changed) evalQuorum(ju, members, now);
      if (r.afterConfirm) ctx.afterConfirm = body.status === "out" ? "有朋友来不了了" : "有朋友加入了";
    }
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

/** #2 开放下一圈：该圈候补的人按顺序转正（名额允许的话） */
export function openTier(id: string, tier: number, viewer: Viewer): Promise<JuState> {
  return mutateJu(id, (ctx) => {
    const { ju, members, now } = ctx;
    const t = ju.admin?.tiers.find((x) => x.tier === tier);
    if (!t) throw new HttpError(404, "没有这一圈");
    if (!t.openedAt) t.openedAt = now.toISOString();
    if (ju.status === "confirmed") {
      // 定局后的转正交给 B3 的稳定重规划（它会一起调桌数、发一条合并的私信）
      appendTraceAt(ju, "decide", "放出了更多名额", now);
      if (members.some((m) => m.status === "waitlist" && (m.secret?.tier ?? 1) === tier)) ctx.afterConfirm = "又放出了名额";
    } else {
      const promoted = promoteWaitlist(ju, members, now, ctx.priv);
      appendTraceAt(ju, "decide", promoted.length ? `又放出了名额，${promoted.length} 位朋友确认入局` : "放出了更多名额", now);
      if (promoted.length) evalQuorum(ju, members, now);
    }
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

// ---------------------------------------------------------------- 群消息

/** GET /api/ju/:id/messages：B1 groupMessages(publicFacts) → 防火墙兜底 → 规则版 */
export async function messagesFor(id: string): Promise<GroupMessages> {
  const ju = loadJu(id);
  const members = db.listMembers(id);
  const facts = publicFacts(ju, members);
  const fallback = ruleGroupMessages(facts);
  let out: GroupMessages | undefined;
  try {
    out = await groupMessages(facts);
  } catch (e) {
    console.warn(`[ju ${id}] groupMessages 失败，用规则版：${(e as Error)?.message ?? e}`);
  }
  return guardMessages(ju, members, out, fallback);
}

// ---------------------------------------------------------------- 定时推进（给 B3 的 tickJu 调）

/**
 * 幂等：门限截止 / 方案截止（预填 + 出方案 / 按推荐定局）/ 攒批重算。
 * B3 的 tickJu 和 GET /api/ju/:id 都会调到；没有到点的事情时不写库。
 */
export async function advanceJu(id: string): Promise<void> {
  const quick = db.getJu(id);
  if (!quick || quick.status === "cancelled") return;
  await mutateJu(id, async (ctx) => {
    const dirty = await advance(ctx.ju, ctx.members, ctx.priv, ctx.now, planDeps(ctx.members));
    if (!dirty) ctx.save = false;
  });
}

/** B3 的 tickJu 按这个名字找截止动作（after/core.ts runCoreDeadlines） */
export const runDeadlines = advanceJu;

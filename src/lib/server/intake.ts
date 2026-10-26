// 入局：认领截图里的自己（#3）→ 私聊局长（#4 #5 #6 #7）→ 刷卡（#6）→ 想认识谁（#2）。
// 私聊 LLM 会看到本人私密信息，但它的输出只回给本人（这里的返回值只给带本人 token 的请求）。
// LLM / 课表解析 / 地图都是慢操作：放在锁外跑，锁里只做"读 → 改 → 存"。
import { nanoid } from "nanoid";
import { chatTurn, parseSchedule } from "../llm";
import { getMapProvider } from "../map";
import { availabilityFromBusy, buildSwipeDeck, predictSwipes } from "../planner";
import type {
  ChatPatch,
  ChatReply,
  DayAvailability,
  DietTag,
  Member,
  Poi,
  Profile,
  SwipeVerdict,
} from "../types";
import { findByToken, quorumHidden, safeEqual, selfMember, visibleMembers } from "./firewall";
import { HttpError } from "./http";
import { AVATARS, isAdminToken, loadJu, loadMembers, mutateJu, type MutateCtx, type Viewer } from "./ju";
import {
  admitStatus,
  autofillMember,
  emptyPrivate,
  evalQuorum,
  inOnly,
  markChanged,
  recomputeMatches,
  setMemberStatus,
} from "./ju-core";
import { getProfile, learnFromMember, saveProfile } from "./profile";
import type { ChatBody, JoinInput } from "./schemas";
import { prefillKnow } from "./social";

const DIET: readonly DietTag[] = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"];

function pickAvatar(members: Member[]): string {
  const used = new Set(members.map((m) => m.avatar));
  return AVATARS.find((a) => !used.has(a)) ?? AVATARS[members.length % AVATARS.length];
}

function requireMe(ctx: MutateCtx, token: string | undefined): Member {
  if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
  const me = findByToken(ctx.members, token);
  if (!me) throw new HttpError(403, "成员身份不对");
  if (!me.private) me.private = emptyPrivate();
  return me;
}

function profileOf(m: Member): Profile | undefined {
  return m.profileId ? (getProfile(m.profileId) ?? undefined) : undefined;
}

// ---------------------------------------------------------------- 应用私聊 / 组件提交的更新

/**
 * 把一轮私聊抽出的 patch（或组件提交的结构化数据）写进本人。
 * - rsvp=no → status out（#5，公开视图里直接消失），空出的名额给候补
 * - 方案出来之后，已完成入局的人改了东西 → 只记 pendingChanges，不立即重算（#4）
 */
export function applyPatch(ctx: MutateCtx, me: Member, patch: ChatPatch, profile: Profile | undefined): void {
  const { ju, members, now, priv } = ctx;
  const p = (me.private ??= emptyPrivate());
  let planInputChanged = false;
  const unflag = (k: (typeof p.autoFilled)[number]) => {
    p.autoFilled = p.autoFilled.filter((x) => x !== k);
  };

  if (patch.name?.trim()) me.name = patch.name.trim().slice(0, 20);
  if (patch.location && Number.isFinite(patch.location.lat) && Number.isFinite(patch.location.lng)) {
    me.location = { lat: patch.location.lat, lng: patch.location.lng, label: (patch.location.label ?? "").slice(0, 100) };
    planInputChanged = true;
  }
  if (patch.availability) {
    const dates = new Set(ju.spec.dates);
    const next: Record<string, DayAvailability> = {};
    for (const [d, a] of Object.entries(patch.availability)) if (dates.has(d) && a?.from) next[d] = a;
    if (Object.keys(next).length) {
      // 自己说的时间覆盖局长预填的
      p.availability = p.autoFilled.includes("availability") ? next : { ...p.availability, ...next };
      unflag("availability");
      planInputChanged = true;
    }
  }
  if (patch.dietTags) {
    p.dietTags = [...new Set(patch.dietTags.filter((t) => DIET.includes(t)))];
    unflag("diet");
    planInputChanged = true;
  }
  if (patch.budgetMax !== undefined && Number.isFinite(patch.budgetMax) && patch.budgetMax > 0) {
    p.budgetMax = Math.round(patch.budgetMax);
    unflag("budget");
    planInputChanged = true;
  }
  if (patch.note?.trim()) {
    const n = patch.note.trim().slice(0, 120);
    if (!p.notes.includes(n)) p.notes.push(n);
    planInputChanged = true;
  }
  if (patch.billFacts) p.billFacts = { ...p.billFacts, ...patch.billFacts };
  if (patch.wantsAutofill) planInputChanged = autofillMember(ju, me, profile) || planInputChanged;

  if (patch.rsvp) {
    p.rsvp = patch.rsvp;
    if (patch.rsvp === "no") {
      const r = setMemberStatus(ju, members, me, "out", now, priv);
      if (r.afterConfirm) ctx.afterConfirm = "有朋友临时来不了了";
    } else if (me.status === "out") {
      const r = setMemberStatus(ju, members, me, "in", now, priv);
      if (r.afterConfirm) ctx.afterConfirm = "有朋友加入了";
    }
    evalQuorum(ju, members, now);
  }
  if (planInputChanged && me.intake === "done" && me.status === "in") markChanged(ju, priv, me.id);
}

/** 组件提交 → 写进私聊记录的一句话（只在本人私聊里，不出去） */
function describeWidget(w: ChatPatch, scheduleBlocks?: number): string {
  const parts: string[] = [];
  if (w.rsvp) parts.push(w.rsvp === "yes" ? "我能来" : "这次来不了");
  if (w.location) parts.push(`我从${w.location.label || "这里"}出发`);
  if (scheduleBlocks !== undefined) parts.push(`（发了课表，识别出 ${scheduleBlocks} 段课）`);
  else if (w.availability) {
    const days = Object.entries(w.availability).sort(([a], [b]) => (a < b ? -1 : 1));
    parts.push(
      days
        .map(([d, a]) => `${d.slice(5)} ${a.from} 后能出发${a.homeBy ? `，${a.homeBy} 前要回` : ""}`)
        .join("；"),
    );
  }
  if (w.dietTags) parts.push(w.dietTags.length ? `忌口：${w.dietTags.join("、")}` : "没有忌口");
  if (w.budgetMax !== undefined) parts.push(`人均 ${w.budgetMax} 以内比较舒服`);
  if (w.wantsAutofill) parts.push("都行，你定");
  return parts.join("，");
}

// ---------------------------------------------------------------- join

export async function join(
  juId: string,
  input: JoinInput,
  viewer: Viewer,
): Promise<{ memberId: string; memberToken: string; status: Member["status"]; opening: ChatReply }> {
  const admin = isAdminToken(juId, viewer.adminToken);
  const profile = input.profileId ? (getProfile(input.profileId) ?? undefined) : undefined;

  const created = await mutateJu(juId, (ctx) => {
    const { ju, members, now } = ctx;
    if (ju.status === "cancelled") throw new HttpError(409, "这个局已经取消了");

    // 同一台设备再次进来（换了浏览器标签 / token 丢了）：认回原来那个人
    if (input.profileId) {
      const again = members.find((m) => m.profileId === input.profileId && m.secret);
      if (again) {
        ctx.save = false;
        const last = [...(again.private?.chat ?? [])].reverse().find((t) => t.role === "juzhang");
        return { m: structuredClone(again), resumed: last?.text, ju: structuredClone(ju), quorumPending: quorumHidden(ju), now };
      }
    }

    let tier = 1;
    if (input.tierToken) {
      const t = ju.admin?.tiers.find((x) => safeEqual(x.token, input.tierToken!));
      if (!t) throw new HttpError(400, "邀请链接不对，找发起人要一个新的吧");
      tier = t.tier;
    }
    const isOrganizer = !!input.isOrganizer && (admin || !members.some((m) => m.isOrganizer));
    if (input.isOrganizer && !isOrganizer) throw new HttpError(403, "需要发起人权限（x-admin-token）");

    const seed = input.seedId ? ju.seeds?.find((s) => s.id === input.seedId) : undefined;
    if (input.seedId && !seed) throw new HttpError(400, "截图里没有这个人");
    if (seed?.claimedBy && members.some((m) => m.id === seed.claimedBy)) throw new HttpError(409, "这位已经被认领了");

    const name = (input.name || seed?.name || profile?.name || "").trim().slice(0, 20);
    if (!name) throw new HttpError(400, "名字不能为空");

    const m: Member = {
      id: nanoid(10),
      juId,
      name,
      avatar: input.avatar || profile?.avatar || pickAvatar(members),
      role: "guest",
      intake: "chatting",
      status: isOrganizer ? "in" : admitStatus(ju, members, tier),
      joinedAt: now.toISOString(),
      isOrganizer,
      ...(input.profileId ? { profileId: input.profileId } : {}),
      private: emptyPrivate(),
      secret: { token: nanoid(24), tier },
    };
    if (seed) {
      seed.claimedBy = m.id;
      m.seedId = seed.id;
    }
    members.push(m);
    // #21 同一拨人再约：局长记得上次谁和谁同桌、谁和谁聊得来（各自档案里的记忆，双向预填）
    prefillKnow(members, m);
    if (m.status === "in" && ju.status === "confirmed") ctx.afterConfirm = "有朋友加入了";
    return { m: structuredClone(m), resumed: undefined as string | undefined, ju: structuredClone(ju), quorumPending: quorumHidden(ju), now };
  });

  const { m } = created;
  if (created.resumed !== undefined || (m.private?.chat.length ?? 0) > 0) {
    return {
      memberId: m.id,
      memberToken: m.secret!.token,
      status: m.status,
      opening: { reply: created.resumed ?? "欢迎回来～我们接着聊。", widget: null, quickReplies: [], done: m.intake !== "chatting" },
    };
  }

  const r = await chatTurn({
    ju: created.ju,
    me: m,
    ...(profile ? { profile } : {}),
    userText: null,
    quorumPending: created.quorumPending,
    now: created.now,
  });
  await mutateJu(juId, (ctx) => {
    const me = ctx.members.find((x) => x.id === m.id);
    if (!me) return;
    const p = (me.private ??= emptyPrivate());
    p.chat.push({ role: "juzhang", text: r.reply, at: ctx.now.toISOString(), ...(r.ask ? { ask: r.ask } : {}) });
    applyPatch(ctx, me, r.patch ?? {}, profile);
  });
  return {
    memberId: m.id,
    memberToken: m.secret!.token,
    status: m.status,
    opening: { reply: r.reply, widget: r.widget, quickReplies: r.quickReplies, done: r.done },
  };
}

// ---------------------------------------------------------------- chat

const WIDGET_KEYS = ["rsvp", "location", "availability", "dietTags", "budgetMax", "wantsAutofill"] as const;

export async function chat(juId: string, token: string, body: ChatBody): Promise<ChatReply & { me: Member }> {
  // 0) 课表截图 → 忙碌时段 → 每天的可出发时间（#7），锁外做
  let scheduleAvail: Record<string, DayAvailability> | undefined;
  let scheduleBlocks: number | undefined;
  if (body.schedule) {
    const ju0 = loadJu(juId);
    const me0 = findByToken(loadMembers(juId), token);
    if (!me0) throw new HttpError(token ? 403 : 401, "成员身份不对");
    const { busy } = await parseSchedule(body.schedule);
    const first = Object.values(me0.private?.availability ?? {})[0];
    scheduleAvail = availabilityFromBusy(busy, ju0.spec, first ? { from: first.from, homeBy: first.homeBy } : undefined);
    scheduleBlocks = busy.length;
  }

  const widget: ChatPatch = {};
  if (body.rsvp) widget.rsvp = body.rsvp;
  if (body.location) widget.location = body.location;
  if (scheduleAvail ?? body.availability) widget.availability = scheduleAvail ?? body.availability;
  if (body.dietTags) widget.dietTags = body.dietTags as DietTag[];
  if (body.budgetMax !== undefined) widget.budgetMax = body.budgetMax;
  if (body.autofill) widget.wantsAutofill = true;
  const text = body.text?.trim() || describeWidget(widget, scheduleBlocks);
  if (!text) throw new HttpError(400, "说点什么吧");

  // 1) 锁内：先应用组件提交的结构化数据，记下"我"这一句
  const s1 = await mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const profile = profileOf(me);
    applyPatch(ctx, me, widget, profile);
    me.private!.chat.push({ role: "me", text: text.slice(0, 500), at: ctx.now.toISOString() });
    return { ju: structuredClone(ctx.ju), me: structuredClone(me), profile, quorumPending: quorumHidden(ctx.ju), now: ctx.now };
  });

  // 2) 锁外：私聊一轮
  const r = await chatTurn({
    ju: s1.ju,
    me: s1.me,
    ...(s1.profile ? { profile: s1.profile } : {}),
    userText: text,
    quorumPending: s1.quorumPending,
    now: s1.now,
  });

  // 3) 锁内：应用抽取结果（组件已经给了的字段以组件为准），记下局长的回复，推进入局阶段
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const patch: ChatPatch = { ...(r.patch ?? {}) };
    for (const k of WIDGET_KEYS) if (widget[k] !== undefined) delete patch[k];
    applyPatch(ctx, me, patch, s1.profile);
    me.private!.chat.push({ role: "juzhang", text: r.reply, at: ctx.now.toISOString(), ...(r.ask ? { ask: r.ask } : {}) });
    if (me.private!.chat.length > 200) me.private!.chat.splice(0, me.private!.chat.length - 200);
    if (r.done && me.intake === "chatting" && me.private!.rsvp !== "no") me.intake = "swiping";
    return { reply: r.reply, widget: r.widget, quickReplies: r.quickReplies, done: r.done, me: selfMember(me) };
  });
}

// ---------------------------------------------------------------- 刷卡

type DeckCard = Pick<Poi, "id" | "name" | "type">;

export async function deckFor(
  juId: string,
  token: string,
): Promise<{ deck: Poi[]; predicted?: Record<string, SwipeVerdict> }> {
  const ju = loadJu(juId);
  const members = loadMembers(juId);
  if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
  const me = findByToken(members, token);
  if (!me) throw new HttpError(403, "成员身份不对");
  let deck: Poi[];
  try {
    deck = await buildSwipeDeck(ju, inOnly(members), me, getMapProvider());
  } catch (e) {
    throw new HttpError(503, (e as Error)?.message || "地图服务暂时不可用");
  }
  await mutateJu(juId, (ctx) => {
    ctx.priv.decks[me.id] = deck.map((p) => ({ id: p.id, name: p.name, type: p.type }));
    // 只写私密区，其他不动
    ctx.members = ctx.members.filter((m) => m.id === me.id);
  });
  const out: { deck: Poi[]; predicted?: Record<string, SwipeVerdict> } = { deck };
  if ((me.private?.autoFilled.length ?? 0) > 0) out.predicted = predictSwipes(profileOf(me), deck);
  return out;
}

const FILL_MAX_S = 3600;

/** 入局完成：记 fillSeconds，把这次的偏好写回档案（#6），方案已出则记一笔待重算（#4） */
export function finishIntake(ctx: MutateCtx, me: Member): void {
  if (me.intake === "done") return;
  me.intake = "done";
  const secs = (ctx.now.getTime() - Date.parse(me.joinedAt)) / 1000;
  if (Number.isFinite(secs) && secs >= 0 && secs <= FILL_MAX_S) me.fillSeconds = Math.round(secs * 10) / 10;
  if (me.private && !me.private.rsvp && !ctx.ju.quorum) me.private.rsvp = "yes";
  if (me.profileId) {
    const deck = ctx.priv.decks[me.id] ?? [];
    const next = learnFromMember(getProfile(me.profileId), me, deck);
    if (next) saveProfile(next);
  }
  if (me.status === "in") markChanged(ctx.ju, ctx.priv, me.id);
}

export function swipe(juId: string, token: string, poiId: string, verdict: SwipeVerdict): Promise<{ me: Member }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const p = me.private!;
    p.swipes[poiId] = verdict;
    p.autoFilled = p.autoFilled.filter((x) => x !== "swipes");
    const deck: DeckCard[] = ctx.priv.decks[me.id] ?? [];
    const allSwiped = deck.length > 0 ? deck.every((c) => p.swipes[c.id]) : Object.keys(p.swipes).length >= 5;
    if (me.intake === "done") {
      if (me.status === "in") markChanged(ctx.ju, ctx.priv, me.id);
    } else if (allSwiped) {
      finishIntake(ctx, me);
    } else if (me.intake === "chatting" && p.rsvp !== "no" && Object.keys(p.swipes).length > 0) {
      me.intake = "swiping";
    }
    return { me: selfMember(me) };
  });
}

// ---------------------------------------------------------------- 想认识谁（#2 互选）

export function setWants(juId: string, token: string, memberIds: string[]): Promise<{ me: Member; matchNames: string[] }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const visible = visibleMembers(ctx.ju, ctx.members);
    const ok = new Set(visible.map((m) => m.id));
    me.private!.wants = [...new Set(memberIds)].filter((id) => id !== me.id && ok.has(id)).slice(0, 20);
    recomputeMatches(ctx.members, me, ctx.now);
    const byId = new Map(visible.map((m) => [m.id, m.name]));
    const matchNames = me.private!.matches.map((id) => byId.get(id)).filter((x): x is string => !!x);
    return { me: selfMember(me), matchNames };
  });
}


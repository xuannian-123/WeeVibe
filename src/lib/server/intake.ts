// 入局：认领截图里的自己（#3）→ 私聊局长（#4 #5 #6 #7）→ 刷卡（#6）→ 想认识谁（#2）。
// 私聊 LLM 会看到本人私密信息，但它的输出只回给本人（这里的返回值只给带本人 token 的请求）。
// LLM / 课表解析 / 地图都是慢操作：放在锁外跑，锁里只做"读 → 改 → 存"。
import { nanoid } from "nanoid";
import { chatTurn, parseSchedule } from "../llm";
import { ruleChatTurn, type IntakePatch } from "../llm/chat";
import { getMapProvider } from "../map";
import { availabilityFromBusy, buildSwipeDeck, predictSwipes } from "../planner";
import type {
  ChatPatch,
  ChatReply,
  DayAvailability,
  DietTag,
  Mandate,
  Member,
  MemberPrivate,
  Need,
  Poi,
  Profile,
  SwipeVerdict,
} from "../types";
import { activityKeyOfWord } from "../client/activities";
import { activityNeed, CARE_TAGS, careTag, floorCandidates, GIVE_BY_STYLE, HARD_DIET, MOOD_LABEL } from "../client/mandate";
import { findByToken, quorumHidden, safeEqual, selfMember, visibleMembers } from "./firewall";
import { HttpError } from "./http";
import { AVATARS, isAdminToken, loadJu, loadMembers, mutateJu, type MutateCtx, type Viewer } from "./ju";
import {
  admitStatus,
  appendTraceAt,
  autofillMember,
  emptyPrivate,
  evalQuorum,
  inOnly,
  markChanged,
  recomputeMatches,
  setMemberStatus,
} from "./ju-core";
import { materializeNeeds } from "../planner/needs";
import { applyOnboarding, commuteLimitOf, getProfile, learnedFacts, learnFromMember, saidFacts, saveProfile } from "./profile";
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
export function applyPatch(ctx: MutateCtx, me: Member, patch: IntakePatch, profile: Profile | undefined): void {
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
  // v5 需求模型
  if (patch.needs?.length) {
    p.needs = materializeNeeds(p.needs ?? [], patch.needs, "chat", now.toISOString());
    planInputChanged = true;
  }
  if (patch.budgetStrength && patch.budgetStrength !== p.budgetStrength) {
    p.budgetStrength = patch.budgetStrength;
    planInputChanged = true;
  }
  if (patch.wantsAutofill) planInputChanged = autofillMember(ju, me, profile) || planInputChanged;
  // v6 这次的状态 / 想干什么 / 风格（话里听出来的；想干什么的需求已经在 needs 里）
  if (patch.mood && patch.mood !== p.mood) {
    p.mood = patch.mood;
    planInputChanged = true;
  }
  if (patch.activities?.length && p.activityOpen) {
    p.activityOpen = false;
    planInputChanged = true;
  } else if (patch.activityOpen && !p.activityOpen && !wantedKeys(p).length) {
    p.activityOpen = true;
    planInputChanged = true;
  }
  if (patch.style && patch.style !== p.mandate?.style) {
    p.mandate = { ...draftMandate(p), style: patch.style, give: { ...GIVE_BY_STYLE[patch.style] } };
    planInputChanged = true;
  }

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

// ---------------------------------------------------------------- v6 授权书（docs/AVATAR.md 第 2、5 节）

/** 还没有授权书时的草稿：风格按档案，give 按风格默认 */
function draftMandate(p: MemberPrivate, profile?: Profile): Mandate {
  if (p.mandate) return { ...p.mandate, give: { ...p.mandate.give }, floors: [...p.mandate.floors] };
  const style = profile?.style ?? "balanced";
  return { status: "draft", style, give: { ...GIVE_BY_STYLE[style] }, floors: [] };
}

/** 想干什么里认得出的活动 key */
function wantedKeys(p: MemberPrivate): string[] {
  return (p.needs ?? []).flatMap((n) => (n.rule.t === "preferCategory" ? n.rule.words.map(activityKeyOfWord).filter((k): k is string => !!k) : []));
}

const careNeed = (key: string, kind: Need["kind"] = "soft") => {
  const n = careTag(key)?.need;
  return n ? { ...n, kind } : undefined;
};

/**
 * 按档案把 v6 的东西预填进这次（入局 / 建档完成时）：
 * - 本人说过的底线（建档第 3 屏）：门禁、清真 / 素食 → 记为已确认；膝盖不好 / 不喝酒 / 过敏 → 硬需求（已确认）
 * - 分身猜的（怕吵、通勤容忍）→ 只预填成软需求，永远不当底线
 * - 授权书草稿：风格按档案
 * 只补空的，不覆盖本人这次已经说过的。
 */
export function prefillAvatar(m: Member, profile: Profile | undefined, now: Date): void {
  if (!profile) return;
  const p = (m.private ??= emptyPrivate());
  const at = now.toISOString();
  const said = new Set(saidFacts(profile).map((f) => f.key));
  const confirm = (k: string) => {
    if (!(p.confirmed ?? []).includes(k)) p.confirmed = [...(p.confirmed ?? []), k];
  };
  if (said.has("homeBy") && Object.values(p.availability).some((a) => a.homeBy)) confirm("homeBy");
  for (const t of HARD_DIET) if (said.has(`diet:${t}`) && p.dietTags.includes(t)) confirm(`diet:${t}`);
  const hard: Omit<Need, "id" | "at" | "source">[] = [];
  if (said.has("body:膝盖不好")) hard.push(careNeed("knee", "hard")!);
  if (said.has("noAlcohol")) {
    hard.push(careNeed("noalcohol", "hard")!);
    p.billFacts = { ...p.billFacts, noAlcohol: true };
  }
  const allergy = saidFacts(profile).find((f) => f.key === "allergy");
  if (allergy) hard.push({ dim: "food", kind: "hard", strength: 3, rule: { t: "custom" }, text: allergy.text });
  const soft: Omit<Need, "id" | "at" | "source">[] = [];
  if (learnedFacts(profile, now).some((f) => f.key === "quiet" && f.confidence >= 0.3)) soft.push(careNeed("quiet")!);
  const commute = commuteLimitOf(profile, now);
  if (commute) soft.push({ dim: "travel", kind: "soft", strength: 2, rule: { t: "maxCommute", minutes: commute }, text: `单程尽量别超过 ${commute} 分钟` });
  const before = new Set((p.needs ?? []).map((n) => n.id));
  if (hard.length || soft.length) p.needs = materializeNeeds(p.needs ?? [], [...hard, ...soft], "profile", at);
  for (const n of p.needs ?? []) if (!before.has(n.id) && n.kind === "hard") confirm(n.id);
  if (!p.mandate) p.mandate = draftMandate(p, profile);
}

/** 授权书卡片提交的 v6 字段（完整选择：没出现的标签 / 活动 = 取消）。返回是否改了排方案的输入 */
function applyCard(ctx: MutateCtx, me: Member, body: ChatBody, profile: Profile | undefined): boolean {
  const p = me.private!;
  const at = ctx.now.toISOString();
  let changed = false;
  if (body.mood !== undefined && body.mood !== p.mood) {
    if (body.mood) p.mood = body.mood;
    else delete p.mood;
    changed = true;
  }
  if (body.activityOpen !== undefined && body.activityOpen !== !!p.activityOpen) {
    p.activityOpen = body.activityOpen;
    changed = true;
  }
  if (body.activities) {
    // 认得出的活动偏好整组替换；认不出的（"想吃川菜"）原样保留
    const keep = (p.needs ?? []).filter((n) => n.rule.t !== "preferCategory" || !n.rule.words.some((w) => activityKeyOfWord(w)));
    const n = p.activityOpen ? undefined : activityNeed(body.activities);
    p.needs = n ? materializeNeeds(keep, [n], "widget", at) : keep;
    changed = true;
  }
  // 卡片上亲手点的硬忌口（清真 / 素食）= 本人确认过
  for (const t of body.dietTags ?? []) if (HARD_DIET.includes(t)) p.confirmed = [...new Set([...(p.confirmed ?? []), `diet:${t}`])];
  if (body.tags) {
    const on = new Set(body.tags);
    for (const t of CARE_TAGS) {
      if (t.diet || !t.need || !t.match) continue;
      const has = (p.needs ?? []).some((n) => t.match!(n));
      if (on.has(t.key) && !has) p.needs = materializeNeeds(p.needs ?? [], [t.need], "widget", at);
      if (!on.has(t.key) && has) p.needs = (p.needs ?? []).filter((n) => !t.match!(n));
      if (t.key === "noalcohol") p.billFacts = { ...p.billFacts, noAlcohol: on.has(t.key) || undefined };
      if (on.has(t.key) !== has) changed = true;
    }
    if (!p.billFacts.noAlcohol) delete p.billFacts.noAlcohol;
  }
  if (body.mandate) {
    const m = draftMandate(p, profile);
    m.style = body.mandate.style;
    m.give = body.mandate.give ? { ...body.mandate.give } : { ...GIVE_BY_STYLE[body.mandate.style] };
    // 本人在授权书上把一条软需求设成底线：升成硬需求，算本人确认过
    for (const k of body.mandate.floors) {
      const n = (p.needs ?? []).find((x) => x.id === k);
      if (n && n.kind === "soft") p.needs = (p.needs ?? []).map((x) => (x.id === k ? { ...x, kind: "hard" as const, strength: 3 as const } : x));
    }
    // 只认能当底线的 key（档案里猜的东西不在候选里，进不来）
    const cands = new Set(floorCandidates({ ...p, mandate: { ...m, floors: body.mandate.floors } }).map((c) => c.key));
    m.floors = body.mandate.floors.filter((k) => cands.has(k));
    p.confirmed = [...new Set([...(p.confirmed ?? []), ...m.floors])];
    p.mandate = m;
    changed = true;
  }
  return changed;
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
    if (profile) {
      autofillMember(ju, m, profile);
      prefillAvatar(m, profile, now);
    }
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

  const r = ruleChatTurn({
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

// ---------------------------------------------------------------- 硬约束回问确认（docs/DECISION.md 2.4）

const CONFIRM_YES_RE = /^(对|是|嗯|必须|一定|是的|没错|对的|确定|yes|ok|好)/i;
const CONFIRM_NO_RE = /^(不是|不用|没那么|尽量|最好|不一定|也不一定|不算|晚点也行|可以晚|不必)/;

/** 这一轮从自然语言里新冒出来的硬约束（只取第一条，一次只问一件事） */
function hardToConfirm(me: Member, patch: ChatPatch): { key: string; text: string } | undefined {
  const p = me.private!;
  const done = new Set(p.confirmed ?? []);
  const homeBy = Object.values(patch.availability ?? {}).find((a) => a?.homeBy)?.homeBy;
  if (homeBy && !done.has("homeBy")) return { key: "homeBy", text: `${homeBy} 前必须回去` };
  const diet = (patch.dietTags ?? []).find((t) => HARD_DIET.includes(t) && !done.has(`diet:${t}`));
  if (diet) return { key: `diet:${diet}`, text: `只能吃${diet}的店` };
  for (const n of patch.needs ?? []) {
    if (n.kind !== "hard") continue;
    const stored = (p.needs ?? []).find((x) => x.dim === n.dim && JSON.stringify(x.rule) === JSON.stringify(n.rule));
    if (stored && !done.has(stored.id)) return { key: stored.id, text: stored.text };
  }
  return undefined;
}

/** 回答了确认问题：确认 → 记进 confirmed；否认 → 降成软偏好。返回给本人的一句话，没回答返回 undefined */
function resolveConfirm(me: Member, text: string, now: Date): string | undefined {
  const p = me.private!;
  const pc = p.pendingConfirm;
  if (!pc) return undefined;
  const t = text.trim();
  const yes = CONFIRM_YES_RE.test(t);
  const no = CONFIRM_NO_RE.test(t);
  if (!yes && !no) return undefined;
  delete p.pendingConfirm;
  if (yes && !no) {
    p.confirmed = [...new Set([...(p.confirmed ?? []), pc.key])];
    return `好，「${pc.text}」我当成硬性的，方案一定照顾到。`;
  }
  if (pc.key === "homeBy") {
    const at = Object.values(p.availability).find((a) => a.homeBy)?.homeBy;
    for (const a of Object.values(p.availability)) delete a.homeBy;
    if (at) p.needs = materializeNeeds(p.needs ?? [], [{ dim: "time", kind: "soft", strength: 2, rule: { t: "leaveBy", at }, text: `想 ${at} 前结束` }], "chat", now.toISOString());
  } else if (pc.key.startsWith("diet:")) {
    const tag = pc.key.slice(5) as DietTag;
    p.dietTags = p.dietTags.filter((x) => x !== tag);
    p.needs = materializeNeeds(p.needs ?? [], [{ dim: "food", kind: "soft", strength: 2, rule: { t: "custom" }, text: `尽量${tag}` }], "chat", now.toISOString());
  } else {
    p.needs = (p.needs ?? []).map((n) => (n.id === pc.key ? { ...n, kind: "soft" as const, strength: 3 as const } : n));
  }
  return `明白，「${pc.text}」我按"尽量"来排，不会因为它把你排除在外。`;
}

// ---------------------------------------------------------------- chat

const WIDGET_KEYS = ["rsvp", "location", "availability", "dietTags", "budgetMax", "wantsAutofill"] as const;

/** 卡片确认直接应用结构化值；摘要只写本人记录，不再交给模型二次解释。 */
async function savePreferences(juId: string, token: string, body: ChatBody): Promise<ChatReply & { me: Member }> {
  const map = getMapProvider();
  const snapshot = loadJu(juId);
  if (!token || !findByToken(loadMembers(juId), token)) throw new HttpError(token ? 403 : 401, "成员身份不对");
  const city = body.location && snapshot.spec.cityFrom !== "said" && snapshot.spec.cityFrom !== "location" && !snapshot.plan && map.cityAt
    ? await map.cityAt(body.location).catch(() => undefined) : undefined;
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const p = me.private!;
    const complete = body.preferenceAction !== "review" && body.rsvp !== "no";
    const availability = body.availability && Object.fromEntries(Object.entries(body.availability).filter(([d]) => ctx.ju.spec.dates.includes(d)));
    if (complete) {
      if (p.pendingConfirm) throw new HttpError(409, "先回答局长的确认问题，再确认偏好");
      if (body.rsvp !== "yes" || !body.location || !availability || !Object.keys(availability).length || body.budgetMax === undefined || body.dietTags === undefined)
        throw new HttpError(400, "请确认参与意愿、出发地、可用日期、预算和忌口");
    }
    if (availability && Object.values(availability).some((a) => a.homeBy && a.homeBy <= a.from))
      throw new HttpError(400, "到家时间需要晚于出发时间");
    const patch: ChatPatch = {
      ...(body.rsvp ? { rsvp: body.rsvp } : {}),
      ...(body.location ? { location: body.location } : {}),
      ...(availability ? { availability } : {}),
      ...(body.dietTags ? { dietTags: body.dietTags } : {}),
      ...(body.budgetMax !== undefined ? { budgetMax: body.budgetMax } : {}),
    };
    const profile = profileOf(me);
    applyPatch(ctx, me, patch, profile);
    // 卡片中的日期代表完整选择，取消勾选必须删除旧日期。
    if (availability) {
      p.availability = availability;
      p.autoFilled = p.autoFilled.filter((k) => k !== "availability");
    }
    // v6 授权书：状态 / 想干什么 / 讲究 / 风格 / 可以让 / 底线
    if (applyCard(ctx, me, body, profile) && me.intake === "done" && me.status === "in") markChanged(ctx.ju, ctx.priv, me.id);
    if (city && !ctx.ju.plan && ctx.ju.spec.cityFrom !== "said" && ctx.ju.spec.cityFrom !== "location")
      ctx.ju.spec = { ...ctx.ju.spec, city, cityFrom: "location" };
    const declined = p.rsvp === "no";
    // 「就这样」= 授权书生效（finish / swipe 都算本人确认过授权书）
    if (!declined && body.preferenceAction !== "review") p.mandate = { ...draftMandate(p, profile), status: "confirmed", confirmedAt: ctx.now.toISOString() };
    if (!declined && body.preferenceAction === "finish") finishIntake(ctx, me);
    if (!declined && body.preferenceAction === "swipe" && me.intake !== "done") me.intake = "swiping";
    const name = profile?.avatarName ? `你的${profile.avatarName}` : "你的分身";
    const reply = declined ? "收到，这次不来只有局长知道，群里不会显示原因。" : body.preferenceAction === "finish"
      ? `授权书收好了，${name}会按它去谈。有变化随时可以改。` : body.preferenceAction === "swipe"
        ? "授权书收好了，可以继续看看想去哪家店。" : "";
    // 草稿保存（边说边填时的自动保存）不写进私聊记录，免得刷屏
    if (body.preferenceAction !== "review") {
      const said = [describeWidget(patch), body.mood ? `这次${MOOD_LABEL[body.mood].text}` : ""].filter(Boolean).join("，");
      p.chat.push({ role: "me", text: said || "就这样", at: ctx.now.toISOString() }, { role: "juzhang", text: reply, at: ctx.now.toISOString() });
    }
    if (p.chat.length > 200) p.chat.splice(0, p.chat.length - 200);
    return { reply, widget: body.preferenceAction === "swipe" && !declined ? "swipe" : null, quickReplies: [], done: body.preferenceAction !== "review", me: selfMember(me) };
  });
}

/**
 * 首次建档「认识你的分身」：写进本人档案（设备级），再按新档案把这次的卡片预填一遍。
 * 每屏都能跳过——没填的字段不动；走到最后就算完成（写 onboardedAt）。整个跳过 = 不调这个接口。
 */
async function onboard(juId: string, token: string, body: ChatBody): Promise<ChatReply & { me: Member }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    if (!me.profileId) throw new HttpError(409, "这台设备还没有档案，刷新一下再试");
    const next = applyOnboarding(getProfile(me.profileId), me.profileId, body.onboarding!, ctx.now);
    saveProfile(next);
    autofillMember(ctx.ju, me, next);
    prefillAvatar(me, next, ctx.now);
    if (me.intake === "done" && me.status === "in") markChanged(ctx.ju, ctx.priv, me.id);
    const reply = `好，我大概认识你了${next.avatarName ? `，以后我就是「${next.avatarName}」` : ""}。这次的授权书先按你说的填好了，看看对不对。`;
    me.private!.chat.push({ role: "juzhang", text: reply, at: ctx.now.toISOString() });
    if (me.private!.chat.length > 200) me.private!.chat.splice(0, me.private!.chat.length - 200);
    return { reply, widget: null, quickReplies: [], done: false, me: selfMember(me) };
  });
}

export async function chat(juId: string, token: string, body: ChatBody): Promise<ChatReply & { me: Member }> {
  if (body.onboarding) return onboard(juId, token, body);
  if (body.preferenceAction) return savePreferences(juId, token, body);
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

  // 1) 锁内：先应用组件提交的结构化数据，记下"我"这一句；如果是在回答硬约束确认，先处理掉
  const s1 = await mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const profile = profileOf(me);
    applyPatch(ctx, me, widget, profile);
    if (body.preferencesChat && scheduleAvail) {
      me.private!.availability = scheduleAvail;
      me.private!.autoFilled = me.private!.autoFilled.filter((key) => key !== "availability");
    }
    const confirmAck = body.text ? resolveConfirm(me, body.text, ctx.now) : undefined;
    if (confirmAck && me.intake === "done" && me.status === "in") markChanged(ctx.ju, ctx.priv, me.id);
    me.private!.chat.push({ role: "me", text: text.slice(0, 500), at: ctx.now.toISOString() });
    return { ju: structuredClone(ctx.ju), me: structuredClone(me), profile, quorumPending: quorumHidden(ctx.ju), now: ctx.now, confirmAck };
  });

  // 2) 锁外：私聊一轮。刚回答完确认问题时，这句"对 / 不是"不再当成新内容，局长直接接着问下一项
  const map = getMapProvider();
  const r0 = await chatTurn({
    ju: s1.ju,
    me: s1.me,
    supplemental: body.preferencesChat,
    ...(s1.profile ? { profile: s1.profile } : {}),
    userText: s1.confirmAck ? "" : text,
    quorumPending: s1.quorumPending,
    now: s1.now,
    // 私聊里说的地名：用高德地理编码（全国），按局的城市优先
    resolvePlace: async (q) => (await map.searchPlaces(q, s1.ju.spec.city))[0],
  });
  const r = s1.confirmAck ? { ...r0, reply: `${s1.confirmAck}${r0.reply}`, patch: {} } : r0;

  // 城市没被发起人亲口说过：用第一个真实出发地校正（比如按 IP 猜成了上海，人其实在北京）
  const loc = widget.location ?? r.patch?.location;
  const cityFix =
    loc && s1.ju.spec.cityFrom !== "said" && s1.ju.spec.cityFrom !== "location" && !s1.ju.plan && map.cityAt
      ? await map.cityAt(loc).catch(() => undefined)
      : undefined;

  // 3) 锁内：应用抽取结果（组件已经给了的字段以组件为准），记下局长的回复，推进入局阶段
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const patch: IntakePatch = { ...(r.patch ?? {}) };
    for (const k of WIDGET_KEYS) if (widget[k] !== undefined) delete patch[k];
    applyPatch(ctx, me, patch, s1.profile);
    if (cityFix && ctx.ju.spec.cityFrom !== "said" && ctx.ju.spec.cityFrom !== "location" && !ctx.ju.plan) {
      const was = ctx.ju.spec.city;
      ctx.ju.spec = { ...ctx.ju.spec, city: cityFix, cityFrom: "location" };
      if (was !== cityFix) appendTraceAt(ctx.ju, "listen", `按大家的出发地，这个局在${cityFix}`, ctx.now);
    }
    // 从自然语言里推断出硬约束（门禁 / 清真 / "最多一小时"）：先回问确认，这一轮不往下问。
    // 确认之前按硬约束算——把门禁当软偏好可能把人排到门禁之后，那比多问一句糟得多
    const hard = body.text && (!r.done || body.preferencesChat) ? hardToConfirm(me, patch) : undefined;
    let out = { reply: r.reply, widget: r.widget, quickReplies: r.quickReplies, done: r.done, ask: r.ask };
    if (hard) {
      me.private!.pendingConfirm = { ...hard, at: ctx.now.toISOString() };
      out = { reply: `收到。确认一下：${hard.text}，是硬性的吗？`, widget: null, quickReplies: ["对，必须", "不是，尽量就行"], done: false, ask: undefined };
    }
    if (body.preferencesChat) {
      out = { ...out, widget: null, done: false };
      // 没有回答确认问题时继续展示，刷新后也不会丢失。
      if (me.private!.pendingConfirm) out = { ...out, reply: `确认一下：${me.private!.pendingConfirm.text}，是硬性的吗？`, quickReplies: ["对，必须", "不是，尽量就行"] };
    }
    me.private!.chat.push({ role: "juzhang", text: out.reply, at: ctx.now.toISOString(), ...(out.ask ? { ask: out.ask } : {}) });
    if (me.private!.chat.length > 200) me.private!.chat.splice(0, me.private!.chat.length - 200);
    if (out.done && me.intake === "chatting" && me.private!.rsvp !== "no") me.intake = "swiping";
    return { reply: out.reply, widget: out.widget, quickReplies: out.quickReplies, done: out.done, me: selfMember(me) };
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
    const next = learnFromMember(getProfile(me.profileId), me, deck, ctx.now);
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


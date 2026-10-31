// /api/dev/seed：演示场景（CONTRACT 第八节）。6 个人的设定来自 C 的 demoPeople(spec)（C 的场景测试已验证方案"有戏"）：
// - 阿杰：漕河泾，6 点半下班（晚到），档案里有 3 次"跑得最远"的账本（#10 被照顾）
// - 小林：私密预算 80（#4），刷卡把最贵那家 pass 了
// - 老王：11 点前回宿舍（门禁，私密），不吃辣
// - 小周：说"都行"，由局长预填（#6）
// - 阿May：私下 rsvp = no（#5，公开视图里不存在）
// - 大刘：从第二圈进来、名额满了在候补（#2），有人退出后转正
// - 小林和阿杰互相标了"想认识"（#2 互选成功 1 对）
// 这里只负责把设定落成真实成员（token / 圈层 / 档案 / 刷卡 / 互选 / 名额），规划相关的数据一律以 C 为准。
import { nanoid } from "nanoid";
import * as db from "../db";
import { getMapProvider } from "../map";
import { DEMO_VENUE, buildSwipeDeck, demoPeople, predictSwipes, type DemoPerson } from "../planner";
import type { AvatarStyle, Ju, JuState, Member, Mood, Need, NeedStrength, Poi, Profile, SwipeVerdict } from "../types";
import { STYLE_GIVE } from "../planner/avatar/mandate";
import { hmToMin, minToHm } from "../planner/util";
import { publicState, quorumHidden } from "./firewall";
import { HttpError } from "./http";
import { AVATARS, TIER_LABELS, mutateJu, planDeps, type Viewer } from "./ju";
import { appendTraceAt, applyAnswer, autofillMember, computePlan, emptyPrivate, evalQuorum, inOnly, markChanged, pendingAsks, recomputeMatches } from "./ju-core";
import { saveProfile } from "./profile";

/** 私聊里的几句原话（只进本人私聊记录，不影响规划） */
const CHAT: Record<DemoPerson["key"], string[]> = {
  jie: ["我在漕河泾上班，周五 6 点半才下班", "没忌口，价格都行"],
  lin: ["人均 80 以内吧，最近有点紧"],
  wang: ["宿舍 11 点门禁，得早点回", "不吃辣"],
  zhou: ["都行，你定"],
  may: ["这次就不去了"],
  liu: ["都可以，我等名额"],
};

const SPICY = /麻辣|川|重庆|湘|串串|辣/;

// ---------------------------------------------------------------- v4 社团团建场景（scene = "club"）
// 摄影社第 3 次聚会：4 个老社员互相挺熟、都认识社长（发起人），5 个新生之间只是见过几次，两拨人基本不认识。
// - 木木今天社交电量低（每一轮都给留熟人）
// - 小鹿悄悄不想和大鹏一桌（局长用诱饵分组掩护，谁也推断不出来）
// - 橙子和知夏互相想认识（互选成功，至少同桌一次）
// - 前两次聚会作为圈子历史挂在 prevJuId 链上：大屏能画出"一局一局熟起来"

type ClubPerson = {
  name: string;
  avatar: string;
  old: boolean;
  interests: string[];
  energy?: "low" | "mid" | "high";
  /** 和其他新生"见过"的人 */
  met?: string[];
  avoid?: string;
  wants?: string[];
  dLat: number;
  dLng: number;
};

const CLUB: ClubPerson[] = [
  { name: "知夏", avatar: "🦉", old: true, interests: ["胶片", "爬山"], wants: ["橙子"], dLat: 0.012, dLng: -0.01 },
  { name: "阿哲", avatar: "🐺", old: true, interests: ["人像", "剧本杀"], met: ["小舟"], dLat: -0.008, dLng: 0.015 },
  { name: "小鹿", avatar: "🦌", old: true, interests: ["胶片", "猫"], avoid: "大鹏", dLat: 0.02, dLng: 0.006 },
  { name: "大鹏", avatar: "🦅", old: true, interests: ["风光", "爬山"], met: ["阿June"], dLat: -0.015, dLng: -0.012 },
  { name: "橙子", avatar: "🍊", old: false, interests: ["胶片", "咖啡"], met: ["木木", "豆豆"], wants: ["知夏"], dLat: 0.005, dLng: 0.022 },
  { name: "木木", avatar: "🌳", old: false, interests: ["猫", "动漫"], energy: "low", met: ["橙子", "阿June"], dLat: -0.02, dLng: 0.004 },
  { name: "阿June", avatar: "🐳", old: false, interests: ["人像", "咖啡"], met: ["木木", "小舟"], energy: "high", dLat: 0.017, dLng: -0.018 },
  { name: "小舟", avatar: "⛵", old: false, interests: ["风光", "剧本杀"], met: ["阿June"], dLat: -0.004, dLng: -0.024 },
  { name: "豆豆", avatar: "🫘", old: false, interests: ["动漫", "猫"], met: ["橙子"], dLat: 0.024, dLng: 0.016 },
];

/** 前两次聚会的聚合数字（只有对数，没有人） */
const CLUB_HISTORY = [
  { title: "（演示）摄影社第 1 次聚会", people: 6, knownBefore: 3, newPairs: 6, daysAgo: 28 },
  { title: "（演示）摄影社第 2 次聚会", people: 8, knownBefore: 9, newPairs: 6, daysAgo: 14 },
];

function historyJu(ownerId: string, h: (typeof CLUB_HISTORY)[number], i: number, prevJuId: string | undefined, now: Date, spec: Ju["spec"]): Ju {
  const at = new Date(now.getTime() - h.daysAgo * 86400_000).toISOString();
  const pairs = (h.people * (h.people - 1)) / 2;
  return {
    id: `${ownerId}h${i + 1}`,
    title: h.title,
    rawPrompt: "",
    spec,
    slots: [],
    status: "confirmed",
    createdAt: at,
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    ...(prevJuId ? { prevJuId } : {}),
    recap: { text: `${h.people} 个人一起扫了街，新认识了 ${h.newPairs} 对朋友。`, photos: [], at },
    seating: {
      rounds: [],
      current: 1,
      tableSize: 4,
      metrics: {
        people: h.people,
        pairs,
        knownBefore: h.knownBefore,
        newPairs: h.newPairs,
        everyoneAnchored: true,
        matchesSeated: 0,
        matchPairs: 0,
        neverTogether: Math.max(0, pairs - h.knownBefore - h.newPairs),
      },
      audit: { inputHash: "demo", outputHash: "demo", restarts: 0, evaluations: 0, algorithmVersion: "demo" },
      absentIds: [],
      computedAt: at,
      version: 1,
    },
    admin: { tiers: [], auditSecret: nanoid(32) },
  };
}

export function seedClub(id: string, viewer: Viewer = {}): Promise<JuState> {
  return mutateJu(id, (ctx) => {
    const { ju, members, now } = ctx;
    if (ju.status === "confirmed" || ju.status === "cancelled") throw new HttpError(409, "局已经定了，不能再加演示成员");
    const center = DEMO_VENUE;
    const taken = new Set(members.map((m) => m.name));
    const byName = new Map<string, Member>();
    const organizer = members.find((m) => m.isOrganizer);

    CLUB.forEach((p, i) => {
      if (taken.has(p.name)) return;
      const at = new Date(now.getTime() + i).toISOString();
      const pv = emptyPrivate();
      pv.rsvp = "yes";
      for (const d of ju.spec.dates) pv.availability[d] = { from: ju.spec.earliest, pref: "ok" };
      if (p.energy) pv.energy = p.energy;
      const m: Member = {
        id: nanoid(10),
        juId: id,
        name: p.name,
        avatar: p.avatar,
        location: { label: `${p.name}的出发地`, lat: +(center.lat + p.dLat).toFixed(5), lng: +(center.lng + p.dLng).toFixed(5) },
        role: "guest",
        intake: "done",
        status: "in",
        joinedAt: at,
        isOrganizer: false,
        isDemo: true,
        interests: [...p.interests],
        private: pv,
        secret: { token: nanoid(24), tier: 1 },
      };
      members.push(m);
      byName.set(p.name, m);
    });

    // 熟悉度：老社员之间挺熟、都和社长挺熟；新生之间按 met 见过；其余不认识
    for (const p of CLUB) {
      const m = byName.get(p.name);
      if (!m) continue;
      const know: Record<string, 0 | 1 | 2> = {};
      for (const q of CLUB) {
        const o = byName.get(q.name);
        if (!o || o === m) continue;
        if (p.old && q.old) know[o.id] = 2;
        else if (p.met?.includes(q.name) || q.met?.includes(p.name)) know[o.id] = 1;
        else know[o.id] = 0;
      }
      if (p.old && organizer) know[organizer.id] = 2;
      m.private!.know = know;
      if (p.avoid && byName.get(p.avoid)) m.private!.avoid = [byName.get(p.avoid)!.id];
      m.private!.wants = (p.wants ?? []).map((n) => byName.get(n)?.id).filter((x): x is string => !!x);
    }
    for (const m of byName.values()) recomputeMatches(members, m, now);
    for (const m of byName.values()) markChanged(ju, ctx.priv, m.id);

    // 圈子历史：前两次聚会（只有聚合数字），挂在 prevJuId 链上
    if (!ju.prevJuId) {
      let prev: string | undefined;
      CLUB_HISTORY.forEach((h, i) => {
        const hj = historyJu(id, h, i, prev, now, ju.spec);
        if (!db.getJu(hj.id)) db.insertJu(hj, nanoid(24));
        prev = hj.id;
      });
      if (prev) ju.prevJuId = prev;
    }

    appendTraceAt(ju, "listen", `又有 ${byName.size} 位朋友跟局长私聊完了`, now);
    evalQuorum(ju, members, now);
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

export function seedJu(id: string, count = 6, viewer: Viewer = {}): Promise<JuState> {
  return mutateJu(id, async (ctx) => {
    const { ju, members, priv, now } = ctx;
    if (ju.status === "confirmed" || ju.status === "cancelled") throw new HttpError(409, "局已经定了，不能再加演示成员");
    if (!ju.admin) throw new HttpError(500, "局缺少发起人数据");

    const people = demoPeople(ju.spec).slice(0, count);
    // 大刘从第二圈来：保证有第二圈并已开放（名额满了才进候补，有人退出就能按顺序转正）
    if (people.some((p) => p.tier >= 2)) {
      let t2 = ju.admin.tiers.find((t) => t.tier === 2);
      if (!t2) {
        t2 = { token: nanoid(16), tier: 2, label: TIER_LABELS[1] };
        ju.admin.tiers.push(t2);
      }
      t2.openedAt ??= now.toISOString();
    }

    const taken = new Set(members.map((m) => m.name));
    const usedAvatars = new Set(members.map((m) => m.avatar));
    const byKey = new Map<DemoPerson["key"], { p: DemoPerson; m: Member }>();

    people.forEach((p, i) => {
      if (taken.has(p.name)) return;
      const at = new Date(now.getTime() + i).toISOString();
      const pv = emptyPrivate();
      if (p.rsvp) pv.rsvp = p.rsvp;
      pv.availability = structuredClone(p.availability);
      pv.dietTags = [...p.dietTags];
      if (p.budgetMax !== undefined) pv.budgetMax = p.budgetMax;
      pv.notes = [...p.notes];
      for (const t of CHAT[p.key] ?? []) pv.chat.push({ role: "me", text: t, at });
      const avatar = usedAvatars.has(p.avatar) ? (AVATARS.find((a) => !usedAvatars.has(a)) ?? p.avatar) : p.avatar;
      usedAvatars.add(avatar);
      const m: Member = {
        id: nanoid(10),
        juId: id,
        name: p.name,
        avatar,
        location: { ...p.location },
        role: "guest",
        intake: "done",
        status: p.status,
        joinedAt: at,
        isOrganizer: false,
        isDemo: true,
        private: pv,
        secret: { token: nanoid(24), tier: p.tier },
      };
      if (p.ledger.length) {
        m.profileId = `demo-${p.key}-${id}`;
        const prof: Profile = {
          id: m.profileId,
          name: p.name,
          avatar,
          lastLocation: { ...p.location },
          dietTags: [...p.dietTags],
          ledger: structuredClone(p.ledger),
          tastes: {},
        };
        saveProfile(prof);
      }
      if (p.autofill) autofillMember(ju, m, undefined);
      members.push(m);
      byKey.set(p.key, { p, m });
    });

    // 名额：演示成员入局后正好满，候补的人有人退出时按顺序转正
    if ([...byKey.values()].some((x) => x.m.status === "waitlist")) ju.capacity = inOnly(members).length;

    // 刷卡：同一个局所有人看同一批卡
    let deck: Poi[] = [];
    const first = [...byKey.values()].find((x) => x.m.status === "in")?.m;
    if (first) {
      try {
        deck = await buildSwipeDeck(ju, inOnly(members), first, getMapProvider());
      } catch (e) {
        console.warn(`[seed ${id}] 刷卡牌堆生成失败，演示成员不刷卡：${(e as Error)?.message ?? e}`);
      }
    }
    if (deck.length) {
      const priced = deck.filter((x) => x.costPerPerson !== undefined);
      const dearest = [...priced].sort((a, b) => b.costPerPerson! - a.costPerPerson!)[0];
      const cards = deck.map((x) => ({ id: x.id, name: x.name, type: x.type }));
      for (const { p, m } of byKey.values()) {
        let sw: Record<string, SwipeVerdict>;
        if (p.autofill) {
          sw = predictSwipes(undefined, deck);
          if (!m.private!.autoFilled.includes("swipes")) m.private!.autoFilled.push("swipes");
        } else {
          sw = {};
          deck.forEach((x, i) => {
            let v: SwipeVerdict = i === 0 ? "love" : "like";
            if (p.passMostExpensive && x === dearest) v = "pass";
            if (p.dietTags.includes("不吃辣") && SPICY.test(`${x.name}${x.type}`)) v = "pass";
            sw[x.id] = v;
          });
        }
        m.private!.swipes = sw;
        priv.decks[m.id] = cards;
      }
    }

    // 互选（#2）
    for (const { p, m } of byKey.values()) {
      m.private!.wants = p.wants.map((k) => byKey.get(k)?.m.id).filter((x): x is string => !!x);
    }
    for (const { m } of byKey.values()) recomputeMatches(members, m, now);

    for (const { m } of byKey.values()) if (m.status === "in") markChanged(ju, priv, m.id);
    const nIn = [...byKey.values()].filter((x) => x.m.status === "in").length;
    if (nIn) appendTraceAt(ju, "listen", `又有 ${nIn} 位朋友跟局长私聊完了`, now);
    evalQuorum(ju, members, now);
    return publicState(ju, members, viewer, { mine: priv.mine });
  });
}

// ---------------------------------------------------------------- v5 冲突场景（scene = "conflict"）
// 部门周五聚餐：阿杰 20:00 宿舍门禁（已确认的硬约束）、小林 19:30 才下班 —— 18:30 / 19:00 / 19:30 哪个时间都少一个人。
// 老王私下手头紧、小周想安静点、阿May 想吃清淡。局长出方案时会发现"没有完美方案"，私下去问能让一小步的人。
// 被问的是演示成员（没有手机），演示时用控制台 / 大屏的"替演示朋友回答"按钮。

type ConflictPerson = { name: string; avatar: string; from: string; homeBy?: string; budgetMax?: number; needs?: Need[]; dLat: number; dLng: number };

const NEED_AT = "2026-10-26T12:00:00+08:00";
const CONFLICT: ConflictPerson[] = [
  { name: "阿杰", avatar: "🧑‍💻", from: "17:00", homeBy: "20:00", dLat: 0.01, dLng: -0.01 },
  { name: "小林", avatar: "🦊", from: "19:30", dLat: -0.008, dLng: 0.012 },
  { name: "老王", avatar: "🐻", from: "17:30", budgetMax: 70, dLat: 0.015, dLng: 0.004 },
  {
    name: "小周",
    avatar: "🐧",
    from: "17:30",
    needs: [{ id: "n1-quiet", dim: "ambience", kind: "soft", strength: 2, rule: { t: "quiet" }, text: "想安静点、能好好聊天", source: "chat", at: NEED_AT }],
    dLat: -0.012,
    dLng: -0.006,
  },
  {
    name: "阿May",
    avatar: "🐰",
    from: "17:30",
    needs: [{ id: "n1-lightFood", dim: "food", kind: "soft", strength: 2, rule: { t: "lightFood" }, text: "想吃清淡点", source: "chat", at: NEED_AT }],
    dLat: 0.004,
    dLng: 0.018,
  },
];

export function seedConflict(id: string, viewer: Viewer = {}): Promise<JuState> {
  return mutateJu(id, (ctx) => {
    const { ju, members, now } = ctx;
    if (ju.status === "confirmed" || ju.status === "cancelled") throw new HttpError(409, "局已经定了，不能再加演示成员");
    const taken = new Set(members.map((m) => m.name));
    let n = 0;
    CONFLICT.forEach((p, i) => {
      if (taken.has(p.name)) return;
      const pv = emptyPrivate();
      pv.rsvp = "yes";
      for (const d of ju.spec.dates) pv.availability[d] = { from: p.from, ...(p.homeBy ? { homeBy: p.homeBy } : {}), pref: "ok" };
      if (p.homeBy) pv.confirmed = ["homeBy"];
      if (p.budgetMax) {
        pv.budgetMax = p.budgetMax;
        pv.budgetStrength = 3;
        pv.notes = ["最近手头有点紧"];
      }
      if (p.needs) pv.needs = structuredClone(p.needs);
      const m: Member = {
        id: nanoid(10),
        juId: id,
        name: p.name,
        avatar: p.avatar,
        location: { label: `${p.name}的出发地`, lat: +(DEMO_VENUE.lat + p.dLat).toFixed(5), lng: +(DEMO_VENUE.lng + p.dLng).toFixed(5) },
        role: "guest",
        intake: "done",
        status: "in",
        joinedAt: new Date(now.getTime() + i).toISOString(),
        isOrganizer: false,
        isDemo: true,
        private: pv,
        secret: { token: nanoid(24), tier: 1 },
      };
      members.push(m);
      markChanged(ju, ctx.priv, m.id);
      n++;
    });
    if (n) appendTraceAt(ju, "listen", `又有 ${n} 位朋友跟局长私聊完了`, now);
    evalQuorum(ju, members, now);
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

/** 演示用：被局长私下问到的演示成员（没有手机）一律回答"可以"，问完自动重算 */
export function answerDemoAsks(id: string, viewer: Viewer = {}): Promise<JuState> {
  return mutateJu(id, async (ctx) => {
    let n = 0;
    for (const m of ctx.members) {
      if (!m.isDemo) continue;
      const ask = (m.private?.asks ?? []).find((a) => a.status === "pending");
      if (!ask) continue;
      applyAnswer(m, ask.id, true, ctx.now);
      markChanged(ctx.ju, ctx.priv, m.id);
      n++;
    }
    if (!n) throw new HttpError(409, "没有正在等演示朋友回答的问题");
    if (ctx.ju.status === "voting" && !pendingAsks(ctx.members)) {
      await computePlan(ctx.ju, ctx.members, ctx.priv, { ...planDeps(ctx.members), now: ctx.now });
    }
    return publicState(ctx.ju, ctx.members, viewer, { mine: ctx.priv.mine });
  });
}

// ---------------------------------------------------------------- v6 分身谈判场景（scene = "avatar"）
// 8 个人（发起人 + 7 位演示朋友），每人一个分身，一键出方案就能看到完整的五轮谈判：
// - 阿杰：宿舍门禁（确认过的底线），分身很坚持 —— 晚一点开始他就待不满
// - 小林：加班，晚到；分身授权"多等我 15 分钟" —— 自动让步
// - 老王：手头紧，但"我都行"（随和，授权多出 30 元）—— 自动让步；和小林在不同维度各让一步 = 交换
// - 小周：也手头紧，而且"这次就想省点"（坚持，什么都不让）—— 超出授权，分身私下来问本人
// - 阿May：随和，"别太远就好"（授权多走 20 分钟）；想躺着
// - 大刘：想动一动，想找个能聊天的地方
// - 木木：想动一动，还没确认授权书（分身只守底线、不替她让步）
// 时间都相对发起人定的最早开始时间（默认 18:30），所以换个日期 / 时段也成立。

type AvatarPerson = {
  name: string;
  avatar: string;
  /** 相对最早开始时间的分钟数 */
  from: number;
  homeBy?: number;
  budgetMax?: number;
  budgetStrength?: NeedStrength;
  needs?: Need[];
  mood: Mood;
  style: AvatarStyle;
  confirmed: boolean;
  say: string;
  dLat: number;
  dLng: number;
};

const AVATAR_DEMO: AvatarPerson[] = [
  { name: "阿杰", avatar: "🧑‍💻", from: -90, homeBy: 105, mood: "chill", style: "firm", confirmed: true, say: "宿舍门禁，必须按时回去", dLat: 0.01, dLng: -0.01 },
  { name: "小林", avatar: "🦊", from: 70, mood: "active", style: "balanced", confirmed: true, say: "今天加班，得七点多才能走", dLat: -0.008, dLng: 0.012 },
  { name: "老王", avatar: "🐻", from: -60, budgetMax: 60, budgetStrength: 3, mood: "lazy", style: "easy", confirmed: true, say: "我都行，就是最近手头有点紧", dLat: 0.015, dLng: 0.004 },
  { name: "小周", avatar: "🐧", from: -60, budgetMax: 55, budgetStrength: 3, mood: "hype", style: "firm", confirmed: true, say: "这次就想省点钱", dLat: -0.012, dLng: -0.006 },
  {
    name: "阿May",
    avatar: "🐰",
    from: -60,
    needs: [{ id: "n1-maxCommute", dim: "travel", kind: "soft", strength: 2, rule: { t: "maxCommute", minutes: 15 }, text: "单程尽量别超过 15 分钟", source: "chat", at: NEED_AT }],
    mood: "lazy",
    style: "easy",
    confirmed: true,
    say: "我都行，别太远就好",
    dLat: 0.004,
    dLng: 0.018,
  },
  {
    name: "大刘",
    avatar: "🐯",
    from: -60,
    needs: [{ id: "n1-quiet", dim: "ambience", kind: "soft", strength: 2, rule: { t: "quiet" }, text: "想安静点、能好好聊天", source: "chat", at: NEED_AT }],
    mood: "active",
    style: "balanced",
    confirmed: true,
    say: "想找个能聊天的地方，动一动也行",
    dLat: -0.004,
    dLng: -0.016,
  },
  { name: "木木", avatar: "🌳", from: -60, mood: "active", style: "balanced", confirmed: false, say: "想动一动", dLat: 0.018, dLng: -0.004 },
];

/** 分身谈判演示局：加 7 位带授权书的演示朋友，并直接出方案（五轮谈判一次看完） */
export function seedAvatar(id: string, viewer: Viewer = {}): Promise<JuState> {
  return mutateJu(id, async (ctx) => {
    const { ju, members, now } = ctx;
    if (ju.status === "confirmed" || ju.status === "cancelled") throw new HttpError(409, "局已经定了，不能再加演示成员");
    const taken = new Set(members.map((m) => m.name));
    const e0 = hmToMin(ju.spec.earliest) ?? 18 * 60 + 30;
    let n = 0;
    AVATAR_DEMO.forEach((p, i) => {
      if (taken.has(p.name)) return;
      const pv = emptyPrivate();
      pv.rsvp = "yes";
      for (const d of ju.spec.dates)
        pv.availability[d] = { from: minToHm(e0 + p.from), ...(p.homeBy !== undefined ? { homeBy: minToHm(e0 + p.homeBy) } : {}), pref: "ok" };
      if (p.homeBy !== undefined) pv.confirmed = ["homeBy"];
      if (p.budgetMax) {
        pv.budgetMax = p.budgetMax;
        pv.budgetStrength = p.budgetStrength ?? 2;
      }
      if (p.needs) pv.needs = structuredClone(p.needs);
      pv.mood = p.mood;
      pv.chat.push({ role: "me", text: p.say, at: now.toISOString() });
      pv.mandate = {
        status: p.confirmed ? "confirmed" : "draft",
        style: p.style,
        give: { ...STYLE_GIVE[p.style] },
        floors: p.homeBy !== undefined ? ["homeBy"] : [],
        ...(p.confirmed ? { confirmedAt: now.toISOString() } : {}),
      };
      const m: Member = {
        id: nanoid(10),
        juId: id,
        name: p.name,
        avatar: p.avatar,
        location: { label: `${p.name}的出发地`, lat: +(DEMO_VENUE.lat + p.dLat).toFixed(5), lng: +(DEMO_VENUE.lng + p.dLng).toFixed(5) },
        role: "guest",
        intake: "done",
        status: "in",
        joinedAt: new Date(now.getTime() + i).toISOString(),
        isOrganizer: false,
        isDemo: true,
        private: pv,
        secret: { token: nanoid(24), tier: 1 },
      };
      members.push(m);
      markChanged(ju, ctx.priv, m.id);
      n++;
    });
    if (n) appendTraceAt(ju, "listen", `又有 ${n} 位朋友把授权书交给了自己的分身`, now);
    evalQuorum(ju, members, now);
    // 一键看完整谈判：直接出方案（门限没达成时先不出）
    if (!quorumHidden(ju) && inOnly(members).length > 0) await computePlan(ju, members, ctx.priv, { ...planDeps(members), now });
    return publicState(ju, members, viewer, { mine: ctx.priv.mine });
  });
}

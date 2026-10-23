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
import { getMapProvider } from "../map";
import { buildSwipeDeck, demoPeople, predictSwipes, type DemoPerson } from "../planner";
import type { JuState, Member, Poi, Profile, SwipeVerdict } from "../types";
import { publicState } from "./firewall";
import { HttpError } from "./http";
import { AVATARS, TIER_LABELS, mutateJu, type Viewer } from "./ju";
import { appendTraceAt, autofillMember, emptyPrivate, evalQuorum, inOnly, markChanged, recomputeMatches } from "./ju-core";
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

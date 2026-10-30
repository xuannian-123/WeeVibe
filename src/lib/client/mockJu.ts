"use client";

// 开发用假后端：/j/<id>?mock=<fixture>（仅非生产环境）。动作在本地改 fixture，私聊按规则脚本推进。
import { useMemo, useRef, useState } from "react";
import type {
  AvatarLogEntry,
  ChatReply,
  ChatTurn,
  ChatWidget,
  Experience,
  JuState,
  Member,
  MemberPrivate,
  MyExperience,
  Negotiation,
  Plan,
  Poi,
  Proposal,
  Segment,
  TraceEvent,
} from "@/lib/types";
import { FIXTURES, fixtureConfirmed, fixtureDeck, fixturePredicted, fixtureVoting, type FixtureKey } from "@/components/fixtures";
import type { JuActions, JuHook } from "./useJu";
import type { AvatarActions, ChatBody } from "./api";

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const ASK: Record<Exclude<ChatWidget, null>, string> = {
  rsvp: "这次能来吗？说不来也没关系，只有我知道。",
  location: "收到 👌 你一般从哪出发？",
  time: "哪天几点能出发？有门禁或者末班车的话也告诉我，群里不会知道。",
  schedule: "传张课表截图也行，我来看哪些时间有课。",
  diet: "有什么不吃的吗？",
  budget: "人均多少以内你比较舒服？不方便在群里说的，悄悄告诉我就好。",
  swipe: "最后一步，刷几家店吧，右滑想去 🃏",
};

function nextWidget(me: Member, p: MemberPrivate, quorumPending: boolean, askedNote: boolean): ChatWidget {
  if (!p.rsvp && quorumPending) return "rsvp";
  if (!me.location) return "location";
  if (!Object.keys(p.availability).length) return "time";
  if (!p.dietTags.length && !p.notes.includes("__diet")) return "diet";
  if (p.budgetMax == null && !p.autoFilled.includes("budget") && !p.notes.includes("__budget")) return "budget";
  if (!askedNote) return null;
  return "swipe";
}

export function useMockJu(id: string, key: string): JuHook {
  const [initial] = useState<JuState>(() =>
    isAvatarMock(key) ? fixtureAvatar(key) : FIXTURES[(key in FIXTURES ? key : "waiting") as FixtureKey],
  );
  const [state, setState] = useState<JuState>(() => structuredClone({ ...initial, ju: { ...initial.ju, id } }));
  const ref = useRef(state);
  ref.current = state;
  const askedNote = useRef(false);

  const set = (f: (s: JuState) => JuState) => {
    const next = f(structuredClone(ref.current));
    ref.current = next;
    setState(next);
    return next;
  };

  const actions = useMemo<JuActions>(() => {
    const patchMe = (f: (me: Member, p: MemberPrivate) => void) =>
      set((s) => {
        if (s.me?.private) f(s.me, s.me.private);
        if (s.me) s.members = s.members.map((m) => (m.id === s.me!.id ? { ...m, intake: s.me!.intake, location: s.me!.location } : m));
        return s;
      });
    const base: JuActions = {
      refresh: async () => {},
      apply: (s) => set(() => s),
      join: async (body) => {
        await wait(500);
        const opening: ChatReply = {
          reply: `${body.name}你好～我是这次${ref.current.ju.spec.category}局的局长 🙋 群里不方便说的，都可以悄悄告诉我，我只说结论，不说是谁。${ref.current.ju.quorum?.state === "pending" ? "先问一句：这次能来吗？" : "你一般从哪出发？"}`,
          widget: ref.current.ju.quorum?.state === "pending" ? "rsvp" : "location",
          quickReplies: [],
          done: false,
        };
        const me: Member = {
          id: "me",
          juId: id,
          name: body.name,
          avatar: body.avatar ?? "🙂",
          role: "guest",
          intake: "chatting",
          status: "in",
          joinedAt: now(),
          isOrganizer: !!body.isOrganizer,
          seedId: body.seedId,
          private: {
            chat: [{ role: "juzhang", text: opening.reply, at: now() }],
            availability: {},
            dietTags: [],
            notes: [],
            swipes: {},
            autoFilled: [],
            wants: [],
            matches: [],
            billFacts: {},
            inbox: [],
          },
        };
        set((s) => ({ ...s, me, mine: { experiences: [], matchNames: [], unread: 0 } }));
        return { memberId: "me", memberToken: "mock", status: "in", opening };
      },
      chat: async (body: ChatBody) => {
        await wait(500);
        if ("preferenceAction" in body && body.preferenceAction) {
          const next = patchMe((me, p) => {
            if (body.rsvp) p.rsvp = body.rsvp;
            if (body.rsvp === "no") me.status = "out";
            if (body.location) me.location = body.location;
            if (body.availability) p.availability = body.availability;
            if (body.budgetMax !== undefined) p.budgetMax = body.budgetMax;
            if (body.dietTags) p.dietTags = body.dietTags;
            p.autoFilled = [];
            if (body.preferenceAction === "finish") me.intake = "done";
            else if (body.preferenceAction === "swipe") me.intake = "swiping";
          });
          return { reply: "偏好已记下，有变化随时告诉局长。", widget: body.preferenceAction === "swipe" ? "swipe" : null, quickReplies: [], done: body.preferenceAction !== "review", me: next.me! };
        }
        let say = "";
        let reply = "";
        const quorumPending = ref.current.ju.quorum?.state === "pending";
        const next = patchMe((me, p) => {
          if ("text" in body) {
            say = body.text;
            if (/都行|随便|你定/.test(body.text)) {
              p.availability = { [ref.current.ju.spec.dates[0]]: { from: "18:30", pref: "ok" }, [ref.current.ju.spec.dates[1] ?? ref.current.ju.spec.dates[0]]: { from: "17:00", pref: "ok" } };
              p.budgetMax ??= 100;
              p.autoFilled = ["availability", "budget"];
              reply = "好嘞，我按你平时的习惯先填上了，你看看对不对 👇";
            } else if (/没有了|就这些|没了/.test(body.text)) {
              askedNote.current = true;
            } else if (/不限|都行/.test(body.text)) {
              p.notes.push("__budget");
            } else {
              p.notes.push(body.text);
              reply = "记下了，这句话只有我知道 🤐";
            }
          } else {
            if (body.rsvp) {
              p.rsvp = body.rsvp;
              say = body.rsvp === "yes" ? "能来！" : "这次来不了";
              if (body.rsvp === "no") {
                me.status = "out";
                reply = "收到，这事只有我知道 🤝 群里不会出现你的名字，也看不出你是没空还是没回。下次有局我再悄悄问你。";
              }
            }
            if (body.location) {
              me.location = body.location;
              say = `从${body.location.label}出发`;
            }
            if (body.availability) {
              p.availability = body.availability;
              p.autoFilled = p.autoFilled.filter((x) => x !== "availability");
              say = "时间填好了";
            }
            if (body.schedule) {
              p.availability = { [ref.current.ju.spec.dates[0]]: { from: "18:10", pref: "ok" } };
              say = "📷 发了一张课表截图";
              reply = "看到了：周五下午 4 点到 5 点 50 有课，所以 18:10 之后才能出发，我记下了 📒";
            }
            if (body.dietTags) {
              p.dietTags = body.dietTags;
              if (!body.dietTags.length) p.notes.push("__diet");
              p.autoFilled = p.autoFilled.filter((x) => x !== "diet");
              say = body.dietTags.join("、") || "啥都吃";
            }
            if (body.budgetMax != null) {
              p.budgetMax = body.budgetMax;
              p.autoFilled = p.autoFilled.filter((x) => x !== "budget");
              say = `人均 ${body.budgetMax} 以内`;
            }
            if (body.autofill) {
              p.availability = { [ref.current.ju.spec.dates[0]]: { from: "18:30", pref: "ok" } };
              p.budgetMax ??= 100;
              p.autoFilled = ["availability", "budget"];
              say = "都行";
              reply = "好嘞，我按你平时的习惯先填上了，随时可以改 👇";
            }
          }
          const w = me.status === "out" ? null : nextWidget(me, p, quorumPending, askedNote.current);
          if (!reply) reply = w ? ASK[w] : "还有什么想让局长知道的吗？比如这周在减肥、想早点回。";
          const turns: ChatTurn[] = [
            { role: "me", text: say, at: now() },
            { role: "juzhang", text: reply, at: now() },
          ];
          p.chat.push(...turns);
          if (w === "swipe") me.intake = "chatting";
        });
        const me = next.me!;
        const w = me.status === "out" || body.preferencesChat ? null : nextWidget(me, me.private!, quorumPending, askedNote.current);
        return {
          reply: me.private!.chat.at(-1)!.text,
          widget: w,
          quickReplies: w === "time" || w === "budget" ? ["都行"] : w === null && me.status !== "out" ? ["没有了"] : [],
          done: w === "swipe",
          me,
        };
      },
      deck: async () => {
        await wait(600);
        set((s) => {
          if (s.me) s.me.intake = "swiping";
          return s;
        });
        return { deck: fixtureDeck, predicted: fixturePredicted };
      },
      swipe: async (poiId, verdict) => {
        await wait(150);
        const s = patchMe((me, p) => {
          p.swipes[poiId] = verdict;
          if (Object.keys(p.swipes).length >= fixtureDeck.length) me.intake = "done";
        });
        return s.me!;
      },
      wants: async (ids) => {
        await wait(400);
        const names = ids.includes("m2") ? ["阿杰"] : [];
        set((s) => {
          if (s.me?.private) {
            s.me.private.wants = ids;
            s.me.private.matches = ids.includes("m2") ? ["m2"] : [];
          }
          s.mine = { experiences: [], unread: 0, ...s.mine, matchNames: names };
          return s;
        });
        return names;
      },
      social: async (body) => {
        await wait(300);
        const s = patchMe((me, p) => {
          if (body.know) p.know = { ...(p.know ?? {}), ...body.know };
          if (body.energy) p.energy = body.energy;
          if (body.avoid) p.avoid = body.avoid.slice(0, 1);
          if (body.interests) me.interests = body.interests;
        });
        return s.me!;
      },
      feel: async (round, feel) => {
        await wait(200);
        patchMe((_me, p) => {
          p.feel = { ...(p.feel ?? {}), [String(round)]: feel };
        });
      },
      clicked: async (ids) => {
        await wait(300);
        patchMe((_me, p) => {
          p.clicked = ids;
        });
        return [];
      },
      answerAsk: async (askId, yes) => {
        await wait(300);
        patchMe((_me, p) => {
          const a = (p.asks ?? []).find((x) => x.id === askId);
          if (a) a.status = yes ? "yes" : "no";
        });
      },
      setStatus: async (status) => {
        await wait(300);
        patchMe((me) => {
          me.status = status;
        });
      },
      vote: async (pid) => {
        await wait(300);
        set((s) => {
          s.ju.votes = { ...s.ju.votes, me: pid };
          const n = Object.values(s.ju.votes).filter((v) => v === pid).length;
          if (n > s.counts.in / 2) {
            s.ju.status = "confirmed";
            s.ju.confirmedProposalId = pid;
          }
          return s;
        });
      },
      verify: async () => {
        await wait(700);
        const a = ref.current.ju.plan!.audit;
        return { ok: true, inputHash: a.inputHash, outputHash: a.outputHash, recomputedOutputHash: a.outputHash };
      },
      itinerary: async () => {
        await wait(500);
        return fixtureConfirmed.mine!.itinerary!;
      },
      eta: async () => {
        await wait(800);
        const eta = { arriveAt: "2026-10-23T11:03:00.000Z", lateMin: 3, updatedAt: now() };
        patchMe((me) => {
          me.eta = eta;
        });
        return eta;
      },
      inbox: async () => ref.current.me?.private?.inbox ?? [],
      inboxRead: async () => {
        const s = patchMe((_, p) => {
          p.inbox = p.inbox.map((n) => ({ ...n, read: true }));
        });
        return s.me?.private?.inbox ?? [];
      },
      paid: async () => {
        await wait(400);
        set((s) => {
          if (s.me?.private?.payment) s.me.private.payment.paid = true;
          if (s.ju.settlement) s.ju.settlement.paidCount += 1;
          return s;
        });
      },
      uploadPhoto: async (image) => {
        await wait(600);
        return image;
      },
      plan: async () => {
        await wait(1200);
        set((s) => ({ ...s, ju: { ...s.ju, status: "voting", plan: fixtureVoting.ju.plan, votes: {} }, mine: fixtureVoting.mine }));
      },
      confirm: async (pid) => {
        set((s) => ({ ...s, ju: { ...s.ju, status: "confirmed", confirmedProposalId: pid } }));
      },
      seed: async () => {
        set(() => structuredClone({ ...FIXTURES.waiting, ju: { ...FIXTURES.waiting.ju, id } }));
      },
    };
    // v6：撤回分身的自动让步（JuActions 还没有这个动作，组件按 AvatarActions 鸭子类型取用）
    const extra: AvatarActions = {
      revokeAvatar: async (entryId) => {
        await wait(400);
        patchMe((_me, p) => {
          p.avatarLog = (p.avatarLog ?? []).map((e) => (e.id === entryId ? { ...e, revoked: true } : e));
        });
      },
    };
    return Object.assign(base, extra);
  }, [id]);

  return { state, loadError: null, offline: false, memberId: state.me?.id ?? null, adminToken: null, tierToken: null, ready: true, actions };
}

/* ───────────────────────── v6 分身谈判演示数据 ─────────────────────────
 * /j/<id>?mock=avatar（投票中）/ ?mock=avatar-confirmed（已定局）。
 * 8 个人：门禁冲突、有人预算紧、有人想动有人想躺 → 两段式「攀岩 → 家常菜」。
 * 公开的 negotiation 只用代号；avatarLog 只属于本人（阿鹿）。
 */
export const AVATAR_MOCKS = ["avatar", "avatar-confirmed"] as const;
export const isAvatarMock = (key: string) => (AVATAR_MOCKS as readonly string[]).includes(key);

const V6_DAY = "2026-11-07";
const v6 = (hm: string) => `${V6_DAY}T${hm}:00+08:00`;

const climbPoi: Poi = {
  id: "v6-climb",
  name: "岩时攀岩馆（徐汇店）",
  address: "徐汇区宜山路 455 号 3 楼",
  lat: 31.1872,
  lng: 121.4301,
  rating: 4.7,
  costPerPerson: 98,
  type: "体育休闲服务;运动场馆;攀岩馆",
  openTime: "10:00-22:00",
  indoor: true,
};
const dinnerPoi: Poi = {
  id: "v6-dinner",
  name: "弄堂小馆·家常菜",
  address: "徐汇区虹漕路 88 号",
  lat: 31.1851,
  lng: 121.4335,
  rating: 4.6,
  costPerPerson: 85,
  type: "餐饮服务;中餐厅;家常菜",
  openTime: "11:00-22:00",
  indoor: true,
};
const boardPoi: Poi = {
  id: "v6-board",
  name: "星空桌游馆",
  address: "徐汇区漕溪北路 331 号",
  lat: 31.1934,
  lng: 121.4372,
  rating: 4.5,
  costPerPerson: 68,
  type: "体育休闲服务;娱乐场所;桌游",
  indoor: true,
};

const v6People: Pick<Member, "id" | "name" | "avatar" | "isOrganizer">[] = [
  { id: "m1", name: "小陈", avatar: "🐼", isOrganizer: true },
  { id: "m2", name: "阿杰", avatar: "🐯", isOrganizer: false },
  { id: "m3", name: "小林", avatar: "🐰", isOrganizer: false },
  { id: "m4", name: "老王", avatar: "🐻", isOrganizer: false },
  { id: "m5", name: "小周", avatar: "🐧", isOrganizer: false },
  { id: "m6", name: "Momo", avatar: "🐱", isOrganizer: false },
  { id: "m7", name: "大海", avatar: "🐳", isOrganizer: false },
  { id: "me", name: "阿鹿", avatar: "🦊", isOrganizer: false },
];
const V6_LOC: Record<string, [number, number, string]> = {
  m1: [31.1946, 121.4365, "徐家汇"],
  m2: [31.17, 121.397, "漕河泾"],
  m3: [31.205, 121.452, "交大徐汇校区"],
  m4: [31.158, 121.429, "上海师大"],
  m5: [31.183, 121.46, "龙华中路"],
  m6: [31.214, 121.418, "中山公园"],
  m7: [31.141, 121.47, "华东理工"],
  me: [31.176, 121.442, "上海南站"],
};

function v6Exp(memberId: string, commuteMin: number, utility: number, extra: Partial<Experience> = {}): Experience {
  const lateMin = extra.lateMin ?? 0;
  const status: Experience["status"] =
    extra.status ?? (lateMin > 0 && extra.leaveAt ? "lateEarly" : lateMin > 0 ? "late" : extra.leaveAt ? "early" : "full");
  return {
    memberId,
    status,
    arriveAt: lateMin ? `15:${String(lateMin).padStart(2, "0")}` : "15:00",
    lateMin,
    stayMin: 360 - lateMin,
    commuteMin,
    utility,
    notes: [...(lateMin ? [`晚到 ${lateMin} 分钟`] : []), ...(extra.leaveAt ? [`${extra.leaveAt} 需先走`] : [])],
    ...extra,
  };
}

const v6Segments: Segment[] = [
  { activity: "climbing", activityName: "攀岩", poi: climbPoi, start: v6("15:00"), end: v6("17:40") },
  { activity: "homestyle", activityName: "家常菜", poi: dinnerPoi, start: v6("18:00"), end: v6("21:00") },
];

const v6Proposals: Proposal[] = [
  {
    id: "v6p1",
    label: "balanced",
    labelText: "大家都照顾到",
    slot: { id: `${V6_DAY}T15:00`, start: v6("15:00"), end: v6("21:00") },
    poi: climbPoi,
    segments: v6Segments,
    experiences: [
      v6Exp("m1", 12, 92),
      v6Exp("m2", 28, 84),
      v6Exp("m3", 18, 88),
      v6Exp("m4", 24, 86),
      v6Exp("m5", 16, 90),
      v6Exp("m6", 26, 80),
      v6Exp("m7", 35, 82, { leaveAt: "21:00" }),
      v6Exp("me", 20, 85, { lateMin: 15 }),
    ],
    attendCount: 8,
    cared: 8,
    minUtility: 78,
    avgUtility: 86,
    score: 88,
    headline: "8 人全到：下午攀岩，傍晚步行 6 分钟去吃安静的家常菜",
    tradeoffs: ["有 1 位朋友晚到 15 分钟（他的分身已同意）"],
    highlights: ["想动的和想躺的都有份", "晚饭人均 85，大家都在预算内", "21:00 前结束，赶得上门禁"],
    blurb: "先出一身汗，再坐下来慢慢聊。",
    recommended: true,
    risks: [{ kind: "weather", level: "low", text: "周六傍晚预报小雨", mitigation: "两家都在室内，中间只走 6 分钟，带把伞", confidence: "known" }],
  },
  {
    id: "v6p2",
    label: "cheapest",
    labelText: "最省钱",
    slot: { id: `${V6_DAY}T19:00`, start: v6("19:00"), end: v6("22:00") },
    poi: boardPoi,
    experiences: [
      v6Exp("m1", 8, 84, { arriveAt: "19:00" }),
      v6Exp("m2", 30, 70, { arriveAt: "19:00" }),
      v6Exp("m3", 14, 80, { arriveAt: "19:00" }),
      v6Exp("m4", 22, 75, { arriveAt: "19:00" }),
      v6Exp("m5", 18, 82, { arriveAt: "19:00" }),
      v6Exp("m6", 20, 64, { arriveAt: "19:00" }),
      v6Exp("m7", 38, 0, { status: "absent", stayMin: 0, notes: ["这个时间来不了"] }),
      v6Exp("me", 16, 78, { arriveAt: "19:00" }),
    ],
    attendCount: 7,
    cared: 6,
    minUtility: 60,
    avgUtility: 76,
    score: 70,
    headline: "7 人能到，人均最低",
    tradeoffs: ["结束得晚，有 1 位朋友来不了", "想动一动的朋友没得动"],
    highlights: ["人均 68，最省钱"],
    recommended: false,
  },
];

const v6Negotiation: Negotiation = {
  events: [
    { round: 0, speaker: "局长", kind: "open", text: "8 个分身到齐，授权书已经密封交给我。其中 3 个带着底线来，底线内容只有我知道。" },
    { round: 0, speaker: "局长", kind: "open", text: "规矩：所有让步由我按代价从小到大发起，分身只在本人授权的范围里回应。" },
    { round: 1, speaker: "局长", kind: "propose", text: "大家心情分化：有人想动一动，也有人想躺着聊天。拆成两段 —— 下午攀岩，傍晚吃饭。" },
    { round: 1, speaker: "局长", kind: "propose", text: "初版：15:00 攀岩 → 18:30 川菜馆，21:30 结束。" },
    { round: 1, speaker: "分身 C", kind: "block", text: "21:30 结束碰到我的底线，这版我不能同意。" },
    { round: 1, speaker: "分身 F", kind: "block", text: "川菜馆人均 128，超出了我能做主的范围。" },
    { round: 1, speaker: "分身 A", kind: "block", text: "15:00 我赶不到，最早 15:15。" },
    { round: 2, speaker: "局长", kind: "propose", text: "三个卡点。先找代价最小的：晚饭提前到 18:00，换成步行 6 分钟的家常菜，人均 85，21:00 前结束。" },
    { round: 2, speaker: "局长", kind: "propose", text: "分身 C、分身 F 的卡点解除。还剩分身 A 的开始时间。" },
    { round: 2, speaker: "分身 A", kind: "concede", text: "晚到 15 分钟在授权范围内，我替本人同意，不打扰本人。" },
    { round: 2, speaker: "分身 D", kind: "concede", text: "晚饭这家我多走 5 分钟，也在授权范围内，同意。" },
    { round: 3, speaker: "局长", kind: "trade", text: "分身 B 想多攀一会儿，分身 G 想早点坐下：B 少攀 20 分钟、G 晚吃 10 分钟，两边都比各自坚持更好。" },
    { round: 3, speaker: "分身 B", kind: "trade", text: "同意交换。" },
    { round: 3, speaker: "分身 G", kind: "trade", text: "同意，成交。" },
    { round: 3, speaker: "局长", kind: "compensate", text: "分身 A 刚才让了步：第二段按 A 的口味加权挑店，记一笔补偿。" },
    { round: 4, speaker: "局长", kind: "decide", text: "拍板：周六 15:00 攀岩 → 步行 6 分钟 → 18:00 家常菜，21:00 前结束；下雨两家都在室内。" },
    { round: 4, speaker: "局长", kind: "decide", text: "照顾到 8/8。每个分身会私下告诉本人：得到了什么、替本人让了什么、为什么。" },
  ],
  autoConcessions: 2,
  asked: 0,
  trades: 1,
  outcome: "8 个分身谈了 5 轮：2 次自动让步、1 次交换、1 次补偿，照顾到 8/8，没打扰任何人",
};

const v6Plan: Plan = {
  proposals: v6Proposals,
  recommendation: "推荐周六下午攀岩 + 傍晚家常菜：8 个人都照顾到了，想动的和想躺的都有份，21:00 前结束。",
  why: ["8 个人都照顾到了", "最不开心的那位也有 78 分", "两段式：想动的先动，想聊的后半场坐下来聊"],
  negotiation: v6Negotiation,
  caredFor: "这次优先照顾了上次让过步的 1 位朋友",
  constraintSummaries: ["有人晚上要早点回去，21:00 前结束", "有 2 位朋友想安静点，第二段选了能聊天的店", "有人预算偏紧，晚饭控制在人均 85"],
  center: { lat: 31.1862, lng: 121.4318 },
  audit: {
    inputHash: "6a1f0c93be27d4e8a5f1c3b7d9e2a4c6f8b0d2e4a6c8e0f2b4d6a8c0e2f4a6b8",
    outputHash: "c4e2a0f8d6b4c2e0a8f6d4b2c0e8a6f4d2b0c8e6a4f2d0b8c6e4a2f0d8b6c4e2",
    candidates: 96,
    evaluations: 768,
    paretoSize: 6,
    algorithmVersion: "juzhang-planner/6.0.0-avatar",
  },
  computedAt: v6("10:00"),
};

const v6Mine: MyExperience[] = [
  {
    proposalId: "v6p1",
    utility: 85,
    cared: true,
    notes: ["晚饭人均 85，在你说的 100 以内"],
    needs: [
      { text: "23:00 前到家", result: "met", detail: "21:00 结束，路上 20 分钟" },
      { text: "人均 100 以内", result: "met", detail: "晚饭人均 85" },
      { text: "这次想动一动", result: "met", detail: "下午攀岩" },
      { text: "不吃辣", result: "met", detail: "第二段按你的口味挑" },
    ],
  },
  {
    proposalId: "v6p2",
    utility: 78,
    cared: true,
    notes: ["人均 68，最省"],
    needs: [
      { text: "23:00 前到家", result: "met" },
      { text: "人均 100 以内", result: "met" },
      { text: "这次想动一动", result: "unmet", detail: "桌游基本不动" },
    ],
  },
];

function v6AvatarLog(now: number): AvatarLogEntry[] {
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  return [
    { id: "al1", at: ago(6), kind: "concede", dim: "lateMin", text: "替你让了 15 分钟：你 15:15 到，第一段少攀一会儿" },
    { id: "al2", at: ago(6), kind: "held", text: "守住了你的底线：23:00 前到家（21:00 结束，路上 20 分钟）" },
    { id: "al3", at: ago(6), kind: "gained", text: "争取到了：下午能动一动，晚饭人均 85，在你说的 100 以内" },
    { id: "al4", at: ago(5), kind: "compensated", text: "补偿：你让过步，第二段按你的口味选 —— 不辣、能坐下来聊天" },
  ];
}

/** v6 演示局：8 人谈判 + 两段式方案 + 本人的分身记录 */
export function fixtureAvatar(key: string, now = Date.now()): JuState {
  const base = structuredClone(fixtureVoting);
  const confirmed = key === "avatar-confirmed";
  const members: Member[] = v6People.map((p, i) => {
    const [lat, lng, label] = V6_LOC[p.id];
    return {
      ...p,
      juId: base.ju.id,
      location: { lat, lng, label },
      role: "guest",
      intake: "done",
      status: "in",
      joinedAt: new Date(now - (60 - i * 5) * 60_000).toISOString(),
    };
  });
  const me: Member = {
    ...members.at(-1)!,
    private: {
      ...structuredClone(base.me!.private!),
      budgetMax: 100,
      mood: "active",
      mandate: { status: "confirmed", style: "balanced", give: { lateMin: 15, stayCutMin: 15, budgetUp: 15, commuteUp: 10 }, floors: ["homeBy"] },
      avatarLog: v6AvatarLog(now),
      inbox: [{ id: "nv6", at: new Date(now - 5 * 60_000).toISOString(), kind: "avatar", text: "你的分身替你让了 15 分钟：你 15:15 到。30 分钟内可以撤回。" }],
    },
  };
  return {
    ju: {
      ...base.ju,
      title: "周六一起出来动一动",
      spec: { ...base.ju.spec, category: "局长定", open: true, dates: [V6_DAY], earliest: "14:00", latest: "22:00", durationMinutes: 360 },
      status: confirmed ? "confirmed" : "voting",
      plan: v6Plan,
      votes: confirmed ? { m1: "v6p1", m2: "v6p1", m3: "v6p1", m5: "v6p1", me: "v6p1" } : { m1: "v6p1", m3: "v6p1" },
      confirmedProposalId: confirmed ? "v6p1" : undefined,
      revisions: [],
      reservation: confirmed ? { status: "booked", tableSize: 8 } : undefined,
      trace: [
        ["listen", "8 个人都交了授权书，其中 3 个有底线"],
        ["compute", "心情分化：有人想动，有人想躺 → 考虑两段式"],
        ["search", "在攀岩馆周边 15 分钟步行内找能聊天的家常菜"],
        ["compute", "96 个候选 × 8 人 = 768 次体验计算"],
        ["decide", "分身谈判 5 轮：2 次自动让步、1 次交换"],
        ["done", "照顾到 8/8，等大家投票"],
      ].map(([kind, text], i) => ({ id: `v6t${i}`, at: new Date(now - (12 - i) * 60_000).toISOString(), kind: kind as TraceEvent["kind"], text })),
    },
    members,
    counts: { in: 8, done: 8, waitlist: 0, matchPairs: 1 },
    me,
    mine: { experiences: v6Mine, matchNames: [], unread: 1 },
  };
}

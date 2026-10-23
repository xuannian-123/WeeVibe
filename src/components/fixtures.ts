// 写死的 v3 假数据：/dev/gallery 和 /j/<id>?mock=<key>（仅开发环境）用，不依赖后端
import type {
  ChatReply,
  ChatTurn,
  Experience,
  Itinerary,
  Ju,
  JuState,
  Member,
  MemberPrivate,
  MyExperience,
  Notice,
  Plan,
  Poi,
  Proposal,
  Slot,
  Stats,
  SwipeVerdict,
} from "@/lib/types";

const JU_ID = "demo42";
const T0 = "2026-10-22T04:00:00.000Z";
const at = (min: number) => new Date(Date.parse(T0) + min * 60000).toISOString();

function mkSlots(): Slot[] {
  const out: Slot[] = [];
  for (const date of ["2026-10-23", "2026-10-24"]) {
    for (const t of ["18:00", "18:30", "19:00", "19:30"]) {
      const [h, m] = t.split(":").map(Number);
      out.push({
        id: `${date}T${t}`,
        start: `${date}T${t}:00+08:00`,
        end: `${date}T${String(h + 2).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+08:00`,
      });
    }
  }
  return out;
}
const slots = mkSlots();
const slot = (id: string) => slots.find((s) => s.id === id)!;

/* ───────── 人 ───────── */
type Pub = Pick<Member, "id" | "name" | "avatar" | "location" | "isOrganizer"> & { intake?: Member["intake"] };
const people: Pub[] = [
  { id: "m1", name: "小陈", avatar: "🐼", isOrganizer: true, location: { lat: 31.1946, lng: 121.4365, label: "徐家汇地铁站" } },
  { id: "m2", name: "阿杰", avatar: "🐯", isOrganizer: false, location: { lat: 31.1700, lng: 121.3970, label: "漕河泾开发区" } },
  { id: "m3", name: "小林", avatar: "🐰", isOrganizer: false, location: { lat: 31.2050, lng: 121.4520, label: "交大徐汇校区" } },
  { id: "m4", name: "老王", avatar: "🐻", isOrganizer: false, location: { lat: 31.1580, lng: 121.4290, label: "上海师大宿舍" } },
  { id: "m5", name: "小周", avatar: "🐧", isOrganizer: false, location: { lat: 31.1830, lng: 121.4600, label: "龙华中路" } },
  { id: "me", name: "阿鹿", avatar: "🦊", isOrganizer: false, location: { lat: 31.1760, lng: 121.4420, label: "上海南站" } },
];

function pubMember(p: Pub, extra: Partial<Member> = {}): Member {
  return {
    id: p.id,
    juId: JU_ID,
    name: p.name,
    avatar: p.avatar,
    location: p.location,
    role: p.id === "m2" ? "must" : "guest",
    intake: p.intake ?? "done",
    status: "in",
    joinedAt: at(people.indexOf(p) * 4),
    isOrganizer: p.isOrganizer,
    ...extra,
  };
}

/* ───────── 刷卡卡组 ───────── */
export const fixtureDeck: Poi[] = [
  { id: "d1", name: "蜀大侠火锅（徐家汇店）", address: "徐汇区虹桥路 1 号港汇恒隆 5F", rating: 4.7, costPerPerson: 98, type: "餐饮服务;中餐厅;火锅店", lat: 31.1953, lng: 121.4372, openTime: "11:00-02:00" },
  { id: "d2", name: "左庭右院鲜牛肉火锅", address: "徐汇区漕溪北路 88 号", rating: 4.6, costPerPerson: 118, type: "餐饮服务;中餐厅;火锅店", lat: 31.1890, lng: 121.4330, openTime: "10:30-22:30" },
  { id: "d3", name: "谭鸭血老火锅（龙华店）", address: "徐汇区龙华中路 600 号", rating: 4.4, costPerPerson: 76, type: "餐饮服务;中餐厅;火锅店", lat: 31.1790, lng: 121.4520 },
  { id: "d4", name: "捞王锅物料理（日月光）", address: "黄浦区徐家汇路 618 号", rating: 4.5, costPerPerson: 132, type: "餐饮服务;中餐厅;火锅店", lat: 31.2070, lng: 121.4700 },
  { id: "d5", name: "珮姐老火锅", address: "徐汇区天钥桥路 380 号", rating: 4.8, costPerPerson: 108, type: "餐饮服务;中餐厅;火锅店", lat: 31.1870, lng: 121.4380 },
];
export const fixturePredicted: Record<string, SwipeVerdict> = { d1: "love", d3: "like", d4: "pass" };

/* ───────── 方案 ───────── */
function exp(memberId: string, e: Partial<Experience> & { commuteMin: number }): Experience {
  const lateMin = e.lateMin ?? 0;
  const status: Experience["status"] =
    e.status ?? (lateMin > 0 && e.leaveAt ? "lateEarly" : lateMin > 0 ? "late" : e.leaveAt ? "early" : "full");
  const notes = e.notes ?? [
    ...(lateMin > 0 ? [`晚到 ${lateMin} 分钟`] : []),
    ...(e.leaveAt ? [`${e.leaveAt} 需先走`] : []),
  ];
  return { memberId, status, lateMin, stayMin: e.stayMin ?? 120, utility: e.utility ?? 90, notes, ...e } as Experience;
}

const p1: Proposal = {
  id: "p1",
  label: "most-people",
  labelText: "人最全",
  slot: slot("2026-10-23T19:00"),
  poi: { ...fixtureDeck[0], tel: "021-64269999" },
  experiences: [
    exp("m1", { commuteMin: 6, arriveAt: "19:00", utility: 96 }),
    exp("m2", { commuteMin: 34, arriveAt: "19:20", lateMin: 20, utility: 68 }),
    exp("m3", { commuteMin: 14, arriveAt: "19:00", utility: 92 }),
    exp("m4", { commuteMin: 22, arriveAt: "19:00", leaveAt: "21:20", stayMin: 140, utility: 81 }),
    exp("m5", { commuteMin: 18, arriveAt: "19:00", utility: 90 }),
    exp("me", { commuteMin: 21, arriveAt: "19:00", utility: 88 }),
  ],
  attendCount: 6,
  minUtility: 64,
  avgUtility: 84,
  score: 86,
  headline: "6 人全到，有 1 人晚 20 分钟",
  tradeoffs: ["阿杰要晚到 20 分钟", "周五饭点可能要排队 15 分钟"],
  highlights: ["人均 98，大家都在预算内", "3 人刷卡点了想去", "有鸳鸯锅，不吃辣的朋友也能吃"],
  blurb: "离谁都不远，周五早点去拿号就行。",
  recommended: true,
};
const p2: Proposal = {
  id: "p2",
  label: "most-comfortable",
  labelText: "大家最舒服",
  slot: slot("2026-10-24T18:30"),
  poi: { ...fixtureDeck[4], tel: "021-54119988" },
  experiences: [
    exp("m1", { commuteMin: 9, arriveAt: "18:30", utility: 94 }),
    exp("m2", { commuteMin: 25, arriveAt: "18:30", utility: 90 }),
    exp("m3", { commuteMin: 16, arriveAt: "18:30", utility: 92 }),
    exp("m4", { commuteMin: 18, arriveAt: "18:30", leaveAt: "21:30", stayMin: 180, utility: 90 }),
    exp("m5", { commuteMin: 15, arriveAt: "18:30", utility: 93 }),
    exp("me", { commuteMin: 12, arriveAt: "18:30", utility: 95 }),
  ],
  attendCount: 6,
  minUtility: 72,
  avgUtility: 88,
  score: 84,
  headline: "6 人全到，没人迟到",
  tradeoffs: ["改到周六，有人周五更方便", "人均 108，略高"],
  highlights: ["没人需要赶路", "评分 4.8，三家里最高", "这次优先照顾了跑得最远的朋友"],
  recommended: false,
};
const p3: Proposal = {
  id: "p3",
  label: "cheapest",
  labelText: "最省钱",
  slot: slot("2026-10-23T18:30"),
  poi: { ...fixtureDeck[2], tel: "021-64561234" },
  experiences: [
    exp("m1", { commuteMin: 12, arriveAt: "18:30", utility: 92 }),
    exp("m2", { commuteMin: 38, status: "absent", lateMin: 68, stayMin: 0, utility: 0, notes: ["这个时间来不了"] }),
    exp("m3", { commuteMin: 20, arriveAt: "18:30", utility: 88 }),
    exp("m4", { commuteMin: 15, arriveAt: "18:30", leaveAt: "21:30", stayMin: 180, utility: 90 }),
    exp("m5", { commuteMin: 6, arriveAt: "18:30", utility: 96 }),
    exp("me", { commuteMin: 17, arriveAt: "18:30", utility: 89 }),
  ],
  attendCount: 5,
  minUtility: 70,
  avgUtility: 82,
  score: 71,
  headline: "5 人能到，人均最低",
  tradeoffs: ["阿杰这个时间来不了"],
  highlights: ["人均 76，最省钱", "离地铁站 200 米"],
  recommended: false,
};

const plan: Plan = {
  proposals: [p1, p2, p3],
  recommendation: "推荐周五蜀大侠：6 个人都能来，阿杰晚到 20 分钟但他说不介意；想更从容可以选周六。",
  caredFor: "这次优先照顾了前几次跑得最远的 1 位朋友",
  constraintSummaries: ["有人预算偏紧，已按大家都舒服的价位筛选", "有人不吃辣，三家都有鸳鸯锅", "有人晚上要早点回去，方案里都留了时间"],
  center: { lat: 31.1842, lng: 121.4388 },
  audit: {
    inputHash: "9f2c41d07ab3e8c55e1d6f0a2b7c94e3d18a6f5b0c2e7d94a1f3b8c6e5d2a07f",
    outputHash: "3b7e9a12c4d5f6e7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
    candidates: 40,
    evaluations: 240,
    paretoSize: 5,
    algorithmVersion: "juzhang-planner/3.0.0",
  },
  computedAt: at(90),
};

const mine: MyExperience[] = [
  { proposalId: "p1", utility: 86, notes: ["人均 98，在你说的范围内", "你刷卡点了超想去"] },
  { proposalId: "p2", utility: 71, notes: ["人均 108，比你说的 100 多一点"] },
  { proposalId: "p3", utility: 84, notes: ["人均 76，最省", "你刷卡点了想去"] },
];

/* ───────── 私聊 ───────── */
const chat: ChatTurn[] = [
  { role: "juzhang", at: at(30), text: "阿鹿你好～我是这次火锅局的局长 🙋 群里不方便说的，都可以悄悄告诉我，我只说结论，不说是谁。先问一句：这次能来吗？" },
  { role: "me", at: at(31), text: "能来！" },
  { role: "juzhang", at: at(31), text: "太好了 🎉 你一般从哪出发？我好算算谁跑得远。" },
];
export const fixtureReply: ChatReply = {
  reply: chat[2].text,
  widget: "location",
  quickReplies: ["公司", "家里", "都行"],
  done: false,
};

const notices: Notice[] = [
  { id: "n1", at: at(200), kind: "match", text: "好消息：你和阿杰互相想认识 👀 局长会安排你们坐一起。", read: false },
  { id: "n2", at: at(150), kind: "autofill", text: "你说都行，我按你上次的习惯把时间和价位填好了，随时可以改。", read: true },
];

function privateOf(p: Partial<MemberPrivate> = {}): MemberPrivate {
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
    ...p,
  };
}

const donePrivate = privateOf({
  chat: [
    ...chat,
    { role: "me", at: at(32), text: "上海南站" },
    { role: "juzhang", at: at(32), text: "收到。哪天几点能出发？几点前要回去？" },
    { role: "me", at: at(33), text: "都行" },
    { role: "juzhang", at: at(33), text: "好嘞，我按你上次的习惯先填上了，你看看对不对 👇" },
  ],
  rsvp: "yes",
  availability: {
    "2026-10-23": { from: "18:30", homeBy: "22:30", pref: "best" },
    "2026-10-24": { from: "17:00", pref: "ok" },
  },
  dietTags: ["不吃内脏"],
  budgetMax: 100,
  notes: ["这周在减肥，别太油"],
  swipes: { d1: "love", d2: "like", d3: "like", d4: "pass", d5: "like" },
  autoFilled: ["availability", "budget"],
  wants: ["m2"],
  matches: ["m2"],
  inbox: notices,
});

/* ───────── 局 ───────── */
const baseJu: Ju = {
  id: JU_ID,
  title: "周五火锅局",
  rawPrompt: "周五晚上 6 个人吃火锅，人均 100",
  organizerName: "小陈",
  spec: {
    category: "火锅",
    poiKeywords: ["火锅"],
    headcount: 6,
    budgetPerPerson: 100,
    dates: ["2026-10-23", "2026-10-24"],
    earliest: "18:00",
    latest: "19:30",
    durationMinutes: 120,
    city: "上海",
  },
  slots,
  status: "collecting",
  createdAt: T0,
  deadline: "2026-10-22T12:00:00.000Z",
  votes: {},
  trace: [],
  quorum: { min: 4, state: "met", metAt: at(60) },
  capacity: 6,
  seeds: [
    { id: "s1", name: "阿杰", said: "yes", quote: "我可以，就是要 6 点半下班", hint: "6 点半下班" },
    { id: "s2", name: "小林", said: "yes", quote: "冲！" },
    { id: "s3", name: "老王", said: "maybe", quote: "看情况，晚了宿舍关门" },
    { id: "s4", name: "阿鹿", said: "maybe", quote: "周五可能要加班 🥲", hint: "可能加班" },
    { id: "s5", name: "小周", said: "yes", quote: "都行" },
  ],
  announcements: [{ at: at(5), text: "【周五火锅局】小陈组了个局，点链接私聊局长，10 秒说清你的情况～" }],
  pendingChanges: 0,
  revisions: [],
};

const allIn = people.map((p) => pubMember(p));
const counts = (over: Partial<JuState["counts"]> = {}): JuState["counts"] => ({
  in: 6,
  done: 6,
  waitlist: 1,
  quorumHave: 6,
  quorumNeed: 4,
  matchPairs: 1,
  ...over,
});

function meWith(intake: Member["intake"], priv: MemberPrivate, extra: Partial<Member> = {}): Member {
  return { ...pubMember(people[5]), intake, private: priv, ...extra };
}

const itinerary: Itinerary = {
  proposalId: "p1",
  departAt: "18:35",
  arriveAt: "18:56",
  commuteMin: 21,
  route: ["步行 300 米到上海南站", "地铁 1 号线 4 站到徐家汇", "11 号口出，步行 5 分钟"],
  leaveAt: undefined,
  seatWith: ["阿杰"],
};

/* ───────── 各状态 ───────── */

/** 没入局，局里有截图预填的人（#3 认领） */
export const fixtureEntry: JuState = {
  ju: { ...baseJu, quorum: { min: 4, state: "pending" } },
  members: [pubMember(people[0])],
  counts: counts({ in: 3, done: 2, waitlist: 0, quorumHave: 2, quorumNeed: 4, matchPairs: 0 }),
};

/** 私聊中 */
export const fixtureChat: JuState = {
  ju: { ...baseJu, quorum: { min: 4, state: "pending" } },
  members: [pubMember(people[0])],
  counts: counts({ in: 4, done: 2, waitlist: 0, quorumHave: 3, quorumNeed: 4, matchPairs: 0 }),
  me: meWith("chatting", privateOf({ chat, rsvp: "yes" }), { location: undefined }),
  mine: { experiences: [], matchNames: [], unread: 0 },
};

/** 刷卡 */
export const fixtureSwipe: JuState = {
  ...fixtureChat,
  me: meWith("swiping", { ...donePrivate, swipes: {}, autoFilled: ["availability", "budget"], wants: [], matches: [], inbox: [] }),
};

/** 等待室：门限还没达成（#1） */
export const fixtureQuorum: JuState = {
  ju: { ...baseJu, quorum: { min: 4, state: "pending", deadline: "2026-10-22T10:00:00.000Z" } },
  members: [pubMember(people[0])],
  counts: counts({ in: 4, done: 2, waitlist: 0, quorumHave: 2, quorumNeed: 4, matchPairs: 0 }),
  me: meWith("done", { ...donePrivate, wants: [], matches: [], inbox: [] }),
  mine: { experiences: [], matchNames: [], unread: 0 },
};

/** 等待室：已成局门槛，等人 / 等方案 */
export const fixtureWaiting: JuState = {
  ju: { ...baseJu },
  members: allIn.map((m) => (m.id === "m4" ? { ...m, intake: "swiping" } : m.id === "m5" ? { ...m, intake: "chatting" } : m)),
  counts: counts({ done: 4 }),
  me: meWith("done", donePrivate),
  mine: { experiences: [], matchNames: ["阿杰"], unread: 1 },
};

/** 候补（#2）：只说"局长正在确认名额" */
export const fixtureWaitlist: JuState = {
  ...fixtureWaiting,
  me: meWith("done", { ...donePrivate, wants: [], matches: [], inbox: [] }, { status: "waitlist" }),
  members: allIn.filter((m) => m.id !== "me"),
  mine: { experiences: [], matchNames: [], unread: 0 },
};

/** 私下说了不来（#5） */
export const fixtureDeclined: JuState = {
  ...fixtureWaiting,
  members: allIn.filter((m) => m.id !== "me"),
  me: meWith("done", privateOf({ chat: [...chat.slice(0, 1), { role: "me", at: at(31), text: "这次来不了" }], rsvp: "no" }), {
    status: "out",
  }),
  mine: { experiences: [], matchNames: [], unread: 0 },
};

/** 方案对比 / 投票 */
export const fixtureVoting: JuState = {
  ju: { ...baseJu, status: "voting", plan, votes: { m1: "p1", m3: "p1", m4: "p2" } },
  members: allIn,
  counts: counts(),
  me: meWith("done", donePrivate),
  mine: { experiences: mine, matchNames: ["阿杰"], unread: 1 },
};

/** 成局 */
export const fixtureConfirmed: JuState = {
  ju: {
    ...baseJu,
    status: "confirmed",
    plan,
    votes: { m1: "p1", m3: "p1", m4: "p2", me: "p1", m5: "p1" },
    confirmedProposalId: "p1",
    reservation: { status: "booked", tableSize: 6 },
    revisions: [{ at: at(400), reason: "有人临时来不了", changes: ["候补的朋友转正了，还是 6 个人", "桌子不变"] }],
  },
  members: allIn.map((m) => (m.id === "m3" ? { ...m, eta: { arriveAt: "2026-10-23T11:05:00.000Z", lateMin: 5, updatedAt: at(500) } } : m)),
  counts: counts(),
  me: meWith("done", donePrivate),
  mine: { experiences: mine, itinerary, matchNames: ["阿杰"], unread: 1 },
};

/** 局后：分账 + 回顾 + 下一局 */
export const fixtureAfter: JuState = {
  ...fixtureConfirmed,
  ju: {
    ...fixtureConfirmed.ju,
    settlement: { total: 612, itemized: true, payerName: "小陈", payCount: 5, paidCount: 3 },
    recap: {
      text: "周五晚上 6 个人挤在蜀大侠的大圆桌，阿杰踩点冲进来正好赶上第一锅毛肚。老王九点多先撤，走之前把最后一盘虾滑包圆了。下次还约！",
      photos: [],
      at: at(1800),
    },
    nextJuId: "next77",
  },
  me: meWith("done", {
    ...donePrivate,
    payment: {
      amount: 96.5,
      paid: false,
      remindedAt: [],
      lines: [
        { itemName: "鸳鸯锅底", amount: 14.67 },
        { itemName: "毛肚 / 鸭肠 / 虾滑等 12 道菜", amount: 71.83 },
        { itemName: "酸梅汤", amount: 10, reason: "你没喝酒，啤酒没算你的" },
      ],
    },
  }),
  mine: { ...fixtureConfirmed.mine!, itinerary: { ...itinerary, aaAmount: 96.5, payerName: "小陈" } },
};

/** 门限没凑够，局被悄悄收了 */
export const fixtureCancelled: JuState = {
  ...fixtureQuorum,
  ju: { ...fixtureQuorum.ju, status: "cancelled", quorum: { min: 4, state: "failed" } },
};

export const FIXTURES = {
  entry: fixtureEntry,
  chat: fixtureChat,
  swipe: fixtureSwipe,
  quorum: fixtureQuorum,
  waiting: fixtureWaiting,
  waitlist: fixtureWaitlist,
  declined: fixtureDeclined,
  voting: fixtureVoting,
  confirmed: fixtureConfirmed,
  after: fixtureAfter,
  cancelled: fixtureCancelled,
  // 旧 key 兼容
  empty: fixtureEntry,
  collecting: fixtureWaiting,
} as const;

export type FixtureKey = keyof typeof FIXTURES;

/* ───────── /stats 用的假数据 ───────── */

function mkHourly(): Stats["hourly"] {
  const end = Date.UTC(2026, 9, 22, 6); // 北京时间 14:00
  const out: Stats["hourly"] = [];
  for (let i = 71; i >= 0; i--) {
    const t = new Date(end - i * 3600000);
    const bj = (t.getUTCHours() + 8) % 24;
    const daily = bj >= 11 && bj <= 13 ? 3 : bj >= 17 && bj <= 21 ? 5 : bj >= 1 && bj <= 7 ? 0 : 1;
    const growth = 1 + (71 - i) / 30;
    const joins = Math.max(0, Math.round(daily * growth + ((i * 7) % 3) - 1));
    out.push({ hour: t.toISOString().slice(0, 13) + ":00:00.000Z", joins });
  }
  return out;
}

const RECENT_TITLES = ["周五火锅局", "周六羽毛球", "今晚宵夜烧烤", "部门团建桌游", "毕业五周年聚餐", "周日早茶", "剧本杀开黑", "KTV 生日局", "露营烧烤", "下班喝一杯"];
const STATUSES: Stats["recent"][number]["status"][] = ["confirmed", "voting", "collecting", "confirmed", "confirmed"];

export const fixtureStats: Stats = {
  juCount: 23,
  confirmedCount: 14,
  memberCount: 137,
  medianFillSeconds: 12,
  privateShareRate: 0.64,
  recent: RECENT_TITLES.map((title, i) => ({
    id: `r${i}`,
    title,
    members: 3 + ((i * 5) % 7),
    status: STATUSES[i % STATUSES.length],
    createdAt: new Date(Date.UTC(2026, 9, 22, 6) - i * 47 * 60000).toISOString(),
  })),
  hourly: mkHourly(),
  generatedAt: new Date(Date.UTC(2026, 9, 22, 6)).toISOString(),
};

export const fixtureStatsEmpty: Stats = {
  juCount: 0,
  confirmedCount: 0,
  memberCount: 0,
  recent: [],
  hourly: [],
  generatedAt: new Date(Date.UTC(2026, 9, 22, 6)).toISOString(),
};

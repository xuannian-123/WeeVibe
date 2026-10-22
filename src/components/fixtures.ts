// /dev/gallery 用的写死数据，不依赖后端
import type { Ju, JuState, Member, PlanOption, Slot } from "@/lib/types";

const JU_ID = "demo42";

function mkSlots(): Slot[] {
  const out: Slot[] = [];
  for (const date of ["2026-10-23", "2026-10-24"]) {
    for (const t of ["18:00", "18:30", "19:00", "19:30", "20:00"]) {
      const [h, m] = t.split(":").map(Number);
      const endH = String(h + 2).padStart(2, "0");
      out.push({
        id: `${date}T${t}`,
        start: `${date}T${t}:00+08:00`,
        end: `${date}T${endH}:${String(m).padStart(2, "0")}:00+08:00`,
      });
    }
  }
  return out;
}

const slots = mkSlots();
const S = (i: number) => slots[i].id;

const baseMembers: Omit<Member, "juId" | "status" | "joinedAt">[] = [
  {
    id: "m1",
    name: "阿杰",
    avatar: "🐯",
    location: { lat: 31.3195, lng: 120.6292, label: "苏州站北广场" },
    availableSlotIds: [S(1), S(2), S(3), S(6), S(7)],
    dietRaw: "",
    dietTags: [],
    isOrganizer: true,
  },
  {
    id: "m2",
    name: "小鹿",
    avatar: "🦊",
    location: { lat: 31.2632, lng: 120.7275, label: "星海街地铁站" },
    availableSlotIds: [S(2), S(3), S(4), S(7)],
    dietRaw: "不吃辣",
    dietTags: ["不吃辣"],
    isOrganizer: false,
  },
  {
    id: "m3",
    name: "大熊",
    avatar: "🐻",
    location: { lat: 31.2988, lng: 120.7766, label: "苏州大学独墅湖校区" },
    availableSlotIds: [S(2), S(3), S(7), S(8)],
    dietRaw: "",
    dietTags: [],
    isOrganizer: false,
  },
  {
    id: "m4",
    name: "Momo",
    avatar: "🐰",
    location: { lat: 31.2421, lng: 120.6853, label: "苏州中心商场" },
    availableSlotIds: [S(0), S(2), S(3)],
    dietRaw: "不吃内脏，香菜也不要",
    dietTags: ["不吃内脏"],
    isOrganizer: false,
  },
  {
    id: "m5",
    name: "老王",
    avatar: "🐼",
    location: { lat: 31.3361, lng: 120.7393, label: "阳澄湖大道 88 号" },
    availableSlotIds: [S(2), S(7), S(8), S(9)],
    dietRaw: "不吃牛肉",
    dietTags: ["不吃牛肉"],
    isOrganizer: false,
  },
  {
    id: "m6",
    name: "糖糖",
    avatar: "🐧",
    location: { lat: 31.2206, lng: 120.7608, label: "金鸡湖东 · 湖西 CBD" },
    availableSlotIds: [S(2), S(3), S(4)],
    dietRaw: "",
    dietTags: [],
    isOrganizer: false,
  },
  {
    id: "m7",
    name: "Kevin",
    avatar: "🐸",
    location: { lat: 31.2851, lng: 120.6611, label: "观前街" },
    availableSlotIds: [S(5), S(6)],
    dietRaw: "素食",
    dietTags: ["素食"],
    isOrganizer: false,
  },
];

const members: Member[] = baseMembers.map((m, i) => ({
  ...m,
  juId: JU_ID,
  status: "in",
  joinedAt: new Date(Date.UTC(2026, 9, 22, 4, i * 3)).toISOString(),
}));

const baseJu: Ju = {
  id: JU_ID,
  title: "周五火锅局",
  rawPrompt: "周五晚上 8 个人吃火锅，人均 100",
  spec: {
    category: "火锅",
    poiKeywords: ["火锅"],
    headcount: 8,
    budgetPerPerson: 100,
    dates: ["2026-10-23", "2026-10-24"],
    earliest: "18:00",
    latest: "20:00",
    durationMinutes: 120,
    city: "苏州",
  },
  slots,
  status: "collecting",
  createdAt: "2026-10-22T04:00:00.000Z",
  votes: {},
};

const attendeeIds = ["m1", "m2", "m3", "m4", "m5", "m6"];
const commuteMin: Record<string, number[]> = {
  m1: [24, 28, 31],
  m2: [9, 14, 12],
  m3: [17, 12, 21],
  m4: [15, 22, 16],
  m5: [21, 18, 26],
  m6: [13, 20, 11],
};

function commutes(idx: number) {
  return attendeeIds.map((mid) => ({
    memberId: mid,
    minutes: commuteMin[mid][idx],
    distanceKm: Math.round(commuteMin[mid][idx] * 0.55 * 10) / 10,
  }));
}

const options: PlanOption[] = [
  {
    poi: {
      id: "p1",
      name: "老灶台重庆火锅·金鸡湖店",
      address: "苏州工业园区星海街 198 号 3F",
      rating: 4.7,
      costPerPerson: 92,
      type: "餐饮服务;中餐厅;火锅店",
      lat: 31.2788,
      lng: 120.7185,
      tel: "0512-66668888",
    },
    score: 91,
    commutes: commutes(0),
    maxCommute: 24,
    avgCommute: 16.5,
    conflicts: ["小鹿：不吃辣（可点鸳鸯锅）"],
    reasons: ["最远的人只要 24 分钟", "人均 92 元，在预算内", "评分 4.7，周五有包间"],
    blurb: "离谁都不远，鸳鸯锅照顾了小鹿，周五记得早点订包间。",
  },
  {
    poi: {
      id: "p2",
      name: "围炉小馆（时代广场店）",
      address: "苏州工业园区苏惠路 88 号",
      rating: 4.5,
      costPerPerson: 85,
      type: "餐饮服务;中餐厅;火锅店",
      lat: 31.2896,
      lng: 120.7312,
      tel: "0512-62223333",
    },
    score: 84,
    commutes: commutes(1),
    maxCommute: 28,
    avgCommute: 19,
    conflicts: [],
    reasons: ["最远的人 28 分钟", "人均 85 元，最省钱", "清汤锅底口碑好"],
    blurb: "清汤锅底做得讲究，不吃辣的朋友最安心。",
  },
  {
    poi: {
      id: "p3",
      name: "川渝巷子·老火锅",
      address: "苏州工业园区现代大道 1699 号",
      rating: 4.6,
      costPerPerson: 108,
      type: "餐饮服务;中餐厅;火锅店",
      lat: 31.2683,
      lng: 120.7392,
      tel: "0512-65556666",
    },
    score: 78,
    commutes: commutes(2),
    maxCommute: 31,
    avgCommute: 19.5,
    conflicts: ["小鹿：不吃辣（川味重油锅底）", "老王：不吃牛肉（招牌是鲜切牛肉）"],
    reasons: ["最远的人 31 分钟", "人均 108 元，略超预算", "毛肚是招牌"],
    blurb: "味道最正宗，就是离阿杰有点远。",
  },
];

const plan = {
  slotId: S(2),
  attendeeIds,
  absentIds: ["m7"],
  center: { lat: 31.2805, lng: 120.7201 },
  options,
  computedAt: "2026-10-22T05:00:00.000Z",
};

export const fixtureCollecting: JuState = {
  ju: { ...baseJu },
  members,
};

export const fixtureCollectingEmpty: JuState = {
  ju: { ...baseJu },
  members: [],
};

export const fixtureVoting: JuState = {
  ju: { ...baseJu, status: "voting", plan, votes: { m2: "p1", m3: "p2", m5: "p1" } },
  members,
};

export const fixtureConfirmed: JuState = {
  ju: {
    ...baseJu,
    status: "confirmed",
    plan,
    votes: { m1: "p1", m2: "p1", m3: "p2", m4: "p1", m5: "p1" },
    confirmedPoiId: "p1",
    settlement: { total: 588, perPerson: 98 },
  },
  members,
};

export const FIXTURES = {
  empty: fixtureCollectingEmpty,
  collecting: fixtureCollecting,
  voting: fixtureVoting,
  confirmed: fixtureConfirmed,
} as const;

export type FixtureKey = keyof typeof FIXTURES;

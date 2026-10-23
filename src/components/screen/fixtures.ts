// A2 的 v3 假数据：后端没好之前开发用，之后给 /dev/gallery 用。
import type {
  BillSplit,
  Experience,
  GroupMessages,
  JuState,
  JuStatus,
  Member,
  Plan,
  PrivacySelfTest,
  Proposal,
  Receipt,
  Stats,
  TraceEvent,
} from "@/lib/types";

const NOW = new Date("2026-10-23T10:20:00+08:00");
const iso = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60000).toISOString();

const DATE = "2026-10-24";
const slot = (hm: string, dur = 150) => {
  const start = `${DATE}T${hm}:00+08:00`;
  const end = new Date(new Date(start).getTime() + dur * 60000);
  const e = new Date(end.getTime() + 8 * 3600000).toISOString().slice(0, 19) + "+08:00";
  return { id: `${DATE}T${hm}`, start, end: e };
};
const SLOTS = [slot("18:30"), slot("19:00"), slot("19:30")];

type Raw = [id: string, name: string, avatar: string, label: string, lat: number, lng: number, org?: boolean];
const RAW: Raw[] = [
  ["m1", "局长", "🐼", "徐汇 · 36space", 31.1676, 121.432, true],
  ["m2", "阿杰", "🦊", "漕河泾开发区", 31.1695, 121.3975],
  ["m3", "小林", "🐰", "五角场", 31.2989, 121.5143],
  ["m4", "老王", "🐻", "华东理工 · 奉贤校区", 30.8325, 121.5059],
  ["m5", "小周", "🐸", "静安寺", 31.2232, 121.4456],
  ["m6", "Momo", "🐙", "陆家嘴", 31.2397, 121.4998],
];

function member(r: Raw, i: number, intake: Member["intake"] = "done"): Member {
  return {
    id: r[0],
    juId: "demo42",
    name: r[1],
    avatar: r[2],
    location: { label: r[3], lat: r[4], lng: r[5] },
    role: r[1] === "阿杰" ? "must" : "guest",
    intake,
    status: "in",
    joinedAt: iso(60 - i * 6),
    isOrganizer: !!r[6],
    isDemo: !r[6],
  };
}

const MEMBERS = RAW.map((r, i) => member(r, i));

const TRACE_TEXT: [TraceEvent["kind"], string][] = [
  ["listen", "局长开张：周六晚上火锅，人均 120 左右"],
  ["listen", "阿杰入局，从漕河泾出发"],
  ["listen", "有人私下告诉了局长一个说不出口的约束（不说是谁）"],
  ["listen", "小林入局，刷了 6 张卡"],
  ["listen", "有 2 位朋友更新了情况，攒够了再重算"],
  ["search", "在公平中心 3 公里内找到 8 家火锅店"],
  ["compute", "计算了 3 个时段 × 8 家店 × 6 个人 = 144 次体验"],
  ["filter", "有人预算偏紧，排除了人均 150 以上的 3 家"],
  ["filter", "有人不吃辣，剩下的店都确认有鸳鸯锅"],
  ["compute", "帕累托前沿上剩 5 个候选"],
  ["decide", "前几次跑得最远的 1 位朋友，这次权重 ×1.4"],
  ["decide", "挑出 3 个有实质差异的方案：人最全 / 大家最舒服 / 最省钱"],
  ["done", "方案出炉，审计哈希已生成，任何人都可以一键复算"],
];

export function fixtureTrace(n = TRACE_TEXT.length): TraceEvent[] {
  return TRACE_TEXT.slice(0, n).map(([kind, text], i) => ({ id: `t${i}`, at: iso(40 - i * 2), kind, text }));
}

function exp(memberId: string, utility: number, extra: Partial<Experience> = {}): Experience {
  return {
    memberId,
    status: "full",
    arriveAt: "18:40",
    lateMin: 0,
    stayMin: 150,
    commuteMin: 25,
    utility,
    notes: [],
    ...extra,
  };
}

const POIS = [
  { id: "p1", name: "左庭右院鲜牛肉火锅（徐家汇店）", address: "徐汇区虹桥路 1 号港汇恒隆 5F", rating: 4.7, costPerPerson: 118, tel: "021-64071234", lat: 31.1953, lng: 121.4372, type: "餐饮服务;中餐厅;火锅店" },
  { id: "p2", name: "楠火锅（漕河泾店）", address: "徐汇区宜山路 1388 号", rating: 4.5, costPerPerson: 96, tel: "021-54261234", lat: 31.1772, lng: 121.4161, type: "餐饮服务;中餐厅;火锅店" },
  { id: "p3", name: "怂火锅（龙华店）", address: "徐汇区龙华中路 600 号", rating: 4.4, costPerPerson: 82, tel: "021-64561234", lat: 31.1801, lng: 121.4562, type: "餐饮服务;中餐厅;火锅店" },
];

function proposals(): Proposal[] {
  const ids = MEMBERS.map((m) => m.id);
  const mk = (
    i: number,
    label: Proposal["label"],
    labelText: string,
    utils: number[],
    extra: Partial<Proposal>,
    over: Record<string, Partial<Experience>> = {},
  ): Proposal => {
    const experiences = ids.map((id, k) => exp(id, utils[k], { commuteMin: [12, 22, 48, 55, 20, 30][k], ...over[id] }));
    const att = experiences.filter((e) => e.status !== "absent");
    return {
      id: `prop${i + 1}`,
      label,
      labelText,
      slot: SLOTS[i],
      poi: POIS[i],
      experiences,
      attendCount: att.length,
      minUtility: Math.min(...att.map((e) => e.utility)),
      avgUtility: Math.round(att.reduce((s, e) => s + e.utility, 0) / att.length),
      score: [86, 81, 74][i],
      headline: "",
      tradeoffs: [],
      highlights: [],
      recommended: i === 0,
      ...extra,
    };
  };
  return [
    mk(0, "most-people", "人最全", [92, 78, 70, 66, 88, 81], {
      headline: "6 人全到，有 1 人晚 10 分钟",
      tradeoffs: ["21:20 有人需先走"],
      highlights: ["3 人刷卡点了想去", "有鸳鸯锅"],
      blurb: "周六 18:30 在徐家汇，谁都不用跑太远。",
    }, { m2: { status: "late", lateMin: 10, arriveAt: "18:40", notes: ["晚到 10 分钟"] }, m4: { status: "early", leaveAt: "21:20", stayMin: 160, notes: ["21:20 需先走"] } }),
    mk(1, "most-comfortable", "大家最舒服", [85, 90, 64, 72, 82, 76], {
      headline: "6 人全到，最远的人也只坐 40 分钟",
      tradeoffs: ["开始晚半小时"],
      highlights: ["阿杰下班直接走过去 8 分钟"],
    }),
    mk(2, "cheapest", "最省钱", [80, 70, 0, 74, 85, 79], {
      headline: "人均 82，5 人能到",
      tradeoffs: ["小林来不了"],
      highlights: ["人均 82，大家都在预算内"],
    }, { m3: { status: "absent", stayMin: 0, notes: ["这个时段来不了"] } }),
  ];
}

function plan(): Plan {
  return {
    proposals: proposals(),
    recommendation: "推荐「人最全」：6 个人都能到，最不开心的那位也有 66 分；比第二名多照顾了一位从远处赶来的朋友。",
    caredFor: "这次优先照顾了前几次跑得最远的 1 位朋友",
    constraintSummaries: ["有人预算偏紧，已按大家都舒服的价位筛选", "有人不吃辣，三家都有鸳鸯锅", "有人要早点回去，方案都在 22:00 前结束"],
    center: { lat: 31.205, lng: 121.45 },
    audit: {
      inputHash: "9f3c2a7d41be08e6c55d0a13f7e2b9c4d6a8e1f0b3c5d7e9f1a2b3c4d5e6f708",
      outputHash: "4be1d07a9c3f25e6b8d0a1c2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f70",
      candidates: 24,
      evaluations: 144,
      paretoSize: 5,
      algorithmVersion: "planner-v3.0",
    },
    computedAt: iso(12),
  };
}

export const fixtureMessages: GroupMessages = {
  broadcast: "【周六火锅局】已经定了：10/24 周六 18:30，左庭右院鲜牛肉火锅（徐家汇店），6 个人。有鸳鸯锅，21:20 前有人先走不影响。到时候见～",
  nudges: [{ memberId: "m6", name: "Momo", text: "Momo，就差你点几张卡了，10 秒的事～" }],
  reservationScript: "您好，想订 10 月 24 号周六晚上 18:30，6 位，要一个能放鸳鸯锅的桌子，联系人姓局，电话 138****0000。",
  reservationDialog: [
    { who: "店员", text: "您好，左庭右院徐家汇店，请问有什么可以帮您？" },
    { who: "局长", text: "您好，想订这周六晚上六点半，六位，要一张能放鸳鸯锅的桌子。" },
    { who: "店员", text: "周六六点半六位是吧，我看一下……有的，靠窗的圆桌可以吗？" },
    { who: "局长", text: "可以，谢谢。有一位朋友九点二十要先走，坐靠外一点就好。" },
    { who: "店员", text: "好的，帮您备注了。请问怎么称呼？" },
    { who: "局长", text: "姓局，电话我稍后短信发给您。" },
    { who: "店员", text: "好的，给您留到六点四十五，到店报手机尾号就行。" },
    { who: "局长", text: "好嘞，谢谢您！" },
  ],
};

export const fixtureReceipt: Receipt = {
  items: [
    { id: "r1", name: "鲜切吊龙", price: 68, qty: 2, tags: ["beef", "meat"] },
    { id: "r2", name: "鸳鸯锅底", price: 48, qty: 1, tags: ["spicy", "shared"] },
    { id: "r3", name: "毛肚", price: 52, qty: 1, tags: ["offal"] },
    { id: "r4", name: "虾滑", price: 42, qty: 2, tags: ["seafood"] },
    { id: "r5", name: "时蔬拼盘", price: 36, qty: 1, tags: ["shared"] },
    { id: "r6", name: "精酿啤酒", price: 28, qty: 4, tags: ["alcohol"] },
    { id: "r7", name: "酸梅汤", price: 22, qty: 2, tags: ["drink"] },
  ],
  total: 602,
  serviceFee: 0,
  discount: 30,
  fallback: true,
};

export const fixtureSplit: BillSplit = {
  total: 602,
  perMember: {
    m1: { amount: 112.5, lines: [{ itemName: "共享菜", amount: 84.5 }, { itemName: "精酿啤酒", amount: 28 }] },
    m2: { amount: 112.5, lines: [{ itemName: "共享菜", amount: 84.5 }, { itemName: "精酿啤酒", amount: 28 }] },
    m3: { amount: 84.5, lines: [{ itemName: "共享菜", amount: 84.5 }] },
    m4: { amount: 70, lines: [{ itemName: "共享菜", amount: 70, reason: "提前离开，少摊部分菜" }] },
    m5: { amount: 112.5, lines: [{ itemName: "共享菜", amount: 84.5 }, { itemName: "精酿啤酒", amount: 28 }] },
    m6: { amount: 110, lines: [{ itemName: "共享菜", amount: 84.5 }, { itemName: "酸梅汤", amount: 25.5 }] },
  },
  explain: ["酒水只由喝酒的人分摊", "有人提前离开，少摊了部分菜", "不吃辣的人不摊辣锅那一半"],
};

export type FixtureKey = "quorum" | "collecting" | "voting" | "confirmed" | "settled" | "recap" | "failed";
export const FIXTURE_KEYS: FixtureKey[] = ["quorum", "collecting", "voting", "confirmed", "settled", "recap", "failed"];

/** withAdmin = 发起人视图（含 ju.admin） */
export function fixtureState(key: FixtureKey, withAdmin = false): JuState {
  const status: JuStatus =
    key === "quorum" || key === "collecting" ? "collecting" : key === "voting" ? "voting" : key === "failed" ? "cancelled" : "confirmed";
  const quorumState = key === "quorum" ? "pending" : key === "failed" ? "failed" : "met";
  const hasPlan = !["quorum", "collecting", "failed"].includes(key);
  const members =
    key === "quorum" || key === "failed"
      ? MEMBERS.slice(0, 1)
      : key === "collecting"
        ? MEMBERS.slice(0, 5).map((m, i) => ({ ...m, intake: (i < 3 ? "done" : i === 3 ? "swiping" : "chatting") as Member["intake"] }))
        : MEMBERS;
  const s: JuState = {
    ju: {
      id: "demo42",
      title: "周六火锅局",
      rawPrompt: "周六晚上火锅，人均 120 左右",
      organizerName: "局长",
      spec: {
        category: "火锅",
        poiKeywords: ["火锅"],
        headcount: 6,
        budgetPerPerson: 120,
        dates: [DATE],
        earliest: "18:30",
        latest: "19:30",
        durationMinutes: 150,
        city: "上海",
      },
      slots: SLOTS,
      status,
      createdAt: iso(70),
      deadline: "2026-10-24T12:00:00+08:00",
      plan: hasPlan ? plan() : undefined,
      votes: hasPlan ? { m1: "prop1", m2: "prop1", m3: "prop2", m5: "prop1" } : {},
      confirmedProposalId: status === "confirmed" ? "prop1" : undefined,
      trace: fixtureTrace(key === "quorum" ? 3 : key === "collecting" ? 5 : TRACE_TEXT.length),
      quorum: { min: 4, state: quorumState, deadline: "2026-10-23T20:00:00+08:00", metAt: quorumState === "met" ? iso(45) : undefined },
      capacity: 6,
      announcements: [{ at: iso(5), text: fixtureMessages.broadcast }],
      pendingChanges: key === "voting" ? 1 : 0,
      revisions: [],
      reservation: key === "confirmed" ? { status: "none" } : status === "confirmed" ? { status: "booked", tableSize: 6 } : undefined,
      settlement:
        key === "settled" || key === "recap"
          ? { total: 602, perPerson: 100.33, itemized: true, payerName: "局长", payCount: 6, paidCount: key === "recap" ? 6 : 4 }
          : undefined,
      recap:
        key === "recap"
          ? {
              text: "周六晚上 6 个人在徐家汇涮到九点半。阿杰难得没迟到，老王九点二十先撤，剩下的人把最后一盘吊龙分了。下次轮到谁挑店？",
              photos: [],
              at: iso(1),
            }
          : undefined,
    },
    members,
    counts: {
      in: members.length,
      done: members.filter((m) => m.intake === "done").length,
      waitlist: key === "quorum" ? 0 : 1,
      quorumHave: key === "quorum" ? 2 : key === "failed" ? 2 : 4,
      quorumNeed: 4,
      matchPairs: hasPlan ? 1 : 0,
    },
  };
  if (withAdmin) {
    s.isAdmin = true;
    s.ju.admin = {
      tiers: [
        { token: "tk1", tier: 1, label: "核心圈", openedAt: iso(70) },
        { token: "tk2", tier: 2, label: "第二圈", openedAt: key === "quorum" || key === "collecting" ? undefined : iso(30) },
      ],
      auditSecret: "fixture",
      clockOffsetMin: 0,
      ...(key === "settled" || key === "recap"
        ? {
            receipt: fixtureReceipt,
            split: fixtureSplit,
            payments: Object.fromEntries(
              Object.entries(fixtureSplit.perMember).map(([id, v], i) => [id, { amount: v.amount, paid: key === "recap" || i < 4 }]),
            ),
          }
        : {}),
    };
  }
  return s;
}

export const fixtureSelfTest: PrivacySelfTest = {
  runs: 1200,
  leaks: 0,
  checks: [
    { name: "交换检验", runs: 400, leaks: 0 },
    { name: "字面检验", runs: 400, leaks: 0 },
    { name: "时序检验", runs: 400, leaks: 0 },
  ],
  at: NOW.toISOString(),
};

function hourly() {
  const out: Stats["hourly"] = [];
  const end = new Date("2026-10-23T10:00:00+08:00").getTime();
  for (let i = 47; i >= 0; i--) {
    const d = new Date(end - i * 3600000);
    const h = (d.getUTCHours() + 8) % 24;
    const base = h >= 19 && h <= 23 ? 5 : h >= 11 && h <= 13 ? 3 : h < 7 ? 0 : 1;
    out.push({ hour: d.toISOString(), joins: base + ((i * 7) % 3) });
  }
  return out;
}

export const fixtureStats: Stats = {
  juCount: 23,
  confirmedCount: 17,
  memberCount: 112,
  medianFillSeconds: 38,
  privateShareRate: 0.64,
  recent: [
    { id: "a1", title: "周五宿舍火锅", members: 7, status: "confirmed", createdAt: iso(25) },
    { id: "a2", title: "周末羽毛球", members: 5, status: "voting", createdAt: iso(70) },
    { id: "a3", title: "部门团建桌游", members: 9, status: "confirmed", createdAt: iso(180) },
    { id: "a4", title: "今晚宵夜烧烤", members: 4, status: "collecting", createdAt: iso(240) },
    { id: "a5", title: "研究生聚餐", members: 6, status: "confirmed", createdAt: iso(600) },
  ],
  hourly: hourly(),
  generatedAt: NOW.toISOString(),
};

export const fixtureStatsEmpty: Stats = { juCount: 0, confirmedCount: 0, memberCount: 0, recent: [], hourly: [], generatedAt: NOW.toISOString() };

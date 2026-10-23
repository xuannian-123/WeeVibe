// 演示场景（CONTRACT 第八节）的算法侧设定：位置 / 时间 / 私密约束 / 账本都调过，保证 planJu 出来的方案"有戏"：
// - 阿杰从漕河泾来、周五 6 点半下班，前几次都跑得最远 → #10 这次被照顾（场馆往他那边偏）
// - 小林私密预算 80、刷卡 pass 了最贵那家 → 贵店掉出推荐，但公开数据里看不出是她
// - 老王 11 点前回宿舍、不吃辣、周末不在 → 周六的方案少他一个，周五晚场他得先走
// - 小周说"都行"，由局长按默认值预填
// - 阿May 私下说不来（公开视图里不存在）；大刘第二圈进来、在候补
// B2 的 /api/dev/seed 可以直接用 demoPeople() 生成成员（场馆：上海徐汇 36space）。
import type { DayAvailability, DietTag, JuSpec, LedgerEntry, Place } from "../types";

export const DEMO_VENUE: Place = { label: "36space（漕宝路36号E座）", lat: 31.167645, lng: 121.43195 };

export type DemoPerson = {
  key: "jie" | "lin" | "wang" | "zhou" | "may" | "liu";
  name: string;
  avatar: string;
  location: Place;
  status: "in" | "out" | "waitlist";
  rsvp?: "yes" | "no";
  /** #2 第几圈邀请链接进来的 */
  tier: number;
  availability: Record<string, DayAvailability>;
  /** true = 说了"都行"，availability 应由 autofillFromProfile 预填 */
  autofill?: boolean;
  dietTags: DietTag[];
  budgetMax?: number;
  notes: string[];
  /** 刷卡时 pass 掉卡组里最贵的那家 */
  passMostExpensive?: boolean;
  /** #2 想认识的人（key） */
  wants: DemoPerson["key"][];
  /** #10 档案里的跨局账本 */
  ledger: LedgerEntry[];
};

/** 发起人的建议出发地（演示时发起人自己也可以改） */
export const DEMO_ORGANIZER_PLACE: Place = { label: "上海交通大学徐汇校区", lat: 31.2005, lng: 121.4335 };

/** 第一天 = spec.dates[0]（周五），第二天 = spec.dates[1]（周六，可无） */
export function demoPeople(spec: JuSpec): DemoPerson[] {
  const [d0, d1] = spec.dates;
  const day = (a?: DayAvailability, b?: DayAvailability): Record<string, DayAvailability> => {
    const out: Record<string, DayAvailability> = {};
    if (d0 && a) out[d0] = a;
    if (d1 && b) out[d1] = b;
    return out;
  };
  const jieLedger: LedgerEntry[] = [1, 2, 3].map((k) => ({
    juId: `demo-old-${k}`,
    at: `2026-0${6 + k}-12T21:00:00+08:00`,
    commuteMin: 48 + k,
    avgCommuteMin: 24,
    utility: 72,
    regret: 28 + 24 + k,
  }));
  return [
    {
      key: "jie",
      name: "阿杰",
      avatar: "🧑‍💻",
      location: { label: "漕河泾开发区", lat: 31.1675, lng: 121.397 },
      status: "in",
      rsvp: "yes",
      tier: 1,
      availability: day({ from: "18:30", pref: "ok" }, { from: "16:00", pref: "best" }),
      dietTags: [],
      notes: [],
      wants: ["lin"],
      ledger: jieLedger,
    },
    {
      key: "lin",
      name: "小林",
      avatar: "🦊",
      location: { label: "龙华寺", lat: 31.1757, lng: 121.4497 },
      status: "in",
      rsvp: "yes",
      tier: 1,
      availability: day({ from: "17:00", pref: "best" }, { from: "17:00", pref: "ok" }),
      dietTags: [],
      budgetMax: 80,
      notes: [],
      passMostExpensive: true,
      wants: ["jie"],
      ledger: [],
    },
    {
      key: "wang",
      name: "老王",
      avatar: "🐻",
      location: { label: "上海体育场", lat: 31.183, lng: 121.437 },
      status: "in",
      rsvp: "yes",
      tier: 1,
      availability: day({ from: "17:30", homeBy: "23:00", pref: "ok" }),
      dietTags: ["不吃辣"],
      notes: [],
      wants: [],
      ledger: [],
    },
    {
      key: "zhou",
      name: "小周",
      avatar: "🐱",
      location: { label: "长宁来福士", lat: 31.2185, lng: 121.4235 },
      status: "in",
      rsvp: "yes",
      tier: 1,
      availability: {},
      autofill: true,
      dietTags: [],
      notes: [],
      wants: [],
      ledger: [],
    },
    {
      key: "may",
      name: "阿May",
      avatar: "🌸",
      location: { label: "打浦桥", lat: 31.206, lng: 121.466 },
      status: "out",
      rsvp: "no",
      tier: 1,
      availability: {},
      dietTags: ["不吃海鲜"],
      notes: [],
      wants: [],
      ledger: [],
    },
    {
      key: "liu",
      name: "大刘",
      avatar: "🐯",
      location: { label: "田子坊", lat: 31.209, lng: 121.469 },
      status: "waitlist",
      rsvp: "yes",
      tier: 2,
      availability: day({ from: "18:00", pref: "ok" }, { from: "17:00", pref: "ok" }),
      dietTags: [],
      notes: [],
      wants: [],
      ledger: [],
    },
  ];
}

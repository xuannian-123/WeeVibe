// v6 活动库的纯数据（不依赖 node，前端预览也能用）：每种活动的动静、能不能聊天、吵不吵、有没有酒、室内户外、人均、时长、常见说法。
// 打分、识别说法这些在 activities.ts（它再导出这里的东西）。
import type { ActivityDef } from "../types";

/**
 * 活动库的一项 = 共享类型 ActivityDef + 本地扩展（types.ts 只由 leader 改，缺的字段先在这里顶着）：
 * - aliases：常见中文说法（识别发起人的话、匹配"想去 / 不想去"的需求）
 * - halal：附近一般能找到清真的店（清真的朋友能去）
 * - veg：吃素的朋友能吃
 * - halalKeywords：有清真的朋友时改用的搜索词（只找清真店，不额外多调地图）
 */
export type ActivityInfo = ActivityDef & {
  aliases: string[];
  halal: boolean;
  veg: boolean;
  halalKeywords?: string[];
};

type Base = Omit<ActivityInfo, "halal" | "veg"> & Partial<Pick<ActivityInfo, "halal" | "veg">>;

/** 不是吃饭的活动：饮食约束不适用（清真 / 素食都能去） */
const act = (a: Base): ActivityInfo => ({ halal: !a.food, veg: !a.food, ...a });

/** 活动库（≥ 24 种）。人均、时长按一二线城市的常见水平估，只用来预排序，最终以真实店的人均为准 */
export const ACTIVITY_LIB: ActivityInfo[] = [
  // ---- 吃 ----
  act({ key: "hotpot", name: "火锅", emoji: "🍲", group: "eat", poiKeywords: ["火锅"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [80, 140], minutes: 120, people: [2, 20], lateJoin: true, food: true, halal: true, veg: false, halalKeywords: ["清真火锅"], aliases: ["火锅", "涮锅", "涮肉", "串串", "打边炉", "海底捞"] }),
  act({ key: "bbq", name: "烧烤", emoji: "🍢", group: "eat", poiKeywords: ["烧烤"], energy: 0, talk: 2, loud: true, alcohol: true, indoor: "either", cost: [60, 120], minutes: 120, people: [2, 20], lateJoin: true, food: true, halal: true, veg: false, halalKeywords: ["清真烧烤"], aliases: ["烧烤", "撸串", "烤串", "bbq"] }),
  act({ key: "korean_bbq", name: "烤肉", emoji: "🥩", group: "eat", poiKeywords: ["烤肉"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [90, 160], minutes: 120, people: [2, 12], lateJoin: true, food: true, halal: false, veg: false, aliases: ["烤肉", "烧肉", "韩式烤肉", "韩料"] }),
  act({ key: "homestyle", name: "家常菜", emoji: "🍚", group: "eat", poiKeywords: ["家常菜"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [50, 100], minutes: 90, people: [2, 20], lateJoin: true, food: true, halal: true, veg: true, halalKeywords: ["清真餐厅"], aliases: ["家常菜", "吃饭", "聚餐", "约饭", "吃顿饭", "吃个饭", "干饭", "中餐", "炒菜"] }),
  act({ key: "japanese", name: "日料", emoji: "🍣", group: "eat", poiKeywords: ["日本料理"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [100, 220], minutes: 100, people: [2, 10], lateJoin: true, food: true, halal: false, veg: true, aliases: ["日料", "日本料理", "寿司", "刺身"] }),
  act({ key: "western", name: "西餐", emoji: "🍝", group: "eat", poiKeywords: ["西餐"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [90, 200], minutes: 100, people: [2, 10], lateJoin: true, food: true, halal: false, veg: true, aliases: ["西餐", "牛排", "意面", "披萨", "pizza"] }),
  act({ key: "buffet", name: "自助餐", emoji: "🍱", group: "eat", poiKeywords: ["自助餐"], energy: 0, talk: 1, loud: false, alcohol: false, indoor: true, cost: [100, 200], minutes: 120, people: [2, 20], lateJoin: true, food: true, halal: false, veg: true, aliases: ["自助餐", "自助"] }),
  act({ key: "snack", name: "小吃", emoji: "🥟", group: "eat", poiKeywords: ["小吃"], energy: 0, talk: 1, loud: false, alcohol: false, indoor: true, cost: [30, 60], minutes: 90, people: [2, 8], lateJoin: true, food: true, halal: true, veg: true, halalKeywords: ["清真小吃"], aliases: ["小吃", "夜市", "美食街", "逛吃"] }),
  // ---- 喝 ----
  act({ key: "coffee", name: "咖啡", emoji: "☕", group: "drink", poiKeywords: ["咖啡"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [30, 60], minutes: 90, people: [2, 8], lateJoin: true, food: false, aliases: ["咖啡", "下午茶", "coffee"] }),
  act({ key: "bar", name: "清吧", emoji: "🍸", group: "drink", poiKeywords: ["清吧"], energy: 0, talk: 2, loud: false, alcohol: true, indoor: true, cost: [80, 150], minutes: 150, people: [2, 10], lateJoin: true, food: false, aliases: ["清吧", "酒吧", "小酒馆", "喝一杯", "喝酒", "精酿"] }),
  act({ key: "milktea", name: "奶茶甜品", emoji: "🧋", group: "drink", poiKeywords: ["奶茶"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [15, 35], minutes: 60, people: [2, 8], lateJoin: true, food: false, aliases: ["奶茶", "甜品", "糖水"] }),
  // ---- 玩 ----
  act({ key: "boardgame", name: "桌游", emoji: "🎲", group: "play", poiKeywords: ["桌游"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: true, cost: [40, 80], minutes: 180, people: [3, 12], lateJoin: true, food: false, aliases: ["桌游", "狼人杀", "三国杀", "阿瓦隆", "uno"] }),
  act({ key: "jubensha", name: "剧本杀", emoji: "🕵️", group: "play", poiKeywords: ["剧本杀"], energy: 1, talk: 2, loud: false, alcohol: false, indoor: true, cost: [90, 160], minutes: 240, people: [4, 10], lateJoin: false, food: false, aliases: ["剧本杀"] }),
  act({ key: "escape", name: "密室逃脱", emoji: "🔐", group: "play", poiKeywords: ["密室逃脱"], energy: 2, talk: 1, loud: true, alcohol: false, indoor: true, cost: [80, 140], minutes: 90, people: [3, 8], lateJoin: false, food: false, aliases: ["密室逃脱", "密室"] }),
  act({ key: "ktv", name: "KTV", emoji: "🎤", group: "play", poiKeywords: ["KTV"], energy: 1, talk: 0, loud: true, alcohol: true, indoor: true, cost: [60, 120], minutes: 180, people: [2, 20], lateJoin: true, food: false, aliases: ["ktv", "唱k", "k歌", "唱歌"] }),
  act({ key: "arcade", name: "电玩城", emoji: "🕹️", group: "play", poiKeywords: ["电玩城"], energy: 1, talk: 0, loud: true, alcohol: false, indoor: true, cost: [50, 120], minutes: 120, people: [2, 10], lateJoin: true, food: false, aliases: ["电玩城", "电玩", "街机", "抓娃娃"] }),
  act({ key: "billiards", name: "台球", emoji: "🎱", group: "play", poiKeywords: ["台球"], energy: 1, talk: 1, loud: false, alcohol: false, indoor: true, cost: [30, 60], minutes: 120, people: [2, 8], lateJoin: true, food: false, aliases: ["台球", "桌球", "斯诺克"] }),
  act({ key: "bowling", name: "保龄球", emoji: "🎳", group: "play", poiKeywords: ["保龄球馆"], energy: 1, talk: 1, loud: true, alcohol: false, indoor: true, cost: [50, 100], minutes: 90, people: [2, 12], lateJoin: true, food: false, aliases: ["保龄球"] }),
  act({ key: "archery", name: "射箭", emoji: "🏹", group: "play", poiKeywords: ["射箭馆"], energy: 1, talk: 1, loud: false, alcohol: false, indoor: true, cost: [60, 120], minutes: 90, people: [2, 8], lateJoin: true, food: false, aliases: ["射箭"] }),
  act({ key: "climbing", name: "攀岩", emoji: "🧗", group: "play", poiKeywords: ["攀岩馆"], energy: 3, talk: 1, loud: false, alcohol: false, indoor: true, cost: [90, 150], minutes: 120, people: [2, 10], lateJoin: true, food: false, aliases: ["攀岩", "抱石"] }),
  act({ key: "badminton", name: "羽毛球", emoji: "🏸", group: "play", poiKeywords: ["羽毛球馆"], energy: 2, talk: 1, loud: false, alcohol: false, indoor: true, cost: [30, 60], minutes: 120, people: [2, 8], lateJoin: true, food: false, aliases: ["羽毛球", "打球"] }),
  // ---- 看 ----
  act({ key: "exhibition", name: "看展", emoji: "🖼️", group: "see", poiKeywords: ["美术馆"], energy: 1, talk: 1, loud: false, alcohol: false, indoor: true, cost: [0, 80], minutes: 120, people: [1, 10], lateJoin: true, food: false, aliases: ["看展", "展览", "美术馆", "博物馆"] }),
  act({ key: "movie", name: "电影", emoji: "🎬", group: "see", poiKeywords: ["电影院"], energy: 0, talk: 0, loud: false, alcohol: false, indoor: true, cost: [40, 80], minutes: 150, people: [1, 20], lateJoin: false, food: false, aliases: ["看电影", "电影", "影院"] }),
  act({ key: "livehouse", name: "Livehouse", emoji: "🎸", group: "see", poiKeywords: ["livehouse"], energy: 2, talk: 0, loud: true, alcohol: true, indoor: true, cost: [100, 250], minutes: 150, people: [1, 20], lateJoin: true, food: false, aliases: ["livehouse", "看演出", "演出", "音乐现场"] }),
  // ---- 户外 ----
  act({ key: "hiking", name: "徒步爬山", emoji: "🥾", group: "outdoor", poiKeywords: ["徒步"], energy: 3, talk: 1, loud: false, alcohol: false, indoor: false, cost: [0, 50], minutes: 240, people: [2, 20], lateJoin: false, food: false, aliases: ["徒步", "爬山", "登山", "走山"] }),
  act({ key: "picnic", name: "公园野餐", emoji: "🧺", group: "outdoor", poiKeywords: ["公园"], energy: 0, talk: 2, loud: false, alcohol: false, indoor: false, cost: [30, 80], minutes: 180, people: [2, 20], lateJoin: true, food: false, aliases: ["野餐", "逛公园", "草坪"] }),
  act({ key: "cycling", name: "骑行", emoji: "🚴", group: "outdoor", poiKeywords: ["骑行"], energy: 2, talk: 1, loud: false, alcohol: false, indoor: false, cost: [20, 60], minutes: 150, people: [2, 12], lateJoin: false, food: false, aliases: ["骑行", "骑车", "骑自行车"] }),
  act({ key: "camping", name: "露营", emoji: "🏕️", group: "outdoor", poiKeywords: ["露营"], energy: 1, talk: 2, loud: false, alcohol: false, indoor: false, cost: [80, 200], minutes: 240, people: [3, 20], lateJoin: true, food: false, aliases: ["露营"] }),
];

const BY_KEY = new Map(ACTIVITY_LIB.map((a) => [a.key, a]));

export function activityByKey(key: string): ActivityInfo | undefined {
  if (key.startsWith(CUSTOM_PREFIX)) return customActivity(key.slice(CUSTOM_PREFIX.length));
  return BY_KEY.get(key);
}

// ---------------------------------------------------------------- 本人自己写的活动（"陶艺""猫咖""保龄球"）

/** 活动库里没有、本人在"想干什么"里自己写的：key = "custom:陶艺"，用这个词直接在地图上搜店 */
export const CUSTOM_PREFIX = "custom:";
const FOOD_WORD_RE = /吃|菜|饭|餐|料理|火锅|烤|面|粉|锅|串|鸡|鱼|虾|甜品|小吃|自助|食|茶餐厅|bistro/i;

/** 活动库里有这个说法吗（"唱歌"= KTV、"日料"= 日料）；有就返回那个活动 */
export function libActivityOfWord(word: string): ActivityInfo | undefined {
  const w = word.trim().toLowerCase();
  if (!w) return undefined;
  return ACTIVITY_LIB.find((a) => a.name.toLowerCase() === w || a.aliases.some((x) => x.toLowerCase() === w));
}

/** 自己写的活动：属性取中间值（不吵、不累、能聊），只用来预排序；人均、营业时间以真实的店为准 */
export function customActivity(word: string): ActivityInfo {
  const w = word.trim().slice(0, 12);
  const food = FOOD_WORD_RE.test(w);
  return act({
    key: `${CUSTOM_PREFIX}${w}`,
    name: w,
    emoji: food ? "🍽️" : "✨",
    group: food ? "eat" : "play",
    poiKeywords: [w],
    energy: 1,
    talk: 1,
    loud: false,
    alcohol: /酒/.test(w),
    indoor: "either",
    cost: food ? [60, 150] : [50, 150],
    minutes: 120,
    people: [1, 20],
    lateJoin: true,
    food,
    aliases: [w],
  });
}

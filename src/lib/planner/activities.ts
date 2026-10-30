// v6 活动层（docs/AVATAR.md 第 3 节）：先定干什么，再定去哪。
// - ACTIVITY_LIB：活动库（吃 / 喝 / 玩 / 看 / 户外），每种带动静、能不能聊天、吵不吵、有没有酒、室内户外、人均、时长…
// - activitiesIn：从一句话里认出说到的活动（"火锅""唱K""爬山"）
// - scoreActivities：每人对每种活动的契合度（不调地图，便宜），按 v5 三级准则排序
// 隐私：契合度用到心情 / 预算 / 身体 / 偏好这些私密信息，只在内部排序用；对外只说聚合（见 plan.ts 的思考流）。
// 确定性：只用规则和数字，平局按活动库顺序。
import type { ActivityDef, JuSpec, Member, Mood, NeedStrength, Profile, WeatherDay } from "../types";
import { budgetDegree, CARE_FLOOR, HARD_DIET } from "./experience";
import { slotWeather, type WeatherKind } from "./external";
import { softPenalty } from "./needs";
import { bjIso, clamp, hmToMin } from "./util";

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
  return BY_KEY.get(key);
}

/** 所有说法（长的在前，避免"看电影"被拆成"电影"之外的东西） */
const ALIASES: { alias: string; key: string }[] = ACTIVITY_LIB.flatMap((a) => a.aliases.map((alias) => ({ alias: alias.toLowerCase(), key: a.key }))).sort(
  (x, y) => y.alias.length - x.alias.length || (x.alias < y.alias ? -1 : x.alias > y.alias ? 1 : 0),
);

/** 泛泛的说法：同一句话里有更具体的同类活动时不算（"周五聚餐吃火锅" = 火锅，"烧烤喝酒" = 烧烤） */
const GENERIC_ALIAS: Record<string, string> = {
  吃饭: "eat", 聚餐: "eat", 约饭: "eat", 吃顿饭: "eat", 吃个饭: "eat", 干饭: "eat", 喝酒: "drink", 喝一杯: "drink",
};

/** 一句话里说到的活动（按出现顺序，去重）："吃饭或者桌游" → ["homestyle", "boardgame"] */
export function activitiesIn(text: string): string[] {
  const s = (text ?? "").toLowerCase().replace(/\s+/g, "");
  const hits: { key: string; generic?: string }[] = [];
  for (let i = 0; i < s.length; ) {
    const hit = ALIASES.find((a) => s.startsWith(a.alias, i));
    if (!hit) {
      i++;
      continue;
    }
    hits.push({ key: hit.key, generic: GENERIC_ALIAS[hit.alias] });
    i += hit.alias.length;
  }
  const specific = new Set(hits.filter((h) => !h.generic).map((h) => activityByKey(h.key)!.group));
  // "eat" 泛称被具体的吃饭活动盖掉；"drink" 泛称（喝酒）被任何具体活动盖掉
  const kept = hits.filter((h) => !h.generic || (h.generic === "eat" ? !specific.has("eat") : specific.size === 0));
  const out: string[] = [];
  for (const h of kept) if (!out.includes(h.key)) out.push(h.key);
  return out;
}

/** 某个词是不是在说这个活动（"想去 / 不想去"需求的匹配） */
export function activityMatchesWord(a: ActivityInfo, word: string): boolean {
  const w = word.trim().toLowerCase();
  if (!w) return false;
  const names = [a.name, ...a.aliases, ...a.poiKeywords].map((x) => x.toLowerCase());
  return names.some((n) => n.includes(w) || w.includes(n));
}

// ---------------------------------------------------------------- 契合度

export const MOOD_TEXT: Record<Mood, string> = { hype: "想嗨一点", chill: "想安静聊聊", active: "想动一动", lazy: "想躺着" };

/** 心情 ↔ 活动属性：想嗨的爱热闹，想安静的要能聊，想动的要出汗，想躺的别太累 */
export function moodFit(mood: Mood | undefined, a: Pick<ActivityDef, "energy" | "talk" | "loud">): number {
  switch (mood) {
    case "hype":
      return (a.loud ? 14 : 0) + (a.energy >= 1 ? 6 : 0) + (a.energy === 0 && !a.loud ? -10 : 0);
    case "chill":
      return (a.talk === 2 ? 10 : a.talk === 0 ? -14 : 0) + (a.loud ? -18 : 4) + (a.energy >= 2 ? -10 : 0);
    case "active":
      return [-18, 0, 12, 16][a.energy];
    case "lazy":
      return [12, 0, -18, -32][a.energy];
    default:
      return 0;
  }
}

/** 活动层用到的档案（Profile 的子集；planJu 的 opts.profiles 传进来，按 memberId） */
export type ActivityProfile = Pick<Profile, "activityTastes" | "body">;

/** 契合度的上下文 */
export type ActivityCtx = {
  spec: JuSpec;
  /** 集合点附近的天气预报（4 天内；没有就是 []） */
  forecast?: WeatherDay[];
  profile?: ActivityProfile;
  /** 这次局的人数（公开）：人数不在活动适合的范围里（3 个人玩剧本杀）所有人一起扣 */
  headcount?: number;
};

/**
 * 某个人对某种活动的契合度（0–100，70 = 没什么感觉）。
 * base 不含"想去哪类"的偏好（两段式时要看两段里有没有一段命中，见 program.ts），prefer 单独给。
 * hard = 碰到底线（清真 / 素食的店不对、确认过的身体限制、预算差太远、户外碰上大雨），这个人在这个活动里不算被照顾到。
 */
export type ActivityFit = {
  base: number;
  /** base 里心情那一项（两段式合成时要单独处理，见 pairMood） */
  mood: number;
  hard: boolean;
  /** 说过"想去 X"（没说 = undefined）；hit = 这个活动就是 X */
  prefer?: { hit: boolean; penalty: number };
  /** 给本人的说明（只进本人视图） */
  notes: string[];
};

/** 想去的类型命中时的加分 */
export const PREFER_BONUS = 8;
/** 中性契合度 */
export const NEUTRAL_FIT = 70;

const HEAVY_FOOD = new Set(["hotpot", "bbq", "korean_bbq", "buffet"]);

/** 候选日期里最好的天气档（只要有一天能去就不排除）；没有预报 = unknown */
function bestWeather(spec: JuSpec, forecast: WeatherDay[]): { kind: WeatherKind; hot: boolean; cold: boolean } {
  const start = hmToMin(spec.earliest) ?? 18 * 60;
  const order: WeatherKind[] = ["ok", "light", "unknown", "heavy"];
  let best: { kind: WeatherKind; hot: boolean; cold: boolean } | undefined;
  for (const date of spec.dates ?? []) {
    const iso = bjIso(date, start);
    const w = slotWeather(forecast, { id: date, start: iso, end: iso });
    const cur = { kind: w.kind, hot: (w.half?.temp ?? 20) >= 33, cold: (w.half?.temp ?? 20) <= 5 };
    if (!best || order.indexOf(cur.kind) < order.indexOf(best.kind)) best = cur;
  }
  return best ?? { kind: "unknown", hot: false, cold: false };
}

/** 户外活动的天气作用（公开事实，所有人一样）：大雨 = 不成立；小雨 / 高温 / 严寒扣分；没有预报轻扣（要带备案） */
export function weatherFit(a: Pick<ActivityDef, "indoor">, spec: JuSpec, forecast: WeatherDay[] = []): { penalty: number; infeasible: boolean } {
  if (a.indoor !== false) return { penalty: 0, infeasible: false };
  const w = bestWeather(spec, forecast);
  if (w.kind === "heavy") return { penalty: 0, infeasible: true };
  let penalty = w.kind === "light" ? 12 : w.kind === "unknown" ? 4 : 0;
  if (w.hot || w.cold) penalty += 10;
  return { penalty, infeasible: false };
}

/** 有没有身体上的限制：需求里的 body 维度，或档案里的身体限制。hard = 确认过的底线 */
function bodyLimit(m: Member, profile?: ActivityProfile): { kind: "hard" | "soft"; strength: NeedStrength } | undefined {
  const needs = (m.private?.needs ?? []).filter((n) => n.dim === "body");
  if (needs.some((n) => n.kind === "hard")) return { kind: "hard", strength: 3 };
  if (needs.length) return { kind: "soft", strength: Math.max(...needs.map((n) => n.strength)) as NeedStrength };
  if ((profile?.body ?? []).length) return { kind: "soft", strength: 2 };
  return undefined;
}

/**
 * 心情 + 口味 + 身体：两段式落到具体店之后，这几项不在 v5 的单店体验里，要另外加进本人的满意度（只进私密的那份）。
 */
export function personalDelta(m: Member, a: ActivityInfo, profile?: ActivityProfile): { delta: number; mood: number; hard: boolean; notes: string[] } {
  const notes: string[] = [];
  let delta = 0;
  let hard = false;
  const mood = m.private?.mood;
  const mf = moodFit(mood, a);
  if (mood && mf <= -10) notes.push(`你说这次${MOOD_TEXT[mood]}，${a.name}不太对路`);
  else if (mood && mf >= 10) notes.push(`你说这次${MOOD_TEXT[mood]}，${a.name}正合适`);
  delta += mf;
  const taste = profile?.activityTastes?.[a.key];
  if (typeof taste === "number" && Number.isFinite(taste)) {
    const t = clamp(taste, -1, 1);
    delta += Math.round(t * 15);
    if (t >= 0.5) notes.push(`你喜欢${a.name}`);
    else if (t <= -0.5) notes.push(`你不太喜欢${a.name}`);
  }
  const body = bodyLimit(m, profile);
  if (body && a.energy >= 2) {
    if (body.kind === "hard") {
      hard = true;
      notes.push(`${a.name}运动量大，和你的身体情况冲突`);
    } else {
      delta -= softPenalty("body", body.strength, (a.energy - 1) / 2);
      notes.push(`${a.name}运动量偏大，你的身体情况得悠着点`);
    }
  }
  return { delta, mood: mf, hard, notes };
}

/**
 * 两段式里心情那一项怎么合成：有一段对路就算对路，不对路的那段只扣一半
 * （想动的人第二段坐下来吃饭不难受；想躺的人陪着动一段是让步，但第二段能躺着）。
 * 时间加权平均会让"一段动一段静"永远输给一个不咸不淡的折中活动，不符合 AVATAR.md 3.4 的本意。
 */
export function pairMood(a: number, b: number): number {
  return Math.max(a, b) - 0.5 * Math.max(0, -Math.min(a, b));
}

/** 某个人对某种活动的契合度（活动层，不看具体哪家店） */
export function activityFit(m: Member, a: ActivityInfo, ctx: ActivityCtx): ActivityFit {
  const p = m.private;
  const pd = personalDelta(m, a, ctx.profile);
  const notes = [...pd.notes];
  let base = NEUTRAL_FIT + pd.delta;
  let hard = pd.hard;

  // 饮食底线：清真 / 素食的朋友，吃饭的活动得能找到对的店
  const tags = new Set(p?.dietTags ?? []);
  if (a.food) {
    for (const t of HARD_DIET) {
      if (!tags.has(t)) continue;
      if ((t === "清真" && !a.halal) || (t === "素食" && !a.veg)) {
        hard = true;
        notes.push(`${a.name}一般不适合${t}`);
      }
    }
  }
  if (tags.has("清真") && a.alcohol) {
    base -= softPenalty("ambience", 3, 1);
    notes.push(`${a.name}以喝酒为主`);
  }

  // 预算：按这类店常见的人均偏低一档估；最便宜的都超出 60% 以上 = 这次的底线碰不了
  const low = a.cost[0];
  const typical = Math.round(a.cost[0] + (a.cost[1] - a.cost[0]) * 0.3);
  if (p?.budgetMax !== undefined && p.budgetMax > 0) {
    if (budgetDegree(low, p.budgetMax) >= 1) {
      hard = true;
      notes.push(`${a.name}人均一般 ${low} 起，比你说的 ${p.budgetMax} 多太多`);
    } else {
      const d = budgetDegree(typical, p.budgetMax);
      if (d > 0) {
        base -= softPenalty("money", p.budgetStrength ?? 2, d);
        notes.push(`${a.name}人均一般 ${typical} 左右，超出你说的 ${p.budgetMax}`);
      }
    }
  } else if (ctx.spec.budgetPerPerson && ctx.spec.budgetPerPerson > 0) {
    const over = (typical - ctx.spec.budgetPerPerson) / ctx.spec.budgetPerPerson;
    if (over > 0.2) base -= Math.min(15, (over - 0.2) * 40);
  }

  // 人数（公开事实）
  const n = ctx.headcount;
  if (n && (n < a.people[0] || n > a.people[1])) {
    base -= 15;
    notes.push(`${a.name}一般 ${a.people[0]}–${a.people[1]} 人玩，这次 ${n} 人`);
  }

  // 天气（公开事实）
  const wf = weatherFit(a, ctx.spec, ctx.forecast);
  if (wf.infeasible) {
    hard = true;
    notes.push(`${a.name}在户外，那几天预报有大雨`);
  } else base -= wf.penalty;

  // 私聊抽出来的其他需求（活动层只看活动属性；落到具体店后 v5 的单店体验会再按店算一遍）
  let prefer: ActivityFit["prefer"];
  for (const n of p?.needs ?? []) {
    const r = n.rule;
    let degree = 0;
    let dim = n.dim;
    if (r.t === "preferCategory") {
      const hit = r.words.some((w) => activityMatchesWord(a, w));
      const pen = softPenalty("activity", n.strength, 0.6);
      prefer = prefer ? { hit: prefer.hit || hit, penalty: Math.max(prefer.penalty, pen) } : { hit, penalty: pen };
      continue;
    }
    if (r.t === "avoidCategory") degree = r.words.some((w) => activityMatchesWord(a, w)) ? 1 : 0;
    else if (r.t === "quiet") degree = a.loud ? 1 : 0;
    else if (r.t === "noAlcohol") degree = a.alcohol ? 1 : 0;
    else if (r.t === "indoor") degree = a.indoor === false ? 1 : a.indoor === "either" ? 0.3 : 0;
    else if (r.t === "lightFood") {
      degree = a.food && HEAVY_FOOD.has(a.key) ? 1 : 0;
      dim = "food";
    } else continue;
    if (degree <= 0) continue;
    if (n.kind === "hard") {
      hard = true;
      notes.push(`你说「${n.text}」，${a.name}不行`);
    } else {
      base -= softPenalty(dim, n.strength, degree);
      notes.push(`你说「${n.text}」，${a.name}不太合适`);
    }
  }
  return { base: clamp(Math.round(base), 0, 100), mood: pd.mood, hard, ...(prefer ? { prefer } : {}), notes };
}

/** 一种活动（单段节目）的最终契合度：base + 想去的类型命中 / 没命中 */
export function singleFit(f: ActivityFit): number {
  if (!f.prefer) return f.base;
  return clamp(Math.round(f.base + (f.prefer.hit ? PREFER_BONUS : -f.prefer.penalty)), 0, 100);
}

// ---------------------------------------------------------------- 三级准则（活动层）

/** 活动层的评分：和 plan.ts 的 Candidate 同一套三级准则字段 */
export type Graded = {
  /** 每人的契合度（与 members 一一对应） */
  fits: number[];
  hard: boolean[];
  /** 被照顾到的人数：没碰底线 + 契合度 ≥ 保底线 */
  cared: number;
  caredW: number;
  /** 加权损失 w_i·(100 − fit_i)，从大到小 */
  losses: number[];
  nash: number;
  /** 平局时的确定性次序 */
  order: number;
};

export function grade(fits: number[], hard: boolean[], weights: number[], order: number): Graded {
  const eff = fits.map((f, i) => (hard[i] ? 0 : f));
  const caredIdx = eff.map((_, i) => i).filter((i) => !hard[i] && fits[i] >= CARE_FLOOR);
  return {
    fits,
    hard,
    cared: caredIdx.length,
    caredW: Math.round(caredIdx.reduce((s, i) => s + (weights[i] ?? 1), 0) * 100) / 100,
    losses: eff.map((u, i) => Math.round((weights[i] ?? 1) * (100 - u) * 10) / 10).sort((a, b) => b - a),
    nash: Math.round(eff.reduce((s, u) => s + Math.log(1 + u), 0) * 1000) / 1000,
    order,
  };
}

/** 活动层的 leximin 容差（同 plan.ts 的 LEXIMIN_EPS） */
const EPS = 1;

/** 三级准则：照顾到的人最多 → 最吃亏的人损失最小 → 纳什福利。负数 = a 更好 */
export function gradeCompare(a: Graded, b: Graded): number {
  if (a.cared !== b.cared) return b.cared - a.cared;
  if (Math.abs(a.caredW - b.caredW) > 1e-9) return b.caredW - a.caredW;
  const n = Math.min(a.losses.length, b.losses.length);
  for (let i = 0; i < n; i++) {
    const d = a.losses[i] - b.losses[i];
    if (Math.abs(d) > EPS) return d;
  }
  if (Math.abs(a.nash - b.nash) > 1e-9) return b.nash - a.nash;
  return a.order - b.order;
}

export type ActivityScore = Graded & {
  key: string;
  act: ActivityInfo;
  /** 每人的契合度明细（内部用） */
  detail: ActivityFit[];
  /** 对所有人都不成立（户外 + 大雨） */
  excluded: boolean;
};

/** 候选活动池：spec.activities 里认识的那些；没给（或一个都不认识）= 全库 */
export function candidatePool(spec: Pick<JuSpec, "activities">): ActivityInfo[] {
  const pool = (spec.activities ?? []).map((k) => activityByKey(k)).filter((a): a is ActivityInfo => !!a);
  return pool.length ? [...new Set(pool)] : ACTIVITY_LIB;
}

/**
 * 活动层打分（不调地图）：每人对候选池里每种活动的契合度，按三级准则从好到差排好。
 * profiles：memberId → 档案（活动口味、身体限制）；weights：跨局公平权重（与 members 一一对应，缺省都是 1）。
 */
export function scoreActivities(
  members: Member[],
  spec: JuSpec,
  forecast: WeatherDay[] = [],
  opts: { profiles?: Record<string, ActivityProfile>; weights?: number[] } = {},
): ActivityScore[] {
  const weights = members.map((_, i) => opts.weights?.[i] ?? 1);
  const pool = candidatePool(spec);
  const out = pool.map((a) => {
    const detail = members.map((m) => activityFit(m, a, { spec, forecast, profile: opts.profiles?.[m.id], headcount: members.length }));
    const fits = detail.map(singleFit);
    const hard = detail.map((d) => d.hard);
    return { key: a.key, act: a, detail, excluded: weatherFit(a, spec, forecast).infeasible, ...grade(fits, hard, weights, ACTIVITY_LIB.indexOf(a)) };
  });
  return out.sort((a, b) => (a.excluded !== b.excluded ? (a.excluded ? 1 : -1) : gradeCompare(a, b)));
}

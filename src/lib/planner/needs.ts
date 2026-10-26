// v5 需求模型（docs/DECISION.md 第 2、3 节）。
// - extractNeeds：从一句话里抽出能算的需求（规则版：没有大模型时兜底，也用来校验大模型的输出）
// - needsOf：把一个人的全部需求合成一张清单（时间 / 预算 / 忌口在各自字段里，其余在 private.needs）
// - evaluateNeed：某条需求在某个候选（时间 × 场地）下的违反程度 0–1，以及给本人的一句解释
// 确定性：只用正则和数字，不依赖时区、不用随机。
import type { Need, NeedDim, NeedResult, NeedRule, NeedStrength, Poi } from "../types";
import { isFoodPoi } from "./util";

export type ExtractedNeed = Omit<Need, "id" | "at" | "source">;

/** 强度系数：1 随口一提 / 2 在意 / 3 很在意 */
export const STRENGTH_COEF: Record<NeedStrength, number> = { 1: 0.4, 2: 1.0, 3: 1.8 };

/** 每个维度的扣分上限（强度 2、完全违反时扣这么多） */
export const DIM_CAP: Record<NeedDim, number> = {
  time: 30,
  travel: 30,
  money: 40,
  food: 35,
  activity: 30,
  ambience: 20,
  people: 15,
  body: 35,
  join: 0,
};

export function softPenalty(dim: NeedDim, strength: NeedStrength, degree: number): number {
  return STRENGTH_COEF[strength] * Math.max(0, Math.min(1, degree)) * DIM_CAP[dim];
}

// ---------------------------------------------------------------- 场地属性

const LOUD_RE = /KTV|ktv|酒吧|清吧|livehouse|Livehouse|大排档|烧烤|串|电玩|蹦迪|夜店/;
const ALCOHOL_RE = /酒吧|清吧|酒馆|精酿|居酒屋|小酒馆|夜店/;
const HEAVY_RE = /火锅|烧烤|烤肉|串|炸|麻辣|冒菜|干锅/;
const OUTDOOR_RE = /公园|景区|风景名胜|露营|郊野|广场|户外|室外|农家乐|采摘|徒步|沙滩|营地/;

/** 室内 / 户外：高德给了楼层 → 室内；类型像户外 → 户外；否则不知道 */
export function poiIndoor(poi: Pick<Poi, "indoor" | "name" | "type">): boolean | undefined {
  if (poi.indoor !== undefined) return poi.indoor;
  if (OUTDOOR_RE.test(`${poi.name}${poi.type}`)) return false;
  return undefined;
}

// ---------------------------------------------------------------- 抽取（规则版）

const CATEGORY_WORDS = [
  "火锅", "烧烤", "烤肉", "日料", "寿司", "西餐", "自助", "KTV", "酒吧", "桌游", "剧本杀", "密室",
  "川菜", "湘菜", "粤菜", "海鲜", "串串", "麻辣烫", "咖啡", "轰趴", "羽毛球", "篮球", "电影", "唱歌", "韩料", "泰餐", "面馆",
];
const CATEGORY_ALIAS: Record<string, string> = { 唱歌: "KTV" };
const CAT_RE = new RegExp(`(${CATEGORY_WORDS.join("|")}|ktv)`, "gi");

function cats(s: string): string[] {
  const out = new Set<string>();
  for (const m of s.matchAll(CAT_RE)) out.add(/^ktv$/i.test(m[1]) ? "KTV" : (CATEGORY_ALIAS[m[1]] ?? m[1]));
  return [...out];
}

const HARD_RE = /必须|一定要|只能|最多|不能超过|绝对|千万|实在不行/;
// "太"不算强调（"别太远"只是普通的要求），"真的 / 特别 / 实在"才算
const STRONG_RE = /很|特别|真的|千万|实在|超级|非常/;

const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** "40" / "四十" / "二十五" / "十一" → 数字；不认识返回 undefined */
function num(s: string): number | undefined {
  if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const m = /^([一二两三四五六七八九])?(十)?([一二三四五六七八九])?$/.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  if (!m[2]) return CN_DIGIT[m[1] ?? m[3]];
  return (m[1] ? CN_DIGIT[m[1]] : 1) * 10 + (m[3] ? CN_DIGIT[m[3]] : 0);
}

const NUM = "(\\d+(?:\\.\\d+)?|[一二两三四五六七八九十]{1,3})";

function minutesIn(s: string): number | undefined {
  if (/半(个)?(小时|钟头)/.test(s)) return 30;
  const h = new RegExp(`${NUM}\\s*个?\\s*半?\\s*(小时|钟头)`).exec(s);
  if (h) {
    const n = num(h[1]);
    if (n !== undefined) return Math.round((n + (/半(小时|钟头)/.test(h[0]) ? 0.5 : 0)) * 60);
  }
  const m = new RegExp(`${NUM}\\s*分钟`).exec(s);
  return m ? num(m[1]) : undefined;
}

function clockIn(s: string): string | undefined {
  const m = new RegExp(`${NUM}\\s*(?:点|:|：)\\s*(半|\\d{2})?`).exec(s);
  if (!m) return undefined;
  // 聚会语境里说"几点结束 / 几点前回"指的是下午晚上："10 点" = 22:00，"12 点" = 午夜
  let h = num(m[1]) ?? NaN;
  if (!Number.isInteger(h)) return undefined;
  if (h === 12) h = 0;
  else if (h >= 1 && h <= 11) h += 12;
  if (h >= 24) return undefined;
  const mm = m[2] === "半" ? 30 : m[2] ? Number(m[2]) : 0;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function push(out: ExtractedNeed[], n: ExtractedNeed) {
  const sig = `${n.dim}|${JSON.stringify(n.rule)}`;
  if (!out.some((x) => `${x.dim}|${JSON.stringify(x.rule)}` === sig)) out.push(n);
}

/**
 * 规则版抽取：一句话 → 能算的需求。只抽"说了的"，宁可漏也不瞎猜。
 * 时间（几点出发 / 门禁）、预算数字、忌口标签不在这里（chat.ts 的老规则负责），这里管其余的。
 */
export function extractNeeds(text: string): ExtractedNeed[] {
  const s = text.replace(/\s+/g, "");
  const out: ExtractedNeed[] = [];
  if (!s) return out;
  const strong = STRONG_RE.test(s);
  const hard = HARD_RE.test(s);

  // 身体：腿脚不方便 → 路上别太久（走路距离拿不到，用通勤时间近似，如实写在复述里）
  if (/腿|脚|膝盖|崴|骨折|拄拐|行动不便|不方便走|走不了远/.test(s) && /伤|疼|痛|崴|骨折|不便|不方便|不好|走不了/.test(s)) {
    const mins = minutesIn(s) ?? 25;
    push(out, { dim: "body", kind: "soft", strength: 3, rule: { t: "maxCommute", minutes: mins }, text: `腿脚不方便：路上尽量别超过 ${mins} 分钟`, evidence: text });
  }

  // 通勤
  const far =
    /离我近|近点|近一点/.test(s) ||
    (/远|跑|路上|路程|通勤|车程|地铁/.test(s) && /不想|别|不要|太|受不了|近点|近一点|以内|之内|不超过|最多/.test(s));
  if (far && !out.some((n) => n.dim === "body")) {
    const mins = minutesIn(s);
    push(out, {
      dim: "travel",
      kind: hard && mins ? "hard" : "soft",
      strength: strong ? 3 : 2,
      rule: { t: "maxCommute", minutes: mins ?? 30 },
      text: `单程${hard && mins ? "不能" : "尽量别"}超过 ${mins ?? 30} 分钟`,
      evidence: text,
    });
  }

  // 环境
  if (/安静|能聊天|好聊天|别太吵|不要太吵|怕吵|太吵|吵闹/.test(s)) {
    push(out, { dim: "ambience", kind: "soft", strength: strong ? 3 : 2, rule: { t: "quiet" }, text: "想安静点、能好好聊天", evidence: text });
  }
  if (/不喝酒|不能喝酒|喝不了酒|劝酒|不想喝|酒精过敏|戒酒|吃头孢|开车/.test(s)) {
    push(out, { dim: "ambience", kind: "soft", strength: 2, rule: { t: "noAlcohol" }, text: "不喝酒，别去以喝酒为主的地方", evidence: text });
  }
  if (/怕冷|怕热|怕晒|室内|别在外面|不想在外面|怕下雨|不要户外|别户外/.test(s)) {
    push(out, { dim: "ambience", kind: "soft", strength: 2, rule: { t: "indoor" }, text: "想在室内", evidence: text });
  }

  // 饮食口味
  if (/减肥|清淡|别太油|太油|油腻|胃不好|肠胃|拉肚子|上火/.test(s)) {
    push(out, { dim: "food", kind: "soft", strength: 2, rule: { t: "lightFood" }, text: "想吃清淡点", evidence: text });
  }
  if (/排队|等位|等太久/.test(s) && /不想|怕|别|不要|讨厌|受不了/.test(s)) {
    push(out, { dim: "time", kind: "soft", strength: 2, rule: { t: "noQueue" }, text: "不想排队", evidence: text });
  }

  // 早点回（软）：真正的门禁 / 末班车走 availability.homeBy
  const early = /早点回|早点走|早点散|早走|先走|太晚|明天早|明早|早八|早起|第二天还要/.test(s) || new RegExp(`${NUM}\\s*点(半)?(之前|以前|前)\\s*[得要就能]?\\s*(结束|回|走|散)`).test(s);
  const notNegatedLate = !/太晚(也|都)?(没事|没关系|无所谓|可以)/.test(s);
  if (early && notNegatedLate && !/门禁|宿舍关门|末班/.test(s)) {
    const at = clockIn(s) ?? "21:30";
    push(out, { dim: "time", kind: "soft", strength: strong ? 3 : 2, rule: { t: "leaveBy", at }, text: `想 ${at} 前结束`, evidence: text });
  }

  // 品类：不想 X / X 就算了 / 想 X。"不吃海鲜 / 不吃辣"这类是忌口，由忌口解析负责，这里不重复
  const DIET_WORDS = new Set(["海鲜"]);
  const negSeg = s.match(/(?:不想|不要|不去|别去|不吃|别吃|讨厌|受不了|别)[^，,。；;!！?？]{0,8}/g) ?? [];
  const negAfter = s.match(new RegExp(`(?:${CATEGORY_WORDS.join("|")}|ktv)+[^，,。；;!！?？]{0,3}?(?:都|也)?(?:不想|不要|不去|不吃|算了|就算了|不太想|pass)`, "gi")) ?? [];
  const neg = new Set([...negSeg, ...negAfter].flatMap(cats).filter((c) => !DIET_WORDS.has(c)));
  if (neg.size) push(out, { dim: "activity", kind: "soft", strength: strong ? 3 : 2, rule: { t: "avoidCategory", words: [...neg] }, text: `不想去${[...neg].join("、")}`, evidence: text });
  const posSeg = s.match(/(?:想吃|想去|想玩|最好是|想要|馋|好想)[^，,。；;!！?？]{0,8}/g) ?? [];
  const pos = [...new Set(posSeg.flatMap(cats))].filter((c) => !neg.has(c));
  if (pos.length) push(out, { dim: "activity", kind: "soft", strength: strong ? 2 : 1, rule: { t: "preferCategory", words: pos }, text: `想去${pos.join("、")}`, evidence: text });

  return out;
}

/** "手头紧"一类的话 → 预算很在意（3）；"无所谓 / 都行"→ 随口（1）；其余不变 */
export function budgetStrengthOf(text: string): NeedStrength | undefined {
  const s = text.replace(/\s+/g, "");
  if (/穷|没钱|手头紧|手头有点紧|月底|吃土|省钱|拮据|破产|生活费|囊中羞涩|紧巴|超预算/.test(s)) return 3;
  if (/(价格|贵不贵|多少钱)?(无所谓|都行|不在乎|不差钱|随便)/.test(s) && /价|钱|贵|预算|人均/.test(s)) return 1;
  return undefined;
}

// ---------------------------------------------------------------- 评估

export type NeedCtx = {
  poi: Pick<Poi, "name" | "type" | "costPerPerson" | "indoor">;
  /** 本人到这家的通勤（分钟） */
  commuteMin: number;
  /** 本人在这个方案里的离开时刻（当天分钟，可 > 1440） */
  stayEndMin: number;
  /** 饭点排队分钟（公开因素） */
  queueMin: number;
};

export type NeedEval = { degree: number; result: NeedResult["result"]; detail: string };

const hmToMinLoose = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
};
const fmt = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** 某条规则在某个候选下的违反程度（0 = 满足，1 = 完全没满足）和解释 */
export function evaluateRule(rule: NeedRule, ctx: NeedCtx): NeedEval {
  const where = `${ctx.poi.name}${ctx.poi.type}`;
  switch (rule.t) {
    case "maxCommute": {
      const over = ctx.commuteMin - rule.minutes;
      if (over <= 0) return { degree: 0, result: "met", detail: `路上 ${ctx.commuteMin} 分钟` };
      const degree = Math.min(1, over / Math.max(10, rule.minutes * 0.5));
      return { degree, result: degree < 0.5 ? "partial" : "unmet", detail: `路上 ${ctx.commuteMin} 分钟，多了 ${over} 分钟` };
    }
    case "leaveBy": {
      const at = hmToMinLoose(rule.at);
      if (at === undefined) return { degree: 0, result: "noted", detail: "" };
      const end = ctx.stayEndMin;
      const target = at < 6 * 60 ? at + 1440 : at;
      const over = end - target;
      if (over <= 0) return { degree: 0, result: "met", detail: `${fmt(end)} 就结束了` };
      const degree = Math.min(1, over / 60);
      return { degree, result: degree < 0.5 ? "partial" : "unmet", detail: `${fmt(end)} 才结束，比你想的晚 ${over} 分钟` };
    }
    case "avoidCategory": {
      const hit = rule.words.find((w) => where.includes(w) || (w === "KTV" && /KTV|ktv|量贩/.test(where)));
      return hit ? { degree: 1, result: "unmet", detail: `这家是${hit}` } : { degree: 0, result: "met", detail: "不是你不想去的类型" };
    }
    case "preferCategory": {
      const hit = rule.words.find((w) => where.includes(w));
      return hit ? { degree: 0, result: "met", detail: `正好是${hit}` } : { degree: 0.6, result: "partial", detail: "不是你想去的类型" };
    }
    case "quiet":
      return LOUD_RE.test(where) ? { degree: 1, result: "unmet", detail: "这类地方一般比较吵" } : { degree: 0, result: "unknown", detail: "吵不吵局长不确定" };
    case "noAlcohol":
      return ALCOHOL_RE.test(where) ? { degree: 1, result: "unmet", detail: "这里以喝酒为主" } : { degree: 0, result: "met", detail: "不是以喝酒为主的地方" };
    case "indoor": {
      const indoor = poiIndoor(ctx.poi);
      if (indoor === true) return { degree: 0, result: "met", detail: "在室内" };
      if (indoor === false) return { degree: 1, result: "unmet", detail: "在户外" };
      return { degree: 0.3, result: "unknown", detail: "不确定是不是室内" };
    }
    case "lightFood":
      return isFoodPoi(ctx.poi) && HEAVY_RE.test(where) ? { degree: 1, result: "unmet", detail: "这家偏油偏重口" } : { degree: 0, result: "met", detail: "不算油腻" };
    case "noQueue":
      return ctx.queueMin > 0 ? { degree: 1, result: "unmet", detail: `饭点可能要排队约 ${ctx.queueMin} 分钟` } : { degree: 0, result: "met", detail: "不用排队" };
    case "custom":
      return { degree: 0, result: "noted", detail: "局长记下了，但没法算进方案里" };
  }
}

/** 把 ChatPatch 里的需求变成入库的 Need（补 id / 时间 / 来源），去掉和已有需求重复的 */
export function materializeNeeds(existing: Need[], incoming: ExtractedNeed[], source: Need["source"], at: string): Need[] {
  const out = [...existing];
  for (const n of incoming) {
    const sig = `${n.dim}|${JSON.stringify(n.rule)}`;
    const i = out.findIndex((x) => `${x.dim}|${JSON.stringify(x.rule)}` === sig);
    // 同一条需求再说一遍：取更强的那个说法
    if (i >= 0) {
      if (n.strength > out[i].strength || (n.kind === "hard" && out[i].kind === "soft")) out[i] = { ...out[i], ...n };
      continue;
    }
    out.push({ ...n, id: `n${out.length + 1}-${n.rule.t}`, source, at });
  }
  return out.slice(-20);
}

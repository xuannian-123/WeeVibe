// 规则兜底：没有 LLM 或 LLM 出错时用。纯函数、确定性，便于单测。
import type { DietTag, JuSpec } from "../types";
import { ACTIVITY_LIB, activitiesIn, activityByKey } from "../planner/activities";
import { NUM_RE_SRC, parseCnNumber } from "./cn-number";
import {
  addDays,
  dowLabel,
  fromMinutes,
  isValidYmd,
  isoDowOf,
  shanghaiNow,
  toMinutes,
  type ShNow,
} from "./time";

// ---------------------------------------------------------------- 品类

export type Kind = "food" | "sport" | "fun" | "drink" | "outdoor";
type CategoryDef = { category: string; kind: Kind; re: RegExp; keywords: string[]; duration: number };

// 顺序有意义：越具体越靠前
const CATEGORIES: CategoryDef[] = [
  { category: "火锅", kind: "food", re: /火锅|涮锅|涮肉|海底捞|串串|冒菜/, keywords: ["火锅"], duration: 120 },
  { category: "小龙虾", kind: "food", re: /小龙虾|龙虾/, keywords: ["小龙虾"], duration: 120 },
  { category: "烤肉", kind: "food", re: /烤肉|韩式烤|韩料|韩国料理/, keywords: ["烤肉"], duration: 120 },
  { category: "烧烤", kind: "food", re: /烧烤|撸串|烤串|bbq/i, keywords: ["烧烤"], duration: 120 },
  { category: "日料", kind: "food", re: /日料|日本料理|寿司|居酒屋|刺身/, keywords: ["日料"], duration: 120 },
  { category: "西餐", kind: "food", re: /西餐|牛排|意面|披萨|pizza/i, keywords: ["西餐"], duration: 120 },
  { category: "自助", kind: "food", re: /自助/, keywords: ["自助餐"], duration: 120 },
  { category: "川菜", kind: "food", re: /川菜|湘菜/, keywords: ["川菜"], duration: 120 },
  { category: "粤菜", kind: "food", re: /粤菜|早茶|茶餐厅/, keywords: ["粤菜"], duration: 120 },
  { category: "剧本杀", kind: "fun", re: /剧本杀/, keywords: ["剧本杀"], duration: 240 },
  { category: "密室", kind: "fun", re: /密室/, keywords: ["密室逃脱"], duration: 120 },
  { category: "桌游", kind: "fun", re: /桌游|狼人杀|三国杀|阿瓦隆/, keywords: ["桌游"], duration: 180 },
  { category: "KTV", kind: "fun", re: /ktv|k歌|唱歌|唱k/i, keywords: ["KTV"], duration: 180 },
  { category: "电影", kind: "fun", re: /电影/, keywords: ["电影院"], duration: 150 },
  { category: "羽毛球", kind: "sport", re: /羽毛球|打球/, keywords: ["羽毛球馆"], duration: 120 },
  { category: "篮球", kind: "sport", re: /篮球/, keywords: ["篮球场"], duration: 120 },
  { category: "足球", kind: "sport", re: /足球|踢球/, keywords: ["足球场"], duration: 120 },
  { category: "网球", kind: "sport", re: /网球/, keywords: ["网球场"], duration: 120 },
  { category: "乒乓球", kind: "sport", re: /乒乓/, keywords: ["乒乓球馆"], duration: 120 },
  { category: "台球", kind: "sport", re: /台球|桌球|斯诺克/, keywords: ["台球"], duration: 120 },
  { category: "保龄球", kind: "sport", re: /保龄球/, keywords: ["保龄球馆"], duration: 120 },
  { category: "游泳", kind: "sport", re: /游泳/, keywords: ["游泳馆"], duration: 120 },
  { category: "攀岩", kind: "sport", re: /攀岩/, keywords: ["攀岩馆"], duration: 120 },
  { category: "健身", kind: "sport", re: /健身|撸铁/, keywords: ["健身房"], duration: 120 },
  { category: "飞盘", kind: "sport", re: /飞盘/, keywords: ["飞盘"], duration: 120 },
  { category: "爬山", kind: "outdoor", re: /爬山|徒步|登山/, keywords: ["爬山"], duration: 240 },
  { category: "露营", kind: "outdoor", re: /露营|野餐/, keywords: ["露营"], duration: 240 },
  { category: "咖啡", kind: "drink", re: /咖啡|coffee|下午茶/i, keywords: ["咖啡"], duration: 90 },
  { category: "奶茶", kind: "drink", re: /奶茶/, keywords: ["奶茶"], duration: 60 },
  { category: "酒吧", kind: "drink", re: /酒吧|小酒馆|喝酒|喝一杯|精酿|清吧/, keywords: ["酒吧"], duration: 150 },
  { category: "聚餐", kind: "food", re: /吃饭|聚餐|约饭|干饭|饭局|吃顿|吃点|晚饭|午饭|夜宵|宵夜/, keywords: ["餐厅"], duration: 120 },
];

const VERB_RE = /(?:吃|玩|打|去|喝|看|唱|搓|撸|踢|做|逛|搞)([一-龥A-Za-z]{2,4})/;
const FILLER = [
  "一起", "我们", "大家", "咱们", "约个", "约一下", "组个", "组局", "局", "一下", "个人", "吧", "呗", "啊",
];

function detectCategory(text: string): { def: CategoryDef | undefined; raw?: string } {
  for (const def of CATEGORIES) if (def.re.test(text)) return { def };
  const m = text.match(VERB_RE);
  if (m) {
    let raw = m[1];
    for (const f of FILLER) raw = raw.replace(f, "");
    raw = raw.replace(/[人均元块个位点]+.*$/, "");
    if (raw.length >= 2) return { def: undefined, raw };
  }
  return { def: undefined };
}

// ---------------------------------------------------------------- 城市

const CITIES = [
  "北京", "上海", "广州", "深圳", "杭州", "苏州", "南京", "成都", "重庆", "武汉", "西安", "天津", "长沙",
  "厦门", "青岛", "宁波", "无锡", "郑州", "合肥", "昆明", "大连", "福州", "济南", "东莞", "佛山", "珠海",
  "常州", "南通", "哈尔滨", "沈阳", "长春", "南昌", "贵阳", "南宁", "太原", "石家庄", "兰州", "海口", "三亚",
  "香港", "澳门", "台北", "温州", "嘉兴", "绍兴", "扬州", "徐州", "烟台", "泉州", "惠州", "中山",
];

function detectCity(text: string): string | undefined {
  let best: { city: string; idx: number } | undefined;
  for (const c of CITIES) {
    const idx = text.indexOf(c);
    if (idx >= 0 && (!best || idx < best.idx)) best = { city: c, idx };
  }
  return best?.city;
}

// ---------------------------------------------------------------- 人数 / 预算

const NUM = NUM_RE_SRC;

function detectBudget(text: string, headcount?: number): number | undefined {
  const pats: RegExp[] = [
    new RegExp(
      `(?:人均|每人|每个人|一人|一个人|人头)\\s*(?:预算)?\\s*(?:大概|大约|约|差不多|控制在|不超过|不要超过|别超过|最多|在|是|:|：)?\\s*(${NUM})\\s*(?:元|块|rmb)?`,
      "i",
    ),
    new RegExp(`(${NUM})\\s*(?:元|块)?\\s*(?:左右|以内|以下)?\\s*(?:一个人|一人|每人|\\/人|一位|人均)`),
  ];
  for (const re of pats) {
    const m = text.match(re);
    if (m) {
      const v = parseCnNumber(m[1]);
      if (v && v >= 5 && v <= 5000) return Math.round(v);
    }
  }
  const total = text.match(new RegExp(`(?:预算|总共|一共)\\s*(?:大概|大约|约|在)?\\s*(${NUM})\\s*(?:元|块)?`));
  if (total) {
    const v = parseCnNumber(total[1]);
    if (v && v >= 5) {
      if (headcount && v > 300) return Math.round(v / headcount);
      if (v <= 1000) return Math.round(v);
    }
  }
  return undefined;
}

function detectHeadcount(text: string): number | undefined {
  // 先去掉预算片段，避免“人均100一个人”被当成 1 人
  const re = new RegExp(
    `(${NUM})\\s*(?:个人|个朋友|个小伙伴|个同事|个兄弟|个姐妹|位|人|个)(?!均)`,
    "g",
  );
  let best: number | undefined;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index! - 3), m.index!);
    if (/人均|每人|一人/.test(before)) continue;
    // “三四个人” → 取大的
    const raw = m[1];
    let v: number | undefined;
    if (/^[二两三四五六七八九][三四五六七八九十]$/.test(raw)) v = parseCnNumber(raw[1]);
    else v = parseCnNumber(raw);
    if (v && v >= 2 && v <= 100 && Number.isInteger(v)) {
      best = v;
      break;
    }
  }
  return best;
}

// ---------------------------------------------------------------- 日期

const DOW_CH: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, 七: 7 };

type DateHit = { dates: string[]; label: string };

function upcoming(now: ShNow, isoDow: number): string {
  let delta = (isoDow - now.isoDow + 7) % 7;
  if (delta === 0 && now.hour >= 21) delta = 7;
  return addDays(now.ymd, delta);
}

function thisWeek(now: ShNow, isoDow: number): string {
  const delta = isoDow - now.isoDow;
  return addDays(now.ymd, delta >= 0 ? delta : delta + 7);
}

function nextWeek(now: ShNow, isoDow: number, weeks = 1): string {
  return addDays(now.ymd, 7 * weeks - now.isoDow + isoDow);
}

export function detectDates(text: string, now: ShNow): DateHit | undefined {
  const dates: string[] = [];
  const labels: string[] = [];
  const add = (d: string, label: string) => {
    if (!dates.includes(d)) dates.push(d);
    if (!labels.includes(label)) labels.push(label);
  };

  // 周几范围：周五到周日
  const range = text.match(/(下下|下|这|本)?(?:周|星期|礼拜)([一二三四五六日天七])\s*(?:到|至|-|~|—)\s*(?:周|星期|礼拜)?([一二三四五六日天七])/);
  if (range) {
    const a = DOW_CH[range[2]];
    const b = DOW_CH[range[3]];
    const pre = range[1];
    for (let x = a; x <= b; x++) {
      const d = pre === "下" ? nextWeek(now, x) : pre === "下下" ? nextWeek(now, x, 2) : pre ? thisWeek(now, x) : upcoming(now, x);
      add(d, "");
    }
    labels.length = 0;
    labels.push(`${dowLabel(a)}到${dowLabel(b)}`);
  }

  // 周末
  for (const m of text.matchAll(/(下下|下个?|这个?|本)?周末/g)) {
    const pre = (m[1] ?? "").replace(/个/, "");
    if (pre.startsWith("下")) {
      const w = pre === "下下" ? 2 : 1;
      add(nextWeek(now, 6, w), "");
      add(nextWeek(now, 7, w), "");
      labels.push(pre === "下下" ? "下下周末" : "下周末");
    } else {
      if (now.isoDow <= 6) add(thisWeek(now, 6), "");
      add(thisWeek(now, 7), "");
      labels.push("周末");
    }
  }

  // 单个周几（排除已在范围里处理的）
  if (!range) {
    for (const m of text.matchAll(/(下下|下个?|这个?|本)?(?:周|星期|礼拜)([一二三四五六日天七])/g)) {
      const pre = (m[1] ?? "").replace(/个/, "");
      const x = DOW_CH[m[2]];
      if (pre === "下下") add(nextWeek(now, x, 2), `下下${dowLabel(x)}`);
      else if (pre === "下") add(nextWeek(now, x), `下${dowLabel(x)}`);
      else if (pre) add(thisWeek(now, x), dowLabel(x));
      else add(upcoming(now, x), dowLabel(x));
    }
  }

  // 相对日
  const rel: [RegExp, number, string][] = [
    [/大后天/, 3, "大后天"],
    [/(?<!大)后天/, 2, "后天"],
    [/明天|明晚|明儿|明日|明早|明中午|明天晚上/, 1, "明天"],
    [/今天|今晚|今儿|今日|今早|今中午|tonight/i, 0, "今天"],
  ];
  for (const [re, n, label] of rel) {
    if (re.test(text)) {
      let l = label;
      if (n === 0 && /今晚|今天晚上/.test(text)) l = "今晚";
      if (n === 1 && /明晚|明天晚上/.test(text)) l = "明晚";
      add(addDays(now.ymd, n), l);
    }
  }

  // X月X日 / X号
  for (const m of text.matchAll(new RegExp(`(?:(${NUM})\\s*月)?\\s*(?<![周期拜])(${NUM})\\s*(?:日(?![料本式语常韩])|号)`, "g"))) {
    const [y] = now.ymd.split("-").map(Number);
    const curM = Number(now.ymd.slice(5, 7));
    const day = parseCnNumber(m[2]);
    const month = m[1] ? parseCnNumber(m[1]) : undefined;
    if (!day || day > 31) continue;
    let mm = month ?? curM;
    let yy = y;
    const mk = () => `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let d = mk();
    if (!isValidYmd(d)) continue;
    if (d < now.ymd) {
      if (month) yy += 1;
      else {
        mm += 1;
        if (mm > 12) {
          mm = 1;
          yy += 1;
        }
      }
      d = mk();
      if (!isValidYmd(d)) continue;
    }
    add(d, `${mm}.${day}`);
  }

  // 下周 / 这周 / 这几天
  if (dates.length === 0) {
    if (/下周|下星期|下礼拜/.test(text)) {
      for (let x = 1; x <= 7; x++) add(nextWeek(now, x), "");
      labels.length = 0;
      labels.push("下周");
    } else if (/这周|本周|这星期|这礼拜|这几天|最近|近期/.test(text)) {
      for (let i = now.hour >= 20 ? 1 : 0; i < 4; i++) add(addDays(now.ymd, i), "");
      labels.length = 0;
    }
  }

  if (dates.length === 0) return undefined;
  dates.sort();
  return { dates: dates.filter((d) => d >= now.ymd), label: labels.filter(Boolean)[0] ?? "" };
}

// ---------------------------------------------------------------- 时间窗

type Window = { earliest: string; latest: string; period?: "morning" | "noon" | "afternoon" | "evening" | "night" };

function hourWithPeriod(h: number, period: string | undefined, kind: Kind | undefined): number {
  if (h >= 12) return h;
  if (period && /晚|夜|下午|傍晚/.test(period)) return h + 12;
  if (period && /中午/.test(period)) return h <= 3 ? h + 12 : h;
  if (period && /上午|早/.test(period)) return h;
  if (h <= 6) return h + 12;
  if (h <= 10 && (kind === "food" || kind === "fun" || kind === "drink" || kind === undefined)) return h + 12;
  return h;
}

export function detectWindow(text: string, kind: Kind | undefined): Window | undefined {
  const periodRe = "(凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|今晚|明晚|晚|夜里)?";
  const timeRe = `(${NUM})\\s*(?:点|:|：|时)\\s*(半|一刻|(\\d{1,2}))?`;

  // 7点到9点
  const rng = text.match(new RegExp(`${periodRe}\\s*${timeRe}\\s*(?:到|至|-|~|—)\\s*${timeRe}`));
  if (rng) {
    const p = rng[1];
    const h1 = parseCnNumber(rng[2]);
    const h2 = parseCnNumber(rng[5]);
    if (h1 !== undefined && h2 !== undefined) {
      const a = hourWithPeriod(h1, p, kind) * 60 + minPart(rng[3], rng[4]);
      let b = hourWithPeriod(h2, p, kind) * 60 + minPart(rng[6], rng[7]);
      if (b <= a) b += 12 * 60;
      return { earliest: fromMinutes(a), latest: fromMinutes(Math.max(a, b - 60)) };
    }
  }

  // 6点以后
  const after = text.match(new RegExp(`${periodRe}\\s*${timeRe}\\s*(?:以后|之后|后)`));
  if (after) {
    const h = parseCnNumber(after[2]);
    if (h !== undefined) {
      const a = hourWithPeriod(h, after[1], kind) * 60 + minPart(after[3], after[4]);
      return { earliest: fromMinutes(a), latest: fromMinutes(a + 120) };
    }
  }

  // 晚上8点 / 19:30
  const at = text.match(new RegExp(`${periodRe}\\s*${timeRe}`));
  if (at) {
    const h = parseCnNumber(at[2]);
    if (h !== undefined && h <= 24) {
      const t = hourWithPeriod(h, at[1], kind) * 60 + minPart(at[3], at[4]);
      return { earliest: fromMinutes(t - 30), latest: fromMinutes(t + 30) };
    }
  }

  if (/夜宵|宵夜/.test(text)) return { earliest: "21:30", latest: "22:30", period: "night" };
  if (/早茶|早午饭|brunch/i.test(text)) return { earliest: "10:00", latest: "11:30", period: "morning" };
  if (/中午|午饭|午餐|今中午|明中午/.test(text)) return { earliest: "11:30", latest: "12:30", period: "noon" };
  if (/下午|下午茶/.test(text)) return { earliest: "14:00", latest: "16:00", period: "afternoon" };
  if (/上午|早上|早晨|今早|明早/.test(text)) return { earliest: "09:00", latest: "10:30", period: "morning" };
  if (/晚饭|晚餐|晚上|今晚|明晚|下班|傍晚|晚/.test(text)) {
    return kind === "food" || kind === undefined
      ? { earliest: "18:00", latest: "20:00", period: "evening" }
      : { earliest: "19:00", latest: "20:30", period: "evening" };
  }
  return undefined;
}

function minPart(half?: string, explicit?: string): number {
  if (explicit) return Math.min(59, Number(explicit));
  if (half === "半") return 30;
  if (half === "一刻") return 15;
  return 0;
}

function defaultWindow(kind: Kind | undefined, dates: string[], category = ""): Window {
  const allWeekend = dates.length > 0 && dates.every((d) => isoDowOf(d) >= 6);
  switch (kind) {
    case "sport":
      return allWeekend ? { earliest: "14:00", latest: "16:00" } : { earliest: "19:00", latest: "20:30" };
    case "outdoor":
      return { earliest: "09:00", latest: "10:30" };
    case "drink":
      return category === "酒吧" ? { earliest: "20:00", latest: "21:30" } : { earliest: "14:00", latest: "16:00" };
    case "fun":
      return allWeekend ? { earliest: "14:00", latest: "19:00" } : { earliest: "19:00", latest: "20:30" };
    default:
      return { earliest: "18:00", latest: "20:00" };
  }
}

// ---------------------------------------------------------------- v6 活动层：干什么交给局长 / 给一个候选池

/** "大家聚一下 / 你定 / 玩点什么"：发起人没定干什么。"随便 / 都行"太常见（"口味随便"），不算 */
const OPEN_RE =
  /聚一下|聚一聚|聚聚|聚会|你定|你来定|局长定|局长来定|随便玩|玩点什么|玩点啥|玩什么|干点什么|干点啥|干什么|干啥|做点什么|搞点什么|整点什么|整点啥|出来玩|出去玩|见个面|碰个面|去哪玩|不知道(?:干|玩|去)/;
const EAT_RE = /吃|饭|餐/;

/** 发起解析的活动部分：说了 ≥ 2 种活动 = 候选池；没说干什么但说了"聚一下 / 你定" = 交给局长定（只说了吃 = 吃什么交给局长） */
export function detectActivities(text: string): { open?: true; activities?: string[] } {
  const acts = activitiesIn(text);
  if (acts.length >= 2) return { activities: acts.slice(0, 6) };
  if (acts.length === 0 && OPEN_RE.test(text)) {
    if (EAT_RE.test(text)) return { open: true, activities: ACTIVITY_LIB.filter((a) => a.food).map((a) => a.key) };
    return { open: true };
  }
  return {};
}

// ---------------------------------------------------------------- 主入口

const NOTE_RE = /(包间|安静|能停车|好停车|露天|带娃|带孩子|能喝酒|有投影|看球|生日)/g;

export function ruleParsePrompt(prompt: string, now: Date, defaultCity: string): { title: string; spec: JuSpec } {
  const text = (prompt ?? "").trim();
  const sh = shanghaiNow(now);
  const { def, raw } = detectCategory(text);
  // v6：没定干什么（交给局长）只在没认出具体品类时成立（"周六打篮球，大家聚一下" 仍是篮球局）
  const v6 = detectActivities(text);
  const open = v6.open && (!def || def.category === "聚餐");
  const pool = v6.activities && (open || !v6.open) ? v6.activities : undefined;
  const kind: Kind | undefined = open && !pool ? "fun" : (def?.kind ?? (raw ? undefined : "food"));

  let category = def?.category ?? raw ?? "聚餐";
  let poiKeywords = def ? [...def.keywords] : raw ? [raw] : ["餐厅"];
  let durationMinutes = def?.duration ?? 120;
  if (open) {
    category = "局长定";
    poiKeywords = pool ? [...new Set(pool.map((k) => activityByKey(k)!.poiKeywords[0]))].slice(0, 3) : ["餐厅"];
    durationMinutes = pool ? 120 : 180;
  } else if (pool) {
    const names = pool.map((k) => activityByKey(k)!.name);
    category = Array.from(names.join("/")).slice(0, 20).join("");
    poiKeywords = [...new Set(pool.map((k) => activityByKey(k)!.poiKeywords[0]))].slice(0, 3);
    durationMinutes = Math.max(...pool.map((k) => activityByKey(k)!.minutes));
  }

  const headcount = detectHeadcount(text);
  const budgetPerPerson = detectBudget(text, headcount);
  const city = detectCity(text) ?? defaultCity;

  let win = detectWindow(text, kind);
  const dateHit = detectDates(text, sh);
  let dates = dateHit?.dates ?? [];
  let dateLabel = dateHit?.label ?? "";

  if (dates.length === 0) {
    // 没说哪天：从今天（时间还来得及的话）起连续 3 天
    const w = win ?? defaultWindow(kind, [], category);
    const start = sh.hour * 60 + sh.minute + 60 <= toMinutes(w.latest) ? 0 : 1;
    dates = [0, 1, 2].map((i) => addDays(sh.ymd, start + i));
    dateLabel = start === 0 && w.period === "evening" ? "今晚" : "";
  }
  if (!win) win = defaultWindow(kind, dates, category);
  if (dateLabel === "今天" && win.period === "evening") dateLabel = "今晚";
  if (dateLabel === "明天" && win.period === "evening") dateLabel = "明晚";

  const notes = Array.from(new Set(Array.from(text.matchAll(NOTE_RE)).map((m) => m[1])));

  const spec: JuSpec = {
    category,
    poiKeywords,
    ...(headcount ? { headcount } : {}),
    ...(budgetPerPerson ? { budgetPerPerson } : {}),
    dates,
    earliest: win.earliest,
    latest: win.latest,
    durationMinutes,
    city,
    ...(notes.length ? { notes: notes.join("、") } : {}),
    ...(open ? { open: true } : {}),
    ...(pool ? { activities: pool } : {}),
  };
  return { title: activityTitle(dateLabel, spec, headcount) ?? makeTitle(dateLabel, category, headcount), spec };
}

/** v6 局名："周六聚一聚" / "周六吃什么局" / "周六桌游或火锅局"（太长就叫"周六组局"）；v5 单品类返回 undefined */
export function activityTitle(dateLabel: string, spec: Pick<JuSpec, "open" | "activities">, headcount?: number): string | undefined {
  const suffix = headcount && headcount >= 10 ? "大局" : "局";
  const pool = (spec.activities ?? []).map((k) => activityByKey(k)?.name).filter((x): x is string => !!x);
  if (spec.open) return pool.length && pool.length === ACTIVITY_LIB.filter((a) => a.food).length ? `${dateLabel}吃什么${suffix}` : `${dateLabel}聚一聚`;
  if (pool.length < 2) return undefined;
  const joined = pool.join("或");
  return Array.from(joined).length <= 6 ? `${dateLabel}${joined}${suffix}` : `${dateLabel}组${suffix}`;
}

/** “周五火锅局” / “明晚烧烤局” / “周末羽毛球局” */
export function makeTitle(dateLabel: string, category: string, headcount?: number): string {
  const cat = Array.from(category).slice(0, 5).join("");
  const suffix = headcount && headcount >= 10 ? "大局" : "局";
  return `${dateLabel}${cat}${suffix}`;
}

/** 客户端直接传了 spec 但没传 title 时，用 spec 拼一个 */
export function titleFromSpec(spec: JuSpec, now: Date): string {
  const sh = shanghaiNow(now);
  let label = "";
  const d = spec.dates[0];
  if (d) {
    const evening = toMinutes(spec.earliest) >= 17 * 60;
    if (spec.dates.length === 2 && spec.dates.every((x) => isoDowOf(x) >= 6)) label = "周末";
    else if (d === sh.ymd) label = evening ? "今晚" : "今天";
    else if (d === addDays(sh.ymd, 1)) label = evening ? "明晚" : "明天";
    else label = dowLabel(isoDowOf(d));
  }
  return activityTitle(label, spec, spec.headcount) ?? makeTitle(label, spec.category, spec.headcount);
}

// ---------------------------------------------------------------- 忌口

const DIET_ORDER: DietTag[] = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"];

export function ruleParseDiet(raw: string): DietTag[] {
  let t = (raw ?? "").toLowerCase().replace(/\s+/g, "");
  if (!t) return [];
  // 先抹掉“能吃辣”这类正向说法，避免误判
  t = t.replace(/不怕辣|(?<![不没])(?:能|爱|可以)吃辣|无辣不欢|嗜辣/g, "");
  const tags = new Set<DietTag>();
  if (/(不|别|没法|无法|不能|吃不了|受不了|怕|忌|免)[^，,。；;]{0,3}辣|清淡|微辣都不行|一点辣都|辣过敏/.test(t)) tags.add("不吃辣");
  if (/素食|吃素|素食者|全素|蛋奶素|vegetarian|vegan|不吃肉|不吃荤/.test(t)) tags.add("素食");
  if (/清真|回民|回族|穆斯林|halal|muslim|不吃猪/.test(t)) tags.add("清真");
  if (/(不|别|不能|忌)吃?牛|牛肉过敏/.test(t)) tags.add("不吃牛肉");
  if (/海鲜|鱼虾|(不|别|不能|忌)吃?(虾|蟹|鱼|贝|生蚝)|(虾|蟹|贝类|鱼)过敏/.test(t) && !/爱吃海鲜|喜欢海鲜/.test(t)) {
    tags.add("不吃海鲜");
  }
  if (/内脏|下水|(不|别|不能|忌)吃?(毛肚|肥肠|鸭肠|脑花|猪肝|腰子|黄喉|鸭血|百叶)/.test(t)) tags.add("不吃内脏");
  return DIET_ORDER.filter((x) => tags.has(x));
}

// ---------------------------------------------------------------- 推荐语模板

export const BLURB_MAX = 36;

export function charLen(s: string): number {
  return Array.from(s).length;
}

export function fit(parts: string[], max = BLURB_MAX): string {
  let out = "";
  for (const p of parts) {
    if (!p) continue;
    const next = out ? `${out}，${p}` : p;
    if (charLen(next) > max) break;
    out = next;
  }
  return out || Array.from(parts.find(Boolean) ?? "").slice(0, max).join("");
}

/** 按最长通勤分档：≤15 才说“近”，16–25 说“不算远”，>25 不提“近” */
export function commuteHead(maxMinutes: number): string | undefined {
  const m = Math.round(maxMinutes);
  if (m <= 15) return "离大家都近";
  if (m <= 25) return "大家都不算远";
  return undefined;
}

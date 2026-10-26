// v5 外部因素（docs/DECISION.md 第 6 节）：营业时间、室内 / 户外、天气。
// 它们是所有人共享的公开事实，不涉及隐私，但会让"算出来很完美"的方案在现场翻车。
// 四种作用方式：硬过滤（方案不成立）/ 软扣分 / 风险 + 备案 / 提醒。全部确定性规则。
import type { Poi, Risk, Slot, WeatherDay, WeatherHalf } from "../types";
import { poiIndoor } from "./needs";
import { slotTimes } from "./experience";
import { bjParts, hmToMin, minToHm, weekdayOf } from "./util";

/** 打烊前至少留多少分钟（结账、收拾） */
export const CLOSING_MARGIN_MIN = 15;
/** 结束晚于这个时刻提醒夜归 */
export const LATE_NIGHT_MIN = 22 * 60 + 30;

// ---------------------------------------------------------------- 营业时间

/** "11:00-21:30" / "17:00-04:00" / "10:00-14:00 17:00-22:00" → 营业段（当天分钟，跨午夜的 close > 1440） */
export function parseOpenTime(s: string | undefined): { open: number; close: number }[] | undefined {
  if (!s) return undefined;
  const segs: { open: number; close: number }[] = [];
  for (const m of s.matchAll(/(\d{1,2}:\d{2})\s*[-–~至]\s*(\d{1,2}:\d{2})/g)) {
    const open = hmToMin(m[1]);
    let close = hmToMin(m[2]);
    if (open === undefined || close === undefined) continue;
    if (close <= open) close += 1440;
    segs.push({ open, close });
  }
  return segs.length ? segs : undefined;
}

export type OpenFit = { fit: "yes" | "no" | "unknown"; closeAt?: string; closeMin?: number };

/** 活动 [start, end] 能不能放进某一个营业段（结束要留 15 分钟余量） */
export function openFits(openTime: string | undefined, start: number, end: number): OpenFit {
  const segs = parseOpenTime(openTime);
  if (!segs) return { fit: "unknown" };
  // 同一天的营业段，或者前一天跨过午夜的营业段
  const candidates = segs.flatMap((s) => [s, { open: s.open - 1440, close: s.close - 1440 }]);
  const seg = candidates.find((s) => s.open <= start && end + CLOSING_MARGIN_MIN <= s.close);
  if (seg) return { fit: "yes", closeAt: minToHm(seg.close), closeMin: seg.close };
  const near = candidates.find((s) => s.open <= start && start < s.close);
  return { fit: "no", ...(near ? { closeAt: minToHm(near.close), closeMin: near.close } : {}) };
}

// ---------------------------------------------------------------- 天气

export type WeatherKind = "ok" | "light" | "heavy" | "unknown";

/** 天气现象 → 档位：中雨以上 / 雷阵雨 / 雪 / 冰雹 = heavy；小雨 / 阵雨 = light */
export function classifyWeather(text: string): Exclude<WeatherKind, "unknown"> {
  if (/雷|暴|大雨|中雨|雪|冰雹|台风|沙尘/.test(text)) return "heavy";
  if (/雨/.test(text)) return "light";
  return "ok";
}

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

export type SlotWeather = {
  kind: WeatherKind;
  /** "周五夜间" */
  label: string;
  half?: WeatherHalf;
};

/** 这个时间段对应哪一条预报：18:00 前看白天，之后看夜间；4 天外没有预报 = unknown */
export function slotWeather(forecast: WeatherDay[], slot: Slot): SlotWeather {
  const { date, start } = slotTimes(slot);
  const night = start >= 18 * 60;
  const label = `周${WEEK[weekdayOf(date) - 1]}${night ? "夜间" : "白天"}`;
  const day = forecast.find((d) => d.date === date);
  if (!day) return { kind: "unknown", label };
  const half = night ? day.night : day.day;
  return { kind: classifyWeather(half.text), label, half };
}

function windy(power: string | undefined): boolean {
  const n = Number(/(\d+)/.exec(power ?? "")?.[1] ?? 0);
  return n >= 6 || /≥\s*6/.test(power ?? "");
}

export type Effects = {
  /** 方案不成立（户外 + 中雨以上 / 打烊前来不及） */
  infeasible: boolean;
  reason?: string;
  /** 通勤时间倍数（下雨路上慢） */
  commuteFactor: number;
  /** 所有人一起扣的满意度（户外 + 小雨 / 高温 / 严寒 / 大风） */
  penalty: number;
  /** 给本人的说明（公开事实，可以给任何人看） */
  note?: string;
};

/** 天气 × 室内 / 户外 → 作用（docs/DECISION.md 6.3 的表） */
export function weatherEffects(wx: SlotWeather, poi: Pick<Poi, "name" | "type" | "indoor">): Effects {
  const outdoor = poiIndoor(poi) === false;
  const eff: Effects = { infeasible: false, commuteFactor: 1, penalty: 0 };
  if (wx.kind === "light") eff.commuteFactor = 1.15;
  if (wx.kind === "heavy") eff.commuteFactor = 1.25;
  if (!outdoor || !wx.half) return eff;
  if (wx.kind === "heavy") return { ...eff, infeasible: true, reason: `${wx.label}预报${wx.half.text}，户外不成立` };
  if (wx.kind === "light") {
    eff.penalty += 12;
    eff.note = `${wx.label}预报${wx.half.text}，这家在户外`;
  }
  if (wx.half.temp >= 33) {
    eff.penalty += 10;
    eff.note = `${wx.label}预计 ${wx.half.temp}℃，这家在户外`;
  } else if (wx.half.temp <= 5) {
    eff.penalty += 10;
    eff.note = `${wx.label}预计 ${wx.half.temp}℃，这家在户外`;
  }
  if (windy(wx.half.windPower)) eff.penalty += 6;
  return eff;
}

// ---------------------------------------------------------------- 风险（公开安全）

/** 一个候选方案的现场风险，每条都带应对办法 */
export function risksFor(slot: Slot, poi: Pick<Poi, "name" | "type" | "indoor" | "openTime" | "rating">, wx: SlotWeather, open: OpenFit, queueMin: number): Risk[] {
  const out: Risk[] = [];
  const outdoor = poiIndoor(poi) === false;
  const { end } = slotTimes(slot);
  if (wx.kind === "unknown") {
    if (outdoor) out.push({ kind: "weather", level: "mid", text: `${wx.label}还没有天气预报（只能看 4 天内）`, mitigation: "已准备室内备案；前一天局长再确认天气", confidence: "unknown" });
  } else if (wx.half && wx.kind !== "ok") {
    out.push({
      kind: "weather",
      level: wx.kind === "heavy" ? "high" : outdoor ? "mid" : "low",
      text: `${wx.label}预报${wx.half.text}`,
      mitigation: outdoor ? "带伞；已准备室内备案，出发前 3 小时局长再确认" : "带伞；这家在室内，不受影响",
      confidence: "known",
    });
  } else if (wx.half && outdoor && (wx.half.temp >= 33 || wx.half.temp <= 5)) {
    out.push({ kind: "weather", level: "mid", text: `${wx.label}预计 ${wx.half.temp}℃`, mitigation: wx.half.temp >= 33 ? "这家在户外，注意防暑" : "这家在户外，多穿点", confidence: "known" });
  }
  if (open.fit === "unknown") {
    out.push({ kind: "closing", level: "low", text: "营业时间未知", mitigation: "出发前打电话确认一下", confidence: "unknown" });
  } else if (open.fit === "yes" && open.closeMin !== undefined && open.closeMin - end <= 45) {
    out.push({ kind: "closing", level: "low", text: `店 ${open.closeAt} 打烊，我们 ${minToHm(end)} 结束`, mitigation: "别太晚点单", confidence: "known" });
  }
  if (queueMin > 0) out.push({ kind: "queue", level: "low", text: `饭点可能要排队约 ${queueMin} 分钟`, mitigation: "先到的人先取号", confidence: "estimated" });
  if (end > LATE_NIGHT_MIN) out.push({ kind: "lateNight", level: "low", text: `${minToHm(end)} 才结束`, mitigation: "回去的朋友结伴或打车，到家在群里报个平安", confidence: "known" });
  return out;
}

/** 方案开始的北京日期（给天气复查等用） */
export function slotDate(slot: Slot): string {
  return bjParts(slot.start).date;
}


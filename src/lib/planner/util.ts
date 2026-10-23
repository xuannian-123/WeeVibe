// 确定性小工具：北京时间换算、规范化 JSON、哈希。全部不依赖机器时区、不用 Math.random。
import { createHash, createHmac } from "node:crypto";
import type { Poi } from "../types";

export const pad2 = (n: number) => String(n).padStart(2, "0");

/** "HH:mm" -> 分钟；非法返回 undefined。允许 "24:00" 和全角冒号 */
export function hmToMin(s: string | undefined): number | undefined {
  const m = /^(\d{1,2})[:：](\d{2})$/.exec((s ?? "").trim());
  if (!m) return undefined;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return undefined;
  return h * 60 + mi;
}

/** 分钟 -> "HH:mm"（自动对 24 小时取模，跨午夜显示次日时刻） */
export function minToHm(min: number): string {
  const x = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(x / 60))}:${pad2(x % 60)}`;
}

/** ISO 时刻 -> 北京时间 { date: "YYYY-MM-DD", min: 当天分钟 } */
export function bjParts(iso: string | Date): { date: string; min: number } {
  const t = (typeof iso === "string" ? new Date(iso) : iso).getTime() + 8 * 3600_000;
  const d = new Date(t);
  return {
    date: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** 北京时间 date + 分钟（可超过 1440）-> ISO（+08:00） */
export function bjIso(date: string, min: number): string {
  const [y, mo, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d, 0, Math.round(min)));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}T${pad2(t.getUTCHours())}:${pad2(
    t.getUTCMinutes(),
  )}:00+08:00`;
}

/** YYYY-MM-DD 是星期几：1 = 周一 … 7 = 周日 */
export function weekdayOf(date: string): number {
  const [y, mo, d] = date.split("-").map(Number);
  const w = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];
/** "周五 18:30" */
export function slotLabel(slotStart: string): string {
  const { date, min } = bjParts(slotStart);
  return `周${WEEK[weekdayOf(date) - 1]} ${minToHm(min)}`;
}

export function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** 去掉括号里的分店名，用于同名连锁去重 */
export function chainName(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim();
}

/** 是不是吃饭的地方（决定饭点排队、忌口是否适用） */
export function isFoodPoi(poi: Pick<Poi, "type" | "name">): boolean {
  return /餐饮|餐厅|火锅|烧烤|烤肉|小吃|美食/.test(`${poi.type} ${poi.name}`);
}

/**
 * 规范化 JSON（审计用）：对象键按字典序、去掉 undefined、非有限数变 null、Date 变 ISO。
 * 同一个值不管键的插入顺序如何，输出逐字节相同。
 */
export function canonicalJson(x: unknown): string {
  return JSON.stringify(normalize(x)) ?? "null";
}

function normalize(x: unknown): unknown {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" || typeof x === "boolean") return x;
  if (typeof x === "bigint") return x.toString();
  if (x instanceof Date) return x.toISOString();
  if (Array.isArray(x)) return x.map((v) => (v === undefined || typeof v === "function" ? null : normalize(v)));
  if (typeof x === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(x as object).sort(cmpStr)) {
      const v = (x as Record<string, unknown>)[k];
      if (v === undefined || typeof v === "function") continue;
      out[k] = normalize(v);
    }
    return out;
  }
  return null;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hmacHex(secret: string, s: string): string {
  return createHmac("sha256", secret).update(s, "utf8").digest("hex");
}

/** 按权重把 cents 分到各份，最大余数法，平局按下标，和严格等于 cents（可为负） */
export function apportion(cents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((s, w) => s + Math.max(0, w), 0);
  const ws = sumW > 0 ? weights.map((w) => Math.max(0, w)) : weights.map(() => 1);
  const total = sumW > 0 ? sumW : n;
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(Math.round(cents));
  const raw = ws.map((w) => (abs * w) / total);
  const base = raw.map((r) => Math.floor(r + 1e-9));
  let left = abs - base.reduce((s, b) => s + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - base[i], w: ws[i] }))
    .filter((o) => o.w > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) base[order[k].i]++;
  return base.map((b) => sign * b);
}

// 纯几何 / 确定性工具：距离、坐标系转换、种子随机数、通勤估算。
import type { LatLng } from "../types";

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d: number) => (d * Math.PI) / 180;

/** 球面大圆距离（公里） */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------- WGS-84 -> GCJ-02（国测局加偏，高德使用） ----------
const GCJ_A = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function outOfChina(p: LatLng): boolean {
  return p.lng < 72.004 || p.lng > 137.8347 || p.lat < 0.8293 || p.lat > 55.8271;
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

/** 浏览器定位（WGS-84）转高德坐标（GCJ-02）。境外坐标原样返回。 */
export function wgs84ToGcj02(p: LatLng): LatLng {
  if (outOfChina(p)) return { lat: p.lat, lng: p.lng };
  let dLat = transformLat(p.lng - 105.0, p.lat - 35.0);
  let dLng = transformLng(p.lng - 105.0, p.lat - 35.0);
  const radLat = toRad(p.lat);
  let magic = Math.sin(radLat);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

// ---------- 演示中心 ----------
export const DEFAULT_DEMO_CENTER: LatLng = { lat: 31.27, lng: 120.735 };

/** 读取 process.env.DEMO_CENTER（"lat,lng"），非法或缺省时用苏州独墅湖。每次调用时读取，便于测试。 */
export function getDemoCenter(): LatLng {
  const raw = (typeof process !== "undefined" && process.env?.DEMO_CENTER) || "";
  const parts = raw.split(/[,，\s]+/).filter(Boolean).map(Number);
  if (
    parts.length === 2 &&
    parts.every(Number.isFinite) &&
    Math.abs(parts[0]) <= 90 &&
    Math.abs(parts[1]) <= 180
  ) {
    return { lat: parts[0], lng: parts[1] };
  }
  return { ...DEFAULT_DEMO_CENTER };
}

// ---------- 通勤估算（mock 与兜底共用） ----------
export const DETOUR_FACTOR = 1.35;
export const TAXI_SPEED_KMH = 25;
export const PICKUP_MINUTES = 6;

/** 直线距离 × 1.35 绕路系数，按 25km/h 打车，再加 6 分钟上下车 */
export function estimateCommute(origin: LatLng, dest: LatLng): { minutes: number; distanceKm: number } {
  const roadKm = haversineKm(origin, dest) * DETOUR_FACTOR;
  return {
    minutes: Math.round((roadKm / TAXI_SPEED_KMH) * 60 + PICKUP_MINUTES),
    distanceKm: round1(roadKm),
  };
}

// ---------- 确定性随机 ----------
/** FNV-1a 32 位字符串哈希 */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：给定种子，输出 [0,1) 的确定性序列 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

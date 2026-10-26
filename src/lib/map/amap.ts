// 高德 Web 服务 API（v3）实现。参数名按 https://lbs.amap.com/api/webservice 文档。
// - 每次请求 5 秒超时
// - 同一 URL 成功结果在内存缓存 10 分钟（Demo 时反复刷新不打高德）
// - 并发上限 3，遇到 QPS 超限自动重试一次
// 注意：高德返回里空值常常是 [] 而不是 ""，解析时一律用 str()/num() 处理。
import type { LatLng, MapProvider, Place, Poi, WeatherDay } from "../types";
import { estimateCommute } from "./geo";

const BASE = "https://restapi.amap.com";
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_CONCURRENT = 3;
const MAX_ORIGINS = 100;
/** 并发 / QPS 超限的 infocode，重试一次 */
const QPS_CODES = new Set(["10019", "10020", "10021", "10014", "10015"]);

type AmapBase = { status?: string; info?: string; infocode?: string };

const cache = new Map<string, { expires: number; data: unknown }>();

/** 测试用：清空缓存 */
export function clearAmapCache(): void {
  cache.clear();
}

// ---------- 简单信号量 ----------
let active = 0;
const waiters: (() => void)[] = [];
async function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}
function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AmapError extends Error {
  constructor(
    message: string,
    readonly infocode?: string,
  ) {
    super(message);
    this.name = "AmapError";
  }
}

async function fetchOnce<T extends AmapBase>(url: string): Promise<T> {
  await acquire();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) throw new AmapError(`高德 HTTP ${res.status}`);
    const data = (await res.json()) as T;
    if (data.status !== "1") {
      throw new AmapError(`高德接口错误：${data.info ?? "未知"}（${data.infocode ?? "-"}）`, data.infocode);
    }
    return data;
  } catch (e) {
    if (e instanceof AmapError) throw e;
    if ((e as { name?: string })?.name === "AbortError") throw new AmapError(`高德请求超时（${TIMEOUT_MS}ms）`);
    throw new AmapError(`高德请求失败：${(e as Error)?.message ?? String(e)}`);
  } finally {
    clearTimeout(timer);
    release();
  }
}

async function amapGet<T extends AmapBase>(path: string, params: Record<string, string | number | undefined>, key: string): Promise<T> {
  const qs = new URLSearchParams();
  qs.set("key", key);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") qs.set(k, String(v));
  }
  qs.set("output", "JSON");
  const url = `${BASE}${path}?${qs.toString()}`;

  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.data as T;

  let data: T;
  try {
    data = await fetchOnce<T>(url);
  } catch (e) {
    if (e instanceof AmapError && e.infocode && QPS_CODES.has(e.infocode)) {
      await sleep(400);
      data = await fetchOnce<T>(url);
    } else {
      throw e;
    }
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { expires: now + CACHE_TTL_MS, data });
  return data;
}

// ---------- 解析工具 ----------
/** 高德空值可能是 [] / "" / undefined */
export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
export function num(v: unknown): number | undefined {
  const s = typeof v === "number" ? String(v) : str(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
/** "lng,lat" -> LatLng */
export function parseLocation(v: unknown): LatLng | undefined {
  const s = str(v);
  if (!s) return undefined;
  const [lng, lat] = s.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  return { lat, lng };
}
/** LatLng -> "lng,lat"（高德要求小数不超过 6 位） */
export function fmtLocation(p: LatLng): string {
  return `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;
}

// ---------- 响应类型（只列用到的字段） ----------
type InputTipsResp = AmapBase & {
  tips?: { id?: unknown; name?: unknown; district?: unknown; address?: unknown; location?: unknown }[];
};
type RegeoResp = AmapBase & {
  regeocode?: {
    formatted_address?: unknown;
    addressComponent?: {
      township?: unknown;
      neighborhood?: { name?: unknown };
      adcode?: unknown;
      building?: { name?: unknown };
      streetNumber?: { street?: unknown; number?: unknown };
    };
    pois?: { name?: unknown; distance?: unknown }[];
    aois?: { name?: unknown; distance?: unknown }[];
  };
};
type AroundPoi = {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  address?: unknown;
  location?: unknown;
  tel?: unknown;
  biz_ext?: { rating?: unknown; cost?: unknown; open_time?: unknown } | unknown[];
  photos?: { url?: unknown }[];
  indoor_map?: unknown;
  indoor_data?: { floor?: unknown; truefloor?: unknown } | unknown[];
};
type WeatherResp = AmapBase & {
  forecasts?: {
    casts?: {
      date?: unknown;
      dayweather?: unknown;
      nightweather?: unknown;
      daytemp?: unknown;
      nighttemp?: unknown;
      daypower?: unknown;
      nightpower?: unknown;
    }[];
  }[];
};
type AroundResp = AmapBase & { pois?: AroundPoi[] };
type DistanceResp = AmapBase & {
  results?: { origin_id?: unknown; distance?: unknown; duration?: unknown; code?: unknown }[];
};

type Stop = { name?: unknown };
type TransitResp = AmapBase & {
  route?: {
    transits?: {
      duration?: unknown;
      segments?: {
        walking?: { distance?: unknown; duration?: unknown } | unknown[];
        bus?: { buslines?: { name?: unknown; departure_stop?: Stop; arrival_stop?: Stop; via_num?: unknown }[] } | unknown[];
        railway?: { name?: unknown; departure_stop?: Stop; arrival_stop?: Stop } | unknown[];
      }[];
    }[];
  };
};

/** 去掉高德线路名里括号中的起讫站，如 "地铁9号线(松江南站--曹路)" -> "地铁9号线" */
function shortLine(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim();
}

/** 解析高德公交规划的第一条方案；没有方案返回 undefined */
export function parseTransit(data: TransitResp): { minutes: number; steps: string[] } | undefined {
  const t = data.route?.transits?.[0];
  const sec = num(t?.duration);
  if (!t || sec === undefined) return undefined;
  const steps: string[] = [];
  for (const seg of t.segments ?? []) {
    const w = seg.walking && !Array.isArray(seg.walking) ? seg.walking : undefined;
    const wd = num(w?.distance);
    if (wd !== undefined && wd >= 50) steps.push(`步行 ${Math.round(wd / 10) * 10} 米`);
    const bus = seg.bus && !Array.isArray(seg.bus) ? seg.bus : undefined;
    const line = bus?.buslines?.[0];
    if (line && str(line.name)) {
      const via = num(line.via_num);
      const stops = via !== undefined ? `（${via + 1} 站）` : "";
      const from = str(line.departure_stop?.name);
      const to = str(line.arrival_stop?.name);
      steps.push(`${shortLine(str(line.name))}${from && to ? ` ${from} → ${to}` : ""}${stops}`);
    }
    const rail = seg.railway && !Array.isArray(seg.railway) ? seg.railway : undefined;
    if (rail && str(rail.name)) steps.push(`${str(rail.name)} ${str(rail.departure_stop?.name)} → ${str(rail.arrival_stop?.name)}`.trim());
  }
  return { minutes: Math.max(1, Math.round(sec / 60)), steps };
}

/** 公交规划失败 / 没有方案时的打车估算 */
export function taxiFallback(origin: LatLng, dest: LatLng): { minutes: number; steps: string[] } {
  const e = estimateCommute(origin, dest);
  return { minutes: e.minutes, steps: [`打车约 ${e.minutes} 分钟（约 ${e.distanceKm} 公里）`] };
}

export function parseAroundPoi(p: AroundPoi): Poi | undefined {
  const loc = parseLocation(p.location);
  const id = str(p.id);
  const name = str(p.name);
  if (!loc || !id || !name) return undefined;
  const biz = p.biz_ext && !Array.isArray(p.biz_ext) ? p.biz_ext : {};
  const rating = num(biz.rating);
  const cost = num(biz.cost);
  const photo = Array.isArray(p.photos) && p.photos.length > 0 ? str(p.photos[0]?.url) : "";
  const tel = str(p.tel);
  const openTime = str((biz as { open_time?: unknown }).open_time);
  // 有室内地图 / 楼层 = 在楼里（商场、写字楼）；没有就不下结论
  const indoorData = p.indoor_data && !Array.isArray(p.indoor_data) ? p.indoor_data : undefined;
  const indoor = str(p.indoor_map) === "1" || !!str(indoorData?.floor) || !!str(indoorData?.truefloor) ? true : undefined;
  return {
    id,
    name,
    address: str(p.address),
    lat: loc.lat,
    lng: loc.lng,
    rating: rating !== undefined && rating > 0 ? rating : undefined,
    costPerPerson: cost !== undefined && cost > 0 ? Math.round(cost) : undefined,
    type: str(p.type),
    tel: tel || undefined,
    photoUrl: photo || undefined,
    ...(openTime ? { openTime } : {}),
    ...(indoor ? { indoor } : {}),
  };
}

/** 高德天气 → WeatherDay[]（今天起 4 天，白天 / 夜间各一条） */
export function parseWeather(data: WeatherResp): WeatherDay[] {
  const casts = data.forecasts?.[0]?.casts ?? [];
  const out: WeatherDay[] = [];
  for (const c of casts) {
    const date = str(c.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      day: { text: str(c.dayweather), temp: num(c.daytemp) ?? 20, windPower: str(c.daypower) },
      night: { text: str(c.nightweather), temp: num(c.nighttemp) ?? 15, windPower: str(c.nightpower) },
    });
  }
  return out;
}

export function pickRegeoLabel(data: RegeoResp): string {
  const r = data.regeocode;
  if (!r) return "";
  const aoi = r.aois?.map((a) => str(a.name)).find(Boolean);
  if (aoi) return aoi;
  const poi = r.pois?.map((a) => str(a.name)).find(Boolean);
  if (poi) return poi;
  const c = r.addressComponent;
  const street = str(c?.streetNumber?.street);
  if (street) return `${street}${str(c?.streetNumber?.number)}`;
  return str(c?.neighborhood?.name) || str(c?.building?.name) || str(c?.township) || str(r.formatted_address);
}

const weatherCache = new Map<string, { at: number; days: WeatherDay[] }>();

// ---------- Provider ----------
export function createAmapProvider(key: string): MapProvider {
  return {
    async searchPlaces(q: string, city: string): Promise<Place[]> {
      const keywords = (q ?? "").trim();
      if (!keywords) return [];
      const data = await amapGet<InputTipsResp>(
        "/v3/assistant/inputtips",
        { keywords, city: city?.trim() || undefined, citylimit: "true", datatype: "all" },
        key,
      );
      const out: Place[] = [];
      for (const t of data.tips ?? []) {
        const loc = parseLocation(t.location);
        const name = str(t.name);
        if (!loc || !name) continue;
        out.push({ label: name, ...loc });
      }
      return out;
    },

    async weather(center: LatLng): Promise<WeatherDay[]> {
      // 先用逆地理拿区县 adcode，再查预报；同一个区县 30 分钟内复用
      const regeo = await amapGet<RegeoResp>("/v3/geocode/regeo", { location: fmtLocation(center), extensions: "base" }, key);
      const adcode = str(regeo.regeocode?.addressComponent?.adcode);
      if (!adcode) return [];
      const hit = weatherCache.get(adcode);
      if (hit && Date.now() - hit.at < 30 * 60_000) return structuredClone(hit.days);
      const data = await amapGet<WeatherResp>("/v3/weather/weatherInfo", { city: adcode, extensions: "all" }, key);
      const days = parseWeather(data);
      weatherCache.set(adcode, { at: Date.now(), days });
      return days;
    },

    async reverseGeocode(p: LatLng): Promise<string> {
      const data = await amapGet<RegeoResp>(
        "/v3/geocode/regeo",
        { location: fmtLocation(p), extensions: "all", radius: 300, roadlevel: 0 },
        key,
      );
      return pickRegeoLabel(data) || "当前位置";
    },

    async searchAround(center: LatLng, keywords: string[], radiusM: number): Promise<Poi[]> {
      const kws = keywords.map((k) => k.trim()).filter(Boolean);
      const out: Poi[] = [];
      const seen = new Set<string>();
      // 第 1 页满 25 条再取第 2 页：按关键词搜会混进非本品类的店，规划时要先按品类过滤，多拿一页才够
      for (let page = 1; page <= 2; page++) {
        const data = await amapGet<AroundResp>(
          "/v3/place/around",
          {
            location: fmtLocation(center),
            keywords: kws.join("|"),
            radius: Math.max(1, Math.min(50000, Math.round(radiusM))),
            extensions: "all",
            offset: 25,
            page,
            sortrule: "weight",
          },
          key,
        );
        const list = data.pois ?? [];
        for (const raw of list) {
          const poi = parseAroundPoi(raw);
          if (poi && !seen.has(poi.id)) {
            seen.add(poi.id);
            out.push(poi);
          }
        }
        if (list.length < 25) break;
      }
      return out;
    },

    async commute(origins: LatLng[], dest: LatLng) {
      const result: { minutes: number; distanceKm: number }[] = [];
      for (let start = 0; start < origins.length; start += MAX_ORIGINS) {
        const chunk = origins.slice(start, start + MAX_ORIGINS);
        const data = await amapGet<DistanceResp>(
          "/v3/distance",
          { origins: chunk.map(fmtLocation).join("|"), destination: fmtLocation(dest), type: 1 },
          key,
        );
        const byOrigin = new Map<number, { distance?: number; duration?: number; code?: string }>();
        for (const r of data.results ?? []) {
          const idx = num(r.origin_id);
          if (idx !== undefined) {
            byOrigin.set(idx, { distance: num(r.distance), duration: num(r.duration), code: str(r.code) });
          }
        }
        chunk.forEach((o, i) => {
          const r = byOrigin.get(i + 1); // origin_id 从 1 开始
          if (r && !r.code && r.duration !== undefined && r.distance !== undefined) {
            result.push({ minutes: Math.round(r.duration / 60), distanceKm: Math.round(r.distance / 100) / 10 });
          } else {
            // 单条失败（无路 / 太远）时用直线估算兜底，不让整个方案失败
            result.push(estimateCommute(o, dest));
          }
        });
      }
      return result;
    },

    async transitRoute(origin: LatLng, dest: LatLng, city: string) {
      try {
        const c = city?.trim() || undefined;
        const data = await amapGet<TransitResp>(
          "/v3/direction/transit/integrated",
          { origin: fmtLocation(origin), destination: fmtLocation(dest), city: c, cityd: c, strategy: 0, nightflag: 1 },
          key,
        );
        return parseTransit(data) ?? taxiFallback(origin, dest);
      } catch {
        // 公交规划失败（跨城 / 太近 / 接口出错）：退回打车估算
        return taxiFallback(origin, dest);
      }
    },
  };
}

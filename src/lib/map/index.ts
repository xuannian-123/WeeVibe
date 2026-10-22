import type { MapProvider } from "../types";
import { createAmapProvider } from "./amap";
import { mockMapProvider } from "./mock";

export { haversineKm, wgs84ToGcj02, getDemoCenter, estimateCommute } from "./geo";
export { createAmapProvider } from "./amap";
export { createMockMapProvider, mockMapProvider } from "./mock";

/**
 * 高德出错（断网 / 超时 / 配额）时自动降级到 mock，保证现场 Demo 不会卡死。
 * 降级会打一条 console.warn。
 */
export function withFallback(primary: MapProvider, fallback: MapProvider, name = "amap"): MapProvider {
  const wrap =
    <K extends keyof MapProvider>(method: K) =>
    async (...args: Parameters<MapProvider[K]>) => {
      try {
        return await (primary[method] as (...a: unknown[]) => Promise<unknown>)(...args);
      } catch (e) {
        console.warn(`[map] ${name}.${String(method)} 失败，降级到 mock：${(e as Error)?.message ?? e}`);
        return (fallback[method] as (...a: unknown[]) => Promise<unknown>)(...args);
      }
    };
  return {
    searchPlaces: wrap("searchPlaces") as MapProvider["searchPlaces"],
    reverseGeocode: wrap("reverseGeocode") as MapProvider["reverseGeocode"],
    searchAround: wrap("searchAround") as MapProvider["searchAround"],
    commute: wrap("commute") as MapProvider["commute"],
  };
}

let cached: { key: string; provider: MapProvider } | undefined;

/** process.env.AMAP_KEY 非空时用高德（失败自动降级 mock），否则用 mock */
export function getMapProvider(): MapProvider {
  const key = (process.env.AMAP_KEY ?? "").trim();
  if (!key) return mockMapProvider;
  if (cached?.key !== key) {
    cached = { key, provider: withFallback(createAmapProvider(key), mockMapProvider) };
  }
  return cached.provider;
}

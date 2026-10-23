import type { MapProvider } from "../types";
import { createAmapProvider } from "./amap";
import { mockMapProvider } from "./mock";

export { haversineKm, wgs84ToGcj02, getDemoCenter, estimateCommute } from "./geo";
export { createAmapProvider } from "./amap";
export { createMockMapProvider, mockMapProvider, mockTransit } from "./mock";

export const MAP_UNAVAILABLE = "地图服务暂时不可用";

/**
 * 高德出错时的策略：
 * - searchPlaces / reverseGeocode / commute / transitRoute：降级到 mock（地标 / 直线估算），打 console.warn
 * - searchAround：绝不降级（虚构店铺不能当真店推荐），重试 1 次后抛出"地图服务暂时不可用"
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
    searchAround: async (...args: Parameters<MapProvider["searchAround"]>) => {
      try {
        return await primary.searchAround(...args);
      } catch (first) {
        console.warn(`[map] ${name}.searchAround 失败，重试 1 次：${(first as Error)?.message ?? first}`);
        try {
          return await primary.searchAround(...args);
        } catch (e) {
          throw new Error(`${MAP_UNAVAILABLE}：${(e as Error)?.message ?? e}`);
        }
      }
    },
    commute: wrap("commute") as MapProvider["commute"],
    transitRoute: wrap("transitRoute") as MapProvider["transitRoute"],
  };
}

let cached: { key: string; provider: MapProvider } | undefined;

/** process.env.AMAP_KEY 非空时用高德（searchAround 外的失败降级 mock），否则用 mock */
export function getMapProvider(): MapProvider {
  const key = (process.env.AMAP_KEY ?? "").trim();
  if (!key) return mockMapProvider;
  if (cached?.key !== key) {
    cached = { key, provider: withFallback(createAmapProvider(key), mockMapProvider) };
  }
  return cached.provider;
}

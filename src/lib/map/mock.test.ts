import { afterEach, describe, expect, it } from "vitest";
import type { MapProvider } from "../types";
import { createMockMapProvider, getMapProvider, haversineKm, mockMapProvider, wgs84ToGcj02, withFallback } from "./index";
import { createAmapProvider, parseAroundPoi, parseTransit, pickRegeoLabel, taxiFallback } from "./amap";

const map = createMockMapProvider();
const CENTER = { lat: 31.27, lng: 120.735 };

describe("mock searchAround", () => {
  it("每个品类 12–20 家，评分/人均/type 完整，在半径内", async () => {
    for (const kw of ["火锅", "烧烤", "桌游", "KTV", "羽毛球", "陶艺"]) {
      const pois = await map.searchAround(CENTER, [kw], 3000, "苏州");
      expect(pois.length, kw).toBeGreaterThanOrEqual(12);
      expect(pois.length, kw).toBeLessThanOrEqual(20);
      for (const p of pois) {
        expect(p.rating).toBeGreaterThanOrEqual(3.6);
        expect(p.rating).toBeLessThanOrEqual(4.9);
        expect(p.costPerPerson).toBeGreaterThan(0);
        expect(p.type.split(";")).toHaveLength(3);
        expect(p.name).toMatch(/\(.+店\)$/);
        expect(haversineKm(CENTER, p)).toBeLessThanOrEqual(3);
      }
    }
    const unknown = await map.searchAround(CENTER, ["陶艺"], 3000, "苏州");
    expect(unknown.every((p) => p.name.includes("陶艺"))).toBe(true);
  });

  it("确定性，且有店带川味/重庆", async () => {
    const a = await map.searchAround(CENTER, ["火锅"], 3000, "苏州");
    const b = await createMockMapProvider().searchAround(CENTER, ["火锅"], 3000, "苏州");
    expect(a).toEqual(b);
    const wide = await map.searchAround(CENTER, ["火锅"], 6000, "苏州");
    expect(wide.some((p) => /川味|重庆|川菜/.test(p.name + p.type))).toBe(true);
  });

  it("中心微移后附近仍是同一批店（固定世界）", async () => {
    const a = await map.searchAround(CENTER, ["火锅"], 3000, "苏州");
    const b = await map.searchAround({ lat: 31.2702, lng: 120.7352 }, ["火锅"], 3000, "苏州");
    const ids = new Set(b.map((p) => p.id));
    expect(a.filter((p) => ids.has(p.id)).length).toBeGreaterThanOrEqual(10);
  });
});

describe("mock commute / places / reverse", () => {
  it("通勤 = 直线×1.35 / 25km/h + 6 分钟", async () => {
    const o = { lat: 31.27, lng: 120.7 };
    const d = { lat: 31.27, lng: 120.8 };
    const km = haversineKm(o, d);
    const [r] = await map.commute([o], d);
    expect(r.minutes).toBe(Math.round(((km * 1.35) / 25) * 60 + 6));
    expect(r.distanceKm).toBeCloseTo(km * 1.35, 1);
    const [zero] = await map.commute([d], d);
    expect(zero.minutes).toBe(6);
  });

  it("地标模糊匹配 / 空查询 / 未知地点", async () => {
    expect((await map.searchPlaces("", "苏州")).length).toBe(8);
    expect((await map.searchPlaces("西交", "苏州"))[0].label).toBe("西交利物浦大学");
    expect((await map.searchPlaces("独墅湖", "苏州")).map((p) => p.label)).toContain("独墅湖图书馆");
    const unk = await map.searchPlaces("我家小区", "苏州");
    expect(unk[0].label).toBe("我家小区");
    expect(await map.searchPlaces("我家小区", "苏州")).toEqual(unk);
    const sh = await map.searchPlaces("", "上海");
    expect(sh[0].label).toBe("36space（漕宝路36号E座）");
    const hz = await map.searchPlaces("", "杭州");
    expect(hz[0].label).toBe("杭州地标1");
  });

  it("逆地理返回最近地标 + 附近", async () => {
    expect(await map.reverseGeocode({ lat: 31.2749, lng: 120.7384 })).toBe("西交利物浦大学附近");
  });
});

describe("map index", () => {
  afterEach(() => {
    delete process.env.AMAP_KEY;
  });
  it("无 key 用 mock，有 key 用高德包装", () => {
    delete process.env.AMAP_KEY;
    expect(getMapProvider()).toBe(mockMapProvider);
    process.env.AMAP_KEY = "test";
    expect(getMapProvider()).not.toBe(mockMapProvider);
  });
  it("WGS-84 → GCJ-02 偏移约数百米，境外不变", () => {
    const g = wgs84ToGcj02({ lat: 31.27, lng: 120.735 });
    const off = haversineKm(g, { lat: 31.27, lng: 120.735 }) * 1000;
    expect(off).toBeGreaterThan(200);
    expect(off).toBeLessThan(800);
    expect(wgs84ToGcj02({ lat: 40.7, lng: -74 })).toEqual({ lat: 40.7, lng: -74 });
  });
});

describe("withFallback 降级策略", () => {
  const failing = (calls: string[], failTimes = Infinity): MapProvider => {
    let n = 0;
    const boom = (name: string) => async () => {
      calls.push(name);
      if (n++ < failTimes) throw new Error("boom");
      return [];
    };
    return {
      searchPlaces: boom("searchPlaces") as MapProvider["searchPlaces"],
      reverseGeocode: (async () => {
        calls.push("reverseGeocode");
        throw new Error("boom");
      }) as MapProvider["reverseGeocode"],
      searchAround: boom("searchAround") as MapProvider["searchAround"],
      commute: boom("commute") as MapProvider["commute"],
      transitRoute: boom("transitRoute") as unknown as MapProvider["transitRoute"],
    };
  };

  it("searchAround 不降级 mock：重试 1 次后抛出地图服务暂时不可用", async () => {
    const calls: string[] = [];
    const p = withFallback(failing(calls), mockMapProvider);
    await expect(p.searchAround(CENTER, ["火锅"], 3000, "苏州")).rejects.toThrow(/地图服务暂时不可用/);
    expect(calls).toEqual(["searchAround", "searchAround"]);
  });

  it("searchAround 重试成功则返回真实结果（不掺 mock）", async () => {
    const calls: string[] = [];
    const p = withFallback(failing(calls, 1), mockMapProvider);
    expect(await p.searchAround(CENTER, ["火锅"], 3000, "苏州")).toEqual([]);
  });

  it("其余方法降级 mock", async () => {
    const p = withFallback(failing([]), mockMapProvider);
    expect((await p.searchPlaces("西交", "苏州"))[0].label).toBe("西交利物浦大学");
    expect(await p.reverseGeocode({ lat: 31.2749, lng: 120.7384 })).toBe("西交利物浦大学附近");
    expect((await p.commute([CENTER], CENTER))[0].minutes).toBe(6);
    const t = await p.transitRoute(CENTER, { lat: 31.31, lng: 120.7 }, "苏州");
    expect(t).toEqual(await mockMapProvider.transitRoute(CENTER, { lat: 31.31, lng: 120.7 }, "苏州"));
  });
});

describe("高德响应解析", () => {
  it("biz_ext 空数组 / 空字符串都能解析", () => {
    const p = parseAroundPoi({
      id: "B0",
      name: "某店",
      type: "餐饮服务;中餐厅;火锅店",
      address: [],
      location: "120.735,31.27",
      tel: [],
      biz_ext: { rating: [], cost: "" },
      photos: [],
    });
    expect(p).toMatchObject({ id: "B0", address: "", lat: 31.27, lng: 120.735 });
    expect(p?.rating).toBeUndefined();
    expect(p?.costPerPerson).toBeUndefined();
    const q = parseAroundPoi({
      id: "B1",
      name: "某店",
      location: "120.7,31.2",
      biz_ext: { rating: "4.6", cost: "92.00" },
      photos: [{ url: "http://x/1.jpg" }],
    });
    expect(q).toMatchObject({ rating: 4.6, costPerPerson: 92, photoUrl: "http://x/1.jpg" });
    expect(parseAroundPoi({ id: "B2", name: "x", location: [] })).toBeUndefined();
  });
  it("逆地理优先 aoi / poi，其次街道", () => {
    expect(pickRegeoLabel({ regeocode: { aois: [{ name: "西交利物浦大学" }], pois: [{ name: "某店" }] } })).toBe("西交利物浦大学");
    expect(pickRegeoLabel({ regeocode: { aois: [], pois: [] , addressComponent: { streetNumber: { street: "仁爱路", number: "111号" } } } })).toBe("仁爱路111号");
  });
});

describe("transitRoute（#11 行程卡）", () => {
  it("mock：近处步行，远处 步行 + 地铁 + 步行，确定性", async () => {
    const near = await map.transitRoute(CENTER, { lat: 31.275, lng: 120.735 }, "苏州");
    expect(near.steps).toHaveLength(1);
    expect(near.steps[0]).toMatch(/^步行约 \d+ 米/);
    const far = await map.transitRoute({ lat: 31.1675, lng: 121.397 }, { lat: 31.167645, lng: 121.43195 }, "上海");
    expect(far.steps).toHaveLength(3);
    expect(far.steps[1]).toMatch(/地铁 \d+ 号线（模拟）坐 \d+ 站/);
    expect(far.minutes).toBeGreaterThan(10);
    expect(await createMockMapProvider().transitRoute({ lat: 31.1675, lng: 121.397 }, { lat: 31.167645, lng: 121.43195 }, "上海")).toEqual(far);
  });

  it("高德公交规划解析：步行 / 地铁 / 公交", () => {
    const r = parseTransit({
      status: "1",
      route: {
        transits: [
          {
            duration: "1830",
            segments: [
              {
                walking: { distance: "412", duration: "300" },
                bus: { buslines: [{ name: "地铁9号线(松江南站--曹路)", departure_stop: { name: "漕河泾开发区" }, arrival_stop: { name: "桂林路" }, via_num: "1" }] },
                railway: [],
              },
              { walking: { distance: "620" }, bus: { buslines: [] }, railway: [] },
            ],
          },
        ],
      },
    });
    expect(r).toEqual({ minutes: 31, steps: ["步行 410 米", "地铁9号线 漕河泾开发区 → 桂林路（2 站）", "步行 620 米"] });
    expect(parseTransit({ status: "1", route: { transits: [] } })).toBeUndefined();
  });

  it("高德失败时退回打车估算", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      const o = { lat: 31.1675, lng: 121.397 };
      const d = { lat: 31.167645, lng: 121.43195 };
      expect(await createAmapProvider("k").transitRoute(o, d, "上海")).toEqual(taxiFallback(o, d));
      expect(taxiFallback(o, d).steps[0]).toMatch(/^打车约 \d+ 分钟（约 [\d.]+ 公里）$/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

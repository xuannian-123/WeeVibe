import { describe, expect, it } from "vitest";
import type { LatLng, MapProvider, Poi } from "../types";
import { createMockMapProvider } from "../map";
import { buildSwipeDeck, generateSlots, planJu } from "./index";
import { categoryMatches, categoryWords } from "./category";
import { ju, member, spec } from "./testutil";

const DAY = "2026-10-23";
const s = spec({ category: "火锅", poiKeywords: ["火锅"] });
const j = ju(s, generateSlots(s));
const words = categoryWords(s);
const opts = { auditSecret: "k", now: new Date("2026-10-22T12:00:00Z") };
const members = [
  member("A", 31.2748, 120.7383, { id: "a", priv: { availability: { [DAY]: { from: "17:30", pref: "ok" } } } }),
  member("B", 31.2627, 120.7293, { id: "b", priv: { availability: { [DAY]: { from: "17:30", pref: "ok" } }, budgetMax: 70 } }),
  member("C", 31.2865, 120.743, { id: "c", priv: { availability: { [DAY]: { from: "17:30", pref: "ok" } } } }),
];

/** 高德按关键词"火锅"搜周边时会混进来的非火锅店：又近、又便宜、评分又高 */
const decoys = (c: LatLng): Poi[] => [
  { id: "x1", name: "粤東顺·醉鸡煲小海鲜·潮广排档", type: "餐饮服务;中餐厅;海鲜酒楼", address: "", lat: c.lat, lng: c.lng, costPerPerson: 60, rating: 4.9 },
  { id: "x2", name: "超吉炒鸡", type: "餐饮服务;中餐厅;中餐厅", address: "", lat: c.lat + 0.001, lng: c.lng, costPerPerson: 40, rating: 4.8 },
  { id: "x3", name: "星缘全日餐厅", type: "餐饮服务;外国餐厅;外国餐厅", address: "", lat: c.lat, lng: c.lng + 0.001, costPerPerson: 70, rating: 4.9 },
  { id: "x4", name: "拾光咖啡厅", type: "餐饮服务;咖啡厅;咖啡厅", address: "", lat: c.lat - 0.001, lng: c.lng, costPerPerson: 35, rating: 4.9 },
];

describe("品类过滤：火锅局只出火锅店", () => {
  it("品类词含常见写法", () => {
    expect(words).toEqual(expect.arrayContaining(["火锅", "串串", "涮"]));
    expect(categoryMatches({ name: "某某(徐汇店)", type: "餐饮服务;中餐厅;火锅店" }, words)).toBe(true);
    expect(categoryMatches({ name: "蜀香阁串串(东门店)", type: "餐饮服务;中餐厅;四川菜(川菜)" }, words)).toBe(true);
    expect(categoryMatches({ name: "铜炉涮肉馆", type: "餐饮服务;中餐厅;中餐厅" }, words)).toBe(true);
    for (const d of decoys({ lat: 0, lng: 0 })) expect(categoryMatches(d, words)).toBe(false);
  });

  it("mock 地图里混进非火锅店：方案和刷卡卡组都只有火锅店，思考流说明去掉了几家", async () => {
    const base = createMockMapProvider();
    const map: MapProvider = { ...base, searchAround: async (c, k, r, city) => [...decoys(c), ...(await base.searchAround(c, k, r, city))] };
    const trace: string[] = [];
    const { plan } = await planJu(j, members, map, { ...opts, onTrace: (_k, t) => trace.push(t) });
    for (const p of plan.proposals) expect(categoryMatches(p.poi, words)).toBe(true);
    expect(trace.some((t) => /去掉 4 家不是「火锅」的店/.test(t))).toBe(true);
    const deck = await buildSwipeDeck(j, members, members[0], map);
    expect(deck.length).toBeGreaterThanOrEqual(5);
    for (const d of deck) expect(categoryMatches(d, words)).toBe(true);
  });

  it("命中不足先扩大半径；最大半径仍不足才放宽，并在思考流里说明", async () => {
    const radii: number[] = [];
    const hot = (c: LatLng, r: number): Poi[] =>
      r >= 6000 ? [6, 7, 8, 9, 10].map((k) => ({ id: `h${k}`, name: `远方火锅${k}(分店${k})`, type: "餐饮服务;中餐厅;火锅店", address: "", lat: c.lat + 0.02, lng: c.lng + k * 0.001, costPerPerson: 90 })) : [];
    const widen: MapProvider = {
      ...createMockMapProvider(),
      searchAround: async (c, _k, r) => {
        radii.push(r);
        return [...decoys(c), ...hot(c, r)];
      },
    };
    const { plan } = await planJu(j, members, widen, opts);
    expect(radii).toEqual([3000, 6000]);
    for (const p of plan.proposals) expect(p.poi.name).toMatch(/远方火锅/);

    radii.length = 0;
    const scarce: MapProvider = {
      ...createMockMapProvider(),
      searchAround: async (c, _k, r) => {
        radii.push(r);
        return [{ id: "h1", name: "唯一火锅(总店)", type: "餐饮服务;中餐厅;火锅店", address: "", lat: c.lat, lng: c.lng, costPerPerson: 90 }, ...decoys(c)];
      },
    };
    const trace: { k: string; t: string }[] = [];
    const r2 = await planJu(j, members, scarce, { ...opts, onTrace: (k, t) => trace.push({ k, t }) });
    expect(radii).toEqual([3000, 6000, 10000]);
    expect(trace.some((x) => x.k === "warn" && /只找到 1 家「火锅」，放宽到相近的店/.test(x.t))).toBe(true);
    expect(r2.plan.proposals.length).toBeGreaterThanOrEqual(1);
  });
});

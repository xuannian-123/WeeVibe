// v6 活动层的审计复算：出方案时记下的地图返回，复算时原样回放，输出哈希必须对得上（#9 一键复算）。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;

import { describe, expect, it } from "vitest";
import type { MapProvider } from "../types";
import { createMockMapProvider } from "../map";
import { recordingMap, replayMap } from "../server/ju-core";
import { generateSlots, planJu } from "./index";
import { ju, member, spec } from "./testutil";

const DAY = "2030-11-02";

/** 复算时不许再问真地图：所有调用都必须来自记录 */
const nothing: MapProvider = {
  searchPlaces: async () => {
    throw new Error("复算不该调地图");
  },
  reverseGeocode: async () => {
    throw new Error("复算不该调地图");
  },
  searchAround: async () => {
    throw new Error("复算不该调地图");
  },
  commute: async () => {
    throw new Error("复算不该调地图");
  },
  transitRoute: async () => {
    throw new Error("复算不该调地图");
  },
  weather: async () => {
    throw new Error("复算不该调地图");
  },
};

describe("活动层 × 审计重放", () => {
  it("recordingMap 记下的调用足够复算，输入 / 输出哈希都对得上", async () => {
    const s = spec({ category: "局长定", poiKeywords: ["餐厅"], open: true, dates: [DAY], earliest: "14:00", latest: "15:00", budgetPerPerson: undefined });
    const av = (from: string) => ({ [DAY]: { from, pref: "ok" as const } });
    const members = [
      member("A", 31.2748, 120.7383, { id: "a", priv: { availability: av("13:00"), mood: "active" } }),
      member("B", 31.2745, 120.7462, { id: "b", priv: { availability: av("13:00"), mood: "lazy", dietTags: ["清真"] } }),
      member("C", 31.2627, 120.7293, { id: "c", priv: { availability: av("16:40"), mood: "chill" } }),
      member("D", 31.2622, 120.7385, { id: "d", priv: { availability: av("13:00"), budgetMax: 70 } }),
    ];
    const j = ju(s, generateSlots(s));
    const profiles = { a: { activityTastes: { climbing: 1 } } };
    const opts = { auditSecret: "k", now: new Date("2030-10-30T10:00:00+08:00"), profiles };
    const log: Record<string, unknown> = {};
    const first = await planJu(structuredClone(j), structuredClone(members), recordingMap(createMockMapProvider(), log), opts);
    expect(first.plan.proposals[0].segments?.length).toBeGreaterThan(0);
    const again = await planJu(structuredClone(j), structuredClone(members), replayMap(log, nothing), opts);
    expect(again.plan.audit.outputHash).toBe(first.plan.audit.outputHash);
    expect(again.plan.audit.inputHash).toBe(first.plan.audit.inputHash);
    // 档案（活动口味）进了输入哈希：换了口味，输入哈希就变
    const other = await planJu(structuredClone(j), structuredClone(members), replayMap(log, createMockMapProvider()), { ...opts, profiles: {} });
    expect(other.plan.audit.inputHash).not.toBe(first.plan.audit.inputHash);
  });
});

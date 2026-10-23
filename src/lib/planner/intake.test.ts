import { describe, expect, it } from "vitest";
import type { Profile } from "../types";
import { createMockMapProvider } from "../map";
import {
  autofillFromProfile,
  availabilityFromBusy,
  buildSwipeDeck,
  fairnessWeights,
  generateSlots,
  ledgerEntryFor,
  predictSwipes,
} from "./index";
import { ju, member, spec } from "./testutil";

const s = spec({ dates: ["2026-10-23", "2026-10-24"], earliest: "18:00", latest: "20:00" }); // 周五、周六
const j = ju(s, generateSlots(s));
const profile = (over: Partial<Profile> = {}): Profile => ({ id: "pf", dietTags: [], ledger: [], tastes: {}, ...over });

describe("availabilityFromBusy（#7 课表）", () => {
  it("下午有课 → 下课后才能出发；晚课 → 之前得回；忙到最晚开局之后 → 那天不行", () => {
    const busy = [
      { weekday: 5, from: "14:00", to: "18:20", label: "高数" },
      { weekday: 5, from: "21:30", to: "22:30", label: "晚自习" },
      { weekday: 6, from: "08:00", to: "21:00", label: "实习" },
    ];
    expect(availabilityFromBusy(busy, s)).toEqual({ "2026-10-23": { from: "18:20", homeBy: "21:30", pref: "ok" } });
    const sat = availabilityFromBusy([], s, { from: "17:30", homeBy: "23:00" });
    expect(sat).toEqual({
      "2026-10-23": { from: "17:30", homeBy: "23:00", pref: "best" },
      "2026-10-24": { from: "17:30", homeBy: "23:00", pref: "best" },
    });
    expect(availabilityFromBusy([], s)["2026-10-23"].from).toBe("17:00");
  });
});

describe("autofillFromProfile / predictSwipes（#6）", () => {
  it("无档案给温和默认值；有档案用常用时间 / 价位 / 忌口", () => {
    expect(autofillFromProfile(undefined, j)).toEqual({
      availability: { "2026-10-23": { from: "17:30", pref: "ok" }, "2026-10-24": { from: "17:30", pref: "ok" } },
      dietTags: [],
    });
    const a = autofillFromProfile(profile({ usualFrom: "18:30", usualHomeBy: "22:30", typicalBudget: 88.4, dietTags: ["不吃辣"] }), j);
    expect(a.availability["2026-10-24"]).toEqual({ from: "18:30", homeBy: "22:30", pref: "ok" });
    expect(a.budgetMax).toBe(88);
    expect(a.dietTags).toEqual(["不吃辣"]);
  });

  it("按口味 / 价位 / 忌口预测刷卡；无档案一律想去", async () => {
    const map = createMockMapProvider();
    const deck = await buildSwipeDeck(j, [member("A", 31.27, 120.735)], member("A", 31.27, 120.735), map);
    expect(Object.values(predictSwipes(undefined, deck)).every((v) => v === "like")).toBe(true);
    const chain0 = deck[0].name.replace(/\(.*\)/, "");
    expect(predictSwipes(profile({ tastes: { [chain0]: 0.9 } }), deck)[deck[0].id]).toBe("love");
    const cheap = predictSwipes(profile({ typicalBudget: 60 }), deck);
    for (const d of deck) expect(cheap[d.id]).toBe((d.costPerPerson ?? 0) > 78 ? "pass" : "like");
    const mild = predictSwipes(profile({ dietTags: ["不吃辣"] }), deck);
    for (const d of deck) expect(mild[d.id]).toBe(/重庆|麻辣|川|湘|串串/.test(d.name + d.type) ? "pass" : "like");
    expect(Object.keys(mild).sort()).toEqual(deck.map((d) => d.id).sort());
  });

  it("buildSwipeDeck：5–6 家真实附近店，同品牌一张，含最贵和最便宜，确定性", async () => {
    const map = createMockMapProvider();
    const ms = [member("A", 31.27, 120.73), member("B", 31.28, 120.74)];
    const deck = await buildSwipeDeck(j, ms, ms[0], map);
    expect(deck.length).toBeGreaterThanOrEqual(5);
    expect(deck.length).toBeLessThanOrEqual(6);
    expect(new Set(deck.map((d) => d.name.replace(/\(.*\)/, ""))).size).toBe(deck.length);
    const nearby = await map.searchAround({ lat: 31.275, lng: 120.735 }, ["火锅"], 3000, "苏州");
    expect(deck.every((d) => nearby.some((n) => n.id === d.id))).toBe(true);
    expect(await buildSwipeDeck(j, ms, ms[1], createMockMapProvider())).toEqual(deck);
  });
});

describe("fairnessWeights / ledgerEntryFor（#10）", () => {
  const entry = (regret: number, k: number) => ({ juId: `j${k}`, at: `2026-0${k}-01`, commuteMin: 30, avgCommuteMin: 20, utility: 80, regret });
  it("权重 1.0–1.6，累计遗憾越高权重越高（单调）", () => {
    let prev = 0;
    for (let r = 0; r <= 2000; r += 10) {
      const w = fairnessWeights({ x: [entry(r, 1)] }).x;
      expect(w).toBeGreaterThanOrEqual(1);
      expect(w).toBeLessThanOrEqual(1.6);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    const w = fairnessWeights({ none: [], one: [entry(50, 1)], three: [entry(50, 1), entry(50, 2), entry(50, 3)] });
    expect(w.none).toBe(1);
    expect(w.three).toBeGreaterThan(w.one);
    expect(w.one).toBeGreaterThan(w.none);
  });
  it("regret = (100 - utility) + 通勤超出平均", () => {
    expect(ledgerEntryFor("j", { proposalId: "p", utility: 70, notes: [], commuteMin: 45 }, 25, "t")).toEqual({
      juId: "j",
      at: "t",
      commuteMin: 45,
      avgCommuteMin: 25,
      utility: 70,
      regret: 50,
    });
    expect(ledgerEntryFor("j", { proposalId: "p", utility: 100, notes: [], commuteMin: 10 }, 25, "t").regret).toBe(0);
  });
});

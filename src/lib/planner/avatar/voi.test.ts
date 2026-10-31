// v6 只问会改变结果的问题（docs/AVATAR.md 4.2）：不同取值会改变推荐方案或谁被照顾到，才值得问；沿用每人 2 问 / 每局 5 问。
import { describe, expect, it } from "vitest";
import type { LatLng, MapProvider, Member, MemberPrivate, NegotiationAsk, Poi } from "../../types";
import { computeCandidates } from "../plan";
import { generateSlots } from "../slots";
import { ju as mkJu, member, spec } from "../testutil";
import { askBudget, missingFields, worthAsking, worthAskingFor } from "./voi";

type Shop = Partial<Poi> & { id: string; name: string };
function fakeMap(shops: Shop[], commute: number[][]): MapProvider {
  const pois: Poi[] = shops.map((s, p) => ({ address: "某路 1 号", type: "餐饮服务;中餐厅;餐厅", rating: 4.3, costPerPerson: 80, lat: 31.5, lng: 121 + p / 1000, ...s }));
  const pIdx = (d: LatLng) => Math.round((d.lng - 121) * 1000);
  const mIdx = (o: LatLng) => Math.round((o.lat - 31) * 1000);
  return {
    searchPlaces: async () => [],
    reverseGeocode: async () => "",
    searchAround: async () => pois,
    commute: async (origins, dest) => origins.map((o) => ({ minutes: commute[mIdx(o)]?.[pIdx(dest)] ?? 20, distanceKm: 5 })),
    transitRoute: async () => ({ minutes: 20, steps: [] }),
  };
}

const DATE = "2030-11-01";
const s = spec({ dates: [DATE], earliest: "19:00", latest: "19:00", durationMinutes: 120, category: "聚餐", poiKeywords: ["餐厅"], budgetPerPerson: undefined });
const j = mkJu(s, generateSlots(s), { id: "voi" });
/** P0 什么都没说；其余人说清楚了（时间、预算、忌口、心情都有） */
function people(n: number, p0: Partial<MemberPrivate> = {}): Member[] {
  return Array.from({ length: n }, (_, i) =>
    member(`P${i}`, 31 + i / 1000, 120, {
      id: `p${i}`,
      priv: i === 0 ? p0 : { availability: { [DATE]: { from: "18:00", pref: "ok" } }, budgetMax: 300, dietTags: ["不吃内脏"], mood: "chill" },
    }),
  );
}

async function voi(shops: Shop[], commute: number[][], ms: Member[]) {
  const { cands, weights, ctx } = await computeCandidates(j, ms, fakeMap(shops, commute), {}, () => {});
  return Object.fromEntries(worthAsking({ members: ms, cands, weights, ctx, memberId: "p0" }).map((r) => [r.field, r.worth]));
}

describe("worthAsking", () => {
  it("缺什么：没说的、局长预填的都算不确定", () => {
    expect(missingFields(people(1)[0])).toEqual(["time", "budget", "diet", "mood"]);
    expect(missingFields(people(2)[1])).toEqual([]);
    const auto = member("x", 31, 121, { priv: { availability: { [DATE]: { from: "18:00", pref: "ok" } }, budgetMax: 80, autoFilled: ["budget"], dietTags: ["不吃辣"], mood: "lazy" } });
    expect(missingFields(auto)).toEqual(["budget"]);
  });

  it("预算会改变选哪家（便宜但远 vs 贵但近）→ 值得问；心情不影响局长这一层的计算 → 不值得问", async () => {
    const shops = [
      { id: "a", name: "甲餐厅", costPerPerson: 50 },
      { id: "b", name: "乙餐厅", costPerPerson: 150 },
    ];
    const r = await voi(shops, [[25, 12], [25, 12], [25, 12]], people(3));
    expect(r.budget).toBe(true);
    expect(r.mood).toBe(false);
  });

  it("只有一家很便宜的店：预算怎么答都一样 → 不值得问；忌口（清真）会让他照顾不到 → 值得问", async () => {
    const r = await voi([{ id: "a", name: "甲餐厅", costPerPerson: 40 }], [[15], [15], [15]], people(3));
    expect(r.budget).toBe(false);
    expect(r.diet).toBe(true);
  });

  it("问的次数到上限（每人 2 次 / 每局 5 次）就都不问", async () => {
    const ask = (id: string): NegotiationAsk => ({ id, kind: "selfTime", text: "", status: "no", at: "2030-10-30T10:00:00+08:00" });
    const ms = people(3, { asks: [ask("a1"), ask("a2")] });
    expect(askBudget(ms, "p0")).toBe(0);
    const r = await voi([{ id: "a", name: "甲餐厅", costPerPerson: 50 }, { id: "b", name: "乙餐厅", costPerPerson: 150 }], [[25, 12], [25, 12], [25, 12]], ms);
    expect(Object.values(r).every((x) => x === false)).toBe(true);
    const crowd = people(4).map((m, i) => (i > 0 ? { ...m, private: { ...m.private!, asks: i < 3 ? [ask("a1"), ask("a2")] : [ask("a1")] } } : m));
    expect(askBudget(crowd, "p0")).toBe(0);
  });

  it("便捷版自己跑候选计算，结果一致", async () => {
    const ms = people(3);
    const map = fakeMap([{ id: "a", name: "甲餐厅", costPerPerson: 50 }, { id: "b", name: "乙餐厅", costPerPerson: 150 }], [[25, 12], [25, 12], [25, 12]]);
    const r = await worthAskingFor(j, ms, "p0", map);
    expect(r.find((x) => x.field === "budget")!.worth).toBe(true);
    expect(await worthAskingFor(j, ms, "nobody", map)).toEqual([]);
  });
});

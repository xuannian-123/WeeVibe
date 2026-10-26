// 决策基准集（docs/DECISION.md 第 11 节）：手写场景，每个都能手算出"对的答案"。
// 用一张可控的假地图：店、每人到每店的通勤分钟全部写死，结果和真实路况无关。
import { describe, expect, it } from "vitest";
import type { DayAvailability, LatLng, LedgerEntry, MapProvider, Member, MemberPrivate, Need, Poi, WeatherDay } from "../types";
import { generateSlots, planJu } from "./index";
import { ju as mkJu, member, spec } from "./testutil";

// ---------------------------------------------------------------- 假地图

type Shop = Partial<Poi> & { id: string; name: string };

/** 成员 i 的出发地 lat = 31 + i/1000；店 p 的 lng = 121 + p/1000。commute[i][p] = 分钟 */
function fakeMap(shops: Shop[], commute: number[][], forecast: WeatherDay[] = []): MapProvider {
  const pois: Poi[] = shops.map((s, p) => ({
    address: "某路 1 号",
    type: "餐饮服务;中餐厅",
    rating: 4.3,
    costPerPerson: 80,
    lat: 31.5,
    lng: 121 + p / 1000,
    ...s,
  }));
  const pIdx = (d: LatLng) => Math.round((d.lng - 121) * 1000);
  const mIdx = (o: LatLng) => Math.round((o.lat - 31) * 1000);
  return {
    searchPlaces: async () => [],
    reverseGeocode: async () => "",
    searchAround: async () => pois,
    commute: async (origins, dest) => origins.map((o) => ({ minutes: commute[mIdx(o)]?.[pIdx(dest)] ?? 20, distanceKm: 5 })),
    transitRoute: async () => ({ minutes: 20, steps: [] }),
    weather: async () => forecast,
  };
}

const DATE = "2030-11-01";
const day = (from = "18:00", homeBy?: string, pref: DayAvailability["pref"] = "ok"): Record<string, DayAvailability> => ({
  [DATE]: { from, ...(homeBy ? { homeBy } : {}), pref },
});
const need = (rule: Need["rule"], dim: Need["dim"], strength: Need["strength"] = 2, kind: Need["kind"] = "soft"): Need => ({
  id: `n-${rule.t}`,
  dim,
  kind,
  strength,
  rule,
  text: rule.t,
  source: "chat",
  at: "2030-10-30T10:00:00+08:00",
});
function people(n: number, over: (i: number) => Partial<MemberPrivate> & { role?: Member["role"] } = () => ({})): Member[] {
  return Array.from({ length: n }, (_, i) => {
    const { role, ...priv } = over(i);
    return member(`P${i}`, 31 + i / 1000, 120, { id: `p${i}`, ...(role ? { role } : {}), priv: { availability: day(), ...priv } });
  });
}
async function decide(
  shops: Shop[],
  commute: number[][],
  members: Member[],
  specOver: Parameters<typeof spec>[0] = {},
  ledgers: Record<string, LedgerEntry[]> = {},
  forecast: WeatherDay[] = [],
) {
  const s = spec({ dates: [DATE], earliest: "18:30", latest: "19:30", durationMinutes: 120, category: "聚餐", poiKeywords: ["餐厅"], budgetPerPerson: undefined, ...specOver });
  const j = mkJu(s, generateSlots(s), { id: "bench" });
  // 店名里带上类型词，确保通过品类过滤
  const shopsOk = shops.map((x) => ({ ...x, type: x.type ?? "餐饮服务;中餐厅;餐厅" }));
  return planJu(j, members, fakeMap(shopsOk, commute, forecast), { auditSecret: "bench", ledgers, now: new Date("2030-10-30T10:00:00+08:00") });
}
const rows = (n: number, f: (i: number) => number[]) => Array.from({ length: n }, (_, i) => f(i));

// ---------------------------------------------------------------- 场景

describe("决策基准集", () => {
  it("B1 晚下班 vs 门禁：选能让两个人都来的时间，而不是最早的时间", async () => {
    const ms = people(6, (i) => (i === 0 ? { availability: day("19:00") } : i === 1 ? { availability: day("18:00", "21:30") } : {}));
    const { plan } = await decide([{ id: "a", name: "甲餐厅" }], rows(6, () => [20]), ms);
    const rec = plan.proposals[0];
    expect(rec.attendCount).toBe(6);
    expect(rec.slot.id).not.toContain("18:30");
    expect(rec.cared).toBe(6);
    expect(plan.why?.[0]).toBe("6 个人都照顾到了");
  });

  it("B2 为了照顾预算紧的人，可以让大家多走一点（但没人掉到保底线以下）", async () => {
    // 便宜店：人均 35，大家都要 40 分钟；贵店：人均 120，大家 15 分钟。P0 私下预算 40、很在意
    const ms = people(8, (i) => (i === 0 ? { budgetMax: 40, budgetStrength: 3 } : {}));
    const shops = [
      { id: "cheap", name: "平价小馆", costPerPerson: 35 },
      { id: "dear", name: "精致餐厅", costPerPerson: 120, rating: 4.6 },
    ];
    const { plan, mine } = await decide(shops, rows(8, () => [40, 15]), ms);
    expect(plan.proposals[0].poi.id).toBe("cheap");
    expect(plan.proposals[0].cared).toBe(8);
    // P0 在贵店那个方案里不算被照顾到；每个人都能看到逐条解释
    const p0 = mine["p0"];
    const dear = p0.find((x) => plan.proposals.find((p) => p.id === x.proposalId)?.poi.id === "dear");
    if (dear) expect(dear.cared).toBe(false);
    expect(p0[0].needs?.some((r) => r.text === "人均 40 以内" && r.result === "met")).toBe(true);
  });

  it("B3 清真是硬约束：宁可评分低一点，也要选清真能吃的店", async () => {
    const ms = people(6, (i) => (i === 0 ? { dietTags: ["清真"] } : {}));
    const shops = [
      { id: "bbq", name: "炭火烤肉", type: "餐饮服务;中餐厅;烧烤", rating: 4.8 },
      { id: "halal", name: "兰州牛肉面", type: "餐饮服务;中餐厅;清真菜馆", rating: 4.0 },
    ];
    const { plan } = await decide(shops, rows(6, () => [10, 25]), ms);
    expect(plan.proposals[0].poi.id).toBe("halal");
    expect(plan.proposals[0].cared).toBe(6);
  });

  it("B4 腿脚不方便的人：选离他近的店，其他人多走几分钟", async () => {
    const ms = people(6, (i) => (i === 0 ? { needs: [need({ t: "maxCommute", minutes: 20 }, "body", 3)] } : {}));
    // X 店：P0 要 35 分钟，其他人 15；Y 店：P0 18 分钟，其他人 25
    const { plan } = await decide([{ id: "x", name: "甲店" }, { id: "y", name: "乙店" }], rows(6, (i) => (i === 0 ? [35, 18] : [15, 25])), ms);
    expect(plan.proposals[0].poi.id).toBe("y");
  });

  it("B5 公平账本：前几次跑得最远的人，这次被优先照顾", async () => {
    // 两家店完全对称：甲店离 P0 远，乙店离 P1 远。P0 之前吃亏多
    const ms = people(4);
    const shops = [{ id: "a", name: "甲店" }, { id: "b", name: "乙店" }];
    const commute = rows(4, (i) => (i === 0 ? [45, 15] : i === 1 ? [15, 45] : [20, 20]));
    const hurt: LedgerEntry[] = [1, 2, 3].map((k) => ({ juId: `old${k}`, at: `2030-0${k}-01T00:00:00Z`, commuteMin: 50, avgCommuteMin: 20, utility: 60, regret: 70 }));
    const { plan } = await decide(shops, commute, ms, {}, { p0: hurt });
    expect(plan.proposals[0].poi.id).toBe("b");
    expect(plan.caredFor).toMatch(/1 位朋友/);
  });

  it("B6 主角必须到：主角来不了的时间，再多人能来也不选", async () => {
    // 主角 19:30 后才到；其他人 18:30 最合适（20:30 门禁的有 2 个）
    const ms = people(6, (i) => (i === 0 ? { role: "must", availability: day("19:30") } : i <= 2 ? { availability: day("18:00", "21:15") } : {}));
    const { plan } = await decide([{ id: "a", name: "甲店" }], rows(6, () => [10]), ms);
    const rec = plan.proposals[0];
    expect(rec.experiences.find((e) => e.memberId === "p0")!.status).not.toBe("absent");
  });

  it("B7 不想吃火锅：同等条件下选另一家", async () => {
    const ms = people(5, (i) => (i === 0 ? { needs: [need({ t: "avoidCategory", words: ["火锅"] }, "activity")] } : {}));
    const shops = [
      { id: "hot", name: "老码头火锅", type: "餐饮服务;中餐厅;火锅店" },
      { id: "bbq", name: "韩式烤肉", type: "餐饮服务;韩国料理" },
    ];
    const { plan } = await decide(shops, rows(5, () => [20, 20]), ms);
    expect(plan.proposals[0].poi.id).toBe("bbq");
  });

  it("B8 时间实在凑不齐：照顾到尽量多的人，并如实说有人来不了", async () => {
    // P0 20:00 门禁（路上 5 分钟，19:55 得走）：只有 18:30 开始才待得满 60 分钟；P1 19:30 才出发，18:30 开始要晚 65 分钟。
    // 18:30 少 P1，19:00 / 19:30 少 P0：两人不可能同时在
    const ms = people(6, (i) => (i === 0 ? { availability: day("18:00", "20:00") } : i === 1 ? { availability: day("19:30") } : {}));
    const { plan } = await decide([{ id: "a", name: "甲店" }], rows(6, () => [5]), ms);
    const rec = plan.proposals[0];
    expect(rec.cared).toBe(5);
    expect(rec.attendCount).toBe(5);
    expect(plan.why?.join("")).toMatch(/照顾到 5\/6 人/);
    expect(plan.why?.join("")).toMatch(/1 位朋友这个时间来不了/);
  });

  // ---------------- 外部因素（docs/DECISION.md 第 6 节）

  it("B10 营业时间：不会排到打烊之后（结束前至少留 15 分钟）", async () => {
    // 甲店评分高但 21:00 打烊；乙店 23:00 打烊。活动 150 分钟：18:30 开始 21:00 结束，甲店来不及
    const ms = people(5);
    const shops = [
      { id: "early", name: "甲店", openTime: "11:00-21:00", rating: 4.9 },
      { id: "late", name: "乙店", openTime: "11:00-23:00", rating: 4.0 },
    ];
    const { plan } = await decide(shops, rows(5, () => [15, 15]), ms, { durationMinutes: 150 });
    expect(plan.proposals.every((p) => p.poi.id === "late")).toBe(true);
    const rec = plan.proposals[0];
    expect((rec.risks ?? []).some((r) => r.kind === "closing")).toBe(false);
  });

  it("B11 户外 + 当晚中雨：户外方案不成立，换室内", async () => {
    const ms = people(5);
    const shops = [
      { id: "camp", name: "江边露天烧烤营地", type: "体育休闲服务;露营地", rating: 4.9 },
      { id: "indoor", name: "室内烤肉", indoor: true, rating: 4.1 },
    ];
    const fc: WeatherDay[] = [{ date: DATE, day: { text: "阴", temp: 18, windPower: "1-3" }, night: { text: "中雨", temp: 14, windPower: "1-3" } }];
    const { plan } = await decide(shops, rows(5, () => [15, 15]), ms, {}, {}, fc);
    expect(plan.proposals.every((p) => p.poi.id === "indoor")).toBe(true);
    const rain = plan.proposals[0].risks?.find((r) => r.kind === "weather");
    expect(rain?.text).toBe("周五夜间预报中雨");
    expect(rain?.mitigation).toContain("室内");
  });

  it("B12 户外 + 4 天外还没有预报：可以选户外，但必须带室内备案", async () => {
    const ms = people(5);
    const shops = [
      { id: "camp", name: "江边露天烧烤营地", type: "体育休闲服务;露营地", rating: 4.9 },
      { id: "indoor", name: "室内烤肉", indoor: true, rating: 4.0 },
    ];
    const { plan } = await decide(shops, rows(5, () => [15, 15]), ms);
    const camp = plan.proposals.find((p) => p.poi.id === "camp")!;
    expect(camp).toBeDefined();
    expect(camp.fallback?.poi.id).toBe("indoor");
    expect(camp.fallback?.trigger).toMatch(/下雨/);
    expect(camp.risks?.find((r) => r.kind === "weather")?.confidence).toBe("unknown");
  });

  it("B13 小雨：室内的店照常选，风险里提醒带伞；户外的店扣分", async () => {
    const ms = people(5);
    const shops = [
      { id: "camp", name: "江边露天烧烤营地", type: "体育休闲服务;露营地", rating: 4.5 },
      { id: "indoor", name: "室内烤肉", indoor: true, rating: 4.3 },
    ];
    const fc: WeatherDay[] = [{ date: DATE, day: { text: "小雨", temp: 18, windPower: "1-3" }, night: { text: "小雨", temp: 14, windPower: "1-3" } }];
    const { plan } = await decide(shops, rows(5, () => [15, 15]), ms, {}, {}, fc);
    expect(plan.proposals[0].poi.id).toBe("indoor");
    expect(plan.proposals[0].risks?.find((r) => r.kind === "weather")?.mitigation).toBe("带伞；这家在室内，不受影响");
  });

  it("B9 推荐理由只用公开信息：不出现任何人的私密预算或需求原文", async () => {
    const ms = people(5, (i) => (i === 0 ? { budgetMax: 67, notes: ["最近手头紧"], needs: [need({ t: "quiet" }, "ambience")] } : {}));
    const { plan } = await decide([{ id: "a", name: "甲店", costPerPerson: 90 }], rows(5, () => [20]), ms);
    const pub = JSON.stringify({ why: plan.why, rec: plan.recommendation, props: plan.proposals.map((p) => [p.headline, p.tradeoffs, p.highlights]) });
    expect(pub).not.toMatch(/67|手头紧|quiet|P0/);
  });
});

import { describe, expect, it } from "vitest";
import type { LatLng, MapProvider, Poi } from "../types";
import { createMockMapProvider, estimateCommute } from "../map";
import { chainName, checkDiet, dietConflictReason, effectiveBudget, generateSlots, planJu, settle } from "./index";
import { budgetScore, maxCommuteScore, scoreOption } from "./score";
import { ju, member, spec } from "./testutil";

const poi = (name: string, type: string, over: Partial<Poi> = {}): Poi => ({
  id: name,
  name,
  type,
  address: "星湖街1号",
  lat: 31.27,
  lng: 120.735,
  ...over,
});

describe("忌口冲突", () => {
  const spicy = poi("川味坊老火锅(星湖街店)", "餐饮服务;中餐厅;四川菜(川菜)");
  const bbq = poi("炭火小院烧烤(月亮湾店)", "餐饮服务;中餐厅;特色/地方风味餐厅");
  const xinjiang = poi("新疆红柳烤肉(湖东店)", "餐饮服务;中餐厅;清真菜馆");

  it("不吃辣：非火锅局算冲突，火锅局改为鸳鸯锅提示", () => {
    const m = [member("小王", 31.27, 120.73, { dietTags: ["不吃辣"] })];
    expect(checkDiet(spicy, m, "聚餐")).toEqual({ conflicts: ["小王：不吃辣（川味偏辣）"], notes: [] });
    expect(checkDiet(spicy, m, "火锅")).toEqual({ conflicts: [], notes: ["有人不吃辣，记得点鸳鸯锅"] });
  });

  it("素食 / 清真 / 不吃牛肉 / 海鲜 / 内脏", () => {
    expect(dietConflictReason("素食", bbq)).toBe("以烧烤为主");
    expect(dietConflictReason("清真", bbq)).toBe("不是清真店");
    expect(dietConflictReason("清真", xinjiang)).toBeUndefined();
    expect(dietConflictReason("不吃牛肉", poi("潮汕鲜切牛肉火锅", "火锅店"))).toBe("潮汕牛肉");
    expect(dietConflictReason("不吃海鲜", poi("海边烤生蚝烧烤", "餐饮服务;中餐厅;海鲜酒楼"))).toBe("以海鲜为主");
    expect(dietConflictReason("不吃内脏", poi("毛肚研究所火锅", "火锅店"))).toBe("有毛肚");
    expect(dietConflictReason("不吃辣", poi("清汤雅舍", "餐饮服务;中餐厅;粤菜(广东菜)"))).toBeUndefined();
  });

  it("每人每个忌口一条，文案格式固定", () => {
    const ms = [
      member("小李", 0, 0, { dietTags: ["素食", "清真"] }),
      member("小张", 0, 0, { dietTags: ["素食"] }),
    ];
    expect(checkDiet(bbq, ms, "烧烤").conflicts).toEqual([
      "小李：素食（以烧烤为主）",
      "小李：清真（不是清真店）",
      "小张：素食（以烧烤为主）",
    ]);
  });
});

describe("预算与打分", () => {
  it("取 spec 预算与个人预算的最小值", () => {
    expect(effectiveBudget(100, [member("a", 0, 0, { budgetMax: 80 }), member("b", 0, 0)])).toBe(80);
    expect(effectiveBudget(undefined, [member("a", 0, 0)])).toBeUndefined();
  });

  it("预算内满分，超出按比例扣，无数据中性", () => {
    expect(budgetScore(90, 100)).toBe(20);
    expect(budgetScore(110, 100)).toBeCloseTo(16);
    expect(budgetScore(125, 100)).toBeCloseTo(10);
    expect(budgetScore(160, 100)).toBe(0);
    expect(budgetScore(undefined, 100)).toBe(14);
    expect(budgetScore(90, undefined)).toBe(14);
  });

  it("超预算和忌口冲突都会拉低总分", () => {
    const base = {
      poi: poi("某火锅", "火锅店", { rating: 4.5, costPerPerson: 95 }),
      center: { lat: 31.27, lng: 120.735 },
      maxCommute: 20,
      avgCommute: 15,
      budget: 100,
      categoryWords: ["火锅"],
      conflictCount: 0,
    };
    const ok = scoreOption(base);
    const over = scoreOption({ ...base, poi: { ...base.poi, costPerPerson: 130 } });
    const conflict = scoreOption({ ...base, conflictCount: 1 });
    expect(ok).toBeGreaterThan(over);
    expect(ok - conflict).toBe(15);
    expect(maxCommuteScore(10)).toBe(45);
    expect(maxCommuteScore(60)).toBe(0);
  });
});

describe("settle / chainName", () => {
  it("人均向上取整到 1 元", () => {
    expect(settle(1000, 3)).toEqual({ total: 1000, perPerson: 334 });
    expect(settle(600, 6)).toEqual({ total: 600, perPerson: 100 });
    expect(settle(100, 0)).toEqual({ total: 100, perPerson: 100 });
  });
  it("去掉分店名", () => {
    expect(chainName("老灶台火锅(星湖街店)")).toBe("老灶台火锅");
    expect(chainName("老灶台火锅（金鸡湖店）")).toBe("老灶台火锅");
  });
});

// ------- planJu 端到端（mock 地图） -------
function demo() {
  const s = spec({ budgetPerPerson: 100 });
  const slots = generateSlots(s);
  const [s1800, s1830, s1900] = slots.map((x) => x.id);
  const members = [
    member("局长", 31.2748, 120.7383, { id: "org", isOrganizer: true, availableSlotIds: [s1830, s1900] }),
    member("小王", 31.2745, 120.7462, { id: "w", availableSlotIds: [s1830], dietTags: ["不吃辣"] }),
    member("小李", 31.2627, 120.7293, { id: "l", availableSlotIds: [s1830, s1900], budgetMax: 90 }),
    member("小张", 31.3075, 120.6935, { id: "z", availableSlotIds: [s1830], dietTags: ["不吃内脏"] }),
    member("小陈", 31.2865, 120.743, { id: "c", availableSlotIds: [s1830, s1800] }),
    member("小周", 31.3228, 120.7113, { id: "zh", availableSlotIds: [s1800] }),
    member("退出", 31.5, 120.5, { id: "out", status: "out", availableSlotIds: [s1830] }),
  ];
  return { j: ju(s, slots), members, s1830 };
}

describe("planJu（mock 地图）", () => {
  const now = new Date("2026-10-22T12:00:00Z");

  it("端到端跑通，结构正确", async () => {
    const { j, members, s1830 } = demo();
    const plan = await planJu(j, members, createMockMapProvider(), { now });
    expect(plan.slotId).toBe(s1830);
    expect(plan.attendeeIds).toEqual(["org", "w", "l", "z", "c"]);
    expect(plan.absentIds).toEqual(["zh"]);
    expect(plan.computedAt).toBe("2026-10-22T12:00:00.000Z");
    expect(plan.options.length).toBe(3);
    const chains = plan.options.map((o) => chainName(o.poi.name));
    expect(new Set(chains).size).toBe(3);
    for (let i = 0; i < plan.options.length; i++) {
      const o = plan.options[i];
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(100);
      if (i > 0) expect(o.score).toBeLessThanOrEqual(plan.options[i - 1].score);
      expect(o.commutes.map((c) => c.memberId)).toEqual(plan.attendeeIds);
      expect(o.maxCommute).toBe(Math.max(...o.commutes.map((c) => c.minutes)));
      expect(o.reasons[0]).toBe(`最远的人打车 ${o.maxCommute} 分钟`);
      expect(o.reasons.join("|")).toMatch(/5 个人/);
      expect(o).not.toHaveProperty("blurb");
      // 火锅局：不吃辣不算冲突
      expect(o.conflicts.some((c) => c.includes("不吃辣"))).toBe(false);
    }
  });

  it("确定性：跑两次结果完全一样", async () => {
    const a = await planJu(demo().j, demo().members, createMockMapProvider(), { now });
    const b = await planJu(demo().j, demo().members, createMockMapProvider(), { now });
    expect(a).toEqual(b);
  });

  it("结果不足 5 家时扩到 6km；单家通勤失败用估算兜底", async () => {
    const { j, members } = demo();
    const radii: number[] = [];
    const far = (c: LatLng, k: number): Poi =>
      poi(`远方火锅${k}(分店${k})`, "餐饮服务;中餐厅;火锅店", { id: `p${k}`, lat: c.lat + 0.03, lng: c.lng + k * 0.001 });
    const map: MapProvider = {
      searchPlaces: async () => [],
      reverseGeocode: async () => "",
      searchAround: async (c, _k, r) => {
        radii.push(r);
        return r <= 3000 ? [far(c, 1)] : [1, 2, 3, 4, 5, 6].map((k) => far(c, k));
      },
      commute: async (origins, dest) => {
        if ((dest as Poi).id === "p2") throw new Error("boom");
        return origins.map((o) => estimateCommute(o, dest));
      },
    };
    const plan = await planJu(j, members, map, { now });
    expect(radii).toEqual([3000, 6000]);
    expect(plan.options).toHaveLength(3);
  });

  it("没有人能来时抛出明确错误", async () => {
    const { j } = demo();
    const ms = [member("A", 31.27, 120.73, { status: "out", availableSlotIds: [] })];
    await expect(planJu(j, ms, createMockMapProvider())).rejects.toThrow(/没有人/);
  });
});

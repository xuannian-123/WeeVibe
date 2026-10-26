// 理解测试集 · 规则版（没有大模型时的兜底）。数据在 needs.dataset.ts，大模型版用 scripts/eval-needs.ts 跑同一份。
import { describe, expect, it } from "vitest";
import { budgetStrengthOf, evaluateRule, extractNeeds, poiIndoor, softPenalty, type ExtractedNeed } from "./needs";
import { UNDERSTANDING_SET, type Exp } from "./needs.dataset";

function matches(got: ExtractedNeed, e: Exp): boolean {
  if (got.dim !== e.dim || got.rule.t !== e.t) return false;
  if (e.kind && got.kind !== e.kind) return false;
  if (e.strength && got.strength !== e.strength) return false;
  if (e.minutes !== undefined && (got.rule as { minutes?: number }).minutes !== e.minutes) return false;
  if (e.at && (got.rule as { at?: string }).at !== e.at) return false;
  if (e.words && JSON.stringify([...((got.rule as { words?: string[] }).words ?? [])].sort()) !== JSON.stringify([...e.words].sort())) return false;
  return true;
}

describe("理解测试集（规则版）", () => {
  it(`${UNDERSTANDING_SET.length} 句真实说法：抽出来的需求和期望完全一致`, () => {
    const wrong: string[] = [];
    for (const [text, exp] of UNDERSTANDING_SET) {
      const got = extractNeeds(text);
      const ok = got.length === exp.length && exp.every((e) => got.some((g) => matches(g, e)));
      if (!ok) wrong.push(`「${text}」→ ${JSON.stringify(got.map((g) => ({ dim: g.dim, ...g.rule, kind: g.kind, s: g.strength })))}`);
    }
    expect(wrong).toEqual([]);
  });

  it("预算有多在意", () => {
    expect(budgetStrengthOf("最近手头有点紧")).toBe(3);
    expect(budgetStrengthOf("月底了吃土中")).toBe(3);
    expect(budgetStrengthOf("价格无所谓")).toBe(1);
    expect(budgetStrengthOf("人均一百左右")).toBeUndefined();
  });
});

describe("需求评估", () => {
  const poi = (name: string, type: string, over: object = {}) => ({ name, type, ...over });
  const ctx = (p: ReturnType<typeof poi>, over: object = {}) => ({ poi: p, commuteMin: 20, stayEndMin: 21 * 60, queueMin: 0, ...over });

  it("通勤：超得越多违反越多", () => {
    expect(evaluateRule({ t: "maxCommute", minutes: 30 }, ctx(poi("a", "餐厅"), { commuteMin: 25 })).degree).toBe(0);
    expect(evaluateRule({ t: "maxCommute", minutes: 30 }, ctx(poi("a", "餐厅"), { commuteMin: 38 })).result).toBe("unmet");
    expect(evaluateRule({ t: "maxCommute", minutes: 30 }, ctx(poi("a", "餐厅"), { commuteMin: 34 })).result).toBe("partial");
  });

  it("想早点结束：按离开时刻算，跨午夜也对", () => {
    expect(evaluateRule({ t: "leaveBy", at: "21:30" }, ctx(poi("a", "餐厅"), { stayEndMin: 21 * 60 })).result).toBe("met");
    expect(evaluateRule({ t: "leaveBy", at: "21:30" }, ctx(poi("a", "餐厅"), { stayEndMin: 22 * 60 + 30 })).result).toBe("unmet");
    expect(evaluateRule({ t: "leaveBy", at: "00:00" }, ctx(poi("a", "餐厅"), { stayEndMin: 23 * 60 })).result).toBe("met");
  });

  it("环境 / 口味 / 品类：能判断的判断，判断不了的如实说不确定", () => {
    expect(evaluateRule({ t: "quiet" }, ctx(poi("星光KTV", "休闲娱乐;KTV"))).result).toBe("unmet");
    expect(evaluateRule({ t: "quiet" }, ctx(poi("某咖啡", "餐饮服务;咖啡厅"))).result).toBe("unknown");
    expect(evaluateRule({ t: "noAlcohol" }, ctx(poi("精酿小酒馆", "餐饮服务;酒吧"))).result).toBe("unmet");
    expect(evaluateRule({ t: "lightFood" }, ctx(poi("老码头火锅", "餐饮服务;中餐厅;火锅店"))).result).toBe("unmet");
    expect(evaluateRule({ t: "avoidCategory", words: ["KTV"] }, ctx(poi("纯K量贩", "休闲娱乐;KTV"))).result).toBe("unmet");
    expect(evaluateRule({ t: "preferCategory", words: ["烤肉"] }, ctx(poi("韩式烤肉", "餐饮服务;韩国料理"))).result).toBe("met");
    expect(evaluateRule({ t: "indoor" }, ctx(poi("世纪公园", "风景名胜;公园"))).result).toBe("unmet");
    expect(evaluateRule({ t: "indoor" }, ctx(poi("某商场店", "餐饮服务", { indoor: true }))).result).toBe("met");
    expect(evaluateRule({ t: "noQueue" }, ctx(poi("a", "餐饮服务;中餐厅"), { queueMin: 20 })).result).toBe("unmet");
    expect(evaluateRule({ t: "custom" }, ctx(poi("a", "x"))).result).toBe("noted");
  });

  it("室内判断：楼层优先，其次看类型，都没有就是不知道", () => {
    expect(poiIndoor({ name: "a", type: "餐饮服务", indoor: true })).toBe(true);
    expect(poiIndoor({ name: "滨江露营地", type: "体育休闲服务" })).toBe(false);
    expect(poiIndoor({ name: "a", type: "餐饮服务" })).toBeUndefined();
  });

  it("扣分 = 强度系数 × 违反程度 × 维度上限", () => {
    expect(softPenalty("money", 2, 1)).toBe(40);
    expect(softPenalty("money", 3, 0.5)).toBeCloseTo(36);
    expect(softPenalty("ambience", 1, 1)).toBeCloseTo(8);
  });
});

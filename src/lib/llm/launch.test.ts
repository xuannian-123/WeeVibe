// v6 发起解析（docs/AVATAR.md 3.1）：没说干什么 → 局长定；说了几个候选 → 候选池；只说一个品类 → 和 v5 一样。
import { describe, expect, it } from "vitest";
import { detectActivities, ruleParsePrompt, titleFromSpec } from "./rules";
import { specFromLlm } from "./spec";
import { juSpecSchema } from "./schemas";

// 2026-10-22 周四 10:00（北京时间）
const NOW = new Date("2026-10-22T02:00:00Z");
const p = (s: string) => ruleParsePrompt(s, NOW, "苏州");

describe("交给局长定", () => {
  it.each(["周六大家聚一下", "这周六你定吧", "周末出来玩点什么", "周六聚一聚，局长定"])("%s → open、局长定", (text) => {
    const { title, spec } = p(text);
    expect(spec.open).toBe(true);
    expect(spec.category).toBe("局长定");
    expect(spec.activities).toBeUndefined();
    expect(title).toMatch(/聚一聚$/);
    expect(juSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("周六大家聚一下：日期、下午到傍晚的时间窗照常解析", () => {
    const { title, spec } = p("周六大家聚一下");
    expect(title).toBe("周六聚一聚");
    expect(spec.dates).toEqual(["2026-10-24"]);
    expect(spec.earliest).toBe("14:00");
    expect(spec.durationMinutes).toBe(180);
  });

  it("吃什么你定 → 只在吃饭的活动里挑", () => {
    const { title, spec } = p("周五晚上吃什么你定");
    expect(spec.open).toBe(true);
    expect(spec.activities).toContain("hotpot");
    expect(spec.activities).not.toContain("boardgame");
    expect(title).toBe("周五吃什么局");
  });

  it("说了具体品类就不是交给局长：周六打篮球，大家聚一下", () => {
    const { spec } = p("周六打篮球，大家聚一下");
    expect(spec.category).toBe("篮球");
    expect(spec.open).toBeUndefined();
  });
});

describe("候选池", () => {
  it("吃饭或者桌游 → activities", () => {
    const { title, spec } = p("周六吃饭或者桌游");
    expect(spec.activities).toEqual(["homestyle", "boardgame"]);
    expect(spec.open).toBeUndefined();
    expect(spec.category).toBe("家常菜/桌游");
    expect(spec.poiKeywords).toEqual(["家常菜", "桌游"]);
    expect(title).toBe("周六家常菜或桌游局");
    expect(juSpecSchema.safeParse(spec).data?.activities).toEqual(["homestyle", "boardgame"]);
  });

  it("detectActivities：一个活动不算候选池", () => {
    expect(detectActivities("周五吃火锅")).toEqual({});
    expect(detectActivities("唱K还是密室")).toEqual({ activities: ["ktv", "escape"] });
    expect(detectActivities("周五聚餐吃火锅")).toEqual({});
  });
});

describe("v5 单品类不变", () => {
  it.each(["周五晚上8个人吃火锅人均100", "明晚撸串", "周六下午羽毛球", "周五聚餐吃火锅"])("%s：没有 open / activities", (text) => {
    const { spec } = p(text);
    expect(spec.open).toBeUndefined();
    expect(spec.activities).toBeUndefined();
  });

  it("titleFromSpec 对 v6 spec 也给得出局名", () => {
    expect(titleFromSpec(p("周六大家聚一下").spec, NOW)).toBe("周六聚一聚");
    expect(titleFromSpec(p("周五晚上8个人吃火锅").spec, NOW)).toBe("明晚火锅局"); // 周四说的周五 = 明晚
  });
});

describe("大模型解析也保留 v6 字段（规则为准）", () => {
  it("大模型给的品类是“聚会”，规则判定交给局长 → open 保留、品类 = 局长定", () => {
    const rule = p("周六大家聚一下");
    const out = {
      title: "周六聚会局",
      category: "聚会",
      poiKeywords: ["聚会"],
      dates: ["2026-10-24"],
      earliest: "14:00",
      latest: "17:00",
      durationMinutes: 180,
      headcount: undefined,
      budgetPerPerson: undefined,
      city: "苏州",
      notes: undefined,
    };
    const { title, spec } = specFromLlm(out, rule, NOW);
    expect(spec.open).toBe(true);
    expect(spec.category).toBe("局长定");
    expect(title).toBe("周六聚一聚");
    const pool = specFromLlm({ ...out, category: "桌游" }, p("周六吃饭或者桌游"), NOW);
    expect(pool.spec.activities).toEqual(["homestyle", "boardgame"]);
  });
});

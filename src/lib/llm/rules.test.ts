import { describe, expect, it } from "vitest";
import { parseCnNumber } from "./cn-number";
import { commuteHead, ruleParseDiet, ruleParsePrompt, titleFromSpec } from "./rules";

// 2026-10-22 周四 10:00（北京时间）
const NOW = new Date("2026-10-22T02:00:00Z");
const p = (s: string, now = NOW) => ruleParsePrompt(s, now, "苏州");

describe("parseCnNumber", () => {
  it.each([
    ["8", 8],
    ["八", 8],
    ["十二", 12],
    ["二十五", 25],
    ["一百", 100],
    ["一百五", 150],
    ["一百零五", 105],
    ["两百", 200],
    ["五十", 50],
  ])("%s → %d", (s, n) => expect(parseCnNumber(s)).toBe(n));
});

describe("ruleParsePrompt", () => {
  it("周五晚上 8 个人吃火锅人均 100", () => {
    const { title, spec } = p("周五晚上8个人吃火锅人均100");
    expect(title).toBe("周五火锅局");
    expect(spec).toMatchObject({
      category: "火锅",
      poiKeywords: ["火锅"],
      headcount: 8,
      budgetPerPerson: 100,
      dates: ["2026-10-23"],
      earliest: "18:00",
      latest: "20:00",
      durationMinutes: 120,
      city: "苏州",
    });
  });

  it("今晚撸串", () => {
    const { title, spec } = p("今晚撸串");
    expect(spec.category).toBe("烧烤");
    expect(spec.dates).toEqual(["2026-10-22"]);
    expect(spec.earliest).toBe("18:00");
    expect(title).toBe("今晚烧烤局");
  });

  it("明天中午吃日料", () => {
    const { title, spec } = p("明天中午吃日料");
    expect(spec.dates).toEqual(["2026-10-23"]);
    expect([spec.earliest, spec.latest]).toEqual(["11:30", "12:30"]);
    expect(spec.category).toBe("日料");
    expect(title).toBe("明天日料局");
  });

  it("这周末打羽毛球（运动默认 2 小时）", () => {
    const { title, spec } = p("这周末打羽毛球");
    expect(spec.dates).toEqual(["2026-10-24", "2026-10-25"]);
    expect(spec.poiKeywords).toEqual(["羽毛球馆"]);
    expect(spec.durationMinutes).toBe(120);
    expect(title).toBe("周末羽毛球局");
  });

  it("下周六去唱K", () => {
    const { spec } = p("下周六去唱K");
    expect(spec.dates).toEqual(["2026-10-31"]);
    expect(spec.category).toBe("KTV");
  });

  it("下周末剧本杀", () => {
    const { spec } = p("下周末剧本杀");
    expect(spec.dates).toEqual(["2026-10-31", "2026-11-01"]);
    expect(spec.durationMinutes).toBe(240);
  });

  it("具体时间 + 城市", () => {
    const { spec } = p("周五晚上8点在上海喝咖啡");
    expect(spec.city).toBe("上海");
    expect([spec.earliest, spec.latest]).toEqual(["19:30", "20:30"]);
    expect(spec.category).toBe("咖啡");
  });

  it("时间范围", () => {
    const { spec } = p("周五晚上7点到9点吃烤肉");
    expect([spec.earliest, spec.latest]).toEqual(["19:00", "20:00"]);
    expect(spec.category).toBe("烤肉");
  });

  it("中文数字人数 / 预算", () => {
    const { spec } = p("三四个人周日打台球，人均五十");
    expect(spec.headcount).toBe(4);
    expect(spec.budgetPerPerson).toBe(50);
    expect(spec.dates).toEqual(["2026-10-25"]);
    expect(spec.poiKeywords).toEqual(["台球"]);
  });

  it("人均一百五", () => {
    expect(p("周六烧烤人均一百五").spec.budgetPerPerson).toBe(150);
  });

  it("未知品类用原词", () => {
    const { spec } = p("周六一起玩飞镖");
    expect(spec.category).toBe("飞镖");
    expect(spec.poiKeywords).toEqual(["飞镖"]);
  });

  it("X月X号", () => {
    expect(p("10月30号聚餐").spec.dates).toEqual(["2026-10-30"]);
    expect(p("30号聚餐").spec.dates).toEqual(["2026-10-30"]);
    // 已过去的日期 → 下个月
    expect(p("5号聚餐").spec.dates).toEqual(["2026-11-05"]);
  });

  it("“周五日料”不会把“五日”当成 5 号", () => {
    expect(p("周五日料").spec.dates).toEqual(["2026-10-23"]);
  });

  it("今天就是周四时“周四”指今天", () => {
    expect(p("周四吃饭").spec.dates).toEqual(["2026-10-22"]);
  });

  it("周日说“下周五”“这周末”", () => {
    const sunday = new Date("2026-10-25T04:00:00Z");
    expect(p("下周五火锅", sunday).spec.dates).toEqual(["2026-10-30"]);
    expect(p("周五火锅", sunday).spec.dates).toEqual(["2026-10-30"]);
    expect(p("这周末火锅", sunday).spec.dates).toEqual(["2026-10-25"]);
  });

  it("没说日期：从今天起 3 天；太晚了从明天起", () => {
    expect(p("吃火锅").spec.dates).toEqual(["2026-10-22", "2026-10-23", "2026-10-24"]);
    const late = new Date("2026-10-22T14:00:00Z"); // 22:00
    expect(p("吃火锅", late).spec.dates).toEqual(["2026-10-23", "2026-10-24", "2026-10-25"]);
  });

  it("夜宵 / 午饭时间窗", () => {
    expect(p("明晚夜宵小龙虾").spec).toMatchObject({ earliest: "21:30", category: "小龙虾" });
    expect(p("周五午饭").spec).toMatchObject({ earliest: "11:30", latest: "12:30" });
  });

  it("人均100一个人 不会被识别成 1 人", () => {
    const { spec } = p("周五火锅，100一个人");
    expect(spec.headcount).toBeUndefined();
    expect(spec.budgetPerPerson).toBe(100);
  });

  it("titleFromSpec", () => {
    const { spec } = p("周五晚上吃火锅");
    expect(titleFromSpec(spec, NOW)).toBe("明晚火锅局");
  });
});

describe("ruleParseDiet", () => {
  it.each([
    ["不能吃辣，回民", ["不吃辣", "清真"]],
    ["不怕辣，海鲜过敏", ["不吃海鲜"]],
    ["吃素", ["素食"]],
    ["不吃牛肉和内脏", ["不吃牛肉", "不吃内脏"]],
    ["不吃毛肚鸭肠", ["不吃内脏"]],
    ["怕辣", ["不吃辣"]],
    ["穆斯林", ["清真"]],
    ["无", []],
    ["都行，能吃辣", []],
    ["", []],
  ])("%s", (raw, tags) => expect(ruleParseDiet(raw)).toEqual(tags));
});

describe("commuteHead", () => {
  it("最长通勤 ≤15 才说“近”，16–25 说“不算远”，>25 不提", () => {
    expect(commuteHead(15)).toBe("离大家都近");
    expect(commuteHead(16)).toBe("大家都不算远");
    expect(commuteHead(25)).toBe("大家都不算远");
    expect(commuteHead(26)).toBeUndefined();
  });
});

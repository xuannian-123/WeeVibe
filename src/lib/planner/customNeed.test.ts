import { describe, expect, it } from "vitest";
import { customNeed } from "./customNeed";

const rules = (s: string, k: "hard" | "soft" = "hard") => customNeed(s, k).needs.map((n) => n.rule.t);

describe("自己写的底线 / 想要 → 能算的规则", () => {
  it("到家时间 = 门禁", () => {
    expect(customNeed("十点前必须到家", "hard").homeBy).toBe("22:00");
    expect(customNeed("宿舍门禁11点", "hard").homeBy).toBe("23:00");
  });
  it("忌口：当底线时另加一条硬的避开这类店；当想要时只记忌口", () => {
    const h = customNeed("一点辣都不能吃", "hard");
    expect(h.dietTags).toEqual(["不吃辣"]);
    expect(h.needs[0]).toMatchObject({ kind: "hard", strength: 3, rule: { t: "avoidCategory" }, text: "一点辣都不能吃" });
    expect(customNeed("不太能吃辣", "soft").needs).toEqual([]);
    expect(customNeed("对海鲜过敏", "hard").dietTags).toEqual(["不吃海鲜"]);
  });
  it("活动：不想去 / 想去", () => {
    const no = customNeed("不想去KTV", "soft").needs[0];
    expect(no.rule).toMatchObject({ t: "avoidCategory" });
    expect((no.rule as { words: string[] }).words.map((w) => w.toLowerCase())).toContain("ktv");
    expect(customNeed("想去爬山", "soft").needs[0].rule.t).toBe("preferCategory");
  });
  it("身体：避开累的活动", () => {
    for (const s of ["膝盖不好", "不能剧烈运动"]) {
      const n = customNeed(s, "hard").needs[0];
      expect(n.dim).toBe("body");
      expect((n.rule as { words: string[] }).words).toEqual(expect.arrayContaining(["攀岩"]));
    }
  });
  it("路程、不喝酒、想安静", () => {
    expect(customNeed("路上不超过40分钟", "hard").needs[0].rule).toEqual({ t: "maxCommute", minutes: 40 });
    expect(rules("不喝酒")).toEqual(["noAlcohol"]);
    expect(rules("想安静点", "soft")).toEqual(["quiet"]);
  });
  it("算不了的照样记下，文字是本人原话", () => {
    const c = customNeed("花生过敏", "hard");
    expect(c.needs).toEqual([{ dim: "food", kind: "hard", strength: 3, rule: { t: "custom" }, text: "花生过敏" }]);
    expect(customNeed("必须有停车位", "hard").needs[0].rule.t).toBe("custom");
  });
});

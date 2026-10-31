import { describe, expect, it } from "vitest";
import { fixedActivity, juMayEat } from "./relevance";

const s = (x: Record<string, unknown>) => ({ category: "", ...x }) as Parameters<typeof juMayEat>[0];

describe("这个局用得上哪些信息", () => {
  it("下午打羽毛球：不吃饭，活动已定", () => {
    expect(juMayEat(s({ category: "羽毛球" }))).toBe(false);
    expect(fixedActivity(s({ category: "羽毛球" }))).toBe("羽毛球");
  });
  it("吃火锅 / 聚餐：吃饭，活动已定", () => {
    expect(juMayEat(s({ category: "火锅" }))).toBe(true);
    expect(juMayEat(s({ category: "聚餐" }))).toBe(true);
  });
  it("局长定：可能吃饭，活动没定", () => {
    expect(juMayEat(s({ category: "局长定", open: true }))).toBe(true);
    expect(fixedActivity(s({ category: "局长定", open: true }))).toBeUndefined();
  });
  it("先打羽毛球再吃火锅：吃饭，两段都定了；下午玩晚上吃（没定）：活动没定", () => {
    const shaped = s({ category: "羽毛球→火锅", activities: ["badminton", "hotpot"], shape: [{ kind: "play", activities: ["badminton"] }, { kind: "eat", activities: ["hotpot"] }] });
    expect(juMayEat(shaped)).toBe(true);
    expect(fixedActivity(shaped)).toBe("羽毛球 → 火锅");
    expect(fixedActivity(s({ category: "局长定", open: true, shape: [{ kind: "play" }, { kind: "eat" }] }))).toBeUndefined();
  });
  it("桌游 / 看展不吃饭；认不出的品类按可能吃饭算", () => {
    expect(juMayEat(s({ category: "桌游" }))).toBe(false);
    expect(juMayEat(s({ category: "看展" }))).toBe(false);
    expect(juMayEat(s({ category: "生日派对" }))).toBe(true);
  });
});

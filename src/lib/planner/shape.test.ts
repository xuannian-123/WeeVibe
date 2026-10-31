import { describe, expect, it } from "vitest";
import { detectConstraints, detectShape, groupBans, segmentsInWindows, shapeLabel } from "./shape";

describe("从一句话里认安排", () => {
  it("下午玩、晚上吃（都没想好）", () => {
    const s = detectShape("周五下午不知道去哪玩，不知道几点出发，不知道晚上吃什么")!;
    expect(s).toEqual([{ kind: "play", when: "afternoon" }, { kind: "eat", when: "evening" }]);
    expect(shapeLabel(s)).toBe("下午玩 → 晚上吃");
  });
  it("先打羽毛球，打完吃火锅：顺序，不是二选一", () => {
    const s = detectShape("周六下午先去打羽毛球，打完一起吃个火锅")!;
    expect(s.map((p) => [p.kind, p.activities])).toEqual([["play", ["badminton"]], ["eat", ["hotpot"]]]);
    expect(s[0].when).toBe("afternoon");
    // 没说几点吃：下午玩完吃 = 晚饭
    expect(s[1].when).toBe("evening");
  });
  it("白天随便玩玩晚上吃顿好的（没有标点也能切开）", () => {
    expect(detectShape("这周末白天随便玩玩晚上吃顿好的")?.map((p) => [p.kind, p.when])).toEqual([
      ["play", "afternoon"],
      ["eat", "evening"],
    ]);
  });
  it("只有一件事不算安排；顺序说反了按时段排", () => {
    expect(detectShape("周五晚上吃火锅")).toBeUndefined();
    expect(detectShape("周五 8 个人吃饭，人均 100")).toBeUndefined();
    expect(detectShape("晚上吃饭，下午先去看个展")?.map((p) => p.kind)).toEqual(["play", "eat"]);
  });
});

describe("整体要求", () => {
  it("有个人膝盖不好 → 累的活动都不考虑；大家都不喝酒 → 有酒的不考虑", () => {
    const c = detectConstraints("周末出去玩，有个人膝盖不好，大家都不喝酒")!;
    expect(c).toEqual(["有个人膝盖不好", "大家都不喝酒"]);
    const bans = groupBans(c);
    expect(bans.has("climbing")).toBe(true);
    expect(bans.has("hiking")).toBe(true);
    expect(bans.has("boardgame")).toBe(false);
    expect([...bans].some((k) => k === "bar" || k === "livehouse")).toBe(true);
  });
  it("不是关于大家的话不算", () => {
    expect(detectConstraints("周五下午去玩，晚上吃饭")).toBeUndefined();
  });
});

describe("每段落在说好的时段里", () => {
  it("下午开始玩、晚饭点开始吃", () => {
    const shape = [{ kind: "play" as const, when: "afternoon" as const }, { kind: "eat" as const, when: "evening" as const }];
    expect(segmentsInWindows([14 * 60 + 30, 17 * 60 + 10], shape)).toBe(true);
    expect(segmentsInWindows([13 * 60 + 30, 16 * 60 + 10], shape)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { deliberationPick, supportScores } from "./deliberate";

const opts = [
  { proposalId: "rec", fair: true },
  { proposalId: "b", fair: true },
  { proposalId: "c", fair: false },
];

describe("讨论后局长怎么定", () => {
  it("一样公平的方案里，呼声最高的胜出", () => {
    expect(deliberationPick(opts, [{ code: "A", support: "b" }, { code: "B", support: "b" }, { code: "C", support: "rec" }]).chosen).toBe("b");
  });
  it("不公平的方案呼声再高也不选（规则保底）", () => {
    expect(deliberationPick(opts, [{ code: "A", support: "c" }, { code: "B", support: "c" }, { code: "C", support: "rec" }]).chosen).toBe("rec");
  });
  it("打平按规则顺序；反对扣分；主动让步加半分", () => {
    expect(deliberationPick(opts, [{ code: "A", support: "b" }, { code: "B", support: "rec" }]).chosen).toBe("rec");
    expect(deliberationPick(opts, [{ code: "A", support: "b", oppose: "rec" }, { code: "B", support: "rec" }]).chosen).toBe("b");
    expect(supportScores(["rec", "b"], [{ code: "A", support: "b", offer: true }])).toEqual({ rec: 0, b: 1.5 });
  });
  it("同一份记录，结论一定一样（和顺序无关）", () => {
    const s = [{ code: "A", support: "b" }, { code: "B", support: "rec", oppose: "b" }, { code: "C", support: "b", offer: true }];
    expect(deliberationPick(opts, s)).toEqual(deliberationPick(opts, [...s].reverse()));
  });
});

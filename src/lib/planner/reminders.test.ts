import { describe, expect, it } from "vitest";
import type { Member, Need } from "../types";
import { customNeed } from "./customNeed";
import { remindersFor } from "./plan";

const need = (text: string): Need => ({ ...customNeed(text, "hard").needs[0], id: `n-${text}`, source: "widget", at: "" });
const who = (id: string, texts: string[], extra: Partial<Member> = {}): Member =>
  ({
    id,
    name: id,
    status: "in",
    private: { rsvp: "yes", needs: texts.map(need), dietTags: [], availability: {}, notes: [], chat: [], swipes: {}, autoFilled: [], wants: [], matches: [], billFacts: {}, inbox: [] },
    ...extra,
  }) as unknown as Member;

describe("点菜提醒", () => {
  it("挑店用不上的忌口匿名写出来：1 人说有人，多人说人数；过敏统一说法", () => {
    expect(customNeed("不吃香菜", "hard").needs[0]).toMatchObject({ dim: "food", rule: { t: "custom" } });
    const r = remindersFor([who("a", ["不吃香菜", "花生过敏"]), who("b", ["我不吃香菜"]), who("c", ["对芒果过敏"])]);
    expect(r).toEqual(["2 人不吃香菜", "有人对芒果过敏", "有人对花生过敏"].sort());
    expect(r.join()).not.toMatch(/[abc]/);
  });
  it("算得了的（不吃辣、海鲜过敏）不在这里；不在局里 / 不来的人不算", () => {
    expect(remindersFor([who("a", ["一点辣都不能吃", "对海鲜过敏"])])).toEqual([]);
    expect(remindersFor([who("a", ["不吃香菜"], { status: "out" }), who("b", ["不吃葱"], { private: undefined })])).toEqual([]);
    const declined = who("c", ["不吃香菜"]);
    declined.private!.rsvp = "no";
    expect(remindersFor([declined])).toEqual([]);
  });
  it("和谁写的、加入顺序无关", () => {
    const a = who("a", ["不吃香菜"]);
    const b = who("b", ["对芒果过敏"]);
    expect(remindersFor([a, b])).toEqual(remindersFor([b, a]));
  });
});

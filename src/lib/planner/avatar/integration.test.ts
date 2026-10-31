// v6 联调守卫：几条开发线之间的约定，合并后不能悄悄走样。
import { describe, expect, it } from "vitest";
import { LOCAL_ACTIVITIES, ONBOARD_DECK } from "../../client/activities";
import { GIVE_BY_STYLE, GIVE_MAX, mandateOf as cardMandate } from "../../client/mandate";
import type { Member, Poi } from "../../types";
import { ACTIVITY_LIB } from "../activities";
import { compensate, type Candidate } from "../plan";
import { GIVE_CAP, mandateOf, STYLE_GIVE } from "./mandate";

describe("授权书卡片和谈判用的是同一份规则", () => {
  it("卡片的常量就是谈判的常量", () => {
    expect(GIVE_BY_STYLE).toBe(STYLE_GIVE);
    expect(GIVE_MAX).toBe(GIVE_CAP);
    expect(cardMandate).toBe(mandateOf);
  });
});

describe("建档 / 授权书的活动卡都在活动库里", () => {
  it("每个本地活动 key 都能在 ACTIVITY_LIB 找到", () => {
    const keys = new Set(ACTIVITY_LIB.map((a) => a.key));
    for (const a of LOCAL_ACTIVITIES) expect(keys, a.key).toContain(a.key);
    for (const k of ONBOARD_DECK) expect(keys, k).toContain(k);
  });
});

describe("补偿：第二段按让过步的人的口味挑", () => {
  const poi = (id: string): Poi => ({ id, name: id, address: "", lat: 31.2, lng: 121.4, type: "" });
  const seg = (activity: string, p: string) => ({ activity, activityName: activity, poi: poi(p), start: "2026-11-07T15:00:00+08:00", end: "2026-11-07T17:00:00+08:00" });
  const cand = (idx: number, second: string, utils: number[], cared = 3): Candidate =>
    ({
      idx,
      slot: { id: "s1", start: "2026-11-07T15:00:00+08:00", end: "2026-11-07T20:00:00+08:00" },
      poi: poi("climb"),
      segments: [seg("climbing", "climb"), seg(second, second)],
      mines: utils.map((utility) => ({ utility, notes: [], needs: [], cared: true })),
      cared,
      caredW: cared,
      losses: utils.map((u) => 100 - u).sort((a, b) => b - a),
      nash: 0,
      vetoed: false,
    }) as unknown as Candidate;

  it("同样照顾到所有人时，挑让过步的人更满意的第二段", () => {
    const rec = cand(0, "hotpot", [90, 90, 60]);
    const alt = cand(1, "homestyle", [85, 85, 80]);
    expect(compensate(rec, [rec, alt], [2])).toBe(alt);
  });

  it("不会为了补偿少照顾一个人", () => {
    const rec = cand(0, "hotpot", [90, 90, 60]);
    const worse = cand(1, "homestyle", [40, 85, 95], 2);
    expect(compensate(rec, [rec, worse], [2])).toBe(rec);
  });

  it("没人让步或只有一段时不动", () => {
    const rec = cand(0, "hotpot", [90, 90, 60]);
    const alt = cand(1, "homestyle", [85, 85, 80]);
    expect(compensate(rec, [rec, alt], [])).toBe(rec);
    const one = { ...rec, segments: rec.segments!.slice(0, 1) } as Candidate;
    expect(compensate(one, [one, alt], [2])).toBe(one);
  });
});

// mandateOf 两个入口是同一个函数，这里再用一个真实的人确认卡片和谈判算出来的一样
describe("同一个人，卡片和谈判看到同一份授权书", () => {
  it("超过 3 条底线、本人选了 2 条", () => {
    const m = {
      id: "m1",
      private: {
        availability: { "2026-11-07": { from: "18:00", homeBy: "22:00", pref: "ok" } },
        dietTags: ["清真", "素食"],
        needs: [{ id: "n1", dim: "body", kind: "hard", strength: 3, rule: { t: "custom" }, text: "膝盖不好", source: "chat", at: "2026-11-01T00:00:00Z" }],
        confirmed: ["homeBy", "diet:清真", "diet:素食", "n1"],
        mandate: { status: "confirmed", style: "balanced", give: STYLE_GIVE.balanced, floors: ["homeBy", "n1"] },
      },
    } as unknown as Member;
    const v = cardMandate(m);
    expect(v.floors.map((f) => f.key)).toEqual(["homeBy", "n1"]);
    expect(v.demoted.map((f) => f.key).sort()).toEqual(["diet:清真", "diet:素食"]);
  });
});

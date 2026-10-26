import { describe, expect, it } from "vitest";
import type { Need, Poi, Slot } from "../types";
import { experienceFor, publicExperience } from "./index";
import { member, spec } from "./testutil";
import { bjIso } from "./util";

const DAY = "2026-10-23";
const slot = (hm: string, dur = 150): Slot => {
  const [h, m] = hm.split(":").map(Number);
  return { id: `${DAY}T${hm}`, start: `${DAY}T${hm}:00+08:00`, end: bjIso(DAY, h * 60 + m + dur) };
};
const hotpot: Poi = { id: "hp", name: "重庆红汤记火锅(星湖街店)", type: "餐饮服务;中餐厅;火锅店", address: "", lat: 0, lng: 0, costPerPerson: 120, rating: 4.2 };
const ctx = { spec: spec({ budgetPerPerson: 100 }) };

describe("公开体验（只看公开因素）", () => {
  it("到达 = max(开始, 出发 + 通勤)，迟到 / 门禁早走 / 待的时长", () => {
    const m = member("阿杰", 0, 0, { id: "j", priv: { availability: { [DAY]: { from: "18:30", homeBy: "21:00", pref: "ok" } } } });
    const e = publicExperience(m, slot("18:30"), 20);
    expect(e).toMatchObject({ status: "lateEarly", arriveAt: "18:50", lateMin: 20, leaveAt: "20:40", stayMin: 110, commuteMin: 20 });
    expect(e.notes).toEqual(["晚到 20 分钟", "20:40 需先走"]);
    // 100 - 迟到 20×0.8 - 早走 20×0.4 - 通勤超 5 分钟 - ok 4
    expect(e.utility).toBe(Math.round(100 - 16 - 8 - 5 - 4));
  });

  it("absent：那天不在 availability / 迟到超 45 / 待不满 60；没填任何时间 = 都行", () => {
    const other = member("A", 0, 0, { priv: { availability: { "2026-10-24": { from: "17:00", pref: "ok" } } } });
    expect(publicExperience(other, slot("18:00"), 10).status).toBe("absent");
    const late = member("B", 0, 0, { priv: { availability: { [DAY]: { from: "18:30", pref: "ok" } } } });
    expect(publicExperience(late, slot("18:00"), 16).status).toBe("absent"); // 迟到 46
    expect(publicExperience(late, slot("18:00"), 15).status).toBe("late"); // 迟到 45
    const gate = member("C", 0, 0, { priv: { availability: { [DAY]: { from: "17:00", homeBy: "19:30", pref: "ok" } } } });
    expect(publicExperience(gate, slot("18:00"), 31).status).toBe("absent"); // 只能待 59 分钟
    const any = member("D", 0, 0);
    expect(publicExperience(any, slot("18:00"), 10)).toMatchObject({ status: "full", lateMin: 0, utility: 96 });
  });

  it("凌晨门禁视为次日；太晚开始扣分", () => {
    const m = member("E", 0, 0, { priv: { availability: { [DAY]: { from: "17:00", homeBy: "00:30", pref: "best" } } } });
    const e = publicExperience(m, slot("22:00"), 10);
    expect(e.leaveAt).toBe("00:20");
    expect(e.status).toBe("early");
  });
});

describe("私密体验（叠加预算 / 忌口 / 刷卡 / 备注 / 排队）", () => {
  const base = { availability: { [DAY]: { from: "17:00", pref: "meh" as const } } }; // 留出加分空间，避免 100 封顶

  it("超预算 30% 以上重扣，但绝不 absent，也不影响公开体验", () => {
    const rich = member("A", 0, 0, { id: "a", priv: base });
    const poor = member("B", 0, 0, { id: "a", priv: { ...base, budgetMax: 60 } });
    const r = experienceFor(rich, slot("20:00"), hotpot, 10, ctx);
    const p = experienceFor(poor, slot("20:00"), hotpot, 10, ctx);
    expect(p.pub).toEqual(r.pub);
    expect(p.pub.status).not.toBe("absent");
    expect(r.mine.utility - p.mine.utility).toBeGreaterThanOrEqual(40);
    expect(p.mine.notes).toContain("人均 120，超出你说的 60");
    const mild = member("C", 0, 0, { priv: { ...base, budgetMax: 110 } });
    const m = experienceFor(mild, slot("20:00"), hotpot, 10, ctx);
    expect(r.mine.utility - m.mine.utility).toBeLessThan(10);
  });

  it("火锅 + 不吃辣 → 鸳鸯锅只轻扣；不吃内脏撞上毛肚店重扣", () => {
    const spicy = member("A", 0, 0, { priv: { ...base, dietTags: ["不吃辣"] } });
    const plain = member("B", 0, 0, { priv: base });
    const a = experienceFor(spicy, slot("20:00"), hotpot, 10, ctx).mine;
    const b = experienceFor(plain, slot("20:00"), hotpot, 10, ctx).mine;
    expect(b.utility - a.utility).toBe(6);
    expect(a.notes).toContain("有鸳鸯锅，你可以吃清汤那边");
    const offal = member("C", 0, 0, { priv: { ...base, dietTags: ["不吃内脏"] } });
    const maodu = { ...hotpot, name: "毛肚研究所火锅(东门店)" };
    expect(experienceFor(plain, slot("20:00"), maodu, 10, ctx).mine.utility - experienceFor(offal, slot("20:00"), maodu, 10, ctx).mine.utility).toBe(35);
  });

  it("刷卡：love 加分、pass 重扣；同品牌其他分店按 0.6 推广", () => {
    const love = member("A", 0, 0, { priv: { ...base, swipes: { hp: "love" } } });
    const pass = member("B", 0, 0, { priv: { ...base, swipes: { other: "pass" } } });
    const plain = member("C", 0, 0, { priv: base });
    const u = (m: typeof love) =>
      experienceFor(m, slot("20:00"), hotpot, 10, { ...ctx, knownPois: { other: { name: "重庆红汤记火锅(金鸡湖店)" } } }).mine.utility;
    expect(u(love) - u(plain)).toBe(12);
    expect(u(plain) - u(pass)).toBe(18);
  });

  it("v5 需求：按 强度 × 违反程度 × 维度上限 扣分，并逐条解释；饭点排队所有人轻扣", () => {
    const need = (rule: Need["rule"], dim: Need["dim"], strength: Need["strength"] = 2, kind: Need["kind"] = "soft"): Need => ({
      id: `n-${rule.t}`, dim, kind, strength, rule, text: rule.t, source: "chat", at: "2026-10-22T10:00:00+08:00",
    });
    const plain = experienceFor(member("A", 0, 0, { priv: base }), slot("20:00"), hotpot, 10, ctx).mine;
    const light = experienceFor(member("B", 0, 0, { priv: { ...base, needs: [need({ t: "lightFood" }, "food")] } }), slot("20:00"), hotpot, 10, ctx).mine;
    expect(plain.utility - light.utility).toBe(35); // food 上限 35 × 强度 2 × 完全违反
    expect(light.needs?.find((r) => r.text === "lightFood")?.result).toBe("unmet");
    // 饭点排队：所有人扣 5；特别怕排队的人再按 noQueue 扣
    const popular = { ...hotpot, rating: 4.7 };
    const q = experienceFor(member("C", 0, 0, { priv: base }), slot("18:30"), popular, 10, ctx).mine;
    expect(q.notes).toContain("饭点可能要排队约 20 分钟");
    const hate = experienceFor(member("D", 0, 0, { priv: { ...base, needs: [need({ t: "noQueue" }, "time", 1)] } }), slot("18:30"), popular, 10, ctx).mine;
    expect(q.utility - hate.utility).toBe(12); // time 上限 30 × 强度 1（0.4）
    // 硬需求不满足：人还能来，但不算被照顾到
    const far = experienceFor(member("E", 0, 0, { priv: { ...base, needs: [need({ t: "maxCommute", minutes: 5 }, "travel", 2, "hard")] } }), slot("20:00"), hotpot, 10, ctx);
    expect(far.pub.status).not.toBe("absent");
    expect(far.mine.cared).toBe(false);
    expect(plain.cared).toBe(true);
  });
});

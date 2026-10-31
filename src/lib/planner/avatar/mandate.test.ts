// v6 授权书（docs/AVATAR.md 第 2 节）：底线上限与降级、风格默认 give、风格推断、坚持风格的想要更用力、give 什么时候生效。
import { describe, expect, it } from "vitest";
import type { Member, MemberPrivate, Need } from "../../types";
import { experienceDetail, publicExperience } from "../experience";
import { generateSlots } from "../slots";
import { member, spec } from "../testutil";
import { MAX_FLOORS, STYLE_GIVE, giveInEffect, mandateOf, planMember, splitFloors, styleFromText, withGive } from "./mandate";

const DATE = "2030-11-01";
const AT = "2030-10-30T10:00:00+08:00";
const need = (id: string, rule: Need["rule"], kind: Need["kind"] = "soft", strength: Need["strength"] = 2, at = AT): Need => ({
  id,
  dim: rule.t === "maxCommute" ? "travel" : rule.t === "leaveBy" ? "time" : "ambience",
  kind,
  strength,
  rule,
  text: id,
  source: "chat",
  at,
});
const mk = (p: Partial<MemberPrivate>): Member => member("P", 31, 121, { id: "p", priv: p });

/** 5 条硬约束：门禁、清真、素食、两条硬需求 */
function fiveFloors(over: Partial<MemberPrivate> = {}): Member {
  return mk({
    availability: { [DATE]: { from: "18:00", homeBy: "20:00", pref: "ok" } },
    dietTags: ["清真", "素食", "不吃辣"],
    needs: [need("h1", { t: "maxCommute", minutes: 40 }, "hard", 2, "2030-10-30T09:00:00+08:00"), need("h2", { t: "noAlcohol" }, "hard", 2, "2030-10-30T11:00:00+08:00")],
    ...over,
  });
}

describe("底线上限", () => {
  it("MAX_FLOORS = 3；超过时保留最早确认的 3 条，其余降成强度 3 的想要", () => {
    expect(MAX_FLOORS).toBe(3);
    const m = fiveFloors({ confirmed: ["h2", "diet:素食", "homeBy"] });
    const v = mandateOf(m);
    expect(v.floors.map((f) => f.key)).toEqual(["h2", "diet:素食", "homeBy"]);
    expect(v.demoted.map((f) => f.key)).toEqual(["diet:清真", "h1"]);
    for (const d of v.demoted) expect(v.wants.find((w) => w.key === d.key)?.strength).toBe(3);
  });

  it("本人在授权书里选了哪几条就保留哪几条", () => {
    const m = fiveFloors({ confirmed: ["h2", "diet:素食", "homeBy"], mandate: { status: "confirmed", style: "balanced", give: STYLE_GIVE.balanced, floors: ["h1", "diet:清真"] } });
    const { floors, demoted } = splitFloors(m);
    // 选了 2 条，不够 3 条按最早确认的补齐
    expect(floors.map((f) => f.key).sort()).toEqual(["diet:清真", "h1", "h2"].sort());
    expect(demoted.map((f) => f.key).sort()).toEqual(["diet:素食", "homeBy"].sort());
  });

  it("不超过 3 条时全是底线，没有降级", () => {
    const v = mandateOf(mk({ availability: { [DATE]: { from: "18:00", homeBy: "22:00", pref: "ok" } }, dietTags: ["清真"] }));
    expect(v.floors.map((f) => f.key)).toEqual(["homeBy", "diet:清真"]);
    expect(v.demoted).toEqual([]);
  });

  it("降级在规划计算里真正生效：被降级的门禁不再让人来不了、被降级的清真不再算硬约束、被降级的硬需求按软需求算", () => {
    const s = spec({ dates: [DATE], earliest: "19:00", latest: "19:00", durationMinutes: 120 });
    const slot = generateSlots(s)[0];
    const poi = { id: "x", name: "老张川菜馆", address: "", type: "餐饮服务;中餐厅;川菜", lat: 31, lng: 121, costPerPerson: 80 };
    // 门禁、清真最后才确认 → 被降级
    const m = fiveFloors({ confirmed: ["h1", "h2", "diet:素食", "homeBy", "diet:清真"] });
    expect(publicExperience(m, slot, 20).status).toBe("absent"); // 20:00 门禁，19:00 开始待不满 60 分钟
    const pm = planMember(m);
    expect(publicExperience(pm, slot, 20).status).not.toBe("absent");
    const d = experienceDetail(pm, slot, poi, 20, { spec: s });
    // 素食（底线）在川菜馆不冲突、清真被降级 → 不算硬约束；被降级的门禁变成"想几点前结束"扣分
    expect(d.flags.hard).toBe(false);
    expect(d.soft.some((x) => x.key === "demoted-homeBy")).toBe(true);
    expect(d.soft.some((x) => x.key === "demoted-diet:清真")).toBe(true);
    // 原成员一点没改
    expect(m.private!.availability[DATE].homeBy).toBe("20:00");
  });
});

describe("风格与 give", () => {
  it("风格默认 give：随和 30/30/30/20、平衡 15/15/15/10、坚持 0", () => {
    expect(STYLE_GIVE.easy).toEqual({ lateMin: 30, stayCutMin: 30, budgetUp: 30, commuteUp: 20 });
    expect(STYLE_GIVE.balanced).toEqual({ lateMin: 15, stayCutMin: 15, budgetUp: 15, commuteUp: 10 });
    expect(STYLE_GIVE.firm).toEqual({ lateMin: 0, stayCutMin: 0, budgetUp: 0, commuteUp: 0 });
  });

  it("从这次说的话推断风格：我都行 → 随和；这次就想吃火锅 → 坚持；看不出来 → 平衡", () => {
    expect(styleFromText("我都行，你们定")).toBe("easy");
    expect(styleFromText("这次就想吃火锅")).toBe("firm");
    expect(styleFromText("都行，但这次就想吃火锅")).toBe("firm");
    expect(styleFromText("周五晚上有空")).toBeUndefined();
    const chat = (text: string) => mk({ chat: [{ role: "me", text, at: AT }] });
    expect(mandateOf(chat("我都行")).style).toBe("easy");
    expect(mandateOf(chat("我都行")).give).toEqual(STYLE_GIVE.easy);
    expect(mandateOf(chat("这次就想吃火锅")).give).toEqual(STYLE_GIVE.firm);
    expect(mandateOf(chat("周五有空"))).toMatchObject({ style: "balanced", give: STYLE_GIVE.balanced, status: "draft" });
  });

  it("坚持风格：想要的强度 +1（上限 3）；心情、预算、软忌口都进想要", () => {
    const p: Partial<MemberPrivate> = {
      needs: [need("q", { t: "quiet" }, "soft", 2), need("c", { t: "maxCommute", minutes: 30 }, "soft", 3)],
      budgetMax: 80,
      budgetStrength: 1,
      dietTags: ["不吃辣"],
      mood: "chill",
    };
    const firm = mandateOf(mk({ ...p, mandate: { status: "confirmed", style: "firm", give: STYLE_GIVE.firm, floors: [] } }));
    expect(Object.fromEntries(firm.wants.map((w) => [w.key, w.strength]))).toEqual({ q: 3, c: 3, budget: 2, "diet:不吃辣": 3, mood: 3 });
    const easy = mandateOf(mk({ ...p, mandate: { status: "confirmed", style: "easy", give: STYLE_GIVE.easy, floors: [] } }));
    expect(Object.fromEntries(easy.wants.map((w) => [w.key, w.strength]))).toEqual({ q: 2, c: 3, budget: 1, "diet:不吃辣": 2, mood: 2 });
    // 计算里也更用力（授权书确认过才算）
    const pm = planMember(mk({ ...p, mandate: { status: "confirmed", style: "firm", give: STYLE_GIVE.firm, floors: [] } }));
    expect(pm.private!.needs!.find((n) => n.id === "q")!.strength).toBe(3);
    expect(pm.private!.budgetStrength).toBe(2);
  });

  it("give 只有确认过的授权书才生效；撤回过的那一维视为 0", () => {
    const md = { style: "easy" as const, give: STYLE_GIVE.easy, floors: [] };
    expect(giveInEffect(mk({}))).toEqual(STYLE_GIVE.firm);
    expect(giveInEffect(mk({ mandate: { ...md, status: "draft" } }))).toEqual(STYLE_GIVE.firm);
    expect(giveInEffect(mk({ mandate: { ...md, status: "confirmed" } }))).toEqual(STYLE_GIVE.easy);
    const revoked = mk({ mandate: { ...md, status: "confirmed" }, avatarLog: [{ id: "x", at: AT, kind: "concede", text: "", dim: "lateMin", revoked: true }] });
    expect(giveInEffect(revoked)).toEqual({ ...STYLE_GIVE.easy, lateMin: 0 });
  });

  it("withGive：时间放宽门槛、预算加上 budgetUp、通勤软需求放宽；底线（门禁 / 硬需求）不动", () => {
    const m = mk({
      availability: { [DATE]: { from: "18:00", homeBy: "21:00", pref: "ok" } },
      budgetMax: 60,
      needs: [need("c", { t: "maxCommute", minutes: 20 }), need("h", { t: "maxCommute", minutes: 40 }, "hard")],
    });
    const g = withGive(m, STYLE_GIVE.easy, ["lateMin", "stayCutMin", "budgetUp", "commuteUp"]);
    expect(g.private!.relax).toEqual({ maxLateMin: 75, minStayMin: 30 });
    expect(g.private!.budgetMax).toBe(90);
    expect(g.private!.needs!.map((n) => (n.rule.t === "maxCommute" ? n.rule.minutes : 0))).toEqual([40, 40]);
    expect(g.private!.availability[DATE].homeBy).toBe("21:00");
    expect(m.private!.budgetMax).toBe(60);
  });
});

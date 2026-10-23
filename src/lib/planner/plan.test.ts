import { describe, expect, it } from "vitest";
import type { LatLng, MapProvider, Poi } from "../types";
import { createMockMapProvider, estimateCommute } from "../map";
import { canonicalJson, chainName, checkDiet, dietConflictReason, generateSlots, planJu, settle } from "./index";
import { dominates, paretoFront, type Candidate } from "./plan";
import { hmacHex, sha256Hex } from "./util";
import { ju, member, spec } from "./testutil";

const poi = (name: string, type: string, over: Partial<Poi> = {}): Poi => ({
  id: name,
  name,
  type,
  address: "星湖街1号",
  lat: 31.27,
  lng: 120.735,
  ...over,
});

describe("忌口冲突（v3 忌口在 private 里）", () => {
  const spicy = poi("川味坊老火锅(星湖街店)", "餐饮服务;中餐厅;四川菜(川菜)");
  const bbq = poi("炭火小院烧烤(月亮湾店)", "餐饮服务;中餐厅;特色/地方风味餐厅");
  const xinjiang = poi("新疆红柳烤肉(湖东店)", "餐饮服务;中餐厅;清真菜馆");

  it("不吃辣：非火锅局算冲突，火锅局改为鸳鸯锅提示", () => {
    const m = [member("小王", 31.27, 120.73, { priv: { dietTags: ["不吃辣"] } })];
    const sichuan = poi("川味坊(星湖街店)", "餐饮服务;中餐厅;四川菜(川菜)");
    expect(checkDiet(sichuan, m, "聚餐")).toEqual({ conflicts: ["小王：不吃辣（川味偏辣）"], notes: [] });
    expect(checkDiet(spicy, m, "火锅")).toEqual({ conflicts: [], notes: ["有人不吃辣，记得点鸳鸯锅"] });
  });

  it("素食 / 清真 / 不吃牛肉 / 海鲜 / 内脏", () => {
    expect(dietConflictReason("素食", bbq)).toBe("以烧烤为主");
    expect(dietConflictReason("清真", bbq)).toBe("不是清真店");
    expect(dietConflictReason("清真", xinjiang)).toBeUndefined();
    expect(dietConflictReason("不吃牛肉", poi("潮汕鲜切牛肉火锅", "火锅店"))).toBe("潮汕牛肉");
    expect(dietConflictReason("不吃海鲜", poi("海边烤生蚝烧烤", "餐饮服务;中餐厅;海鲜酒楼"))).toBe("以海鲜为主");
    expect(dietConflictReason("不吃内脏", poi("毛肚研究所火锅", "火锅店"))).toBe("有毛肚");
    expect(dietConflictReason("不吃辣", poi("清汤雅舍", "餐饮服务;中餐厅;粤菜(广东菜)"))).toBeUndefined();
  });
});

describe("settle / chainName / canonicalJson", () => {
  it("人均向上取整到 1 元", () => {
    expect(settle(1000, 3)).toEqual({ total: 1000, perPerson: 334 });
    expect(settle(600, 6)).toEqual({ total: 600, perPerson: 100 });
    expect(settle(100, 0)).toEqual({ total: 100, perPerson: 100 });
  });
  it("去掉分店名", () => {
    expect(chainName("老灶台火锅(星湖街店)")).toBe("老灶台火锅");
    expect(chainName("老灶台火锅（金鸡湖店）")).toBe("老灶台火锅");
  });
  it("键顺序无关、去 undefined、非有限数为 null", () => {
    expect(canonicalJson({ b: 1, a: { d: [1, undefined, NaN], c: undefined } })).toBe('{"a":{"d":[1,null,null]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(canonicalJson(new Date("2026-10-22T00:00:00Z"))).toBe('"2026-10-22T00:00:00.000Z"');
  });
});

describe("帕累托前沿", () => {
  const c = (attend: number, wMin: number, cost: number, idx: number) => ({ attend, wMin, cost, idx }) as Candidate;
  it("被全面压制的候选不在前沿上", () => {
    const a = c(6, 70, 100, 0);
    const b = c(6, 60, 110, 1); // 被 a 支配
    const d = c(5, 80, 100, 2);
    const e = c(6, 50, 70, 3);
    expect(dominates(a, b)).toBe(true);
    expect(dominates(a, d)).toBe(false);
    expect(paretoFront([a, b, d, e]).map((x) => x.idx)).toEqual([0, 2, 3]);
  });
});

// ------- planJu 端到端（mock 地图，苏州） -------
const DAY = "2026-10-23";
function demo() {
  const s = spec({ budgetPerPerson: 100 });
  const slots = generateSlots(s);
  const members = [
    member("局长", 31.2748, 120.7383, { id: "org", isOrganizer: true, priv: { availability: { [DAY]: { from: "17:30", pref: "best" } } } }),
    member("小王", 31.2745, 120.7462, { id: "w", priv: { availability: { [DAY]: { from: "18:00", pref: "ok" } }, dietTags: ["不吃辣"] } }),
    member("小李", 31.2627, 120.7293, { id: "l", priv: { availability: { [DAY]: { from: "17:00", pref: "ok" } }, budgetMax: 90 } }),
    member("小张", 31.3075, 120.6935, {
      id: "z",
      priv: { availability: { [DAY]: { from: "17:30", homeBy: "21:30", pref: "ok" } }, dietTags: ["不吃内脏"] },
    }),
    member("小陈", 31.2865, 120.743, { id: "c", priv: { availability: { [DAY]: { from: "18:40", pref: "meh" } } } }),
    member("小周", 31.3228, 120.7113, { id: "zh", priv: { availability: { "2026-10-24": { from: "17:00", pref: "ok" } } } }),
    member("退出", 31.5, 120.5, { id: "out", status: "out" }),
  ];
  return { j: ju(s, slots), members };
}
const now = new Date("2026-10-22T12:00:00Z");
const opts = { auditSecret: "s3cret", now };

describe("planJu（mock 地图）", () => {
  it("端到端跑通，结构正确", async () => {
    const { j, members } = demo();
    const traces: string[] = [];
    const { plan, mine } = await planJu(j, members, createMockMapProvider(), { ...opts, onTrace: (k, t) => traces.push(`${k}:${t}`) });
    expect(plan.computedAt).toBe("2026-10-22T12:00:00.000Z");
    expect(plan.proposals.length).toBeGreaterThanOrEqual(2);
    expect(plan.proposals.length).toBeLessThanOrEqual(3);
    expect(plan.proposals[0].recommended).toBe(true);
    expect(plan.proposals.filter((p) => p.recommended)).toHaveLength(1);
    expect(new Set(plan.proposals.map((p) => p.label)).size).toBe(plan.proposals.length);
    for (const p of plan.proposals) {
      expect(p.experiences.map((e) => e.memberId)).toEqual(["org", "w", "l", "z", "c", "zh"]); // 退出的人不在
      expect(p.experiences.find((e) => e.memberId === "zh")!.status).toBe("absent");
      expect(p.attendCount).toBe(p.experiences.filter((e) => e.status !== "absent").length);
      expect(p.score).toBeGreaterThanOrEqual(0);
      expect(p.score).toBeLessThanOrEqual(100);
      expect(p).not.toHaveProperty("blurb");
      expect(p.headline).toMatch(/人/);
      expect(p.tradeoffs.join("|")).toMatch(/小周.*这个时间来不了/);
    }
    // 小陈 18:40 才能出发：迟到 = max(0, 18:40 + 通勤 - 开始)
    for (const p of plan.proposals) {
      const e = p.experiences.find((x) => x.memberId === "c")!;
      const start = Number(p.slot.id.slice(11, 13)) * 60 + Number(p.slot.id.slice(14, 16));
      if (e.status !== "absent") expect(e.lateMin).toBe(Math.max(0, 18 * 60 + 40 + e.commuteMin - start));
    }
    expect(Object.keys(mine).sort()).toEqual(["c", "l", "org", "w", "z", "zh"]);
    expect(mine.org.map((x) => x.proposalId)).toEqual(plan.proposals.map((p) => p.id));
    expect(plan.audit.candidates).toBe(j.slots.length * 8);
    expect(plan.audit.evaluations).toBe(plan.audit.candidates * 6);
    expect(plan.audit.paretoSize).toBeGreaterThanOrEqual(plan.proposals.length);
    expect(plan.audit.algorithmVersion).toMatch(/^juzhang-planner\//);
    expect(plan.constraintSummaries.join("|")).toMatch(/有人预算偏紧/);
    expect(plan.constraintSummaries.join("|")).toMatch(/有人不吃辣，会点鸳鸯锅/);
    expect(traces.some((t) => /计算了 \d+ 个时段 × 8 家店 × 6 个人 = \d+ 次体验/.test(t))).toBe(true);
    expect(traces.some((t) => /帕累托前沿.*剩 \d+ 个候选/.test(t))).toBe(true);
    expect(traces.at(-1)).toMatch(/^done:/);
  });

  it("确定性：两次输出 canonicalJson 逐字节相同，outputHash 相同；inputHash = HMAC(输入)", async () => {
    const a = await planJu(demo().j, demo().members, createMockMapProvider(), opts);
    const b = await planJu(demo().j, demo().members, createMockMapProvider(), opts);
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(a.plan.audit.outputHash).toBe(b.plan.audit.outputHash);
    expect(a.plan.audit.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.plan.audit.inputHash).toMatch(/^[0-9a-f]{64}$/);
    // 换密钥 → inputHash 变，outputHash 不变
    const c = await planJu(demo().j, demo().members, createMockMapProvider(), { ...opts, auditSecret: "other" });
    expect(c.plan.audit.inputHash).not.toBe(a.plan.audit.inputHash);
    expect(c.plan.audit.outputHash).toBe(a.plan.audit.outputHash);
    // 不同时刻复算：outputHash 不变（computedAt 不进哈希）
    const d = await planJu(demo().j, demo().members, createMockMapProvider(), { ...opts, now: new Date("2026-10-23T00:00:00Z") });
    expect(d.plan.audit.outputHash).toBe(a.plan.audit.outputHash);
    // 成员对象键顺序打乱也一样
    const shuffled = demo().members.map((m) => Object.fromEntries(Object.entries(m).reverse()) as typeof m);
    const e = await planJu(demo().j, shuffled, createMockMapProvider(), opts);
    expect(e.plan.audit.inputHash).toBe(a.plan.audit.inputHash);
    expect(canonicalJson(e)).toBe(canonicalJson(a));
    expect(sha256Hex("x")).not.toBe(hmacHex("k", "x"));
  });

  it("主角来不了的候选直接否决", async () => {
    const { j, members } = demo();
    // 小陈当主角：他 18:40 才能出发，迟到会很多的早场直接否决；他永远在场
    const ms = members.map((m) => (m.id === "c" ? { ...m, role: "must" as const } : m));
    const { plan } = await planJu(j, ms, createMockMapProvider(), opts);
    for (const p of plan.proposals) expect(p.experiences.find((e) => e.memberId === "c")!.status).not.toBe("absent");
  });

  it("结果不足 5 家时扩到 6km；单家通勤失败用估算兜底", async () => {
    const { j, members } = demo();
    const radii: number[] = [];
    const far = (c: LatLng, k: number): Poi =>
      poi(`远方火锅${k}(分店${k})`, "餐饮服务;中餐厅;火锅店", { id: `p${k}`, lat: c.lat + 0.03, lng: c.lng + k * 0.001, costPerPerson: 60 + k * 10 });
    const map: MapProvider = {
      searchPlaces: async () => [],
      reverseGeocode: async () => "",
      searchAround: async (c, _k, r) => {
        radii.push(r);
        return r <= 3000 ? [far(c, 1)] : [1, 2, 3, 4, 5, 6].map((k) => far(c, k));
      },
      commute: async (origins, dest) => {
        if ((dest as Poi).id === "p2") throw new Error("boom");
        return origins.map((o) => estimateCommute(o, dest));
      },
      transitRoute: async () => ({ minutes: 10, steps: [] }),
    };
    const { plan } = await planJu(j, members, map, opts);
    expect(radii).toEqual([3000, 6000]);
    expect(plan.proposals.length).toBeGreaterThanOrEqual(2);
    expect(plan.audit.candidates).toBe(j.slots.length * 6);
  });

  it("没有在局的人时抛出明确错误", async () => {
    const { j } = demo();
    const ms = [member("A", 31.27, 120.73, { status: "out" })];
    await expect(planJu(j, ms, createMockMapProvider(), opts)).rejects.toThrow(/没有人/);
  });
});

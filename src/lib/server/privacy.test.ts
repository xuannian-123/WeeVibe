// 反事实泄露检验（CONTRACT 第二节第 7 条）：≥ 200 组种子化随机场景，mock 地图、无 LLM，0 泄露才算通过。
// 核心逻辑在 privacy.ts，和 GET /api/privacy/selftest 共用。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { describe, expect, it } from "vitest";
import { createMockMapProvider } from "../map";
import type { Ju, Member, Plan } from "../types";
import { guardMessages, guardPlan, publicFacts, publicState, scanText, sensitiveOf } from "./firewall";
import { genScenario, publicOutputs, runPrivacySelfTest, swapHidden } from "./privacy";

const map = createMockMapProvider();

describe("反事实泄露检验", () => {
  it("200 组随机场景，0 泄露", { timeout: 300_000 }, async () => {
    const r = await runPrivacySelfTest({ scenarios: 200, seed: 20261022, map });
    if (r.failures.length) console.error(JSON.stringify(r.failures.slice(0, 50), null, 2));
    expect(r.runs).toBe(200);
    expect(r.checks.find((c) => c.name.startsWith("交换"))!.runs).toBe(200);
    expect(r.checks.find((c) => c.name.startsWith("可否认"))!.runs).toBeGreaterThan(30);
    expect(r.leaks).toBe(0);
  });

  it("同一个种子 → 同一个场景（可复现）", async () => {
    const a = await genScenario(7, map);
    const b = await genScenario(7, map);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("检验本身是灵敏的：故意把私密预算写进公告，交换检验和字面检验都能抓到", async () => {
    let sc = await genScenario(11, map);
    for (let s = 12; !sc.members.find((m) => m.id === sc.a)!.private!.budgetMax; s++) sc = await genScenario(s, map);
    const A = sc.members.find((m) => m.id === sc.a)!;
    const B = sc.members.find((m) => m.id === sc.b)!;
    B.private!.budgetMax = A.private!.budgetMax === 97 ? 83 : 97;
    const leakyAnnounce = (s: typeof sc) => {
      const x = structuredClone(s);
      const a = x.members.find((m) => m.id === x.a)!;
      x.ju.announcements.push({ at: "2026-10-28T02:00:00Z", text: `${a.name}预算${a.private!.budgetMax}` });
      return x;
    };
    const o1 = await publicOutputs(leakyAnnounce(sc), map);
    const o2 = await publicOutputs(leakyAnnounce(swapHidden(sc)), map);
    expect(o1.json).not.toBe(o2.json);
    const hits = scanText(o1.json, sensitiveOf(o1.ju, o1.members));
    expect(hits.some((h) => h.kind === "budget")).toBe(true);
  });
});

// ---------------------------------------------------------------- 输出兜底

function tinyJu(): { ju: Ju; members: Member[] } {
  const ju: Ju = {
    id: "g1",
    title: "火锅局",
    rawPrompt: "",
    spec: { category: "火锅", poiKeywords: ["火锅"], dates: ["2026-10-30"], earliest: "18:00", latest: "19:00", durationMinutes: 120, city: "上海" },
    slots: [],
    status: "collecting",
    createdAt: "2026-10-28T00:00:00Z",
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    admin: { tiers: [{ token: "tiertokenxyz", tier: 1, label: "核心圈" }], auditSecret: "s3cr3t-audit" },
  };
  const mk = (id: string, name: string, status: Member["status"], budget?: number, note?: string): Member => ({
    id,
    juId: "g1",
    name,
    avatar: "🙂",
    role: "guest",
    intake: "done",
    status,
    joinedAt: "2026-10-28T00:00:00Z",
    isOrganizer: id === "m1",
    private: {
      chat: [],
      availability: {},
      dietTags: [],
      notes: note ? [note] : [],
      swipes: {},
      autoFilled: [],
      wants: [],
      matches: [],
      billFacts: {},
      inbox: [],
      ...(budget ? { budgetMax: budget } : {}),
    },
    secret: { token: `tok-${id}-abcdef`, tier: 1 },
  });
  return { ju, members: [mk("m1", "老王", "in"), mk("m2", "小林", "in", 83, "这个月生活费快见底了"), mk("m3", "阿May", "out")] };
}

describe("输出兜底", () => {
  it("群消息命中私密备注 / 预算 / 不在场的名字 → 退回规则版", () => {
    const { ju, members } = tinyJu();
    const fallback = { broadcast: "规则版", nudges: [] };
    const leaky = [
      { broadcast: "小林说这个月生活费快见底了", nudges: [] },
      { broadcast: "有人人均只能 83", nudges: [] },
      { broadcast: "阿May 这次不来", nudges: [] },
      { broadcast: "ok", nudges: [{ memberId: "m3", name: "阿May", text: "快来" }] },
    ];
    for (const m of leaky) expect(guardMessages(ju, members, m, fallback)).toBe(fallback);
    const clean = { broadcast: "有人预算偏紧，已按大家都舒服的价位筛选", nudges: [] };
    expect(guardMessages(ju, members, clean, fallback)).toBe(clean);
  });

  it("润色改了数字 / 排序就退回规则版", () => {
    const { ju, members } = tinyJu();
    const plan: Plan = {
      proposals: [
        {
          id: "p1",
          label: "balanced" as const,
          labelText: "均衡",
          slot: { id: "s", start: "2026-10-30T18:00:00+08:00", end: "2026-10-30T20:00:00+08:00" },
          poi: { id: "poi1", name: "某火锅", address: "x", lat: 31, lng: 121, type: "火锅店", costPerPerson: 90 },
          experiences: [],
          attendCount: 2,
          minUtility: 70,
          avgUtility: 80,
          score: 77,
          headline: "2 人全到",
          tradeoffs: [],
          highlights: [],
          recommended: true,
        },
      ],
      recommendation: "推荐均衡",
      constraintSummaries: [],
      center: { lat: 31, lng: 121 },
      audit: { inputHash: "a", outputHash: "b", candidates: 1, evaluations: 2, paretoSize: 1, algorithmVersion: "t" },
      computedAt: "2026-10-28T00:00:00Z",
    };
    const tampered = structuredClone(plan);
    tampered.proposals[0].score = 99;
    expect(guardPlan(ju, members, plan, tampered).proposals[0].score).toBe(77);
    const leaky = structuredClone(plan);
    leaky.proposals[0].blurb = "照顾一下生活费快见底了的朋友";
    leaky.recommendation = "小林这个月生活费快见底了";
    expect(guardPlan(ju, members, plan, leaky).recommendation).toBe("推荐均衡");
    const ok = structuredClone(plan);
    ok.proposals[0].blurb = "人均 90，热乎乎";
    expect(guardPlan(ju, members, plan, ok).proposals[0].blurb).toBe("人均 90，热乎乎");
  });

  it("公开视图 / PublicFacts 不含私密字段，不在场的人不存在", () => {
    const { ju, members } = tinyJu();
    const st = publicState(ju, members, undefined, { mine: {} });
    const s = JSON.stringify(st);
    expect(st.members.map((m) => m.name)).toEqual(["老王", "小林"]);
    for (const bad of ["阿May", "生活费", "tok-", "s3cr3t", "tiertoken", "核心圈", '"private"', '"secret"', '"admin"']) {
      expect(s).not.toContain(bad);
    }
    expect(JSON.stringify(publicFacts(ju, members))).not.toContain("阿May");
  });
});

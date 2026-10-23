// 隐私性质测试：私密字段（预算 / 忌口 / 刷卡 / 备注 / 分账事实 / 想认识谁）怎么改，公开输出都不变或不泄露。
import { describe, expect, it } from "vitest";
import type { DietTag, Member, MemberPrivate, Poi, SwipeVerdict } from "../types";
import { createMockMapProvider, haversineKm } from "../map";
import { hashString, seededRandom } from "../map/geo";
import { canonicalJson, experienceFor, generateSlots, planJu } from "./index";
import { ju, member, spec } from "./testutil";

const DAYS = ["2026-10-23", "2026-10-24"];
const TAGS: DietTag[] = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"];
const VERDICTS: SwipeVerdict[] = ["love", "like", "pass"];
const NOTES = ["这周减肥，别太油", "想安静点", "不想跑太远", "明天早起，想早点回", "最怕排队", "想吃火锅"];
const s = spec({ dates: DAYS, budgetPerPerson: 100 });
const j = ju(s, generateSlots(s));
const map = createMockMapProvider();

type R = () => number;
const pick = <T>(r: R, xs: T[]): T => xs[Math.floor(r() * xs.length)];

/** 随机一套私密字段（不含 availability —— 它是公开体验的合法输入：出发 / 门禁时刻） */
function randomSecrets(r: R, pois: Poi[]): Partial<MemberPrivate> {
  const swipes: Record<string, SwipeVerdict> = {};
  for (const p of pois) if (r() < 0.4) swipes[p.id] = pick(r, VERDICTS);
  return {
    budgetMax: r() < 0.7 ? 30 + Math.floor(r() * 120) + 0.25 : undefined,
    dietTags: TAGS.filter(() => r() < 0.25),
    notes: NOTES.filter(() => r() < 0.3),
    swipes,
    billFacts: { noAlcohol: r() < 0.5, leftEarly: r() < 0.3, skipItems: r() < 0.3 ? ["毛肚"] : [] },
    wants: r() < 0.5 ? ["x"] : [],
    rsvp: r() < 0.5 ? "yes" : undefined,
  };
}

function randomMembers(r: R, n: number): Member[] {
  return Array.from({ length: n }, (_, i) => {
    const avail: MemberPrivate["availability"] = {};
    for (const d of DAYS)
      if (r() < 0.8)
        avail[d] = {
          from: pick(r, ["17:00", "17:30", "18:00", "18:30", "19:00"]),
          ...(r() < 0.3 ? { homeBy: pick(r, ["21:30", "22:00", "23:00"]) } : {}),
          pref: pick(r, ["best", "ok", "meh"] as const),
        };
    return member(`成员${i}`, 31.25 + r() * 0.06, 120.7 + r() * 0.07, { id: `m${i}`, priv: { availability: avail } });
  });
}

describe("隐私：私密字段不影响任何人的公开 Experience", () => {
  it("200 组随机场景：随机改一个成员的私密字段，所有成员的公开体验逐字节不变", async () => {
    const pois = await map.searchAround({ lat: 31.27, lng: 120.735 }, ["火锅"], 3000, "苏州");
    const cands = j.slots.flatMap((slot) => pois.slice(0, 4).map((poi) => ({ slot, poi })));
    let checked = 0;
    for (let run = 0; run < 200; run++) {
      const r = seededRandom(hashString(`privacy|${run}`));
      const ms = randomMembers(r, 4);
      for (const m of ms) Object.assign(m.private!, randomSecrets(r, pois));
      const victim = Math.floor(r() * ms.length);
      const ms2 = ms.map((m, i) => (i === victim ? { ...m, private: { ...m.private!, ...randomSecrets(r, pois) } } : m));
      const pubs = (list: Member[]) =>
        canonicalJson(
          cands.map(({ slot, poi }) =>
            list.map((m) => experienceFor(m, slot, poi, Math.round(haversineKm(m.location!, poi) * 3 + 6), { spec: s }).pub),
          ),
        );
      expect(pubs(ms2)).toBe(pubs(ms));
      checked++;
    }
    expect(checked).toBe(200);
  });

  it("交换检验：公开信息相同的两人对调私密信息，公开 plan 和思考流逐字节相同；私密数字不出现在思考流", async () => {
    for (let run = 0; run < 40; run++) {
      const r = seededRandom(hashString(`swap|${run}`));
      const pois = await map.searchAround({ lat: 31.27, lng: 120.735 }, ["火锅"], 6000, "苏州");
      const ms = randomMembers(r, 4);
      // A、B：同一个出发地、同样的时间（公开因素完全相同），私密信息不同
      const twinAvail = ms[0].private!.availability;
      const a = member("甲", 31.27, 120.72, { id: "A", priv: { availability: twinAvail, ...randomSecrets(r, pois) } });
      const b = member("乙", 31.27, 120.72, { id: "B", priv: { availability: twinAvail, ...randomSecrets(r, pois) } });
      const pa = a.private!;
      const pb = b.private!;
      const run1: string[] = [];
      const run2: string[] = [];
      const o = { auditSecret: "k", now: new Date("2026-10-22T00:00:00Z") };
      const p1 = await planJu(j, [...ms, a, b], map, { ...o, onTrace: (k, t) => run1.push(`${k}|${t}`) });
      const p2 = await planJu(j, [...ms, { ...a, private: pb }, { ...b, private: pa }], map, {
        ...o,
        onTrace: (k, t) => run2.push(`${k}|${t}`),
      });
      const pub = (p: typeof p1) => canonicalJson({ ...p.plan, audit: { ...p.plan.audit, inputHash: "" } });
      expect(pub(p2)).toBe(pub(p1));
      expect(p2.plan.audit.outputHash).toBe(p1.plan.audit.outputHash);
      expect(run2).toEqual(run1);
      // 字面检验：私密预算数字（带 .25）、备注原文不出现在任何公开输出里
      const text = pub(p1) + run1.join("\n");
      for (const pv of [pa, pb]) {
        if (pv.budgetMax !== undefined) expect(text).not.toContain(String(pv.budgetMax));
        for (const n of pv.notes) expect(text).not.toContain(n);
      }
    }
  });
});

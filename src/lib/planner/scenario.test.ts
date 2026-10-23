// 演示场景（CONTRACT 第八节）：上海徐汇 36space，mock 地图。断言方案"有戏"。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LedgerEntry, Member } from "../types";
import { createMockMapProvider } from "../map";
import {
  autofillFromProfile,
  buildSwipeDeck,
  DEMO_ORGANIZER_PLACE,
  DEMO_VENUE,
  demoPeople,
  experienceFor,
  generateSlots,
  planJu,
  replanStable,
} from "./index";
import { ju, member, spec } from "./testutil";

const FRI = "2026-10-23";
const SAT = "2026-10-24";
const map = createMockMapProvider();
const s = spec({ city: "上海", dates: [FRI, SAT], durationMinutes: 180, budgetPerPerson: 100 });
const j = ju(s, generateSlots(s), { id: "demo-ju" });
const opts = { auditSecret: "demo-secret", now: new Date("2026-10-22T12:00:00Z") };

let oldCenter: string | undefined;
beforeAll(() => {
  oldCenter = process.env.DEMO_CENTER;
  process.env.DEMO_CENTER = `${DEMO_VENUE.lat},${DEMO_VENUE.lng}`;
});
afterAll(() => {
  if (oldCenter === undefined) delete process.env.DEMO_CENTER;
  else process.env.DEMO_CENTER = oldCenter;
});

async function scenario() {
  const people = demoPeople(s);
  const idOf = (k: string) => `demo-${k}`;
  const org = member("局长", DEMO_ORGANIZER_PLACE.lat, DEMO_ORGANIZER_PLACE.lng, {
    id: "demo-org",
    isOrganizer: true,
    priv: { availability: { [FRI]: { from: "17:30", pref: "best" }, [SAT]: { from: "17:00", pref: "ok" } } },
  });
  const members: Member[] = [org];
  const ledgers: Record<string, LedgerEntry[]> = {};
  for (const p of people) {
    const auto = p.autofill ? autofillFromProfile(undefined, j) : undefined;
    members.push(
      member(p.name, p.location.lat, p.location.lng, {
        id: idOf(p.key),
        status: p.status,
        isDemo: true,
        priv: {
          rsvp: p.rsvp,
          availability: auto?.availability ?? p.availability,
          autoFilled: auto ? ["availability"] : [],
          dietTags: p.dietTags,
          budgetMax: p.budgetMax,
          notes: p.notes,
          wants: p.wants.map(idOf),
          matches: p.wants.filter((w) => people.find((x) => x.key === w)?.wants.includes(p.key)).map(idOf),
        },
      }),
    );
    if (p.ledger.length) ledgers[idOf(p.key)] = p.ledger;
  }
  // 小林刷卡：pass 掉卡组里最贵的那家
  const lin = members.find((m) => m.id === "demo-lin")!;
  const deck = await buildSwipeDeck(j, members, lin, map);
  const priciest = [...deck].sort((a, b) => (b.costPerPerson ?? 0) - (a.costPerPerson ?? 0))[0];
  lin.private!.swipes = { [priciest.id]: "pass" };
  return { members, ledgers, deck, priciest };
}

/** 所有公开输出拼成一段文本（plan 公开字段 + 思考流） */
function publicText(plan: Awaited<ReturnType<typeof planJu>>["plan"], trace: string[]): string {
  return [
    ...plan.proposals.flatMap((p) => [p.headline, p.labelText, ...p.tradeoffs, ...p.highlights, ...p.experiences.flatMap((e) => e.notes)]),
    plan.recommendation,
    plan.caredFor ?? "",
    ...plan.constraintSummaries,
    ...trace,
  ].join("\n");
}

describe("演示场景：36space 火锅局", () => {
  it("方案有实质取舍、标签互不相同；退出 / 候补的人不出现", async () => {
    const { members, ledgers, deck } = await scenario();
    expect(deck.length).toBeGreaterThanOrEqual(5);
    expect(deck.length).toBeLessThanOrEqual(6);
    const trace: string[] = [];
    const { plan } = await planJu(j, members, map, { ...opts, ledgers, onTrace: (_k, t) => trace.push(t) });
    const ps = plan.proposals;
    expect(ps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ps.map((p) => p.label)).size).toBe(ps.length);
    expect(new Set(ps.map((p) => `${p.slot.id}|${p.poi.id}`)).size).toBe(ps.length);
    // 有取舍：方案之间到场人数、店或日期不同，且至少一个方案写了取舍
    const shapes = new Set(ps.map((p) => `${p.attendCount}|${p.poi.id}|${p.slot.id.slice(0, 10)}`));
    expect(shapes.size).toBe(ps.length);
    expect(ps.some((p) => p.tradeoffs.length > 0)).toBe(true);
    for (const p of ps) {
      const ids = p.experiences.map((e) => e.memberId);
      expect(ids).toEqual(["demo-org", "demo-jie", "demo-lin", "demo-wang", "demo-zhou"]);
    }
    // 老王周六不在：周六的方案里他是 absent
    for (const p of ps.filter((x) => x.slot.id.startsWith(SAT)))
      expect(p.experiences.find((e) => e.memberId === "demo-wang")!.status).toBe("absent");
    const text = publicText(plan, trace);
    expect(text).not.toMatch(/阿May|大刘/);
    expect(trace.some((t) => /计算了 10 个时段 × 8 家店 × 5 个人 = 400 次体验/.test(t))).toBe(true);
  });

  it("#10 阿杰被照顾：有账本时推荐方案里他的通勤更短，并有公开说明", async () => {
    const { members, ledgers } = await scenario();
    const withLedger = (await planJu(j, members, map, { ...opts, ledgers })).plan;
    const without = (await planJu(j, members, map, opts)).plan;
    const jie = (p: typeof withLedger) => p.proposals[0].experiences.find((e) => e.memberId === "demo-jie")!;
    expect(jie(withLedger).commuteMin).toBeLessThan(jie(without).commuteMin);
    expect(jie(withLedger).status).not.toBe("absent");
    expect(withLedger.caredFor).toMatch(/1 位朋友/);
    expect(without.caredFor).toBeUndefined();
    expect(withLedger.recommendation).toMatch(/照顾/);
  });

  it("#4 小林的私密预算让贵店掉出推荐，但公开数据里看不出是她", async () => {
    const { members, ledgers, priciest } = await scenario();
    const trace: string[] = [];
    const { plan, mine } = await planJu(j, members, map, { ...opts, ledgers, onTrace: (_k, t) => trace.push(t) });
    // 去掉她的预算和刷卡再算一次：会推荐超出她预算 30% 的贵店
    const noPriv = members.map((m) =>
      m.id === "demo-lin" ? { ...m, private: { ...m.private!, budgetMax: undefined, swipes: {} } } : m,
    );
    const loose = (await planJu(j, noPriv, map, { ...opts, ledgers })).plan;
    const tooPricey = (c?: number) => (c ?? 0) > 80 * 1.3;
    expect(loose.proposals.some((p) => tooPricey(p.poi.costPerPerson))).toBe(true);
    expect(plan.proposals.some((p) => tooPricey(p.poi.costPerPerson))).toBe(false);
    expect(plan.proposals.some((p) => p.poi.id === priciest.id)).toBe(false);
    // 公开文案：只说"有人预算偏紧"，不点名、不出现她的数字
    expect(plan.constraintSummaries).toContain("有人预算偏紧，已按大家都舒服的价位筛选");
    const text = publicText(plan, trace);
    expect(text).not.toMatch(/小林/);
    expect(text).not.toMatch(/(预算|超出|上限)[^\n]{0,8}80/);
    // 她在每个方案里的公开体验，和"没有私密预算"时逐字节一样
    const linPriv = members.find((m) => m.id === "demo-lin")!;
    const linBare = noPriv.find((m) => m.id === "demo-lin")!;
    for (const p of plan.proposals) {
      const e = p.experiences.find((x) => x.memberId === "demo-lin")!;
      const ctx = { spec: s };
      expect(JSON.stringify(experienceFor(linBare, p.slot, p.poi, e.commuteMin, ctx).pub)).toBe(JSON.stringify(e));
      expect(JSON.stringify(experienceFor(linPriv, p.slot, p.poi, e.commuteMin, ctx).pub)).toBe(JSON.stringify(e));
    }
    // 只有她自己的 mine 里能看到预算说明
    expect(mine["demo-lin"].some((x) => x.notes.some((n) => /你说的 80/.test(n)))).toBe(true);
    expect(Object.entries(mine).filter(([id]) => id !== "demo-lin").every(([, xs]) => xs.every((x) => x.notes.every((n) => !/80/.test(n))))).toBe(true);
  });

  it("#12 大刘候补转正：原方案仍可行，保留店和时间，只改桌数", async () => {
    const { members, ledgers } = await scenario();
    const { plan } = await planJu(j, members, map, { ...opts, ledgers });
    const cur = plan.proposals[0];
    const promoted = members.map((m) => (m.id === "demo-liu" ? { ...m, status: "in" as const } : m));
    const r = await replanStable(j, promoted, cur, map, {});
    expect(r.keptVenue).toBe(true);
    expect(r.proposal.poi.id).toBe(cur.poi.id);
    expect(r.proposal.slot.id).toBe(cur.slot.id);
    expect(r.proposal.id).toBe(cur.id);
    expect(r.tableSize).toBe(cur.attendCount + 1);
    expect(r.changes.join("|")).toMatch(/订位改为 \d+ 人/);
  });
});

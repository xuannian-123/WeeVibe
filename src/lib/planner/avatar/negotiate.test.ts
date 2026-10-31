// v6 五轮谈判协议（docs/AVATAR.md 第 4 节）：用一张写死通勤的假地图，每个场景都能手算出"对的答案"。
// give 只在需要时用、选让步最少的人、超出 give 才问、碰底线不问、交换、补偿、确定性、代号与身份无关。
import { describe, expect, it } from "vitest";
import type { AvatarStyle, DayAvailability, Give, LatLng, MapProvider, Member, MemberPrivate, Need, Poi, Proposal } from "../../types";
import { computeCandidates, decisionCompare, planJu } from "../plan";
import { generateSlots } from "../slots";
import { ju as mkJu, member, spec } from "../testutil";
import { applyGive, cheapestGive, concedePenalty } from "./give";
import { STYLE_GIVE, planMember } from "./mandate";
import { negotiate } from "./negotiate";

// ---------------------------------------------------------------- 假地图（同 decision.test.ts：成员 i 的 lat = 31 + i/1000，店 p 的 lng = 121 + p/1000）

type Shop = Partial<Poi> & { id: string; name: string };

function fakeMap(shops: Shop[], commute: number[][]): MapProvider {
  const pois: Poi[] = shops.map((s, p) => ({ address: "某路 1 号", type: "餐饮服务;中餐厅;餐厅", rating: 4.3, costPerPerson: 80, lat: 31.5, lng: 121 + p / 1000, ...s }));
  const pIdx = (d: LatLng) => Math.round((d.lng - 121) * 1000);
  const mIdx = (o: LatLng) => Math.round((o.lat - 31) * 1000);
  return {
    searchPlaces: async () => [],
    reverseGeocode: async () => "",
    searchAround: async () => pois,
    commute: async (origins, dest) => origins.map((o) => ({ minutes: commute[mIdx(o)]?.[pIdx(dest)] ?? 20, distanceKm: 5 })),
    transitRoute: async () => ({ minutes: 20, steps: [] }),
    weather: async () => [],
  };
}

const DATE = "2030-11-01";
const AT = "2030-10-30T10:00:00+08:00";
const day = (from = "18:00", homeBy?: string): Record<string, DayAvailability> => ({ [DATE]: { from, ...(homeBy ? { homeBy } : {}), pref: "ok" } });
const mandate = (style: AvatarStyle, give: Give = STYLE_GIVE[style]): MemberPrivate["mandate"] => ({ status: "confirmed", style, give, floors: [] });
const commuteNeed = (minutes: number): Need => ({ id: "n-c", dim: "travel", kind: "soft", strength: 3, rule: { t: "maxCommute", minutes }, text: `单程别超过 ${minutes} 分钟`, source: "chat", at: AT });

function people(n: number, over: (i: number) => Partial<MemberPrivate> = () => ({}), ids?: (i: number) => string, names?: (i: number) => string): Member[] {
  return Array.from({ length: n }, (_, i) =>
    member(names ? names(i) : `P${i}`, 31 + i / 1000, 120, { id: ids ? ids(i) : `p${i}`, priv: { availability: day(), ...over(i) } }),
  );
}

const S = (o: Parameters<typeof spec>[0] = {}) =>
  spec({ dates: [DATE], earliest: "19:00", latest: "19:00", durationMinutes: 120, category: "聚餐", poiKeywords: ["餐厅"], budgetPerPerson: undefined, ...o });

async function run(shops: Shop[], commute: number[][], members: Member[], specOver: Parameters<typeof spec>[0] = {}, concessions: Record<string, number> = {}) {
  const s = S(specOver);
  const j = mkJu(s, generateSlots(s), { id: "neg" });
  return planJu(j, members, fakeMap(shops, commute), { auditSecret: "neg", now: new Date("2030-10-30T10:00:00+08:00"), concessions });
}
const rows = (n: number, f: (i: number) => number[]) => Array.from({ length: n }, (_, i) => f(i));
const said = (plan: Awaited<ReturnType<typeof run>>["plan"]) => plan.negotiation!.events.map((e) => `${e.speaker}：${e.text}`);

// ---------------------------------------------------------------- give

describe("give 进计算", () => {
  it("give 不是免费的：用到才记代价，用得越多越贵，最近让过步的人更贵", () => {
    expect(concedePenalty({})).toBe(0);
    expect(concedePenalty({ lateMin: 10 })).toBeLessThan(concedePenalty({ lateMin: 20 }));
    expect(concedePenalty({ lateMin: 10 }, 2)).toBeGreaterThan(concedePenalty({ lateMin: 10 }));
    expect(concedePenalty({ lateMin: 10, budgetUp: 10 })).toBeGreaterThan(concedePenalty({ lateMin: 10 }));
  });

  it("只在需要时用：人人都照顾得到时，授权再多也一步不让", async () => {
    const ms = people(4, () => ({ mandate: mandate("easy") }));
    const { plan, avatar } = await run([{ id: "a", name: "甲餐厅" }], rows(4, () => [15]), ms);
    expect(plan.proposals[0].cared).toBe(4);
    expect(plan.negotiation!.outcome).toBe("4 个分身谈了 5 轮：没人需要让步，4 个人都照顾到了");
    expect(plan.negotiation!.autoConcessions).toBe(0);
    expect(Object.values(avatar.logs).flat().some((e) => e.kind === "concede")).toBe(false);
    expect(said(plan).join("\n")).toMatch(/这一轮没人需要让步/);
  });

  it("让得最少的那组：只超了预算的人只用预算那一维", async () => {
    // P0 预算 60、店人均 90；同时有"单程别超过 30 分钟"，但通勤只有 15 → 只用 budgetUp
    const ms = people(3, (i) => (i === 0 ? { budgetMax: 60, budgetStrength: 3, needs: [commuteNeed(30)], mandate: mandate("easy") } : {}));
    const s = S();
    const j = mkJu(s, generateSlots(s), { id: "neg" });
    const pms = ms.map(planMember);
    const { cands, ctx } = await computeCandidates(j, pms, fakeMap([{ id: "a", name: "甲餐厅", costPerPerson: 90 }], rows(3, () => [15])), {}, () => {});
    const g = cheapestGive(pms[0], cands[0], 0, ctx)!;
    expect(g.use.used).toEqual({ budgetUp: 30 });
    // 被照顾到靠的是授权，但他看到的满意度仍按"人均 60 以内"算
    expect(g.truth.mine.notes.join("")).toMatch(/超出你说的 60/);
  });

  it("要让就让得最少的人：两家店各要一个人多走一点，选多走得少的那家", async () => {
    // 甲：P0 路上 28（超 8）；乙：P1 路上 30（超 10）。两人都授权多走 10 分钟，不让都照顾不到
    const ms = people(3, (i) => (i < 2 ? { needs: [commuteNeed(20)], mandate: mandate("balanced") } : {}));
    const commute = [
      [28, 12],
      [12, 30],
      [12, 12],
    ];
    const { plan, avatar } = await run([{ id: "a", name: "甲餐厅" }, { id: "b", name: "乙餐厅" }], commute, ms);
    expect(plan.proposals[0].poi.id).toBe("a");
    expect(plan.proposals[0].cared).toBe(3);
    expect(avatar.conceded).toEqual(["p0"]);
    expect(avatar.logs.p0.find((e) => e.kind === "concede")!.text).toMatch(/替你多走了 8 分钟：路上 28 分钟/);
  });

  it("让步账：一样大的让步，最近让过步的人不先让", async () => {
    const ms = people(3, (i) => (i < 2 ? { needs: [commuteNeed(20)], mandate: mandate("balanced") } : {}));
    const commute = [
      [28, 12],
      [12, 28],
      [12, 12],
    ];
    const shops = [{ id: "a", name: "甲餐厅" }, { id: "b", name: "乙餐厅" }];
    const fresh = await run(shops, commute, ms);
    const tired = await run(shops, commute, ms, {}, { [fresh.avatar.conceded[0]]: 3 });
    expect(fresh.avatar.conceded).toHaveLength(1);
    expect(tired.avatar.conceded).toHaveLength(1);
    expect(tired.avatar.conceded[0]).not.toBe(fresh.avatar.conceded[0]);
  });

  it("give 用到上限也照顾不到就不算让（还是没被照顾到），交给第 2 轮去问", async () => {
    const ms = people(4, (i) => (i === 0 ? { availability: day("19:55"), mandate: mandate("balanced") } : {}));
    // 19:00 开始、路上 15 分钟 → 晚到 70 分钟：超过 45 + 15
    const { plan, asks, avatar } = await run([{ id: "a", name: "甲餐厅" }], rows(4, () => [15]), ms);
    expect(avatar.conceded).toEqual([]);
    expect(asks.map((a) => a.memberId)).toEqual(["p0"]);
    expect(asks[0].text).toMatch(/超出了你给分身的授权/);
    expect(asks[0].text).toMatch(/这样也来吗/);
    expect(plan.negotiation!.asked).toBe(1);
    expect(said(plan).join("\n")).toMatch(/超出我的授权了，我去问问本人/);
  });
});

// ---------------------------------------------------------------- 协议

describe("五轮谈判", () => {
  it("在 give 内自动同意，写进本人记录；公开记录只有局长和分身代号", async () => {
    // P0 19:45 下班：晚到 60 分钟，在 45 + 30 以内（随和）
    const ms = people(5, (i) => (i === 0 ? { availability: day("19:45"), mandate: mandate("easy") } : {}), undefined, (i) => ["阿杰", "小林", "老王", "小周", "阿May"][i]);
    const { plan, asks, avatar } = await run([{ id: "a", name: "甲餐厅" }], rows(5, () => [15]), ms);
    expect(asks).toEqual([]);
    expect(plan.proposals[0].cared).toBe(5);
    expect(plan.proposals[0].experiences[0]).toMatchObject({ status: "late", lateMin: 60 });
    expect(avatar.logs.p0[0]).toMatchObject({ kind: "concede", dim: "lateMin" });
    expect(avatar.logs.p0[0].text).toMatch(/^替你多让了 15 分钟：周五 19:00 开始，你大约 20:00 到（晚到 60 分钟），在你授权的 30 分钟以内$/);
    const ng = plan.negotiation!;
    expect(new Set(ng.events.map((e) => e.round))).toEqual(new Set([0, 1, 2, 3, 4]));
    expect(ng.events.every((e) => e.speaker === "局长" || /^分身 [A-Z]$/.test(e.speaker))).toBe(true);
    const text = said(plan).join("\n");
    for (const name of ["阿杰", "小林", "老王", "小周", "阿May"]) expect(text).not.toContain(name);
    expect(text).toMatch(/分身 A：晚到 60 分钟我也来——在授权范围内。/);
    expect(text).toMatch(/局长：那就周五 19:00 在甲餐厅，5 个人都照顾到了。/);
    expect(ng.outcome).toBe("5 个分身谈了 5 轮：1 次自动让步，5 个人都照顾到了");
    // 每人都收到"你得到了什么 / 为什么"
    for (const m of ms) {
      expect(avatar.logs[m.id].some((e) => e.kind === "gained" && e.text.startsWith("你得到了"))).toBe(true);
      expect(avatar.logs[m.id].some((e) => e.text.startsWith("为什么这么定"))).toBe(true);
    }
    expect(avatar.logs.p0.some((e) => e.kind === "compensated" && /让步账/.test(e.text))).toBe(true);
  });

  it("草稿授权书不替人让步：同样的处境，分身只守底线，局长去问本人", async () => {
    const ms = people(4, (i) => (i === 0 ? { availability: day("19:45"), mandate: { ...mandate("easy")!, status: "draft" } } : {}));
    const { plan, asks, avatar } = await run([{ id: "a", name: "甲餐厅" }], rows(4, () => [15]), ms);
    expect(avatar.conceded).toEqual([]);
    expect(asks.map((a) => a.memberId)).toEqual(["p0"]);
    expect(said(plan).join("\n")).toMatch(/还没确认授权书/);
  });

  it("碰底线不问：清真的朋友附近没有清真店，不去问他，公开记录说底线不谈", async () => {
    const ms = people(4, (i) => (i === 0 ? { dietTags: ["清真"], mandate: mandate("easy") } : {}));
    const { plan, asks } = await run([{ id: "a", name: "甲餐厅" }], rows(4, () => [15]), ms);
    expect(asks.some((a) => a.memberId === "p0")).toBe(false);
    const text = said(plan).join("\n");
    expect(text).toMatch(/吃的方面我有条底线，这家不行/);
    expect(text).toMatch(/有 1 位朋友卡在底线上——底线不谈，不去问/);
  });

  it("门禁是底线：亮出来的只有类别，任何方案都不会把人排到门禁之后", async () => {
    // P0 20:30 门禁（底线）；18:30 / 19:00 / 19:30 三个时间，19:30 开始他只能待 45 分钟
    const ms = people(4, (i) => (i === 0 ? { availability: day("17:00", "20:30"), confirmed: ["homeBy"], mandate: mandate("firm") } : {}));
    const { plan } = await run([{ id: "a", name: "甲餐厅" }], rows(4, () => [15]), ms, { earliest: "18:30", latest: "19:30" });
    expect(said(plan).join("\n")).toMatch(/我这边有条底线，时间上动不了/);
    const rec = plan.proposals[0];
    expect(rec.experiences[0].status).not.toBe("absent");
    expect(rec.experiences[0].leaveAt! <= "20:15").toBe(true);
  });

  it("交换：一个晚到、一个多花一点，两人各让一小步、缺一不可，换来两个人都能来", async () => {
    const ms = people(5, (i) =>
      i === 0 ? { availability: day("19:45"), mandate: mandate("balanced") } : i === 1 ? { budgetMax: 60, budgetStrength: 3, mandate: mandate("balanced") } : {},
    );
    const { plan, avatar } = await run([{ id: "a", name: "甲餐厅", costPerPerson: 85 }], rows(5, () => [15]), ms);
    expect(plan.proposals[0].cared).toBe(5);
    expect(plan.negotiation!.trades).toBe(1);
    expect(avatar.conceded.sort()).toEqual(["p0", "p1"]);
    const trade = plan.negotiation!.events.find((e) => e.kind === "trade")!;
    expect(trade.round).toBe(3);
    expect(trade.text).toMatch(/^分身 [AB] (晚到 60 分钟|多花一点)，分身 [AB] (晚到 60 分钟|多花一点)——两人各让一小步，换来两个人都能来。$/);
    expect(said(plan).join("\n")).toMatch(/2 位朋友让了步：记进让步账，下次局里优先照顾/);
    expect(avatar.logs.p1.find((e) => e.kind === "concede")!.text).toMatch(/^替你多出了 15 元（你授权的上限）：这家人均 85，比你说的 60 多 25/);
    // 公开里预算只说聚合："有人觉得偏贵"，不出现任何预算数字
    expect(said(plan).join("\n")).not.toMatch(/比你说的|多出了/);
  });

  it("确定性：同样输入逐字同样的谈判记录和本人记录", async () => {
    const mk = () =>
      people(6, (i) =>
        i === 0 ? { availability: day("19:45"), mandate: mandate("balanced"), mood: "lazy" } : i === 1 ? { budgetMax: 70, mandate: mandate("easy"), mood: "lazy" } : { mood: i % 2 ? "active" : "chill" },
      );
    const shops = [{ id: "a", name: "甲餐厅", costPerPerson: 82 }, { id: "b", name: "乙餐厅", costPerPerson: 95 }];
    const a = await run(shops, rows(6, (i) => [15 + i, 20 - i]), mk());
    const b = await run(shops, rows(6, (i) => [15 + i, 20 - i]), mk());
    expect(JSON.stringify(a.plan.negotiation)).toBe(JSON.stringify(b.plan.negotiation));
    expect(JSON.stringify(a.avatar)).toBe(JSON.stringify(b.avatar));
    expect(said(a.plan).join("\n")).toMatch(/这次的状态：2 位想安静聊聊，2 位想动一动，2 位想躺着。/);
  });

  it("代号和身份无关：换成员 id、真名、加入顺序，公开谈判记录逐字相同", async () => {
    const over = (i: number): Partial<MemberPrivate> =>
      i === 0 ? { availability: day("19:45"), mandate: mandate("balanced") } : i === 1 ? { budgetMax: 70, budgetStrength: 3, mandate: mandate("balanced") } : i === 2 ? { dietTags: ["清真"] } : {};
    const shops = [{ id: "a", name: "甲餐厅", costPerPerson: 82 }];
    const a = await run(shops, rows(5, () => [15]), people(5, over));
    // 同一批人倒过来入局、换 id 和名字（通勤按出发地给，跟着人走）
    const rev = people(5, (i) => over(4 - i), (i) => `zz${i}`, (i) => `别名${i}`).map((m, i) => ({ ...m, location: { lat: 31 + (4 - i) / 1000, lng: 120, label: "x" } }));
    const b = await run(shops, rows(5, () => [15]), rev);
    expect(JSON.stringify(b.plan.negotiation)).toBe(JSON.stringify(a.plan.negotiation));
  });

  it("补偿：有两段式时第二段按让过步的人的口味加权（第二段的名字写进记录）", async () => {
    const ms = people(4, (i) => (i === 0 ? { availability: day("19:45"), mandate: mandate("easy") } : {}));
    const s = S();
    const j = mkJu(s, generateSlots(s), { id: "neg" });
    const pms = ms.map(planMember);
    const { cands, weights, ctx } = await computeCandidates(j, pms, fakeMap([{ id: "a", name: "甲餐厅" }], rows(4, () => [15])), {}, () => {});
    const given = applyGive(pms, cands, weights, ctx);
    const rec = [...given.cands].sort(decisionCompare)[0];
    const poi = rec.poi;
    const proposal = {
      segments: [
        { activity: "climbing", activityName: "攀岩", poi, start: rec.slot.start, end: rec.slot.end },
        { activity: "homestyle", activityName: "家常菜", poi, start: rec.slot.end, end: rec.slot.end },
      ],
    } as unknown as Proposal;
    const r = negotiate({
      members: ms,
      planMembers: pms,
      baseRec: [...cands].sort(decisionCompare)[0],
      basePool: cands,
      given,
      pool: given.cands,
      rec,
      proposal,
      asks: [],
      why: ["4 个人都照顾到了"],
      counts: { slots: 1, pois: 1 },
      now: new Date(AT),
    });
    expect(r.negotiation.events.map((e) => e.text).join("\n")).toMatch(/第二段「家常菜」优先照顾让过步的朋友的口味/);
    expect(r.logs.p0.find((e) => e.kind === "compensated")!.text).toMatch(/第二段「家常菜」优先照顾你的口味/);
    expect(r.negotiation.events.find((e) => e.round === 4)!.text).toMatch(/攀岩（甲餐厅） → 21:00 家常菜（甲餐厅）/);
  });
});

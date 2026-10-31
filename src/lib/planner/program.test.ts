// v6 节目（docs/AVATAR.md 3.3 / 3.4）：一段或两段、每人每段分别算、部分照顾、接进 planJu、地图调用上限、确定性、隐私。
import { describe, expect, it } from "vitest";
import type { MapProvider, Member, MemberPrivate, Mood, Poi, Slot, TraceEvent, WeatherDay } from "../types";
import { createMockMapProvider } from "../map";
import { ACTIVITY_LIB, activityByKey } from "./activities";
import { CARE_FLOOR } from "./experience";
import { generateSlots, planJu } from "./index";
import { MAX_ACTIVITY_POIS, MAX_ACTIVITY_SEARCHES, walkMinutes } from "./plan";
import { buildPrograms, moodSummary, pairOrder, PARTIAL_PENALTY, programExperience, type SegRun } from "./program";
import { ju, member, spec } from "./testutil";
import { bjIso } from "./util";

const DAY = "2030-11-02"; // 周六
const S = spec({ category: "局长定", poiKeywords: ["餐厅"], open: true, dates: [DAY], earliest: "14:00", latest: "15:00", durationMinutes: 180, budgetPerPerson: undefined });
const day = (from: string) => ({ [DAY]: { from, pref: "ok" as const } });

/** 成员：出发地都在一小片里，私密字段放 priv */
function ppl(list: (Partial<MemberPrivate> & { from?: string })[]): Member[] {
  return list.map(({ from, ...priv }, i) =>
    member(`P${i}`, 31.27 + i / 1000, 120.73, { id: `p${i}`, priv: { availability: day(from ?? "13:00"), ...priv } }),
  );
}
const moods = (...ms: Mood[]) => ppl(ms.map((mood) => ({ mood })));

const FOOD_KW = /火锅|烧烤|烤肉|家常菜|日本料理|西餐|自助|小吃|清真/;
const OUTDOOR_KW = /徒步|公园|骑行|露营/;

/** 假地图：任何关键词都在集合点旁边给 3 家店（店名带关键词），通勤一律 15 分钟；记下每种调用的次数和搜的词 */
function fakeMap(forecast: WeatherDay[] = []) {
  const calls = { search: 0, commute: 0, weather: 0, keywords: [] as string[] };
  const map: MapProvider = {
    searchPlaces: async () => [],
    reverseGeocode: async () => "",
    searchAround: async (c, kws) => {
      calls.search++;
      const kw = kws[0];
      calls.keywords.push(kw);
      return [0, 1, 2].map(
        (k): Poi => ({
          id: `${kw}-${k}`,
          name: `${kw}${"甲乙丙"[k]}店`,
          address: "某路 1 号",
          type: FOOD_KW.test(kw) ? "餐饮服务;中餐厅" : "体育休闲服务;娱乐场所",
          lat: c.lat + 0.001 * k,
          lng: c.lng + 0.0015 * k,
          rating: 4.3,
          costPerPerson: 60,
          openTime: "09:00-23:30",
          indoor: !OUTDOOR_KW.test(kw),
        }),
      );
    },
    commute: async (origins) => {
      calls.commute++;
      return origins.map(() => ({ minutes: 15, distanceKm: 3 }));
    },
    transitRoute: async () => ({ minutes: 15, steps: [] }),
    weather: async () => {
      calls.weather++;
      return forecast;
    },
  };
  return { map, calls };
}

/** 包一层计数（真实的 mock 地图） */
function counting(base: MapProvider) {
  let n = 0;
  const wrap = <T extends unknown[], R>(f: (...a: T) => Promise<R>) => (...a: T) => {
    n++;
    return f(...a);
  };
  const map: MapProvider = {
    searchPlaces: wrap(base.searchPlaces),
    reverseGeocode: wrap(base.reverseGeocode),
    searchAround: wrap(base.searchAround),
    commute: wrap(base.commute),
    transitRoute: wrap(base.transitRoute),
    weather: wrap(base.weather!),
  };
  return { map, count: () => n };
}

async function run(members: Member[], s = S, map: MapProvider = fakeMap().map) {
  const traces: TraceEvent[] = [];
  const r = await planJu(ju(s, generateSlots(s)), members, map, {
    auditSecret: "secret",
    now: new Date("2030-10-30T10:00:00+08:00"),
    onTrace: (kind, text) => traces.push({ id: String(traces.length), at: "", kind, text }),
  });
  return { ...r, traces: traces.map((t) => t.text) };
}

describe("活动层排节目（不调地图）", () => {
  it("心情分化（有人想动、有人想躺）→ 考虑两段，而且两段排第一", () => {
    const pp = buildPrograms(moods("active", "active", "lazy", "lazy"), S);
    expect(pp.split.diverged).toBe(true);
    expect(pp.programs.length).toBeLessThanOrEqual(4);
    expect(pp.programs.some((p) => p.segs.length === 2)).toBe(true);
    expect(pp.programs[0].segs.length).toBe(2);
    const [a, b] = pp.programs[0].segs.map((s) => s.act);
    expect([a.food, b.food].sort()).toEqual([false, true]);
  });

  it("大家状态一样 → 只出单段节目（最多 3 个，同一类最多 2 个）", () => {
    const pp = buildPrograms(moods("chill", "chill", "chill"), S);
    expect(pp.split.diverged).toBe(false);
    expect(pp.programs.every((p) => p.segs.length === 1)).toBe(true);
    expect(pp.programs.length).toBe(3);
    const groups = pp.programs.map((p) => p.segs[0].act.group);
    for (const g of groups) expect(groups.filter((x) => x === g).length).toBeLessThanOrEqual(2);
  });

  it("有人只能晚到 → 也考虑两段", () => {
    const pp = buildPrograms(ppl([{ mood: "chill" }, { mood: "chill" }, { mood: "chill", from: "16:40" }]), S);
    expect(pp.split.late).toBe(1);
    expect(pp.programs.some((p) => p.segs.length === 2)).toBe(true);
  });

  it("两段的先后：下午先玩后吃；晚上先吃后玩；累的、不能中途加入的总是先玩", () => {
    const k = (x: string) => activityByKey(x)!;
    expect(pairOrder(k("boardgame"), k("homestyle"), { earliest: "14:00" }).map((a) => a.key)).toEqual(["boardgame", "homestyle"]);
    expect(pairOrder(k("boardgame"), k("hotpot"), { earliest: "18:30" }).map((a) => a.key)).toEqual(["hotpot", "boardgame"]);
    expect(pairOrder(k("climbing"), k("hotpot"), { earliest: "18:30" })[0].key).toBe("climbing");
    expect(pairOrder(k("escape"), k("hotpot"), { earliest: "18:30" })[0].key).toBe("escape");
  });

  it("公开说法只有聚合：≥ 2 人才说具体状态，1 人只说有人", () => {
    expect(moodSummary(buildPrograms(moods("active", "active", "lazy"), S).split)).toBe("有 2 位朋友想动一动，还有人状态不太一样");
    expect(moodSummary(buildPrograms(moods("lazy"), S).split)).toBe("有人说了这次的状态");
    expect(moodSummary(buildPrograms(ppl([{}, {}]), S).split)).toBeUndefined();
  });
});

describe("每人每段分别算", () => {
  const P = (name: string, type = "体育休闲服务;娱乐场所"): Poi => ({ id: name, name, address: "", type, lat: 31.27, lng: 120.73, rating: 4.3, costPerPerson: 60 });
  const seg = (key: string, poi: Poi, from: number, to: number): SegRun => ({
    act: activityByKey(key)!,
    poi,
    slot: { id: `${DAY}T14:00`, start: bjIso(DAY, from), end: bjIso(DAY, to) } as Slot,
  });
  const runs = (second = "homestyle") => [
    seg("boardgame", P("桌游甲店"), 14 * 60, 17 * 60),
    seg(second, P(`${second === "movie" ? "电影院" : "家常菜"}甲店`, second === "movie" ? "体育休闲服务;影剧院;电影院" : "餐饮服务;中餐厅"), 17 * 60 + 10, 18 * 60 + 40),
  ];
  const ctx = { spec: S };

  it("只能晚到的人直接来第二段：公开里写清楚，私下算部分照顾（满意度扣 10，但仍被照顾到）", () => {
    const [late] = ppl([{ from: "16:50" }]);
    const row = programExperience(late, runs(), 15, ctx);
    expect(row.part).toBe("second");
    expect(row.pub.status).toBe("late");
    expect(row.pub.arriveAt).toBe("17:10");
    expect(row.pub.lateMin).toBe(190);
    expect(row.pub.notes[0]).toBe("直接来第二段（家常菜）");
    expect(row.mine.cared).toBe(true);
    expect(row.mine.needs.find((n) => n.text === "这个时间能来")?.result).toBe("partial");
    const full = programExperience(ppl([{}])[0], runs(), 15, ctx);
    expect(full.part).toBe("both");
    expect(full.mine.utility - row.mine.utility).toBeGreaterThanOrEqual(PARTIAL_PENALTY - 2);
  });

  it("第二段不能中途加入（电影）：没赶上第一段、又迟到的人就来不了", () => {
    const [late] = ppl([{ from: "17:15" }]);
    expect(programExperience(late, runs("movie"), 15, ctx).part).toBe("none");
    expect(programExperience(late, runs(), 15, ctx).part).toBe("second");
  });

  it("门禁早的人只参加第一段：公开写几点先走，私下仍算完整参加了一段", () => {
    const [m] = ppl([{ availability: { [DAY]: { from: "13:00", homeBy: "17:30", pref: "ok" } } }]);
    const row = programExperience(m, runs(), 15, ctx);
    expect(row.part).toBe("first");
    expect(row.pub.leaveAt).toBe("17:00");
    expect(row.pub.notes.join()).toContain("只参加第一段（桌游）");
    expect(row.mine.cared).toBe(true);
  });

  it("一段碰底线（清真的朋友，第二家不是清真店）→ 只算另一段，部分照顾；桌游那段不看忌口", () => {
    const [h] = ppl([{ dietTags: ["清真"] }]);
    const row = programExperience(h, runs(), 15, ctx);
    expect(row.part).toBe("both"); // 公开里照样两段都在（忌口是私密的）
    expect(row.flags.hard).toBe(false);
    expect(row.mine.cared).toBe(true);
    expect(row.mine.notes[0]).toContain("只参加桌游");
    const single = programExperience(h, [runs()[0]], 15, ctx);
    expect(single.flags.hard).toBe(false);
  });

  it("两段的预算按合计算", () => {
    const [b] = ppl([{ budgetMax: 100 }]);
    const row = programExperience(b, runs(), 15, ctx);
    expect(row.flags.overBudget).toBe(true);
    expect(row.mine.notes.join()).toContain("两段合计人均 120");
  });
});

describe("接进 planJu", () => {
  it("心情分化：推荐两段式；proposal.slot / poi = 第一段；第二家店步行 15 分钟内", async () => {
    const r = await run(moods("active", "active", "lazy", "lazy"));
    const top = r.plan.proposals[0];
    expect(top.segments?.length).toBe(2);
    const [a, b] = top.segments!;
    expect(top.poi.id).toBe(a.poi.id);
    expect(top.slot.start).toBe(a.start);
    expect(top.slot.end).toBe(b.end);
    const walk = walkMinutes(a.poi, b.poi);
    expect(walk).toBeLessThanOrEqual(15);
    expect((new Date(b.start).getTime() - new Date(a.end).getTime()) / 60000).toBe(walk);
    expect(top.headline.startsWith(`${a.activityName} → ${b.activityName}`)).toBe(true);
    expect(r.plan.recommendation).toContain("→");
    expect(r.plan.proposals.every((p) => p.segments?.length)).toBe(true);
    // 心情让两段式照顾到了每个人
    expect(top.cared).toBe(4);
    for (const m of ["p0", "p1", "p2", "p3"]) expect(r.mine[m][0].utility).toBeGreaterThanOrEqual(CARE_FLOOR);
  });

  it("晚到的人直接来第二段，被算作照顾到；思考流和理由里说清楚（聚合）", async () => {
    const r = await run(ppl([{ mood: "chill" }, { mood: "chill" }, { mood: "chill" }, { mood: "chill", from: "16:40" }]));
    const top = r.plan.proposals[0];
    expect(top.segments?.length).toBe(2);
    const exp = top.experiences.find((e) => e.memberId === "p3")!;
    expect(exp.notes[0]).toMatch(/^直接来第二段/);
    expect(r.mine.p3[0].cared).toBe(true);
    expect(top.cared).toBe(4);
    expect(r.plan.why?.join()).toContain("直接来第二段");
    expect(top.headline).toContain("1 人直接来第二段");
    expect(r.traces.join("\n")).toContain("有人只能晚到");
  });

  it("思考流写出活动层的推理，只说聚合，不点名", async () => {
    const r = await run(moods("active", "active", "lazy", "lazy", "chill"));
    const t = r.traces.join("\n");
    expect(t).toContain("发起人让局长定干什么");
    expect(t).toContain("有 2 位朋友想动一动");
    expect(t).toContain("有 2 位朋友想躺着");
    expect(t).not.toContain("想安静聊聊"); // 只有 1 人想安静：不说具体状态
    expect(t).toContain("还有人状态不太一样");
    expect(t).toContain("活动层按三级准则排出");
    for (const name of ["P0", "P1", "P2", "P3", "P4"]) expect(t).not.toContain(name);
  });

  it("候选池：只在发起人给的活动里挑", async () => {
    const r = await run(moods("chill", "chill"), { ...S, open: false, category: "家常菜/桌游", activities: ["homestyle", "boardgame"] });
    const used = new Set(r.plan.proposals.flatMap((p) => p.segments!.map((s) => s.activity)));
    for (const k of used) expect(["homestyle", "boardgame"]).toContain(k);
    expect(r.traces[0 + 2]).toContain("发起人给了 2 个候选：家常菜 / 桌游");
  });

  it("下大雨：户外活动不出现", async () => {
    const wx: WeatherDay[] = [{ date: DAY, day: { text: "大雨", temp: 18, windPower: "≤3" }, night: { text: "大雨", temp: 16, windPower: "≤3" } }];
    const r = await run(moods("active", "active", "active"), S, fakeMap(wx).map);
    const outdoor = new Set(ACTIVITY_LIB.filter((a) => a.indoor === false).map((a) => a.key));
    for (const p of r.plan.proposals) for (const s of p.segments!) expect(outdoor.has(s.activity)).toBe(false);
    expect(r.traces.join("\n")).toContain("种户外活动那几天预报有大雨");
  });

  it("有清真的朋友：吃饭的那段只搜清真店，他也被照顾到", async () => {
    const { map, calls } = fakeMap();
    const r = await run(ppl([{ mood: "active" }, { mood: "lazy", dietTags: ["清真"] }, { mood: "lazy" }]), S, map);
    const foodSearches = calls.keywords.filter((k) => FOOD_KW.test(k));
    expect(foodSearches.length).toBeGreaterThan(0);
    expect(foodSearches.every((k) => k.includes("清真"))).toBe(true);
    expect(r.mine.p1[0].cared).toBe(true);
  });

  it("确定性：同样的输入两次，方案和输出哈希逐字相同", async () => {
    const ms = ppl([{ mood: "active" }, { mood: "lazy", budgetMax: 80 }, { mood: "chill", from: "16:40" }, { dietTags: ["素食"] }]);
    const a = await run(ms);
    const b = await run(structuredClone(ms));
    expect(b.plan.audit.outputHash).toBe(a.plan.audit.outputHash);
    expect(JSON.stringify(b.plan.proposals)).toBe(JSON.stringify(a.plan.proposals));
    expect(b.traces).toEqual(a.traces);
  });

  it("隐私：两个公开信息一样的人互换心情 / 忌口 / 预算，公开输出逐字相同", async () => {
    const base = (pa: Partial<MemberPrivate>, pb: Partial<MemberPrivate>) => [
      member("A", 31.27, 120.73, { id: "a", priv: { availability: day("13:00"), ...pa } }),
      member("B", 31.27, 120.73, { id: "b", priv: { availability: day("13:00"), ...pb } }),
      member("C", 31.272, 120.731, { id: "c", priv: { availability: day("13:00"), mood: "chill" } }),
    ];
    const x = await run(base({ mood: "active", dietTags: ["清真"] }, { mood: "lazy", budgetMax: 60 }));
    const y = await run(base({ mood: "lazy", budgetMax: 60 }, { mood: "active", dietTags: ["清真"] }));
    expect(y.plan.audit.outputHash).toBe(x.plan.audit.outputHash);
    expect(y.traces).toEqual(x.traces);
    expect(y.plan.recommendation).toBe(x.plan.recommendation);
  });
});

describe("地图调用次数", () => {
  it("假地图：天气 1 次、搜店 ≤ 6 次、通勤 ≤ 10 次", async () => {
    const { map, calls } = fakeMap();
    await run(moods("active", "active", "lazy", "lazy"), S, map);
    expect(calls.weather).toBe(1);
    expect(calls.search).toBeLessThanOrEqual(MAX_ACTIVITY_SEARCHES);
    expect(calls.commute).toBeLessThanOrEqual(MAX_ACTIVITY_POIS);
  });

  it("mock 地图：活动层不超过同样一群人 v5 单品类的 2 倍", async () => {
    const ms = ppl([{ mood: "active" }, { mood: "active" }, { mood: "lazy" }, { mood: "chill", from: "16:40" }, { dietTags: ["清真"] }]);
    const v5 = counting(createMockMapProvider());
    const v5Spec = spec({ dates: [DAY], earliest: "14:00", latest: "15:00", budgetPerPerson: undefined });
    await run(ms, v5Spec, v5.map);
    const v6 = counting(createMockMapProvider());
    const r = await run(ms, S, v6.map);
    expect(r.plan.proposals[0].segments?.length).toBeGreaterThan(0);
    expect(v6.count()).toBeLessThanOrEqual(2 * v5.count());
  });
});

describe("v5 单品类不变", () => {
  it("open = false 且只有一个品类（或只给了 1 个候选）：不走活动层，结果和 v5 逐字相同", async () => {
    const ms = ppl([{ mood: "active" }, { mood: "lazy" }, { budgetMax: 80 }]);
    const v5Spec = spec({ dates: [DAY], earliest: "14:00", latest: "15:00" });
    const mock = createMockMapProvider();
    const a = await run(ms, v5Spec, mock);
    const b = await run(ms, { ...v5Spec, activities: ["hotpot"] }, mock);
    expect(a.plan.proposals.every((p) => !p.segments)).toBe(true);
    expect(b.plan.audit.outputHash).toBe(a.plan.audit.outputHash);
    expect(a.traces.join("\n")).not.toContain("活动层");
  });
});

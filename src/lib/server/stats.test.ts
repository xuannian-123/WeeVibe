import { describe, expect, it } from "vitest";
import type { Ju, Member } from "../types";
import { fillSecondsField } from "./schemas";
import { computeStats, median } from "./stats";

// 2026-10-22 18:30 北京时间
const NOW = new Date("2026-10-22T10:30:00Z");

const ju = (id: string, createdAt: string, status: Ju["status"] = "collecting"): Ju => ({
  id,
  title: `局${id}`,
  rawPrompt: "",
  spec: {
    category: "火锅", poiKeywords: ["火锅"], dates: ["2026-10-23"], earliest: "18:00", latest: "20:00",
    durationMinutes: 120, city: "苏州",
  },
  slots: [],
  status,
  createdAt,
  votes: {},
  trace: [],
  announcements: [],
  pendingChanges: 0,
  revisions: [],
});

let n = 0;
const mem = (juId: string, joinedAt: string, extra: Partial<Member> = {}): Member => ({
  id: `m${++n}`,
  juId,
  name: "x",
  avatar: "🐱",
  location: { lat: 31, lng: 120, label: "" },
  role: "guest",
  intake: "done",
  status: "in",
  joinedAt,
  isOrganizer: false,
  ...extra,
});

describe("computeStats", () => {
  const jus = [
    ju("a", "2026-10-22T09:00:00Z", "confirmed"),
    ju("b", "2026-10-22T10:00:00Z"),
    ju("c", "2026-10-21T01:00:00Z"),
    ju("d", "2026-10-22T10:10:00Z", "confirmed"), // 1 个真实成员 + 一堆演示成员 → 不算真实局
  ];
  const members = [
    mem("a", "2026-10-22T09:05:00Z", { fillSeconds: 8 }),
    mem("a", "2026-10-22T09:10:00Z", { fillSeconds: 12 }),
    mem("a", "2026-10-22T09:20:00Z", { isDemo: true, fillSeconds: 1 }),
    mem("b", "2026-10-22T10:01:00Z", { fillSeconds: 30 }),
    mem("b", "2026-10-22T10:29:59Z", { status: "out" }),
    mem("c", "2026-10-21T01:00:00Z", { fillSeconds: 5 }),
    mem("c", "2026-10-21T01:01:00Z", { isDemo: true }),
    mem("c", "2026-10-21T01:02:00Z", { isDemo: true }),
    mem("c", "2026-10-10T01:00:00Z"), // 72 小时以外
    mem("d", "2026-10-22T08:00:00Z", { fillSeconds: 20 }),
    mem("d", "2026-10-22T08:01:00Z", { isDemo: true }),
    mem("d", "2026-10-22T08:02:00Z", { isDemo: true }),
  ];
  const s = computeStats(jus, members, NOW);

  it("演示成员不计入，真实局 = 至少 2 个真实成员", () => {
    expect(s.memberCount).toBe(7); // 真实成员按人次，d 那个也算
    expect(s.juCount).toBe(3); // c 也有 2 个真实成员（含 72 小时外那个）
    expect(s.confirmedCount).toBe(1);
  });

  it("recent 按创建时间倒序，人数只算真实成员", () => {
    expect(s.recent.map((r) => [r.id, r.members])).toEqual([
      ["b", 2],
      ["a", 2],
      ["c", 2],
    ]);
  });

  it("medianFillSeconds 只取真实成员", () => {
    expect(s.medianFillSeconds).toBe(12); // [5, 8, 12, 20, 30] → 12，演示成员的 1 秒不算
  });

  it("hourly 覆盖最近 72 个北京时间整点", () => {
    expect(s.hourly).toHaveLength(72);
    expect(s.hourly.at(-1)).toEqual({ hour: "2026-10-22T18:00+08:00", joins: 2 });
    expect(s.hourly.at(-2)).toEqual({ hour: "2026-10-22T17:00+08:00", joins: 2 });
    expect(s.hourly[0].hour).toBe("2026-10-19T19:00+08:00");
    expect(s.hourly.reduce((a, h) => a + h.joins, 0)).toBe(6);
  });

  it("没有真实成员时不给中位数", () => {
    const empty = computeStats([], [], NOW);
    expect(empty.medianFillSeconds).toBeUndefined();
    expect(empty.juCount).toBe(0);
    expect(empty.hourly.every((h) => h.joins === 0)).toBe(true);
  });

  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeUndefined();
  });
});

describe("fillSeconds 入参", () => {
  it.each([
    [9.46, 9.5],
    [0, 0],
    [3600, 3600],
    [3601, undefined],
    [-1, undefined],
    ["12", undefined],
    [undefined, undefined],
  ])("%s → %s", (v, want) => {
    expect(fillSecondsField.parse(v)).toBe(want);
  });
});

describe("privateShareRate", () => {
  const priv = (over: Partial<NonNullable<Member["private"]>>): NonNullable<Member["private"]> => ({
    chat: [{ role: "me", text: "hi", at: "2026-10-22T10:00:00Z" }],
    availability: {},
    dietTags: [],
    notes: [],
    swipes: {},
    autoFilled: [],
    wants: [],
    matches: [],
    billFacts: {},
    inbox: [],
    ...over,
  });
  it("真实成员里开过口的人中，主动说了私密约束的比例；预填的不算、演示成员不算", () => {
    const ms = [
      mem("a", "2026-10-22T09:05:00Z", { private: priv({ budgetMax: 80 }) }),
      mem("a", "2026-10-22T09:05:00Z", { private: priv({ rsvp: "no" }) }),
      mem("a", "2026-10-22T09:05:00Z", { private: priv({ budgetMax: 100, autoFilled: ["budget"] }) }),
      mem("a", "2026-10-22T09:05:00Z", { private: priv({ availability: { "2026-10-23": { from: "18:00", homeBy: "23:00", pref: "ok" } } }) }),
      mem("a", "2026-10-22T09:05:00Z", { private: priv({ chat: [] , notes: ["x"] }) }), // 没开过口，不进分母
      mem("a", "2026-10-22T09:05:00Z", { isDemo: true, private: priv({ budgetMax: 80 }) }),
    ];
    expect(computeStats([], ms, NOW).privateShareRate).toBe(0.75);
    expect(computeStats([], [], NOW).privateShareRate).toBeUndefined();
  });
});

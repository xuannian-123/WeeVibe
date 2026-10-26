// v5 提醒：天气复查（前 24 / 3 小时）、一键切到备案、带伞、安静时段、夜归。
// 内存库 + mock 地图（天气用 JUZHANG_MOCK_WEATHER 注入），用演示时钟（clockOffsetMin）把"现在"拨到需要的时刻。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { afterEach, describe, expect, it } from "vitest";
import * as db from "../../db";
import type { Ju, Member, Poi, Proposal } from "../../types";
import { isQuietHour, switchToFallback } from "./reminders";
import { tickJu } from "./scheduler";

const ADMIN = "admin-token-reminders";
let seq = 0;

const OUTDOOR: Poi = { id: "camp", name: "江边露天烧烤营地", address: "滨江 1 号", lat: 31.17, lng: 121.44, type: "体育休闲服务;露营地" };
const INDOOR: Poi = { id: "room", name: "室内烤肉", address: "商场 B1", lat: 31.171, lng: 121.441, type: "餐饮服务;中餐厅;烤肉", indoor: true };

/** 北京时间 date + "HH:mm" → 绝对时刻 */
const bj = (date: string, hm: string) => new Date(`${date}T${hm}:00+08:00`);
const DATE = "2030-11-02";

function setup(opts: { poi: Poi; startHm: string; nowHm: string; minutes?: number; withFallback?: boolean }) {
  const start = bj(DATE, opts.startHm);
  const end = new Date(start.getTime() + (opts.minutes ?? 120) * 60_000);
  const id = `rj${++seq}`;
  const ms: Member[] = ["社长", "阿杰", "小林"].map((name, i) => ({
    id: `${id}-m${i}`,
    juId: id,
    name,
    avatar: "🐱",
    location: { lat: 31.2, lng: 121.43, label: "家" },
    role: "guest",
    intake: "done",
    status: "in",
    joinedAt: new Date(2030, 0, 1, 0, 0, i).toISOString(),
    isOrganizer: i === 0,
    private: { chat: [], availability: {}, dietTags: [], notes: [], swipes: {}, autoFilled: [], wants: [], matches: [], billFacts: {}, inbox: [] },
    secret: { token: `tok-${id}-${i}`, tier: 1 },
  }));
  const p: Proposal = {
    id: "p1",
    label: "balanced",
    labelText: "均衡",
    slot: { id: `${DATE}T${opts.startHm}`, start: start.toISOString(), end: end.toISOString() },
    poi: opts.poi,
    experiences: ms.map((m) => ({ memberId: m.id, status: "full", lateMin: 0, stayMin: 120, commuteMin: 20, utility: 90, notes: [] })),
    attendCount: 3,
    minUtility: 90,
    avgUtility: 90,
    score: 90,
    headline: "3 人全到",
    tradeoffs: [],
    highlights: [],
    recommended: true,
    ...(opts.withFallback ? { fallback: { trigger: "雨下大了（中雨及以上）", poi: INDOOR, proposalId: "p-indoor" } } : {}),
  };
  const ju: Ju = {
    id,
    title: "烧烤局",
    rawPrompt: "",
    spec: { category: "烧烤", poiKeywords: ["烧烤"], dates: [DATE], earliest: opts.startHm, latest: opts.startHm, durationMinutes: opts.minutes ?? 120, city: "上海" },
    slots: [p.slot],
    status: "confirmed",
    createdAt: new Date().toISOString(),
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    confirmedProposalId: "p1",
    plan: {
      proposals: [p],
      recommendation: "",
      constraintSummaries: [],
      center: { lat: 31.17, lng: 121.44 },
      audit: { inputHash: "", outputHash: "", candidates: 1, evaluations: 3, paretoSize: 1, algorithmVersion: "t" },
      computedAt: new Date().toISOString(),
    },
    admin: { tiers: [], auditSecret: "s", clockOffsetMin: Math.round((bj(DATE, opts.nowHm).getTime() - Date.now()) / 60_000) },
  };
  db.insertJu(ju, ADMIN);
  for (const m of ms) db.upsertMember(m);
  return { id, ms };
}
const rain = (text: string) => JSON.stringify([{ date: DATE, day: { text, temp: 18, windPower: "1-3" }, night: { text, temp: 14, windPower: "1-3" } }]);
const inbox = (mid: string) => db.getMember(mid)!.private!.inbox;

afterEach(() => {
  delete process.env.JUZHANG_MOCK_WEATHER;
});

describe("天气复查", () => {
  it("户外 + 中雨：提醒发起人一键切到备案，群里只说在商量；切过去后时间不变、店换成室内、每个人收到变更", async () => {
    process.env.JUZHANG_MOCK_WEATHER = rain("中雨");
    const { id, ms } = setup({ poi: OUTDOOR, startHm: "15:00", nowHm: "13:00", withFallback: true });
    await tickJu(id);
    const ju = db.getJu(id)!;
    expect(ju.weatherAlert).toMatchObject({ phase: "3h", kind: "heavy", outdoor: true, suggestFallback: true, label: "周六白天" });
    expect(inbox(ms[0].id).some((n) => /切到备案「室内烤肉」/.test(n.text))).toBe(true);
    expect(inbox(ms[1].id).some((n) => /备案/.test(n.text))).toBe(false);
    expect(ju.announcements.at(-1)!.text).toMatch(/商量换到室内/);

    const st = await switchToFallback(id, ADMIN);
    const p = st.ju.plan!.proposals.find((x) => x.id === st.ju.confirmedProposalId)!;
    expect(p.poi.id).toBe("room");
    expect(p.slot.id).toBe(`${DATE}T15:00`);
    expect(st.ju.revisions.at(-1)!.changes[0]).toMatch(/室内烤肉/);
    expect(st.ju.weatherAlert?.switched).toBe(true);
    expect(inbox(ms[1].id).some((n) => n.kind === "revision" && /换到室内/.test(n.text))).toBe(true);
  });

  it("室内 + 小雨：每个人收到一次带伞提醒，再 tick 不重复；同一阶段不再复查", async () => {
    process.env.JUZHANG_MOCK_WEATHER = rain("小雨");
    const { id, ms } = setup({ poi: INDOOR, startHm: "15:00", nowHm: "10:00" });
    await tickJu(id);
    await tickJu(id);
    expect(db.getJu(id)!.weatherAlert).toMatchObject({ phase: "24h", kind: "light", outdoor: false });
    for (const m of ms) expect(inbox(m.id).filter((n) => /带伞/.test(n.text))).toHaveLength(1);
  });

  it("安静时段：不紧急的（室内小雨）等早上再说；紧急的（户外中雨）照发", async () => {
    process.env.JUZHANG_MOCK_WEATHER = rain("小雨");
    const a = setup({ poi: INDOOR, startHm: "15:00", nowHm: "02:00" });
    await tickJu(a.id);
    expect(db.getJu(a.id)!.weatherAlert).toBeUndefined();
    process.env.JUZHANG_MOCK_WEATHER = rain("雷阵雨");
    const b = setup({ poi: OUTDOOR, startHm: "15:00", nowHm: "02:00", withFallback: true });
    await tickJu(b.id);
    expect(db.getJu(b.id)!.weatherAlert?.suggestFallback).toBe(true);
  });

  it("没有备案时不能一键切换", async () => {
    const { id } = setup({ poi: OUTDOOR, startHm: "15:00", nowHm: "13:00" });
    await expect(switchToFallback(id, ADMIN)).rejects.toMatchObject({ status: 409 });
  });
});

describe("其他提醒", () => {
  it("散场晚于 22:30：提醒结伴回去，只提醒一次", async () => {
    const { id, ms } = setup({ poi: INDOOR, startHm: "21:00", nowHm: "23:05", minutes: 120 });
    await tickJu(id);
    await tickJu(id);
    for (const m of ms) expect(inbox(m.id).filter((n) => /结伴/.test(n.text))).toHaveLength(1);
  });

  it("安静时段的判断按北京时间", () => {
    expect(isQuietHour(bj(DATE, "23:30"))).toBe(true);
    expect(isQuietHour(bj(DATE, "07:59"))).toBe(true);
    expect(isQuietHour(bj(DATE, "08:00"))).toBe(false);
    expect(isQuietHour(bj(DATE, "22:59"))).toBe(false);
  });
});

// 定局后：#12 稳定重规划、#11 行程卡 / ETA
import { describe, expect, it } from "vitest";
import type { MapProvider } from "../types";
import { createMockMapProvider } from "../map";
import { etaFor, generateSlots, itineraryFor, planJu, replanStable } from "./index";
import { ju, member, spec } from "./testutil";
import { minToHm } from "./util";

const DAY = "2026-10-23";
const s = spec({ budgetPerPerson: 100 });
const j = ju(s, generateSlots(s));
const map = createMockMapProvider();
const av = (from: string, homeBy?: string) => ({ availability: { [DAY]: { from, ...(homeBy ? { homeBy } : {}), pref: "ok" as const } } });
const base = () => [
  member("局长", 31.2748, 120.7383, { id: "org", isOrganizer: true, priv: av("17:00") }),
  member("小王", 31.2745, 120.7462, { id: "w", priv: { ...av("17:00"), matches: ["l"] } }),
  member("小李", 31.2627, 120.7293, { id: "l", priv: { ...av("17:00"), matches: ["w"] } }),
  member("小张", 31.3075, 120.6935, { id: "z", priv: av("17:30", "22:00") }),
];
const opts = { auditSecret: "k", now: new Date("2026-10-22T12:00:00Z") };

describe("replanStable（#12）", () => {
  it("有人退出但原方案仍可行：保留店和时间，只改桌数", async () => {
    const { plan } = await planJu(j, base(), map, opts);
    const cur = plan.proposals[0];
    const ms = base().map((m) => (m.id === "z" ? { ...m, status: "out" as const } : m));
    const r = await replanStable(j, ms, cur, map, {});
    expect(r).toMatchObject({ keptVenue: true, tableSize: 3 });
    expect(r.proposal.id).toBe(cur.id);
    expect(r.proposal.slot.id).toBe(cur.slot.id);
    expect(r.changes).toEqual(["到场人数从 4 人变为 3 人", "订位改为 3 人"]);
  });

  it("原方案不可行（主角来不了）：换到和原方案差异最小的", async () => {
    const { plan } = await planJu(j, base(), map, opts);
    const cur = plan.proposals[0];
    // 新来的主角 19:00 才能出发，原时段他会迟到太多
    const vip = member("主角", 31.27, 120.735, { id: "vip", role: "must", priv: av("19:15") });
    const r = await replanStable(j, [...base(), vip], cur, map, {});
    expect(r.proposal.experiences.find((e) => e.memberId === "vip")!.status).not.toBe("absent");
    expect(r.keptVenue).toBe(true); // 同一家店换个时间就行，不换店
    expect(r.proposal.poi.id).toBe(cur.poi.id);
    expect(r.proposal.slot.id).not.toBe(cur.slot.id);
    expect(r.changes[0]).toMatch(/^时间从 周五 \d\d:\d\d 改到 周五 \d\d:\d\d（店不变）$/);
  });
});

describe("itineraryFor / etaFor（#11）", () => {
  it("行程卡：按公交路线倒推出发时间，不早于本人能出发的时刻；互选的人坐一起", async () => {
    const { plan } = await planJu(j, base(), map, opts);
    const p = plan.proposals[0];
    const w = base()[1];
    const it = await itineraryFor(w, p, map, "苏州");
    const tr = await map.transitRoute(w.location!, p.poi, "苏州");
    expect(it.commuteMin).toBe(tr.minutes);
    expect(it.route).toEqual(tr.steps);
    const start = Number(p.slot.id.slice(11, 13)) * 60 + Number(p.slot.id.slice(14, 16));
    const dep = Number(it.departAt.slice(0, 2)) * 60 + Number(it.departAt.slice(3));
    expect(dep).toBe(Math.max(17 * 60, start - tr.minutes - 5));
    expect(it.seatWith).toEqual(["l"]);
    const z = await itineraryFor(base()[3], p, map, "苏州");
    expect(z.leaveAt ?? null).toBe(p.experiences.find((e) => e.memberId === "z")!.leaveAt ?? null);
  });

  it("transitRoute 失败退回打车估算", async () => {
    const { plan } = await planJu(j, base(), map, opts);
    const broken: MapProvider = { ...map, transitRoute: async () => Promise.reject(new Error("x")) };
    const it = await itineraryFor(base()[0], plan.proposals[0], broken, "苏州");
    expect(it.route[0]).toMatch(/^打车约 \d+ 分钟/);
  });

  it("ETA：现在出发几点到、晚多少（北京时间，与机器时区无关）", async () => {
    const { plan } = await planJu(j, base(), map, opts);
    const p = plan.proposals[0];
    const pos = { lat: p.poi.lat, lng: p.poi.lng };
    const now = new Date(new Date(p.slot.start).getTime() - 10 * 60000); // 开始前 10 分钟，就在店门口
    const start = Number(p.slot.id.slice(11, 13)) * 60 + Number(p.slot.id.slice(14, 16));
    expect(await etaFor(pos, p, map, now)).toEqual({ arriveAt: minToHm(start - 4), lateMin: 0 }); // 原地打车估算 6 分钟
    const later = new Date(new Date(p.slot.start).getTime() + 10 * 60000);
    expect((await etaFor(pos, p, map, later)).lateMin).toBe(16);
  });
});

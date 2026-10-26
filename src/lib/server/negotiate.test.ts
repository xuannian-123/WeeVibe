// v5 协商流程：没有完美方案 → 诊断 → 局长私下问 → 答应 → 自动重算，所有人都照顾到；不答应 → 换个办法或交给发起人。
// 内存库 + mock 地图 + 规则版 LLM（删掉所有 key）。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import type { JuSpec, Member } from "../types";
import { chat, join } from "./intake";
import { createJu, getState, makePlan } from "./ju";
import { answerAsk } from "./negotiate";
import { answerDemoAsks, seedConflict } from "./seed";

const SPEC: JuSpec = { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:30", latest: "19:30", durationMinutes: 120, city: "上海" };
const HOME = { lat: 31.1952, lng: 121.4372, label: "徐家汇" };

beforeEach(() => db._resetDbForTest());

/**
 * 6 个人。P0：20:00 前必须回去（19:00 开始只能待不到 60 分钟）；P1：19:30 才能出发（18:30 开始要晚 60 多分钟）。
 * 不管路上几分钟，三个时间都至少少一个人 —— 但"少待一会儿 / 晚到一点"在可放宽的范围内。
 */
async function conflict() {
  const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "冲突局", organizerName: "老王" } as Parameters<typeof createJu>[0]);
  const ms: { id: string; token: string }[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await join(id, { name: `P${i}` }, {});
    const from = i === 1 ? "19:30" : "17:00";
    await chat(id, r.memberToken, { location: HOME, availability: { "2030-11-01": { from, ...(i === 0 ? { homeBy: "20:00" } : {}), pref: "ok" } } });
    ms.push({ id: r.memberId, token: r.memberToken });
  }
  await makePlan(id, { adminToken });
  return { id, adminToken, ms };
}
const raw = (id: string): Member[] => db.listMembers(id);
const pending = (id: string) => raw(id).filter((m) => (m.private?.asks ?? []).some((a) => a.status === "pending"));

describe("演示场景 scene = conflict", () => {
  it("门禁 vs 加班：出方案没有完美解 → 局长私下问演示朋友 → 替他回答「可以」→ 所有人都照顾到", async () => {
    const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "部门周五聚餐", organizerName: "小张" } as Parameters<typeof createJu>[0]);
    const org = await join(id, { name: "小张", isOrganizer: true }, { adminToken });
    await chat(id, org.memberToken, { location: HOME, availability: { "2030-11-01": { from: "17:00", pref: "ok" } } });
    await seedConflict(id, { adminToken });
    await makePlan(id, { adminToken });
    const before = getState(id).ju.plan!;
    expect(before.diagnosis?.coordinating).toBeGreaterThanOrEqual(1);
    expect(pending(id).every((m) => m.isDemo)).toBe(true);
    const st = await answerDemoAsks(id, { adminToken });
    expect(st.ju.plan!.proposals[0].cared).toBe(6);
    expect(st.ju.plan!.coordination).toMatch(/协调了/);
    await expect(answerDemoAsks(id, { adminToken })).rejects.toMatchObject({ status: 409 });
  });
});

describe("协商", () => {
  it("没有完美方案：诊断只给分类人数，局长私下去问能让一小步的人（只发给本人）", async () => {
    const { id } = await conflict();
    const plan = getState(id).ju.plan!;
    expect(plan.diagnosis?.uncared).toBeGreaterThanOrEqual(1);
    expect(plan.diagnosis?.reasons.join("")).toMatch(/时间凑不上/);
    const asked = pending(id);
    expect(asked.length).toBeGreaterThanOrEqual(1);
    expect(plan.diagnosis?.coordinating).toBe(asked.length);
    for (const m of asked) {
      const ask = m.private!.asks!.find((a) => a.status === "pending")!;
      expect(ask.kind).toBe("selfTime");
      expect(ask.text).toMatch(/这样也来吗/);
      expect(m.private!.inbox.some((n) => n.kind === "ask")).toBe(true);
    }
    // 公开视图里看不出谁被问了、问了什么
    const pub = JSON.stringify(getState(id));
    expect(pub).not.toMatch(/"asks"|这样也来吗|"relax"/);
    for (const m of asked) expect(pub).not.toContain(m.private!.asks![0].text);
  });

  it("答应了 → 自动重算 → 所有人都照顾到；群里只说协调了几位", async () => {
    const { id, ms } = await conflict();
    for (const m of pending(id)) {
      const t = ms.find((x) => x.id === m.id)!.token;
      const ask = m.private!.asks!.find((a) => a.status === "pending")!;
      await answerAsk(id, t, ask.id, true);
    }
    const plan = getState(id).ju.plan!;
    expect(plan.proposals[0].cared).toBe(6);
    expect(plan.proposals[0].attendCount).toBe(6);
    expect(plan.diagnosis).toBeUndefined();
    expect(plan.coordination).toMatch(/局长私下协调了 \d 位朋友/);
    expect(getState(id).ju.announcements.at(-1)!.text).toMatch(/重新排了一遍/);
  });

  it("不答应 → 不会再拿同一件事问他；问够了就交给发起人", async () => {
    const { id, ms } = await conflict();
    let rounds = 0;
    while (pending(id).length && rounds < 10) {
      for (const m of pending(id)) {
        const t = ms.find((x) => x.id === m.id)!.token;
        await answerAsk(id, t, m.private!.asks!.find((a) => a.status === "pending")!.id, false);
      }
      rounds++;
    }
    const all = raw(id).flatMap((m) => m.private?.asks ?? []);
    // 每人最多被问 2 次、每局最多 5 次；同一个人同一类问题不问第二遍
    expect(all.length).toBeLessThanOrEqual(5);
    for (const m of raw(id)) {
      const asks = m.private?.asks ?? [];
      expect(asks.length).toBeLessThanOrEqual(2);
      expect(new Set(asks.map((a) => `${a.kind}|${a.needKey ?? ""}`)).size).toBe(asks.length);
    }
    expect(getState(id).ju.plan!.proposals[0].cared).toBeLessThan(6);
  });

  it("只能回答自己的问题；答过的不能再答", async () => {
    const { id, ms } = await conflict();
    const m = pending(id)[0];
    const ask = m.private!.asks!.find((a) => a.status === "pending")!;
    const other = ms.find((x) => x.id !== m.id)!;
    await expect(answerAsk(id, other.token, ask.id, true)).rejects.toMatchObject({ status: 404 });
    const mine = ms.find((x) => x.id === m.id)!;
    await answerAsk(id, mine.token, ask.id, false);
    await expect(answerAsk(id, mine.token, ask.id, true)).rejects.toMatchObject({ status: 409 });
  });
});

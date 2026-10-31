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
import { answerAsk, revokeConcession } from "./negotiate";
import { getProfile, saveProfile } from "./profile";
import { answerDemoAsks, seedAvatar, seedConflict } from "./seed";

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
      expect(m.private!.inbox.some((n) => n.kind === "ask" && n.text.startsWith("你的分身来问你"))).toBe(true);
      expect(m.private!.avatarLog!.some((e) => e.kind === "ask")).toBe(true);
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

// ---------------------------------------------------------------- v6 分身谈判（docs/AVATAR.md 第 4 节）

async function avatarJu() {
  const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "分身局", organizerName: "小张" } as Parameters<typeof createJu>[0]);
  const org = await join(id, { name: "小张", isOrganizer: true }, { adminToken });
  await chat(id, org.memberToken, { location: HOME, availability: { "2030-11-01": { from: "17:00", pref: "ok" } } });
  await seedAvatar(id, { adminToken });
  return { id, adminToken };
}
const byName = (id: string, name: string) => raw(id).find((m) => m.name === name)!;

describe("演示场景 scene = avatar（分身谈判）", () => {
  it("一键出方案：8 个分身，五轮里有底线、自动让步、交换、私下问、补偿、拍板；公开记录只有局长和分身代号", async () => {
    const { id } = await avatarJu();
    const plan = getState(id).ju.plan!;
    const ng = plan.negotiation!;
    expect(new Set(ng.events.map((e) => e.round))).toEqual(new Set([0, 1, 2, 3, 4]));
    for (const k of ["open", "propose", "block", "concede", "trade", "ask", "compensate", "decide"]) expect(ng.events.some((e) => e.kind === k)).toBe(true);
    expect(ng.events.every((e) => e.speaker === "局长" || /^分身 [A-Z]$/.test(e.speaker))).toBe(true);
    expect(ng.autoConcessions).toBeGreaterThanOrEqual(2);
    expect(ng.trades).toBe(1);
    expect(ng.asked).toBe(1);
    const text = ng.events.map((e) => `${e.speaker}：${e.text}`).join("\n");
    expect(text).toMatch(/我这边有条底线，时间上动不了/);
    expect(text).toMatch(/2 位想躺着/);
    for (const m of raw(id)) expect(text).not.toContain(m.name);
    // 公开视图里有谈判记录，没有任何人的授权书 / 分身记录
    const pub = JSON.stringify(getState(id));
    expect(pub).toContain("分身 A");
    expect(pub).not.toMatch(/"mandate"|"avatarLog"|"mood"|替你多/);
    // 自动让步的人收到 kind = avatar 的站内信；被问的是坚持风格、什么都不让的小周
    const lin = byName(id, "小林");
    expect(lin.private!.inbox.some((n) => n.kind === "avatar" && /你的分身替你多让了/.test(n.text))).toBe(true);
    expect(lin.private!.avatarLog!.some((e) => e.kind === "concede" && e.dim === "lateMin")).toBe(true);
    expect(pending(id).map((m) => m.name)).toEqual(["小周"]);
    // 替演示朋友回答 → 8/8
    const st = await answerDemoAsks(id, {});
    expect(st.ju.plan!.proposals[0].cared).toBe(8);
    expect(st.ju.plan!.negotiation!.outcome).toMatch(/8 个人都照顾到了$/);
  });

  it("重算时同一件事的站内信只发一次；问过的事、撤回过的让步留在本人记录里", async () => {
    const { id } = await avatarJu();
    await answerDemoAsks(id, {});
    const lin = byName(id, "小林");
    expect(lin.private!.inbox.filter((n) => n.kind === "avatar").length).toBe(1);
    const zhou = byName(id, "小周");
    expect(zhou.private!.avatarLog!.find((e) => e.kind === "ask")!.text).toMatch(/你回答了「可以」/);
  });

  it("撤回自动让步：30 分钟内可以，撤回后这一维 give 视为 0、立刻重算；别人的、非让步的、过期的都不行", async () => {
    const { id } = await avatarJu();
    await answerDemoAsks(id, {});
    const lin = byName(id, "小林");
    const entry = lin.private!.avatarLog!.find((e) => e.kind === "concede")!;
    const other = byName(id, "老王");
    await expect(revokeConcession(id, other.secret!.token, entry.id)).rejects.toMatchObject({ status: 404 });
    const held = lin.private!.avatarLog!.find((e) => e.kind !== "concede")!;
    await expect(revokeConcession(id, lin.secret!.token, held.id)).rejects.toMatchObject({ status: 400 });
    await expect(revokeConcession(id, "", entry.id)).rejects.toMatchObject({ status: 401 });

    const r = await revokeConcession(id, lin.secret!.token, entry.id);
    expect(r.entry.revoked).toBe(true);
    const after = byName(id, "小林");
    expect(after.private!.avatarLog!.some((e) => e.id === entry.id && e.revoked)).toBe(true);
    // 分身不再替他让时间：要么换了时间让他准点到，要么来问他本人
    expect(after.private!.avatarLog!.some((e) => e.kind === "concede" && e.dim === "lateMin" && !e.revoked)).toBe(false);
    await expect(revokeConcession(id, lin.secret!.token, entry.id)).rejects.toMatchObject({ status: 409 });

    // 过了 30 分钟：撤回不了
    const laowang = byName(id, "老王");
    const e2 = laowang.private!.avatarLog!.find((e) => e.kind === "concede" && !e.revoked);
    if (e2) {
      const ju = db.getJu(id)!;
      ju.admin = { ...ju.admin!, clockOffsetMin: 31 };
      db.saveJu(ju);
      await expect(revokeConcession(id, laowang.secret!.token, e2.id)).rejects.toMatchObject({ status: 409 });
    }
  });

  it("补偿记账：自动让了步的人记进档案的让步账（同一局只记一次），这一局自己的不影响这一局的重算", async () => {
    const { id, adminToken } = await avatarJu();
    const lin = byName(id, "小林");
    lin.profileId = `prof-lin-${id}`;
    db.upsertMember(lin);
    saveProfile({ id: lin.profileId, dietTags: [], ledger: [], tastes: {} });
    await makePlan(id, { adminToken });
    await makePlan(id, { adminToken });
    const prof = getProfile(lin.profileId)!;
    expect(prof.concessions?.filter((c) => c.juId === id).length).toBe(1);
    // 档案里记了账，这一局再算还是同样的谈判（不会因为自己刚让过步就换人来回翻）
    const a = JSON.stringify(getState(id).ju.plan!.negotiation);
    await makePlan(id, { adminToken });
    expect(JSON.stringify(getState(id).ju.plan!.negotiation)).toBe(a);
  });
});

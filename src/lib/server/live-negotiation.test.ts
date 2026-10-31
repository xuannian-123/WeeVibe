// v6 实时分身谈判：局长按议程点名，分身们（大模型，这里用桩）一句句说，说完可以回看。
// 测：开场每个分身各一句、被点名时用自己的话说同一个意思、不合规的话退回规则版、超出授权时分身自己决定问不问主人、
// 进程重启后补齐规则版、结论不受措辞影响。
process.env.JUZHANG_DB = ":memory:";
process.env.JUZHANG_SCHEDULER = "off";
process.env.JUZHANG_LIVE_GAP_MS = "0";
process.env.LLM_API_KEY = "test";
delete process.env.AMAP_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import * as provider from "../llm/provider";
import type { JuSpec, Member } from "../types";
import { chat, join } from "./intake";
import { advanceJu, createJu, getState } from "./ju";
import { seedAvatar } from "./seed";

const SPEC: JuSpec = { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:30", latest: "19:30", durationMinutes: 120, city: "上海" };
const HOME = { lat: 31.1952, lng: 121.4372, label: "徐家汇" };

/** 分身的桩：按回合类型回话；其余大模型调用（润色、群公告）一律失败 → 走规则版 */
let reply: (user: string) => { say: string; action: "ask_owner" | "decline" | null } = () => ({ say: "好的～", action: null });
beforeEach(() => {
  db._resetDbForTest();
  vi.restoreAllMocks();
  vi.spyOn(provider, "callLlmJson").mockImplementation(async (req) => {
    if (!req.system.includes("AI 分身")) throw new Error("no llm in test");
    return reply(req.user);
  });
});

async function avatarJu() {
  const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "分身局", organizerName: "小张" } as Parameters<typeof createJu>[0]);
  const org = await join(id, { name: "小张", isOrganizer: true }, { adminToken });
  await chat(id, org.memberToken, { location: HOME, availability: { "2030-11-01": { from: "17:00", pref: "ok" } } });
  await seedAvatar(id, { adminToken });
  return { id, adminToken };
}
const neg = (id: string) => getState(id).ju.plan!.negotiation!;
const done = (id: string) => vi.waitFor(() => expect(neg(id).status).toBe("done"), { timeout: 8000, interval: 20 });
const raw = (id: string): Member[] => db.listMembers(id);

describe("实时分身谈判", () => {
  it("出方案时先清空、标 live；谈完 status = done；开场每个分身各说一句（智能体自己的话）", async () => {
    reply = (u) => (u.includes("开场") ? { say: "我都可以，大家开心就好～", action: null } : { say: "收到，我这边就这么定。", action: null });
    const { id } = await avatarJu();
    expect(neg(id).status).toBe("live");
    await done(id);
    const ev = neg(id).events;
    const opens = ev.filter((e) => e.kind === "open" && e.speaker !== "局长");
    expect(opens.length).toBe(8);
    expect(opens.every((e) => e.text === "我都可以，大家开心就好～")).toBe(true);
    expect(new Set(opens.map((e) => e.speaker)).size).toBe(8);
    expect(ev.every((e) => e.speaker === "局长" || /^分身 [A-Z]$/.test(e.speaker))).toBe(true);
    // 整份公开记录里没有任何人的名字（不然代号就对上人了）
    const names = raw(id).map((m) => m.name);
    for (const e of ev) for (const nm of names) expect(e.text).not.toContain(nm);
    // 局长的话照规则版：交底、拍板都在
    expect(ev.some((e) => e.speaker === "局长" && e.kind === "decide" && /拍板/.test(e.text))).toBe(true);
  });

  it("不合规的话（名字、底线原因、没出现过的数字）退回规则版", async () => {
    reply = (u) => (u.includes("开场") ? { say: "我宿舍门禁，得早点回", action: null } : { say: "我预算只有 37 块", action: null });
    const { id } = await avatarJu();
    await done(id);
    const text = neg(id).events.map((e) => e.text).join("\n");
    expect(text).not.toMatch(/宿舍|门禁|37/);
    expect(text).toMatch(/我这边有条底线，时间上动不了|晚到/);
  });

  it("超出授权时分身替主人婉拒：不发私信，聚合数字跟着改", async () => {
    reply = (u) => (u.includes("超出了你的授权") ? { say: "这个我替主人婉拒啦。", action: "decline" } : { say: "好。", action: null });
    const { id } = await avatarJu();
    await done(id);
    expect(raw(id).some((m) => (m.private?.asks ?? []).some((a) => a.status === "pending"))).toBe(false);
    expect(neg(id).asked).toBe(0);
    expect(neg(id).events.some((e) => e.text === "这个我替主人婉拒啦。")).toBe(true);
  });

  it("分身决定去问主人：私信照常发出", async () => {
    reply = (u) => (u.includes("超出了你的授权") ? { say: "我去问问主人。", action: "ask_owner" } : { say: "好。", action: null });
    const { id } = await avatarJu();
    await done(id);
    expect(raw(id).filter((m) => (m.private?.asks ?? []).some((a) => a.status === "pending")).length).toBe(1);
  });

  it("结论不受措辞影响：推荐方案和规则版一样", async () => {
    reply = () => ({ say: "好。", action: null });
    const a = await avatarJu();
    await done(a.id);
    const recA = getState(a.id).ju.plan!.proposals[0];
    reply = () => ({ say: "行吧，我没意见～", action: null });
    db._resetDbForTest();
    const b = await avatarJu();
    await done(b.id);
    const recB = getState(b.id).ju.plan!.proposals[0];
    expect(recB.poi.id).toBe(recA.poi.id);
    expect(recB.slot.id).toBe(recA.slot.id);
  });

  it("进程重启（停在 live、没人在跑）：下次有人打开就补齐规则版", async () => {
    reply = () => ({ say: "好。", action: null });
    const { id } = await avatarJu();
    await done(id);
    // 模拟：重启前停在半路
    const ju = db.getJu(id)!;
    ju.plan!.negotiation = { ...ju.plan!.negotiation!, status: "live", events: ju.plan!.negotiation!.events.slice(0, 2) };
    ju.plan!.computedAt = "2030-01-01T00:00:00.000Z";
    const priv = db.getJuPrivate(id);
    priv.live = { computedAt: ju.plan!.computedAt, template: { ...ju.plan!.negotiation!, events: [{ round: 0, speaker: "局长", kind: "open", text: "规则版" }] }, speakers: [null], codes: {}, asks: [] };
    db.saveJu(ju);
    db.saveJuPrivate(id, priv);
    await advanceJu(id);
    expect(neg(id).status).toBe("done");
    expect(neg(id).events.map((e) => e.text)).toEqual(["规则版"]);
  });
  it("讨论：分身们表态、互相回应；局长只在一样公平的方案之间听呼声；记录能复算", async () => {
    // 所有分身都支持方案 2、反对方案 1
    reply = (u) =>
      u.includes("讨论时间")
        ? { say: "我更想要方案 2，安静点好聊天。", action: null, support: 2, oppose: 1, offer: true }
        : { say: "好。", action: null };
    const { id } = await avatarJu();
    await done(id);
    const ev = neg(id).events;
    const argues = ev.filter((e) => e.kind === "argue");
    expect(argues.length).toBeGreaterThanOrEqual(8);
    expect(argues.every((e) => /^分身 [A-Z]$/.test(e.speaker))).toBe(true);
    expect(ev.some((e) => e.speaker === "局长" && /大家的呼声|意见都记下了/.test(e.text))).toBe(true);
    const plan = getState(id).ju.plan!;
    const live = db.getJuPrivate(id).live!;
    const { deliberationPick } = await import("../planner/avatar/deliberate");
    // 同一份讨论记录复算，结论一样
    expect(deliberationPick(live.options!, live.stances!).chosen).toBe(live.chosen);
    expect(plan.discussion?.chosen).toBe(live.chosen);
    const second = live.options![1];
    if (second?.fair) {
      expect(plan.proposals[0].id).toBe(second.proposalId);
      expect(plan.recommendation).toMatch(/讨论后选的/);
    } else {
      expect(plan.proposals[0].id).toBe(plan.discussion?.ruleChoice);
    }
  });
});

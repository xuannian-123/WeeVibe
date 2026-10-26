// v5 需求模型的私聊流程：自然语言 → 需求入库；推断出的硬约束先回问确认，"不是"就降成软偏好。
// 内存库 + 规则版私聊（删掉所有 key）。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import type { JuSpec, Member } from "../types";
import { chat, join } from "./intake";
import { createJu } from "./ju";

const SPEC: JuSpec = { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:00", latest: "19:30", durationMinutes: 120, city: "上海" };

beforeEach(() => db._resetDbForTest());

async function one() {
  const { id } = await createJu({ prompt: "", spec: SPEC, title: "测试局", organizerName: "老王" } as Parameters<typeof createJu>[0]);
  const r = await join(id, { name: "小林" }, {});
  return { id, token: r.memberToken, mid: r.memberId };
}
const raw = (id: string, mid: string): Member => db.listMembers(id).find((m) => m.id === mid)!;

describe("需求入库", () => {
  it("说了能算的需求：入库、局长复述一遍", async () => {
    const { id, token, mid } = await one();
    const r = await chat(id, token, { text: "我腿受伤了不想走太远，而且不喝酒" });
    const needs = raw(id, mid).private!.needs ?? [];
    expect(needs.map((n) => n.rule.t).sort()).toEqual(["maxCommute", "noAlcohol"]);
    expect(needs.every((n) => n.id && n.at && n.source === "chat")).toBe(true);
    expect(r.reply).toContain("记下了");
    expect(r.reply).toContain("腿脚不方便");
  });

  it("同一条需求再说一遍不重复，说得更强就更新强度", async () => {
    const { id, token, mid } = await one();
    await chat(id, token, { text: "别太远就行" });
    await chat(id, token, { text: "太远了真的受不了" });
    const needs = (raw(id, mid).private!.needs ?? []).filter((n) => n.rule.t === "maxCommute");
    expect(needs).toHaveLength(1);
    expect(needs[0].strength).toBe(3);
  });

  it("手头紧 → 预算很在意", async () => {
    const { id, token, mid } = await one();
    await chat(id, token, { text: "最近手头有点紧" });
    expect(raw(id, mid).private!.budgetStrength).toBe(3);
  });
});

describe("硬约束回问确认", () => {
  it("门禁：先回问；回答「对」→ 记成确认过的硬约束", async () => {
    const { id, token, mid } = await one();
    const r1 = await chat(id, token, { text: "周五6点半下班，宿舍11点门禁" });
    expect(r1.reply).toContain("确认一下");
    expect(r1.quickReplies).toEqual(["对，必须", "不是，尽量就行"]);
    expect(raw(id, mid).private!.pendingConfirm?.key).toBe("homeBy");
    // 确认之前按硬约束算
    expect(raw(id, mid).private!.availability["2030-11-01"].homeBy).toBe("23:00");

    const r2 = await chat(id, token, { text: "对，必须" });
    const p = raw(id, mid).private!;
    expect(p.pendingConfirm).toBeUndefined();
    expect(p.confirmed).toContain("homeBy");
    expect(p.availability["2030-11-01"].homeBy).toBe("23:00");
    expect(r2.reply).toContain("硬性的");
  });

  it("门禁：回答「不是，尽量就行」→ 去掉硬门禁，换成软的「想几点前结束」", async () => {
    const { id, token, mid } = await one();
    await chat(id, token, { text: "周五6点半下班，11点前要回去" });
    await chat(id, token, { text: "不是，尽量就行" });
    const p = raw(id, mid).private!;
    expect(p.availability["2030-11-01"].homeBy).toBeUndefined();
    expect(p.needs?.some((n) => n.rule.t === "leaveBy" && n.kind === "soft" && (n.rule as { at: string }).at === "23:00")).toBe(true);
  });

  it("「最多一个小时」这种硬需求也要确认；否认后变成很在意的软偏好", async () => {
    const { id, token, mid } = await one();
    const r1 = await chat(id, token, { text: "路上最多一个小时，再远我就不去了" });
    // "再远我就不去了"是条件，不是拒绝：人还在局里
    expect(raw(id, mid).status).toBe("in");
    expect(raw(id, mid).private!.rsvp).not.toBe("no");
    expect(r1.reply).toContain("确认一下");
    await chat(id, token, { text: "也不一定" });
    const n = raw(id, mid).private!.needs!.find((x) => x.rule.t === "maxCommute")!;
    expect(n.kind).toBe("soft");
    expect(n.strength).toBe(3);
  });

  it("组件提交的时间不回问（本人亲手选的就是确认过的）", async () => {
    const { id, token, mid } = await one();
    const r = await chat(id, token, { availability: { "2030-11-01": { from: "18:30", homeBy: "23:00", pref: "ok" } } });
    expect(r.reply).not.toContain("确认一下");
    expect(raw(id, mid).private!.pendingConfirm).toBeUndefined();
  });
});

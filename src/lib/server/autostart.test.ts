// 人齐了才自动开谈：还没点开链接的朋友不在局里，"在局的都交了"不等于齐了。
process.env.JUZHANG_DB = ":memory:";
process.env.JUZHANG_SCHEDULER = "off";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import type { JuSpec } from "../types";
import { chat, join } from "./intake";
import { advanceJu, createJu, getState } from "./ju";

const base: JuSpec = { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:30", latest: "19:30", durationMinutes: 120, city: "上海" };
const HOME = { lat: 31.1952, lng: 121.4372, label: "徐家汇" };
beforeEach(() => db._resetDbForTest());

async function ju(headcount?: number) {
  const { id, adminToken } = await createJu({ prompt: "", spec: { ...base, ...(headcount ? { headcount } : {}) }, title: "测", organizerName: "阿明" } as Parameters<typeof createJu>[0]);
  return { id, adminToken };
}
async function fill(id: string, name: string, adminToken?: string) {
  const j = await join(id, { name, ...(adminToken ? { isOrganizer: true } : {}) }, adminToken ? { adminToken } : {});
  await chat(id, j.memberToken, { rsvp: "yes", location: HOME, availability: { "2030-11-01": { from: "17:00", pref: "ok" } }, budgetMax: 150, dietTags: [], preferenceAction: "finish" });
  return j;
}

describe("什么时候自动开谈", () => {
  it("发起人说了 4 个人：3 个交了不开谈，第 4 个交了就开谈", async () => {
    const { id, adminToken } = await ju(4);
    await fill(id, "阿明", adminToken);
    await fill(id, "小林");
    await fill(id, "老王");
    await advanceJu(id);
    expect(getState(id).ju.status).toBe("collecting");
    await fill(id, "小周");
    await advanceJu(id);
    expect(getState(id).ju.status).toBe("voting");
  });

  it("没说人数：大家都交了也不自动开谈，只提醒发起人一次", async () => {
    const { id, adminToken } = await ju();
    const org = await fill(id, "阿明", adminToken);
    await fill(id, "小林");
    await fill(id, "老王");
    await advanceJu(id);
    await advanceJu(id);
    expect(getState(id).ju.status).toBe("collecting");
    const inbox = db.getMember(org.memberId)!.private!.inbox.filter((n) => n.id.endsWith("-ready-3"));
    expect(inbox).toHaveLength(1);
    expect(inbox[0].text).toMatch(/人齐了吗/);
  });
});

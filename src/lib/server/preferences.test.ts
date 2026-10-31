process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import * as llm from "../llm";
import * as provider from "../llm/provider";
import type { JuSpec } from "../types";
import { chat, join } from "./intake";
import { createJu, getState } from "./ju";
import { chatBody } from "./schemas";
import { emptyProfile, saveProfile } from "./profile";

const dates = ["2030-11-01", "2030-11-02"];
const spec: JuSpec = { category: "火锅", poiKeywords: ["火锅"], dates, earliest: "18:00", latest: "19:30", durationMinutes: 120, city: "上海", cityFrom: "said" };
const location = { lat: 31.2, lng: 121.4, label: "徐家汇" };
const form = { rsvp: "yes" as const, location, availability: { [dates[0]]: { from: "17:30", homeBy: "23:00", pref: "ok" as const } }, dietTags: [] as [], budgetMax: 88 };
async function one(profileId?: string) {
  const { id } = await createJu({ prompt: "", title: "测试局", spec });
  const member = await join(id, { name: "小林", profileId }, {});
  return { id, token: member.memberToken, mid: member.memberId };
}
beforeEach(() => db._resetDbForTest());
afterEach(() => vi.restoreAllMocks());

// v6：偏好卡片改造成授权书卡片（docs/AVATAR.md 5.2）。结构化保存沿用，「就这样」同时让授权书生效。
describe("授权书卡片（原偏好卡片）", () => {
  it("一次确认直接完成，不调用模型、不伪造刷卡，不公开私密预算；授权书生效", async () => {
    const { id, token } = await one();
    const model = vi.spyOn(llm, "chatTurn");
    const result = await chat(id, token, chatBody.parse({ ...form, preferenceAction: "finish" }));
    expect(model).not.toHaveBeenCalled();
    expect(result.me.intake).toBe("done");
    expect(result.me.private?.mandate).toMatchObject({ status: "confirmed", style: "balanced" });
    expect(result.reply).toContain("授权书");
    expect(result.me.private?.swipes).toEqual({});
    expect(result.me.private?.budgetMax).toBe(88);
    expect(result.me.private?.pendingConfirm).toBeUndefined();
    expect(result.me.private?.autoFilled).toEqual([]);
    const pub = await getState(id, {});
    expect(pub.members.every((m) => !m.private && !m.secret)).toBe(true);
  });

  it("可以主动选刷店，也可以只保存草稿继续私聊（草稿不写进私聊记录，授权书仍是草稿）", async () => {
    const { id, token } = await one();
    const before = db.getMember((await getState(id, { memberToken: token })).me!.id)!.private!.chat.length;
    const draft = await chat(id, token, chatBody.parse({ ...form, preferenceAction: "review" }));
    expect(draft.me.intake).toBe("chatting");
    expect(draft.me.private?.chat.length).toBe(before);
    expect(draft.me.private?.mandate?.status ?? "draft").toBe("draft");
    const result = await chat(id, token, chatBody.parse({ ...form, preferenceAction: "swipe" }));
    expect(result.me.intake).toBe("swiping");
  });

  it("取消勾选的日期会被删除，不和旧时间合并", async () => {
    const { id, token } = await one();
    await chat(id, token, { availability: { [dates[1]]: { from: "18:00", pref: "ok" } } });
    const result = await chat(id, token, chatBody.parse({ ...form, preferenceAction: "finish" }));
    expect(Object.keys(result.me.private!.availability)).toEqual([dates[0]]);
  });

  it("缺少出发地或有效日期不能完成，也不会留下半份提交", async () => {
    const { id, token, mid } = await one();
    await expect(chat(id, token, chatBody.parse({ rsvp: "yes", preferenceAction: "finish" }))).rejects.toThrow();
    await expect(chat(id, token, chatBody.parse({ ...form, availability: {}, preferenceAction: "finish" }))).rejects.toThrow();
    expect(db.getMember(mid)?.private?.rsvp).toBeUndefined();
    expect(db.getMember(mid)?.intake).toBe("chatting");
  });

  it("悄悄拒绝无需填写其余偏好，错误 token 无法提交", async () => {
    const { id, token } = await one();
    await expect(chat(id, "wrong-token", chatBody.parse({ ...form, preferenceAction: "finish" }))).rejects.toThrow();
    const result = await chat(id, token, chatBody.parse({ rsvp: "no", preferenceAction: "finish" }));
    expect(result.me.status).toBe("out");
  });

  it("入局预填本人档案，完成前仍需确认", async () => {
    saveProfile({ ...emptyProfile("profile-123"), lastLocation: location, typicalBudget: 80, usualFrom: "17:00", dietTags: ["不吃辣"] });
    const { mid } = await one("profile-123");
    const me = db.getMember(mid)!;
    expect(me.location).toEqual(location);
    expect(me.private?.budgetMax).toBe(80);
    expect(me.private?.dietTags).toEqual(["不吃辣"]);
    expect(me.private?.autoFilled).toContain("availability");
    expect(me.intake).toBe("chatting");
  });

  it("可选私聊只回应补充，推断的硬约束仍需确认，刷新后保留确认问题", async () => {
    const { id, token } = await one();
    await chat(id, token, chatBody.parse({ ...form, preferenceAction: "review" }));
    const reply = await chat(id, token, chatBody.parse({ text: "路上最多一个小时，再远我就不去了", preferencesChat: true }));
    expect(reply.reply).toContain("确认一下");
    expect(reply.me.intake).toBe("chatting");
    await expect(chat(id, token, chatBody.parse({ ...form, preferenceAction: "finish" }))).rejects.toThrow("确认");
    const ack = await chat(id, token, chatBody.parse({ text: "对，必须", preferencesChat: true }));
    expect(ack.me.private?.pendingConfirm).toBeUndefined();
    expect(ack.me.intake).toBe("chatting");
    expect(ack.reply).not.toContain("刷卡");
  });

  it("启用模型时也不再给它逐项收集清单，补充内容仍会入库", async () => {
    const { id, token } = await one();
    await chat(id, token, chatBody.parse({ ...form, preferenceAction: "review" }));
    vi.spyOn(provider, "currentProvider").mockReturnValue("openai-compat");
    const call = vi.spyOn(provider, "callLlmJson").mockResolvedValue({ reply: "不喝酒记下了，酒水不会算你的。", askStep: null, rsvp: null, placeName: null, availability: null, dietTags: null, budgetMax: null, note: null, noAlcohol: true, skipItems: null, wantsAutofill: null, needs: null, budgetStrength: null });
    const result = await chat(id, token, chatBody.parse({ text: "我不喝酒", preferencesChat: true }));
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0][0].system).toContain("不要逐项收集信息");
    expect(call.mock.calls[0][0].user).toContain("【还缺的信息】没有了");
    expect(result.me.private?.billFacts.noAlcohol).toBe(true);
    expect(result.me.intake).toBe("chatting");
    expect(result.widget).toBeNull();
  });

  it("课表显示所有候选日期都忙时，清空旧时间而不是保留默认有空", async () => {
    const { id, token } = await one();
    await chat(id, token, chatBody.parse({ ...form, preferenceAction: "review" }));
    vi.spyOn(llm, "parseSchedule").mockResolvedValue({ busy: [
      { weekday: 5, from: "17:00", to: "23:00" },
      { weekday: 6, from: "17:00", to: "23:00" },
    ] });
    const result = await chat(id, token, chatBody.parse({ schedule: "demo", preferencesChat: true }));
    expect(result.me.private?.availability).toEqual({});
    expect(result.me.intake).toBe("chatting");
  });
});

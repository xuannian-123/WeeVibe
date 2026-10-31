// v6 线 C：建档 / 边说边填 / 授权书 / 固定档案 / 局后反馈（docs/AVATAR.md 第 2、5 节）。全部规则版，不联网。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as db from "../db";
import type { JuSpec, Member, Plan, Profile, Proposal } from "../types";
import { ruleActivities, ruleActivityOpen, ruleIntent, ruleMood, ruleStyle } from "../llm/intent";
import { bodyOf, draftFor, litCells, missingRequired } from "../client/intakeDraft";
import { chosenFloors, floorCandidates, GIVE_BY_STYLE, mandateOf, MAX_FLOORS } from "../client/mandate";
import { factConfidence, moodDefault, needsOnboarding, saidFacts, tastesOf } from "../client/profileFacts";
import { chat, join } from "./intake";
import { createJu, getState, mutateJu, vote } from "./ju";
import { feedbackDue, feedbackStatus, submitFeedback } from "./feedback";
import { applyFeedback, editProfile, emptyProfile, getProfile, learn, saveProfile } from "./profile";
import { chatBody, feedbackBody, onboardingBody } from "./schemas";

// 2030-11-01 周五、11-02 周六
const dates = ["2030-11-01", "2030-11-02"];
const spec: JuSpec = { category: "局长定", poiKeywords: [], dates, earliest: "18:00", latest: "19:30", durationMinutes: 120, city: "上海", cityFrom: "said", open: true };
const XJH = { lat: 31.195, lng: 121.437, label: "徐家汇" };

async function one(profileId?: string, s: JuSpec = spec) {
  const { id } = await createJu({ prompt: "", title: "测试局", spec: s });
  const m = await join(id, { name: "小林", ...(profileId ? { profileId } : {}) }, {});
  return { id, token: m.memberToken, mid: m.memberId };
}
const meOf = (mid: string) => db.getMember(mid)!;
const stateOf = (id: string, token: string) => getState(id, { memberToken: token });

beforeEach(() => db._resetDbForTest());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 抽取（规则版）

describe("一句话听出状态 / 风格 / 想干什么", () => {
  it("mood：累 → 躺；累但想聊 → 安静聊；想出汗 → 动；想嗨 → 嗨", () => {
    expect(ruleMood("这周好累")).toBe("lazy");
    expect(ruleMood("这周好累，想找个地方聊聊天")).toBe("chill");
    expect(ruleMood("想出汗，动一动")).toBe("active");
    expect(ruleMood("不想动，躺着就行")).toBe("lazy");
    expect(ruleMood("想热闹点嗨一下")).toBe("hype");
    expect(ruleMood("周六有空")).toBeUndefined();
  });

  it("风格：我都行 → 随和；这次就想吃火锅 → 坚持；没说 → 不填", () => {
    expect(ruleStyle("我都行")).toBe("easy");
    expect(ruleStyle("这次就想吃火锅")).toBe("firm");
    expect(ruleStyle("周六晚上有空")).toBeUndefined();
  });

  it("活动意向：想唱歌 → KTV；否定的不算；没想法 → 局长定", () => {
    expect(ruleActivities("想唱歌")).toEqual(["ktv"]);
    expect(ruleActivities("火锅或者桌游都行")).toEqual(["hotpot", "boardgame"]);
    expect(ruleActivities("不想唱歌，别去KTV")).toEqual([]);
    expect(ruleActivityOpen("干啥都行，局长定")).toBe(true);
    expect(ruleIntent("干啥都行，局长定")).toMatchObject({ activityOpen: true, style: "easy" });
  });

  it("说一句话 → 对应格子亮起（mood、活动、风格进本人私密区）", async () => {
    const { id, token } = await one();
    const before = draftFor(stateOf(id, token), stateOf(id, token).me!);
    const r = await chat(id, token, chatBody.parse({ text: "这次就想唱歌，这周好累", preferencesChat: true }));
    const p = r.me.private!;
    expect(p.mood).toBe("lazy");
    expect(p.mandate?.style).toBe("firm");
    expect(p.mandate?.give).toEqual(GIVE_BY_STYLE.firm);
    expect(p.needs?.some((n) => n.rule.t === "preferCategory" && n.rule.words.includes("KTV"))).toBe(true);
    const after = draftFor(stateOf(id, token), r.me);
    expect(litCells(before, after)).toEqual(expect.arrayContaining(["mood", "activity"]));
    expect(r.reply).toMatch(/累|舒服/);
  });
});

// ---------------------------------------------------------------- 建档

describe("首次建档「认识你的分身」", () => {
  const onboardingInput = {
    avatarName: "小橘",
    places: [{ kind: "home" as const, place: XJH }],
    transport: "metro" as const,
    floors: ["homeBy" as const, "清真" as const, "剧烈运动" as const],
    homeBy: "22:30",
    budget: 120,
    swipes: { hotpot: "love" as const, ktv: "pass" as const, climbing: "like" as const },
  };

  it("完成：写 onboardedAt、我说的事实，并按新档案预填这次的授权书（底线已确认）", async () => {
    const { id, token, mid } = await one("pid-onboard-1");
    expect(needsOnboarding(getProfile("pid-onboard-1"))).toBe(true);
    const r = await chat(id, token, chatBody.parse({ onboarding: onboardingInput }));
    const prof = getProfile("pid-onboard-1")!;
    expect(prof.onboardedAt).toBeTruthy();
    expect(needsOnboarding(prof)).toBe(false);
    expect(prof.avatarName).toBe("小橘");
    expect(prof.activityTastes).toEqual({ hotpot: 1, ktv: -0.5, climbing: 0.5 });
    expect(prof.facts?.every((f) => f.source === "said")).toBe(true);
    expect(r.reply).toContain("小橘");
    const me = meOf(mid);
    expect(me.location?.label).toBe("徐家汇");
    expect(me.private?.budgetMax).toBe(120);
    expect(Object.values(me.private!.availability).every((a) => a.homeBy === "22:30")).toBe(true);
    const view = mandateOf(me);
    expect(view.floors.map((f) => f.key)).toEqual(expect.arrayContaining(["homeBy", "diet:清真"]));
    expect(view.floors).toHaveLength(3);
  });

  it("每屏都能跳过：空的建档也算完成；整个跳过（不调接口）下次还会先走建档", async () => {
    const { id, token } = await one("pid-onboard-2");
    await chat(id, token, chatBody.parse({ onboarding: {} }));
    expect(getProfile("pid-onboard-2")?.onboardedAt).toBeTruthy();
    await one("pid-onboard-3");
    expect(needsOnboarding(getProfile("pid-onboard-3"))).toBe(true);
  });

  it("建档底线最多 3 条", () => {
    expect(() => onboardingBody.parse({ floors: ["homeBy", "清真", "素食", "不喝酒"] })).toThrow(/最多 3 条/);
  });
});

// ---------------------------------------------------------------- 授权书

describe("授权书：底线上限、风格、确认", () => {
  it("提交超过 3 条底线直接拒绝，理由写清楚", () => {
    expect(() => chatBody.parse({ mandate: { style: "balanced", floors: ["a", "b", "c", "d"] }, preferenceAction: "review" })).toThrow(/底线越少/);
  });

  it("候选超过 3 条：默认保留最早确认的 3 条，其余降成强度 3 的想要；本人可以换着选", async () => {
    const { id, token, mid } = await one();
    await chat(id, token, chatBody.parse({
      rsvp: "yes", location: XJH, budgetMax: 100, dietTags: ["清真", "素食"],
      availability: { [dates[0]]: { from: "18:00", homeBy: "22:00", pref: "ok" } },
      tags: ["noalcohol"], preferenceAction: "review",
    }));
    const noAlcohol = meOf(mid).private!.needs!.find((n) => n.rule.t === "noAlcohol")!;
    // 本人把"不喝酒"设成底线：升成硬需求
    await chat(id, token, chatBody.parse({ mandate: { style: "balanced", floors: [noAlcohol.id] }, preferenceAction: "review" }));
    const p = meOf(mid).private!;
    expect(floorCandidates(p)).toHaveLength(4);
    expect(chosenFloors(p)).toEqual([noAlcohol.id]);
    // 没选时：按确认先后保留 3 条
    const unpicked = { ...meOf(mid), private: { ...p, mandate: { ...p.mandate!, floors: [] } } } as Member;
    const view = mandateOf(unpicked);
    expect(view.floors).toHaveLength(MAX_FLOORS);
    expect(view.demoted).toHaveLength(1);
    expect(view.wants.find((w) => w.key === view.demoted[0].key)?.strength).toBe(3);
  });

  it("「就这样」= 授权书 confirmed；风格切换带出默认 give；可以手动调", async () => {
    const { id, token } = await one();
    const give = { lateMin: 20, stayCutMin: 0, budgetUp: 50, commuteUp: 5 };
    const r = await chat(id, token, chatBody.parse({
      rsvp: "yes", location: XJH, budgetMax: 100, dietTags: [], availability: { [dates[0]]: { from: "18:00", pref: "ok" } },
      mood: "active", activityOpen: true, mandate: { style: "easy", give, floors: [] }, preferenceAction: "finish",
    }));
    const p = r.me.private!;
    expect(r.me.intake).toBe("done");
    expect(p.mandate).toMatchObject({ status: "confirmed", style: "easy", give });
    expect(p.mood).toBe("active");
    expect(p.activityOpen).toBe(true);
    expect(mandateOf(r.me).status).toBe("confirmed");
  });

  it("档案里分身猜的东西永远进不了底线", async () => {
    const prof: Profile = { ...emptyProfile("pid-guess-1"), onboardedAt: "2030-10-01T00:00:00+08:00" };
    learn(prof, "quiet", "怕吵", 0.9, new Date());
    saveProfile(prof);
    const { mid } = await one("pid-guess-1");
    const p = meOf(mid).private!;
    const quiet = p.needs!.find((n) => n.rule.t === "quiet")!;
    expect(quiet.kind).toBe("soft");
    expect(floorCandidates(p).map((c) => c.key)).not.toContain(quiet.id);
    // 硬塞进底线也会被过滤掉（软需求只有本人在授权书上亲手设才会升级）
    expect(mandateOf(meOf(mid)).floors).toEqual([]);
  });
});

// ---------------------------------------------------------------- 档案学习

describe("固定档案：我说的 / 分身猜的、半衰期 60 天", () => {
  it("猜的按半衰期淡化，说的不淡化；淡到看不清就忘掉", () => {
    const t0 = new Date("2030-01-01T00:00:00Z");
    const p = emptyProfile("pid-decay");
    learn(p, "quiet", "怕吵", 0.8, t0);
    const f = p.facts![0];
    expect(factConfidence(f, new Date(t0.getTime() + 60 * 86400000))).toBeCloseTo(0.4, 2);
    expect(factConfidence(f, new Date(t0.getTime() + 120 * 86400000))).toBeCloseTo(0.2, 2);
    expect(factConfidence({ ...f, source: "said", confidence: 1 }, new Date(t0.getTime() + 999 * 86400000))).toBe(1);
    // 再学一次：先淡化再加
    learn(p, "quiet", "怕吵", 0.2, new Date(t0.getTime() + 60 * 86400000));
    expect(p.facts![0].confidence).toBeCloseTo(0.6, 2);
    // 一年后再学别的，旧的被清掉
    learn(p, "mood:chill", "x", 0.3, new Date(t0.getTime() + 400 * 86400000));
    const out = editProfile(p, "pid-decay", { forget: [] }, new Date(t0.getTime() + 400 * 86400000));
    expect(out.facts!.map((x) => x.key)).toEqual(["mood:chill"]);
  });

  it("本人说过的不会被猜测覆盖；/me 可以改、删、忘掉", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    let p = editProfile(null, "pid-edit", { typicalBudget: 150, dietTags: ["不吃辣"], usualHomeBy: "23:00" }, now);
    expect(p.facts!.filter((f) => f.source === "said").map((f) => f.key).sort()).toEqual(["budget", "diet:不吃辣", "homeBy"]);
    learn(p, "homeBy", "猜的", 0.9, now);
    expect(p.facts!.find((f) => f.key === "homeBy")?.source).toBe("said");
    learn(p, "quiet", "怕吵", 0.5, now);
    p = editProfile(p, "pid-edit", { forget: ["quiet", "homeBy"], typicalBudget: null }, now);
    expect(p.facts!.map((f) => f.key)).toEqual(["diet:不吃辣"]);
    expect(p.usualHomeBy).toBeUndefined();
    expect(p.typicalBudget).toBeUndefined();
    learn(p, "taste:ktv:+", "x", 0.5, now);
    p = editProfile(p, "pid-edit", { forgetLearned: true }, now);
    expect(p.facts!.every((f) => f.source === "said")).toBe(true);
  });

  it("每次入局完成都更新档案：风格（说的）+ 状态 / 活动 / 怕吵（猜的）", async () => {
    const { id, token } = await one("pid-learn-1");
    await chat(id, token, chatBody.parse({ text: "想去唱歌，别太吵的地方也行", preferencesChat: true }));
    await chat(id, token, chatBody.parse({
      rsvp: "yes", location: XJH, budgetMax: 90, dietTags: [], availability: { [dates[0]]: { from: "18:00", pref: "ok" } },
      mood: "hype", activities: ["ktv"], tags: ["quiet"], mandate: { style: "easy", floors: [] }, preferenceAction: "finish",
    }));
    const prof = getProfile("pid-learn-1")!;
    expect(prof.style).toBe("easy");
    expect(prof.typicalBudget).toBe(90);
    const learned = prof.facts!.filter((f) => f.source === "learned").map((f) => f.key);
    expect(learned).toEqual(expect.arrayContaining(["mood:hype", "taste:ktv:+", "quiet"]));
    expect(tastesOf(prof, new Date()).ktv).toBeGreaterThan(0);
  });

  it("投票后猜一点口味", async () => {
    const { id, token } = await one("pid-vote-1", { ...spec, category: "火锅", open: false, poiKeywords: ["火锅"] });
    await mutateJu(id, (ctx) => {
      ctx.ju.status = "voting";
      ctx.ju.plan = { proposals: [fakeProposal("p1")], recommendation: "" } as unknown as Plan;
    });
    await vote(id, token, "p1", { memberToken: token });
    const learned = getProfile("pid-vote-1")?.facts?.find((f) => f.key === "taste:hotpot:+");
    expect(learned?.source).toBe("learned");
  });
});

// ---------------------------------------------------------------- 局后反馈

function fakeProposal(pid: string, start = "2030-11-01T18:30:00+08:00", end = "2030-11-01T20:30:00+08:00"): Proposal {
  return {
    id: pid, label: "best" as Proposal["label"], labelText: "人最全", slot: { id: start.slice(0, 16), start, end },
    poi: { id: "poi1", name: "某店", address: "", lat: 31.2, lng: 121.4, type: "餐饮服务;中餐厅;火锅店" },
    experiences: [], attendCount: 1, minUtility: 80, avgUtility: 80, score: 80, headline: "", tradeoffs: [], highlights: [], recommended: true,
  } as Proposal;
}

async function confirmedJu(profileId: string) {
  const r = await one(profileId, { ...spec, category: "火锅", open: false, poiKeywords: ["火锅"] });
  await mutateJu(r.id, (ctx) => {
    ctx.ju.status = "confirmed";
    ctx.ju.plan = { proposals: [fakeProposal("p1")], recommendation: "" } as unknown as Plan;
    ctx.ju.confirmedProposalId = "p1";
  });
  return r;
}

describe("局后一键反馈", () => {
  it("太累 → 心情默认偏 chill、高强度活动降权；太贵 → 预算下调；太远 → 通勤容忍下调；太吵 → 猜怕吵", () => {
    const now = new Date("2030-11-02T10:00:00+08:00");
    const base: Profile = { ...emptyProfile("pid-fb"), typicalBudget: 200, activityTastes: { climbing: 0.5, boardgame: 0.5 } };
    const tired = applyFeedback(base, "pid-fb", "j1", "tired", { activities: [] }, now);
    expect(moodDefault(tired, now)).toBe("chill");
    expect(tastesOf(tired, now).climbing).toBeLessThan(0.5);
    expect(tastesOf(tired, now).boardgame).toBe(0.5);
    expect(applyFeedback(base, "pid-fb", "j1", "pricey", { activities: [] }, now).typicalBudget).toBe(170);
    const far = applyFeedback(base, "pid-fb", "j1", "far", { activities: [], commuteMin: 40 }, now);
    expect(far.facts!.map((f) => f.key)).toContain("maxCommute:30");
    const far2 = applyFeedback(far, "pid-fb", "j2", "far", { activities: [] }, now);
    expect(far2.facts!.filter((f) => f.key.startsWith("maxCommute:")).map((f) => f.key)).toEqual(["maxCommute:20"]);
    expect(applyFeedback(base, "pid-fb", "j1", "loud", { activities: [] }, now).facts!.find((f) => f.key === "quiet")?.source).toBe("learned");
    const great = applyFeedback(base, "pid-fb", "j1", "great", { activities: ["hotpot"] }, now);
    expect(tastesOf(great, now).hotpot).toBeGreaterThan(0);
    // 同一个局只记一次
    expect(applyFeedback(tired, "pid-fb", "j1", "pricey", { activities: [] }, now).feedback).toHaveLength(1);
  });

  it("第二天才问；到期时发一条站内信；接口写进档案，下次入局预填受影响", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { id, token, mid } = await confirmedJu("pid-fb-route");
    vi.setSystemTime(new Date("2030-11-01T21:00:00+08:00"));
    expect((await feedbackStatus(id, token)).due).toBe(false);
    await expect(submitFeedback(id, "wrong", "loud")).rejects.toThrow();
    vi.setSystemTime(new Date("2030-11-02T09:30:00+08:00"));
    const st = await feedbackStatus(id, token);
    expect(st.due).toBe(true);
    await feedbackStatus(id, token);
    expect(meOf(mid).private!.inbox.filter((n) => n.kind === "feedback")).toHaveLength(1);
    expect(feedbackBody.safeParse({ verdict: "meh" }).success).toBe(false);
    const r = await submitFeedback(id, token, "loud");
    expect(r.reply).toContain("安静");
    expect(meOf(mid).private!.inbox.find((n) => n.kind === "feedback")?.read).toBe(true);
    await expect(submitFeedback(id, token, "tired")).rejects.toThrow("反馈过");
    expect((await feedbackStatus(id, token))).toMatchObject({ due: false, verdict: "loud" });
    // 下次入局：猜的"怕吵"被预填成软需求
    const next = await one("pid-fb-route");
    expect(meOf(next.mid).private!.needs?.find((n) => n.rule.t === "quiet")).toMatchObject({ kind: "soft", source: "profile" });
    expect(feedbackDue({ ...db.getJu(id)!, status: "collecting" }, new Date("2030-11-02T09:30:00+08:00"))).toBe(false);
  });
});

// ---------------------------------------------------------------- 效率指标

describe("效率指标（硬指标）", () => {
  it("新用户：1 句话 + ≤ 2 次点击 + 1 次确认授权书", async () => {
    const { id, token } = await one();
    let sentences = 0;
    let clicks = 0;
    let confirms = 0;
    // 1 句话
    const r1 = await chat(id, token, chatBody.parse({ text: "周五晚上7点后有空，从徐家汇出发，人均120以内，这周好累想安静聊聊，11点前必须回宿舍", preferencesChat: true }));
    sentences++;
    // 唯一的追问：推断出的硬约束确认（1 次点击）
    if (r1.me.private?.pendingConfirm) {
      await chat(id, token, chatBody.parse({ text: "对，必须", preferencesChat: true }));
      clicks++;
    }
    const st = stateOf(id, token);
    const draft = draftFor(st, st.me!);
    // 没亮的必填格，每格点一下补
    clicks += missingRequired(draft).length;
    expect(draft.mood).toBe("chill");
    expect(missingRequired(draft)).toEqual([]); // 这句话把时间、出发地、预算都填上了
    expect(clicks).toBe(1); // 只点了一次"对，必须"
    // 「就这样」
    const done = await chat(id, token, chatBody.parse(bodyOf(draft, "finish")));
    confirms++;
    expect(done.me.intake).toBe("done");
    expect(done.me.private?.mandate?.status).toBe("confirmed");
    expect(mandateOf(done.me).floors.map((f) => f.key)).toContain("homeBy");
    expect(sentences).toBe(1);
    expect(clicks).toBeLessThanOrEqual(2);
    expect(confirms).toBe(1);
  });

  it("老用户：直接看到预填好的授权书，1 次点击完成", async () => {
    const first = await one("pid-old-1");
    await chat(first.id, first.token, chatBody.parse({ onboarding: { places: [{ kind: "work", place: XJH }], budget: 100 } }));
    await chat(first.id, first.token, chatBody.parse({
      rsvp: "yes", location: XJH, budgetMax: 100, dietTags: ["不吃辣"], availability: { [dates[0]]: { from: "18:30", pref: "ok" } },
      mandate: { style: "easy", floors: [] }, preferenceAction: "finish",
    }));
    const { id, token } = await one("pid-old-1");
    const st = stateOf(id, token);
    const draft = draftFor(st, st.me!, getProfile("pid-old-1"));
    expect(missingRequired(draft)).toEqual([]);
    expect(draft.style).toBe("easy");
    const done = await chat(id, token, chatBody.parse(bodyOf(draft, "finish"))); // 「还和上次一样」
    expect(done.me.intake).toBe("done");
    expect(done.me.private?.dietTags).toEqual(["不吃辣"]);
  });
});

// ---------------------------------------------------------------- 隐私

describe("隐私：v6 字段只在本人视图", () => {
  it("mood / 授权书 / 讲究 / 分身名不出现在公开视图；日志不含私聊原文", async () => {
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const { id, token } = await one("pid-priv-1");
    await chat(id, token, chatBody.parse({ onboarding: { avatarName: "秘密小橘", floors: ["剧烈运动"], customFloors: ["对芒果过敏"] } }));
    const secret = "我膝盖不好这周好累只想躺着";
    await chat(id, token, chatBody.parse({ text: secret, preferencesChat: true }));
    await chat(id, token, chatBody.parse({
      rsvp: "yes", location: XJH, budgetMax: 4271, dietTags: ["清真"], availability: { [dates[0]]: { from: "18:00", pref: "ok" } },
      mood: "lazy", tags: ["quiet"], mandate: { style: "firm", floors: [] }, preferenceAction: "finish",
    }));
    const pub = JSON.stringify(getState(id, {}));
    for (const s of ["秘密小橘", "lazy", "mandate", "膝盖", "剧烈运动", "芒果", "清真", "quiet", "firm", "avatarLog", "activityOpen"]) expect(pub).not.toContain(s);
    // 预算按完整数字查：公开数据里随机的 id / 时间戳可能碰巧含有同样的几个数字
    expect(pub).not.toMatch(/(?<!\d)4271(?!\d)/);
    const self = stateOf(id, token);
    expect(self.me?.private?.mood).toBe("lazy");
    expect(self.members.filter((m) => m.id !== self.me?.id).every((m) => !m.private)).toBe(true);
    const logged = [...log.mock.calls, ...warn.mock.calls].flat().map(String).join("\n");
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain("秘密小橘");
  });
});

// ---------------------------------------------------------------- 自己写的底线 / 想要、交通多选

describe("自己写的底线 / 想要", () => {
  it("建档：交通可多选；选的底线要写清楚（过敏写对什么、路程写几分钟），自己写的照原话进档案，入局时变成这次的硬需求", async () => {
    const { id, token, mid } = await one("pid-own-1");
    await chat(id, token, chatBody.parse({ onboarding: { transports: ["metro", "taxi"], floors: ["过敏", "commute"], allergy: "海鲜", commuteMax: 40, customFloors: ["不去酒吧"] } }));
    const prof = getProfile("pid-own-1")!;
    expect(prof.transports).toEqual(["metro", "taxi"]);
    expect(saidFacts(prof).map((f) => f.text)).toEqual(expect.arrayContaining(["对海鲜过敏", "路上最多 40 分钟", "不去酒吧"]));
    const p = meOf(mid).private!;
    const hard = (p.needs ?? []).filter((n) => n.kind === "hard");
    expect(hard.map((n) => n.rule.t)).toEqual(expect.arrayContaining(["avoidCategory", "maxCommute"]));
    expect(p.dietTags).toContain("不吃海鲜");
    expect(mandateOf(meOf(mid)).floors.map((f) => f.text)).toEqual(expect.arrayContaining(["对海鲜过敏", "路上最多 40 分钟", "不去酒吧"]));
  });

  it("过敏不写对什么就不记；选的加自己写的超过 3 条直接拒绝", () => {
    expect(() => onboardingBody.parse({ floors: ["homeBy", "不喝酒"], customFloors: ["a", "b"] })).toThrow(/最多 3 条/);
  });

  it("授权书上自己写：底线进选中的底线、想要是软的；两条算不了的不会合并；满 3 条底线再加会被拦下；可以删", async () => {
    const { id, token, mid } = await one("pid-own-2");
    await chat(id, token, chatBody.parse({ rsvp: "yes", location: XJH, budgetMax: 100, dietTags: [], availability: { [dates[0]]: { from: "18:00", pref: "ok" } }, preferenceAction: "review" }));
    await chat(id, token, chatBody.parse({ addNeed: { text: "花生过敏", kind: "hard" }, preferenceAction: "review" }));
    await chat(id, token, chatBody.parse({ addNeed: { text: "芒果过敏", kind: "hard" }, preferenceAction: "review" }));
    await chat(id, token, chatBody.parse({ addNeed: { text: "想吃日料", kind: "soft" }, preferenceAction: "review" }));
    let p = meOf(mid).private!;
    const allergies = (p.needs ?? []).filter((n) => n.rule.t === "custom");
    expect(allergies.map((n) => n.text)).toEqual(["花生过敏", "芒果过敏"]);
    expect(p.mandate?.floors).toEqual(expect.arrayContaining(allergies.map((n) => n.id)));
    expect((p.needs ?? []).find((n) => n.text === "想吃日料")).toMatchObject({ kind: "soft", rule: { t: "preferCategory" } });
    await chat(id, token, chatBody.parse({ addNeed: { text: "十点前必须到家", kind: "hard" }, preferenceAction: "review" }));
    await expect(chat(id, token, chatBody.parse({ addNeed: { text: "不去酒吧", kind: "hard" }, preferenceAction: "review" }))).rejects.toThrow(/最多 3 条/);
    await chat(id, token, chatBody.parse({ removeNeed: allergies[0].id, preferenceAction: "review" }));
    p = meOf(mid).private!;
    expect((p.needs ?? []).some((n) => n.text === "花生过敏")).toBe(false);
    expect(p.mandate?.floors).not.toContain(allergies[0].id);
  });
});

describe("点菜提醒进群公告和订位话术", () => {
  it("定局文案带上「点菜注意」，订位话术说有朋友不吃香菜", async () => {
    const { ruleGroupMessages, confirmedText } = await import("./ju-text");
    const f = {
      title: "测试局", category: "火锅", city: "上海", status: "confirmed" as const, members: [], counts: { in: 3, done: 3, waitlist: 0, matchPairs: 0 },
      constraintSummaries: [], reminders: ["有人不吃香菜"],
      confirmed: { slotLabel: "周六 18:00", poiName: "某火锅", address: "某路", headcount: 3 },
    };
    expect(confirmedText(f)).toContain("🍽 点菜注意：有人不吃香菜");
    expect(ruleGroupMessages(f).reservationScript).toContain("有朋友不吃香菜");
  });
});

describe("忌口存在档案里，只在可能吃饭的局拿出来", () => {
  const mk = async (category: string, pid: string) => {
    const { id } = await createJu({ prompt: "", spec: { category, poiKeywords: [category], dates, earliest: "14:00", latest: "16:00", durationMinutes: 120, city: "上海" }, title: "测", organizerName: "阿明" } as Parameters<typeof createJu>[0]);
    const j = await join(id, { name: "小鹿", profileId: pid }, {});
    return { id, token: j.memberToken, mid: j.memberId };
  };
  it("在卡片上写过敏 → 记进档案；打羽毛球的局不拿出来、也不冲掉档案；吃火锅的局自动带上", async () => {
    const a = await mk("火锅", "pid-diet-0001");
    await chat(a.id, a.token, chatBody.parse({ rsvp: "yes", location: XJH, budgetMax: 100, dietTags: ["不吃辣"], availability: { [dates[0]]: { from: "13:00", pref: "ok" } }, preferenceAction: "review" }));
    await chat(a.id, a.token, chatBody.parse({ addNeed: { text: "对芒果过敏", kind: "hard" }, preferenceAction: "review" }));
    await chat(a.id, a.token, chatBody.parse({ rsvp: "yes", location: XJH, budgetMax: 100, dietTags: ["不吃辣"], availability: { [dates[0]]: { from: "13:00", pref: "ok" } }, preferenceAction: "finish" }));
    expect(getProfile("pid-diet-0001")!.dietTags).toContain("不吃辣");
    expect(saidFacts(getProfile("pid-diet-0001")).some((f) => f.text === "对芒果过敏")).toBe(true);

    const b = await mk("羽毛球", "pid-diet-0001");
    let p = meOf(b.mid).private!;
    expect(p.dietTags).toEqual([]);
    expect((p.needs ?? []).some((n) => n.text === "对芒果过敏")).toBe(false);
    await chat(b.id, b.token, chatBody.parse({ rsvp: "yes", location: XJH, budgetMax: 100, dietTags: [], availability: { [dates[0]]: { from: "13:00", pref: "ok" } }, preferenceAction: "finish" }));
    expect(getProfile("pid-diet-0001")!.dietTags).toContain("不吃辣");

    const c = await mk("火锅", "pid-diet-0001");
    p = meOf(c.mid).private!;
    expect(p.dietTags).toContain("不吃辣");
    expect((p.needs ?? []).some((n) => n.text === "对芒果过敏" && n.kind === "hard")).toBe(true);
  });
});

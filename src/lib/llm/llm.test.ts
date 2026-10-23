// v3 LLM 模块单测：全部在“没有 key”下跑，fetch 被打桩成直接报错，保证不真调网络。
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ju, Member, MemberPrivate, Plan, Profile, PublicFacts } from "../types";
import {
  chatTurn,
  groupMessages,
  parseChatScreenshot,
  parsePrompt,
  parseReceipt,
  parseSchedule,
  polishPlan,
  ruleChatTurn,
  ruleGroupMessages,
  ruleReceiptTags,
  writeRecap,
} from "./index";
import { classifyAsk, ruleParseBudget, ruleParseTimes } from "./chat";
import { numbersGrounded } from "./public";
import { parseImage } from "./provider";

// 2026-10-22 周四 10:00（北京时间）
const NOW = new Date("2026-10-22T02:00:00Z");
const KEYS = ["ANTHROPIC_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL", "LLM_VISION", "LLM_VISION_MODEL"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.stubGlobal("fetch", () => Promise.reject(new Error("测试里不许联网")));
});
afterAll(() => {
  for (const k of KEYS) if (saved[k] !== undefined) process.env[k] = saved[k];
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- 夹具

function mkJu(over: Partial<Ju> = {}): Ju {
  return {
    id: "j1",
    title: "周六火锅局",
    rawPrompt: "周六晚上火锅",
    spec: {
      category: "火锅",
      poiKeywords: ["火锅"],
      dates: ["2026-10-23", "2026-10-24"],
      earliest: "18:00",
      latest: "20:00",
      durationMinutes: 120,
      city: "上海",
    },
    slots: [],
    status: "collecting",
    createdAt: NOW.toISOString(),
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    ...over,
  };
}

function emptyPrivate(): MemberPrivate {
  return {
    chat: [],
    availability: {},
    dietTags: [],
    notes: [],
    swipes: {},
    autoFilled: [],
    wants: [],
    matches: [],
    billFacts: {},
    inbox: [],
  };
}

function mkMe(over: Partial<Member> = {}): Member {
  return {
    id: "m1",
    juId: "j1",
    name: "小周",
    avatar: "🐱",
    role: "guest",
    intake: "chatting",
    status: "in",
    joinedAt: NOW.toISOString(),
    isOrganizer: false,
    private: emptyPrivate(),
    ...over,
  };
}

/** 模拟 B2：把 patch 应用到 me 上，并把对话记进 chat */
function apply(me: Member, userText: string | null, r: Awaited<ReturnType<typeof chatTurn>>): void {
  const p = me.private!;
  if (userText !== null) p.chat.push({ role: "me", text: userText, at: "" });
  p.chat.push({ role: "juzhang", text: r.reply, at: "", ...(r.ask ? { ask: r.ask } : {}) });
  const x = r.patch;
  if (x.rsvp) p.rsvp = x.rsvp;
  if (x.location) me.location = x.location;
  if (x.availability) p.availability = { ...p.availability, ...x.availability };
  if (x.dietTags) p.dietTags = x.dietTags;
  if (x.budgetMax) p.budgetMax = x.budgetMax;
  if (x.note) p.notes.push(x.note);
  if (x.billFacts) p.billFacts = { ...p.billFacts, ...x.billFacts };
  if (x.wantsAutofill) {
    // B2 会调 autofillFromProfile；这里模拟一个温和默认值
    p.availability = { "2026-10-24": { from: "18:00", pref: "ok" } };
    p.budgetMax = 120;
    p.autoFilled = ["availability", "budget", "diet"];
  }
}

async function talk(ju: Ju, me: Member, texts: (string | null)[], opts: { quorumPending?: boolean; profile?: Profile } = {}) {
  const replies = [];
  for (const t of texts) {
    const r = await chatTurn({ ju, me, profile: opts.profile, userText: t, quorumPending: !!opts.quorumPending, now: NOW });
    apply(me, t, r);
    replies.push(r);
  }
  return replies;
}

const FACTS: PublicFacts = {
  title: "周六火锅局",
  category: "火锅",
  city: "上海",
  status: "collecting",
  organizerName: "小林",
  members: [
    { id: "a", name: "小林", avatar: "🐱", role: "guest", intake: "done", isOrganizer: true },
    { id: "b", name: "阿杰", avatar: "🐶", role: "must", intake: "done", isOrganizer: false },
    { id: "c", name: "小周", avatar: "🐼", role: "guest", intake: "chatting", isOrganizer: false },
    { id: "d", name: "老王", avatar: "🐯", role: "guest", intake: "swiping", isOrganizer: false },
  ],
  counts: { in: 4, done: 2, waitlist: 1, matchPairs: 1 },
  constraintSummaries: ["有人不吃辣，已优先选能点鸳鸯锅的店", "有人预算偏紧，已按大家都舒服的价位筛选"],
};

const PROPOSALS: NonNullable<PublicFacts["proposals"]> = [
  {
    id: "p1",
    labelText: "人最全",
    slotLabel: "周六 18:30",
    poiName: "蜀大侠火锅（徐汇店）",
    costPerPerson: 98,
    attendCount: 4,
    headline: "4 人全到，有 1 人晚 15 分钟",
    tradeoffs: ["饭点可能要排队 20 分钟"],
    highlights: ["人均 98，大家都在预算内", "3 人刷卡点了想去"],
    recommended: true,
  },
  {
    id: "p2",
    labelText: "最省钱",
    slotLabel: "周六 19:00",
    poiName: "小龙坎（漕河泾店）",
    costPerPerson: 76,
    attendCount: 3,
    headline: "3 人到，人均最低",
    tradeoffs: ["有 1 人来不了"],
    highlights: ["人均 76"],
    recommended: false,
  },
];

/** 不在 facts 里的人名：私下拒绝的、候补的、随便编的 */
const OUTSIDERS = ["阿May", "大刘", "张三", "李四", "小美"];

function textOf(x: unknown): string {
  return JSON.stringify(x);
}

// ---------------------------------------------------------------- 无 key：每个导出都返回合法结构

describe("无 key 降级", () => {
  it("parsePrompt 走规则", async () => {
    const r = await parsePrompt("周五晚上8个人吃火锅人均100", NOW, "上海");
    expect(r.spec).toMatchObject({ category: "火锅", headcount: 8, budgetPerPerson: 100, dates: ["2026-10-23"] });
  });

  it("parseChatScreenshot 返回示例", async () => {
    const r = await parseChatScreenshot("data:image/png;base64,AAAA", NOW, "北京");
    expect(r.fallback).toBe(true);
    expect(r.spec.city).toBe("上海");
    expect(r.seeds.length).toBeGreaterThanOrEqual(4);
  });

  it("parseSchedule / parseReceipt 返回示例", async () => {
    expect((await parseSchedule("data:image/png;base64,AAAA")).fallback).toBe(true);
    expect((await parseReceipt("data:image/png;base64,AAAA")).fallback).toBe(true);
  });

  it("chatTurn 开场白", async () => {
    const r = await chatTurn({ ju: mkJu(), me: mkMe(), userText: null, quorumPending: false, now: NOW });
    expect(r.reply).toContain("局长");
    expect(r.widget).toBe("location");
    expect(r.done).toBe(false);
    expect(r.patch).toEqual({});
  });

  it("polishPlan / groupMessages / writeRecap", async () => {
    const plan = mkPlan();
    const polished = await polishPlan({ ...FACTS, status: "voting", proposals: PROPOSALS }, plan);
    expect(polished.proposals).toHaveLength(2);
    for (const p of polished.proposals) expect(p.blurb).toBeTruthy();
    const gm = await groupMessages(FACTS);
    expect(gm.broadcast).toContain("周六火锅局");
    expect(Array.isArray(gm.nudges)).toBe(true);
    const recap = await writeRecap(confirmedFacts(), 12);
    expect(recap).toContain("12");
  });
});

// ---------------------------------------------------------------- demo 示例

describe("demo 示例", () => {
  it("群聊截图：上海徐汇周六火锅，有人加班、有人不去", async () => {
    const r = await parseChatScreenshot("demo", NOW, "上海");
    expect(r.fallback).toBe(true);
    expect(r.spec.category).toBe("火锅");
    expect(r.spec.dates).toEqual(["2026-10-24"]); // 周四说“周六”= 后天
    expect(r.spec.notes).toContain("徐汇");
    expect(r.seeds.find((s) => s.name === "阿杰")).toMatchObject({ said: "yes", hint: "周六加班到 6 点" });
    expect(r.seeds.some((s) => s.said === "no")).toBe(true);
    for (const s of r.seeds) expect(["yes", "no", "maybe"]).toContain(s.said);
  });

  it("课表：每段 from < to，周几 1-7", async () => {
    const r = await parseSchedule("demo");
    expect(r.fallback).toBe(true);
    expect(r.busy.length).toBeGreaterThan(5);
    for (const b of r.busy) {
      expect(b.weekday).toBeGreaterThanOrEqual(1);
      expect(b.weekday).toBeLessThanOrEqual(7);
      expect(b.from < b.to).toBe(true);
    }
  });

  it("小票：明细 + 服务费 - 折扣 = 实付 600，标签齐全", async () => {
    const r = await parseReceipt("demo");
    expect(r.fallback).toBe(true);
    expect(r.total).toBe(600);
    const sum = r.items.reduce((s, it) => s + it.price * it.qty, 0) + (r.serviceFee ?? 0) - (r.discount ?? 0);
    expect(sum).toBeCloseTo(600, 2);
    const tagsOf = (name: string) => r.items.find((it) => it.name.includes(name))!.tags;
    expect(tagsOf("啤酒")).toEqual(expect.arrayContaining(["alcohol", "drink"]));
    expect(tagsOf("麻辣")).toEqual(expect.arrayContaining(["spicy", "shared"]));
    expect(tagsOf("鸳鸯")).toEqual(["shared"]);
    expect(tagsOf("肥牛")).toEqual(expect.arrayContaining(["beef", "meat"]));
    expect(tagsOf("毛肚")).toEqual(expect.arrayContaining(["offal", "beef"]));
    expect(tagsOf("虾滑")).toContain("seafood");
    expect(tagsOf("酸梅汤")).toEqual(["drink"]);
    expect(tagsOf("米饭")).toEqual(["shared"]);
    expect(new Set(r.items.map((i) => i.id)).size).toBe(r.items.length);
  });
});

describe("ruleReceiptTags", () => {
  it.each([
    ["雪花啤酒", ["alcohol", "drink"]],
    ["酒酿圆子", []],
    ["香辣蟹", ["spicy", "seafood"]],
    ["牛蛙", ["meat"]],
    ["鸭肠", ["meat", "offal"]],
    ["可乐", ["drink"]],
    ["清汤锅底", ["shared"]],
    ["海带结", []],
  ])("%s", (name, tags) => expect(ruleReceiptTags(name)).toEqual(tags));
});

// ---------------------------------------------------------------- 私聊状态机

describe("chatTurn 规则版", () => {
  it("完整走一遍：开场 → 地点 → 时间 → 忌口 → 预算 → 备注 → 刷卡", async () => {
    const ju = mkJu();
    const me = mkMe();
    const [open, loc, time, diet, budget, notes] = await talk(ju, me, [
      null,
      "从漕河泾过来",
      "6 点半下班，11 点前回宿舍",
      "不吃辣",
      "八十吧",
      "我不喝酒",
    ]);
    expect(open.widget).toBe("location");
    expect(loc.patch.location?.label).toBe("漕河泾");
    expect(loc.widget).toBe("time");
    expect(time.patch.availability).toEqual({
      "2026-10-23": { from: "18:30", homeBy: "23:00", pref: "ok" },
      "2026-10-24": { from: "18:30", homeBy: "23:00", pref: "ok" },
    });
    expect(time.widget).toBe("diet");
    expect(diet.patch.dietTags).toEqual(["不吃辣"]);
    expect(diet.reply).toContain("鸳鸯锅");
    expect(diet.widget).toBe("budget");
    expect(diet.reply).toMatch(/悄悄告诉我/);
    expect(diet.reply).toMatch(/只有我知道/);
    expect(budget.patch.budgetMax).toBe(80);
    expect(budget.widget).toBeNull();
    expect(budget.quickReplies.length).toBeGreaterThan(0);
    expect(notes.patch.billFacts).toEqual({ noAlcohol: true });
    expect(notes.widget).toBe("swipe");
    expect(notes.done).toBe(true);
  });

  it("一句话说全：“6 点半下班，从漕河泾过来，11 点前回宿舍”", async () => {
    const r = await talk(mkJu(), mkMe(), [null, "6 点半下班，从漕河泾过来，11 点前回宿舍"]);
    const p = r[1].patch;
    expect(p.location?.label).toBe("漕河泾");
    expect(p.availability?.["2026-10-24"]).toEqual({ from: "18:30", homeBy: "23:00", pref: "ok" });
    // 地点、时间都有了，直接问忌口
    expect(r[1].widget).toBe("diet");
  });

  it("没忌口、预算不想说也算答过，不重复问", async () => {
    const r = await talk(mkJu(), mkMe(), [null, "徐家汇", "周六 7 点后可以，周五不行", "没有忌口", "不太在意", "没有了"]);
    expect(r[2].patch.availability).toEqual({ "2026-10-24": { from: "19:00", pref: "ok" } });
    expect(r[3].widget).toBe("budget");
    expect(r[4].widget).toBeNull(); // 备注
    expect(r[4].patch.budgetMax).toBeUndefined();
    expect(r[5].widget).toBe("swipe");
    expect(r[5].done).toBe(true);
    expect(r[5].patch.note).toBeUndefined();
  });

  it("说“都行”→ wantsAutofill，跳过时间 / 忌口 / 预算", async () => {
    const r = await talk(mkJu(), mkMe(), [null, "漕河泾", "都行，你定", "没有了"]);
    expect(r[2].patch).toEqual({ wantsAutofill: true });
    expect(r[2].reply).toMatch(/帮你填上/);
    expect(classifyAsk(r[2].reply)).toBe("notes");
    expect(r[3].widget).toBe("swipe");
    expect(r[3].done).toBe(true);
  });

  it("#1 门限：先问来不来；说不来 → rsvp no，体面回应", async () => {
    const me = mkMe();
    const r = await talk(mkJu(), me, [null, "这次来不了，你们玩"], { quorumPending: true });
    expect(r[0].widget).toBe("rsvp");
    expect(r[1].patch).toEqual({ rsvp: "no" });
    expect(r[1].reply).toContain("只有我知道");
    expect(r[1].done).toBe(true);
    expect(r[1].widget).toBeNull();
  });

  it("#1 门限：说能来 → 继续问地点", async () => {
    const r = await talk(mkJu(), mkMe(), [null, "能来！"], { quorumPending: true });
    expect(r[1].patch.rsvp).toBe("yes");
    expect(r[1].widget).toBe("location");
  });

  it("中途任何时候说不来都算", async () => {
    const r = await talk(mkJu(), mkMe(), [null, "漕河泾", "算了，这次不去了"]);
    expect(r[2].patch.rsvp).toBe("no");
    expect(r[2].done).toBe(true);
  });

  it("上传课表分支：说要发课表 → schedule 组件；B2 解析课表后继续", async () => {
    const ju = mkJu();
    const me = mkMe();
    const r = await talk(ju, me, [null, "漕河泾", "我发课表给你"]);
    expect(r[2].widget).toBe("schedule");
    // B2：parseSchedule + availabilityFromBusy 写进 availability，然后用 null 继续
    me.private!.availability = { "2026-10-24": { from: "12:00", pref: "ok" } };
    const next = await chatTurn({ ju, me, userText: null, quorumPending: false, now: NOW });
    expect(next.widget).toBe("diet");
    expect(next.reply).not.toContain("我是局长"); // 不是开场白
  });

  it("老朋友被认出来，确认“还是那儿”就用档案里的地点", async () => {
    const profile: Profile = {
      id: "pf1",
      name: "阿杰",
      lastLocation: { lat: 31.1689, lng: 121.3972, label: "漕河泾" },
      dietTags: [],
      ledger: [],
      tastes: {},
    };
    const r = await talk(mkJu(), mkMe({ name: "阿杰" }), [null, "对，还是那儿"], { profile });
    expect(r[0].reply).toContain("阿杰又见面了");
    expect(r[0].reply).toContain("还是从漕河泾出发");
    expect(r[1].patch.location?.label).toBe("漕河泾");
    expect(r[1].widget).toBe("time");
  });

  it("地点没认出来时重问并给搜索组件", async () => {
    const r = await talk(mkJu(), mkMe(), [null, "火星"]);
    expect(r[1].widget).toBe("location");
    expect(r[1].reply).toContain("没找到");
  });

  it("入局完成后再聊：只记录更新", async () => {
    const me = mkMe({ intake: "done" });
    const r = ruleChatTurn({ ju: mkJu(), me, userText: "周六我得 10 点前回去", quorumPending: false, now: NOW });
    expect(r.patch.availability?.["2026-10-24"]?.homeBy).toBe("22:00");
    expect(r.done).toBe(true);
  });

  it("B2 先把用户消息追加进 chat 再调用也一样", async () => {
    const ju = mkJu();
    const me = mkMe();
    await talk(ju, me, [null, "漕河泾", "6 点后都可以"]);
    me.private!.chat.push({ role: "me", text: "没有忌口", at: "" });
    const r = await chatTurn({ ju, me, userText: "没有忌口", quorumPending: false, now: NOW });
    expect(r.widget).toBe("budget");
  });
});

describe("规则抽取细节", () => {
  const ctx = { ju: mkJu(), me: mkMe(), now: NOW };
  it.each([
    ["周六加班到 6 点", { "2026-10-24": { from: "18:00", pref: "ok" } }],
    ["周五最好，8 点后能出发", { "2026-10-23": { from: "20:00", pref: "best" } }],
    ["门禁 11 点", { "2026-10-23": { from: "17:00", homeBy: "23:00", pref: "ok" }, "2026-10-24": { from: "17:00", homeBy: "23:00", pref: "ok" } }],
  ])("%s", (text, expected) => expect(ruleParseTimes(text, ctx)).toEqual(expected));

  it("预算", () => {
    expect(ruleParseBudget("一百以内", true)).toBe(100);
    expect(ruleParseBudget("100-150 吧", true)).toBe(150);
    expect(ruleParseBudget("人均别超过一百五", false)).toBe(150);
    expect(ruleParseBudget("6 点半下班，11 点前回", false)).toBeUndefined();
    expect(ruleParseBudget("不太在意", true)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- 公开 LLM：不能出现 facts 以外的人名

function mkPlan(): Plan {
  const prop = (p: (typeof PROPOSALS)[number], i: number): Plan["proposals"][number] => ({
    id: p.id,
    label: i === 0 ? "most-people" : "cheapest",
    labelText: p.labelText,
    slot: { id: "s", start: "2026-10-24T18:30:00+08:00", end: "2026-10-24T20:30:00+08:00" },
    poi: { id: `poi${i}`, name: p.poiName, address: "徐汇区某路 1 号", lat: 31.17, lng: 121.43, type: "火锅", costPerPerson: p.costPerPerson },
    experiences: [],
    attendCount: p.attendCount,
    minUtility: 70,
    avgUtility: 80,
    score: 80 - i,
    headline: p.headline,
    tradeoffs: p.tradeoffs,
    highlights: p.highlights,
    recommended: p.recommended,
  });
  return {
    proposals: PROPOSALS.map(prop),
    recommendation: "推荐 A：人最全，大家都在预算内",
    constraintSummaries: FACTS.constraintSummaries,
    center: { lat: 31.17, lng: 121.43 },
    audit: { inputHash: "x", outputHash: "y", candidates: 96, evaluations: 576, paretoSize: 5, algorithmVersion: "v3" },
    computedAt: NOW.toISOString(),
  };
}

function confirmedFacts(): PublicFacts {
  return {
    ...FACTS,
    status: "confirmed",
    proposals: PROPOSALS,
    confirmed: { slotLabel: "周六 18:30", poiName: "蜀大侠火锅（徐汇店）", address: "徐汇区某路 1 号", tel: "021-12345678", headcount: 4 },
  };
}

describe("公开文案规则版", () => {
  const phases: [string, PublicFacts][] = [
    ["collecting", FACTS],
    ["collecting+quorum", { ...FACTS, counts: { ...FACTS.counts, quorumHave: 2, quorumNeed: 4 } }],
    ["voting", { ...FACTS, status: "voting", proposals: PROPOSALS, recommendation: "人最全", caredFor: "这次优先照顾了前几次跑得最远的 1 位朋友" }],
    ["confirmed", confirmedFacts()],
    ["settling", { ...confirmedFacts(), settlement: { total: 600, payCount: 4, paidCount: 2, explain: ["酒水只由喝酒的人分摊"] } }],
    ["cancelled", { ...FACTS, status: "cancelled" }],
  ];

  it.each(phases)("%s：不含 facts 以外的人名", async (_, facts) => {
    const gm = ruleGroupMessages(facts);
    const all = textOf(gm) + (await writeRecap(facts, 3)) + textOf(await polishPlan(facts, mkPlan()));
    for (const name of OUTSIDERS) expect(all).not.toContain(name);
    // 催促只点 facts 里的人
    const ids = new Set(facts.members.map((m) => m.id));
    for (const n of gm.nudges) expect(ids.has(n.memberId)).toBe(true);
  });

  it("收集期催没完成的人（发起人除外）", () => {
    const gm = ruleGroupMessages(FACTS);
    expect(gm.nudges.map((n) => n.name).sort()).toEqual(["小周", "老王"].sort());
  });

  it("定局：群公告 + 订位话术 + 6–10 句模拟对白（含人数、时间、鸳鸯锅）", () => {
    const gm = ruleGroupMessages(confirmedFacts());
    expect(gm.broadcast).toContain("蜀大侠火锅（徐汇店）");
    expect(gm.reservationScript).toContain("4 位");
    const d = gm.reservationDialog!;
    expect(d.length).toBeGreaterThanOrEqual(6);
    expect(d.length).toBeLessThanOrEqual(10);
    const dialogText = d.map((l) => l.text).join("");
    expect(dialogText).toContain("4 位");
    expect(dialogText).toContain("周六 18:30");
    expect(dialogText).toContain("鸳鸯锅");
    expect(gm.nudges).toEqual([]);
  });

  it("结算期只说总额和已转人数，不点名", () => {
    const facts = { ...confirmedFacts(), settlement: { total: 600, payCount: 4, paidCount: 2, explain: [] } };
    const gm = ruleGroupMessages(facts);
    expect(gm.broadcast).toContain("600");
    expect(gm.broadcast).toContain("2/4");
    for (const m of facts.members) expect(gm.broadcast).not.toContain(m.name);
    expect(gm.nudges).toEqual([]);
  });

  it("polishPlan 只改文字：方案集合、顺序、数字原样保留", async () => {
    const plan = mkPlan();
    const out = await polishPlan({ ...FACTS, status: "voting", proposals: PROPOSALS }, plan);
    expect(out.proposals.map((p) => p.id)).toEqual(plan.proposals.map((p) => p.id));
    const strip = (p: Plan) => p.proposals.map((p0) => { const rest = { ...p0 }; delete rest.blurb; return rest; });
    expect(strip(out)).toEqual(strip(plan));
    expect(out.audit).toEqual(plan.audit);
  });

  it("交换两个公开信息相同的成员顺序以外，输出确定", () => {
    expect(textOf(ruleGroupMessages(FACTS))).toBe(textOf(ruleGroupMessages(structuredClone(FACTS))));
  });
});

describe("小工具", () => {
  it("numbersGrounded：只允许事实里出现过的数字", () => {
    expect(numbersGrounded("人均 98，4 人全到", "人均 98 元，4 人")).toBe(true);
    expect(numbersGrounded("人均 88", "人均 98 元")).toBe(false);
  });
  it("parseImage", () => {
    expect(parseImage("data:image/jpg;base64,QUJD")).toEqual({ kind: "base64", mediaType: "image/jpeg", data: "QUJD" });
    expect(() => parseImage("hello")).toThrow();
  });
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("私聊：大模型主导 + 接住暗示", () => {
  /** 让 provider 走 OpenAI 兼容接口，fetch 返回给定的 LLM JSON */
  function withLlm(out: Record<string, unknown>) {
    process.env.LLM_API_KEY = "test";
    const body = {
      reply: "", askStep: null, rsvp: null, placeName: null, availability: null, dietTags: null,
      budgetMax: null, note: null, noAlcohol: null, skipItems: null, wantsAutofill: null, ...out,
    };
    vi.stubGlobal("fetch", () =>
      Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }))),
    );
  }
  afterEach(() => {
    delete process.env.LLM_API_KEY;
    vi.stubGlobal("fetch", () => Promise.reject(new Error("测试里不许联网")));
  });

  it("规则版：说手头紧，下一问提前到预算，并私下记一笔", async () => {
    const me = mkMe();
    const [, r] = await talk(mkJu(), me, [null, "漕河泾，就是最近有点穷哈哈"]);
    expect(r.ask).toBe("budget");
    expect(r.widget).toBe("budget");
    expect(me.private!.notes.join("")).toContain("穷");
  });

  it("规则版：话里顺带了备注，也一定会问「还有什么想让我知道的」", async () => {
    const me = mkMe();
    const rs = await talk(mkJu(), me, [null, "漕河泾，在减肥", "6 点半下班，11 点前回宿舍", "不吃辣", "80"]);
    expect(rs[rs.length - 1].ask).toBe("notes");
  });

  it("规则版：收尾一轮不复述清单", async () => {
    const me = mkMe();
    const rs = await talk(mkJu(), me, [null, "漕河泾", "6 点半下班，11 点前回宿舍", "不吃辣", "80", "我不喝酒"]);
    const last = rs[rs.length - 1];
    expect(last.ask).toBe("swipe");
    expect(last.reply.length).toBeLessThan(60);
  });

  it("大模型问的是还缺的一项：采用它的回复，组件跟着它走", async () => {
    const me = mkMe();
    await talk(mkJu(), me, [null]);
    withLlm({ reply: "漕河泾收到～最近紧的话，人均多少你比较舒服？只有我知道。", askStep: "budget", placeName: "漕河泾", note: "最近手头紧" });
    const r = await chatTurn({ ju: mkJu(), me, userText: "漕河泾，就是最近有点穷", quorumPending: false, now: NOW });
    expect(r.reply).toContain("最近紧的话");
    expect(r.ask).toBe("budget");
    expect(r.widget).toBe("budget");
    expect(r.patch.location?.label).toBe("漕河泾");
  });

  it("大模型先回答对方的问题，再问下一项", async () => {
    const me = mkMe({ location: { lat: 31.17, lng: 121.4, label: "漕河泾" } });
    await talk(mkJu(), me, [null]);
    withLlm({ reply: "人齐了我会出两三个方案大家投～你几点能出发？", askStep: "time" });
    const r = await chatTurn({ ju: mkJu(), me, userText: "去哪家定了吗？", quorumPending: false, now: NOW });
    expect(r.reply).toContain("出两三个方案");
    expect(r.ask).toBe("time");
  });

  it("大模型问了已经答过的项：退回规则文案", async () => {
    const me = mkMe();
    await talk(mkJu(), me, [null]);
    withLlm({ reply: "你从哪儿出发呀？", askStep: "location", placeName: "漕河泾" });
    const r = await chatTurn({ ju: mkJu(), me, userText: "我在漕河泾", quorumPending: false, now: NOW });
    expect(r.reply).not.toBe("你从哪儿出发呀？");
    expect(r.ask).toBe("time");
  });
});

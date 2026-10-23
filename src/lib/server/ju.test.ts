// 后端核心的流程单测：token 鉴权、门限成局、候补转正、互选、攒批重算、复算、投票定局。
// 内存库 + mock 地图 + 规则版 LLM（删掉所有 key）。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import type { JuSpec, Member } from "../types";
import { publicFacts, publicState } from "./firewall";
import { HttpError } from "./http";
import { chat, join, setWants } from "./intake";
import {
  advanceJu,
  confirm,
  createJu,
  getState,
  getStateFull,
  makePlan,
  memberByToken,
  openTier,
  patchJu,
  patchMember,
  verifyPlan,
  vote,
} from "./ju";
import { seedJu } from "./seed";

const SPEC: JuSpec = {
  category: "火锅",
  poiKeywords: ["火锅"],
  dates: ["2030-11-01"],
  earliest: "18:00",
  latest: "19:30",
  durationMinutes: 120,
  city: "上海",
};
const PLACES = [
  { lat: 31.1952, lng: 121.4372, label: "徐家汇" },
  { lat: 31.1675, lng: 121.397, label: "漕河泾" },
  { lat: 31.2005, lng: 121.4335, label: "交大" },
  { lat: 31.2235, lng: 121.446, label: "静安寺" },
];

beforeEach(() => db._resetDbForTest());

async function mk(extra: Parameters<typeof createJu>[0] extends infer T ? Partial<T> : never = {}) {
  return createJu({ prompt: "", spec: SPEC, title: "测试局", organizerName: "老王", ...extra } as Parameters<typeof createJu>[0]);
}

async function enter(id: string, name: string, opts: { admin?: string; tierToken?: string; organizer?: boolean } = {}) {
  const r = await join(
    id,
    { name, ...(opts.organizer ? { isOrganizer: true } : {}), ...(opts.tierToken ? { tierToken: opts.tierToken } : {}) },
    opts.admin ? { adminToken: opts.admin } : {},
  );
  return r;
}

const raw = (id: string, mid: string): Member => db.listMembers(id).find((m) => m.id === mid)!;

describe("token 鉴权", () => {
  it("本人 token 才能看到自己的 private；别人的 token 拿不到；secret 永远不出去", async () => {
    const { id } = await mk();
    const a = await enter(id, "小林");
    const b = await enter(id, "阿杰");
    await chat(id, a.memberToken, { budgetMax: 80 });
    await chat(id, b.memberToken, { text: "这周在减肥别太油" });

    const asA = getState(id, { memberToken: a.memberToken });
    expect(asA.me?.id).toBe(a.memberId);
    expect(asA.me?.private?.budgetMax).toBe(80);
    expect(asA.me?.secret).toBeUndefined();
    const asB = getState(id, { memberToken: b.memberToken });
    expect(asB.me?.id).toBe(b.memberId);
    expect(JSON.stringify(asB)).not.toContain('"budgetMax":80');
    expect(JSON.stringify(asA.members)).not.toContain("减肥");
    expect(getState(id, { memberToken: a.memberToken + "x" }).me).toBeUndefined();
    expect(getState(id).members.every((m) => !m.private && !m.secret && !m.profileId)).toBe(true);

    expect(() => memberByToken(id, "")).toThrow(HttpError);
    try {
      memberByToken(id, "nope");
    } catch (e) {
      expect((e as HttpError).status).toBe(403);
    }
    // 不能替别人退出
    await expect(patchMember(id, b.memberId, { status: "out" }, { memberToken: a.memberToken })).rejects.toMatchObject({ status: 403 });
  });

  it("admin token 才有 ju.admin", async () => {
    const { id, adminToken } = await mk({ tiers: 2 });
    expect(getState(id).ju.admin).toBeUndefined();
    expect(getState(id, { adminToken: "wrong" }).isAdmin).toBeUndefined();
    const s = getState(id, { adminToken });
    expect(s.isAdmin).toBe(true);
    expect(s.ju.admin?.tiers).toHaveLength(2);
  });
});

describe("#1 门限成局", () => {
  it("凑够才揭晓；之前谁说了来 / 不来都不可见，人数不因拒绝而减少", async () => {
    const { id, adminToken } = await mk({ quorum: { min: 2 } });
    const org = await enter(id, "老王", { admin: adminToken, organizer: true });
    const a = await enter(id, "小林");
    const b = await enter(id, "阿May");
    expect(getState(id).members.map((m) => m.name)).toEqual(["老王"]);

    await chat(id, a.memberToken, { rsvp: "yes" });
    const before = getState(id).counts;
    await chat(id, b.memberToken, { rsvp: "no" });
    const after = getState(id).counts;
    expect(after.in).toBe(before.in); // 拒绝不会让人数掉
    expect(after.quorumHave).toBe(1);
    expect(getState(id).ju.quorum?.state).toBe("pending");
    expect(getState(id).members.map((m) => m.name)).toEqual(["老王"]);

    await chat(id, org.memberToken, { rsvp: "yes" });
    const st = getState(id);
    expect(st.ju.quorum?.state).toBe("met");
    expect(st.members.map((m) => m.name).sort()).toEqual(["小林", "老王"]);
    expect(JSON.stringify(st)).not.toContain("阿May");
    expect(raw(id, a.memberId).private!.inbox.some((n) => n.kind === "quorum")).toBe(true);
    expect(st.ju.announcements.at(-1)?.text).toContain("凑齐了");
  });

  it("门限截止没凑齐 → 悄悄作废", async () => {
    const { id } = await mk({ quorum: { min: 3, deadline: "2020-01-01T00:00:00Z" } });
    const a = await enter(id, "小林");
    await chat(id, a.memberToken, { rsvp: "yes" });
    await advanceJu(id);
    const st = getState(id);
    expect(st.ju.status).toBe("cancelled");
    expect(st.ju.quorum?.state).toBe("failed");
    expect(raw(id, a.memberId).private!.inbox.some((n) => n.kind === "quorum")).toBe(true);
  });
});

describe("#2 分层邀请 / 候补转正", () => {
  it("名额满或该圈没开放 → 候补；空出名额按圈层、先后转正，私信不提圈层", async () => {
    const { id, adminToken, tierLinks } = await mk({ capacity: 2, tiers: 2 });
    const t2 = tierLinks.find((t) => t.tier === 2)!.token;
    const a = await enter(id, "小林");
    const b = await enter(id, "阿杰");
    const c = await enter(id, "大刘", { tierToken: t2 }); // 第二圈没开放
    const d = await enter(id, "小周"); // 满了
    expect([a.status, b.status, c.status, d.status]).toEqual(["in", "in", "waitlist", "waitlist"]);
    expect(getState(id).counts.waitlist).toBe(2);
    expect(JSON.stringify(getState(id))).not.toContain("大刘");

    await patchMember(id, a.memberId, { status: "out" }, { memberToken: a.memberToken });
    expect(raw(id, d.memberId).status).toBe("in"); // 第一圈先
    expect(raw(id, c.memberId).status).toBe("waitlist");
    const notice = raw(id, d.memberId).private!.inbox.find((n) => n.kind === "promoted")!;
    expect(notice.text).not.toMatch(/圈|tier/);

    await openTier(id, 2, { adminToken });
    expect(raw(id, c.memberId).status).toBe("waitlist"); // 圈开了，但还是满的
    await patchJu(id, { capacity: 3 }, { adminToken });
    expect(raw(id, c.memberId).status).toBe("in");
  });
});

describe("#2 互选匹配", () => {
  it("单方面不揭晓；双方都选了才写入 matches 并发私信", async () => {
    const { id } = await mk();
    const a = await enter(id, "小林");
    const b = await enter(id, "阿杰");
    const r1 = await setWants(id, a.memberToken, [b.memberId]);
    expect(r1.matchNames).toEqual([]);
    expect(raw(id, b.memberId).private!.matches).toEqual([]);
    expect(getState(id).counts.matchPairs).toBe(0);
    expect(getState(id, { memberToken: b.memberToken }).me?.private?.wants).toEqual([]);

    const r2 = await setWants(id, b.memberToken, [a.memberId]);
    expect(r2.matchNames).toEqual(["小林"]);
    expect(raw(id, a.memberId).private!.matches).toEqual([b.memberId]);
    expect(raw(id, a.memberId).private!.inbox.some((n) => n.kind === "match")).toBe(true);
    expect(getState(id).counts.matchPairs).toBe(1);
    expect(getState(id, { memberToken: a.memberToken }).mine?.matchNames).toEqual(["阿杰"]);
  });
});

async function plannedJu() {
  const { id, adminToken } = await mk({ deadline: "2030-10-31T00:00:00Z" });
  const ms = [];
  for (const [i, n] of ["小林", "阿杰", "老王"].entries()) {
    const m = await enter(id, n);
    await chat(id, m.memberToken, { location: PLACES[i] });
    ms.push(m);
  }
  await makePlan(id, { adminToken });
  return { id, adminToken, ms };
}

describe("出方案 / #4 攒批重算 / #9 复算", () => {
  it("出方案：没完成入局的人被预填，mine 只给本人；复算哈希一致", async () => {
    const { id, ms } = await plannedJu();
    const st = getState(id);
    expect(st.ju.status).toBe("voting");
    expect(st.ju.plan!.proposals.length).toBeGreaterThan(0);
    expect(st.ju.plan!.proposals.every((p) => p.blurb)).toBe(true);
    expect(raw(id, ms[0].memberId).private!.inbox.some((n) => n.kind === "autofill")).toBe(true);
    expect(st.mine).toBeUndefined();
    const mine = getState(id, { memberToken: ms[0].memberToken }).mine!;
    expect(mine.experiences.length).toBe(st.ju.plan!.proposals.length);
    const v = await verifyPlan(id);
    expect(v.ok).toBe(true);
    expect(v.recomputedOutputHash).toBe(v.outputHash);
  });

  it("方案出来后单人改动只记数；≥2 人且 ≥3 分钟才重算", async () => {
    const { id, ms } = await plannedJu();
    const computedAt = getState(id).ju.plan!.computedAt;
    await chat(id, ms[0].memberToken, { budgetMax: 70 });
    await advanceJu(id);
    let st = getState(id);
    expect(st.ju.pendingChanges).toBe(1);
    expect(st.ju.plan!.computedAt).toBe(computedAt);

    await chat(id, ms[1].memberToken, { dietTags: ["不吃辣"] });
    await chat(id, ms[1].memberToken, { budgetMax: 90 }); // 同一个人再改不重复计数
    await advanceJu(id);
    st = getState(id);
    expect(st.ju.pendingChanges).toBe(2);
    expect(st.ju.plan!.computedAt).toBe(computedAt); // 不到 3 分钟

    const ju = db.getJu(id)!;
    ju.admin!.clockOffsetMin = 4;
    db.saveJu(ju);
    await advanceJu(id);
    st = getState(id);
    expect(st.ju.pendingChanges).toBe(0);
    expect(st.ju.trace.some((t) => t.text.includes("有 2 位朋友更新了情况"))).toBe(true);
    expect(st.ju.trace.map((t) => t.text).join()).not.toMatch(/小林|阿杰|(?<![0-9a-f])70(?![0-9a-f])|(?<![0-9a-f])90(?![0-9a-f])/);
  });

  it("投票过半自动定局；之后有人退出交给稳定重规划", async () => {
    const { id, ms } = await plannedJu();
    const pid = getState(id).ju.plan!.proposals[0].id;
    await vote(id, ms[0].memberToken, pid, {});
    expect(getState(id).ju.status).toBe("voting");
    await vote(id, ms[1].memberToken, pid, {});
    const st = getState(id);
    expect(st.ju.status).toBe("confirmed");
    expect(st.ju.confirmedProposalId).toBe(pid);
    expect(st.ju.announcements.at(-1)?.text).toContain("定了");
    await expect(vote(id, ms[2].memberToken, pid, {})).rejects.toMatchObject({ status: 409 });
    await patchMember(id, ms[2].memberId, { status: "out" }, { memberToken: ms[2].memberToken });
    expect(getState(id).members.map((m) => m.name)).not.toContain("老王");
  });

  it("发起人拍板", async () => {
    const { id, adminToken } = await plannedJu();
    const pid = getState(id).ju.plan!.proposals.at(-1)!.id;
    await confirm(id, pid, { adminToken });
    expect(getState(id).ju.confirmedProposalId).toBe(pid);
  });
});

describe("演示 seed", () => {
  it("6 人设定都在：阿May 不存在、大刘候补、小林阿杰互选、阿杰有账本、小周被预填", async () => {
    const { id, adminToken } = await mk({ quorum: { min: 3 } });
    const org = await enter(id, "发起人", { admin: adminToken, organizer: true });
    await chat(id, org.memberToken, { rsvp: "yes" });
    const st = await seedJu(id, 6, { adminToken });
    const names = st.members.map((m) => m.name);
    expect(st.ju.quorum?.state).toBe("met");
    expect(names).toEqual(expect.arrayContaining(["阿杰", "小林", "老王", "小周"]));
    expect(JSON.stringify(st)).not.toContain("阿May");
    expect(names).not.toContain("大刘");
    expect(st.counts.waitlist).toBe(1);
    expect(st.counts.matchPairs).toBe(1);
    const all = db.listMembers(id);
    const by = (n: string) => all.find((m) => m.name === n)!;
    expect(by("阿May").status).toBe("out");
    expect(by("大刘").secret!.tier).toBe(2);
    expect(by("小林").private!.budgetMax).toBe(80);
    expect(by("老王").private!.availability[SPEC.dates[0]].homeBy).toBe("23:00");
    expect(by("老王").private!.dietTags).toContain("不吃辣");
    expect(by("小周").private!.autoFilled.length).toBeGreaterThan(0);
    expect(db.getProfileRow(by("阿杰").profileId!)!.ledger).toHaveLength(3);
    expect(by("阿杰").private!.availability[SPEC.dates[0]].from).toBe("18:30");
    // 有人退出 → 大刘转正
    await patchMember(id, by("小周").id, { status: "out" }, { memberToken: by("小周").secret!.token });
    expect(raw(id, by("大刘").id).status).toBe("in");
    // 公开视图再确认一遍
    expect(JSON.stringify(publicState(db.getJu(id)!, db.listMembers(id)))).not.toMatch(/阿May|"budgetMax"|demo-jie/);
  });

  it("定局后有人退出：候补只收到一条私信（转正和变化合并，由稳定重规划发），本人视图带行程卡", async () => {
    const { id, adminToken } = await mk();
    await seedJu(id, 6, { adminToken });
    await makePlan(id, { adminToken });
    const pid = getState(id).ju.plan!.proposals[0].id;
    await confirm(id, pid, { adminToken });
    const all = db.listMembers(id);
    const liu = all.find((m) => m.name === "大刘")!;
    const zhou = all.find((m) => m.name === "小周")!;
    const before = liu.private!.inbox.length;
    await patchMember(id, zhou.id, { status: "out" }, { memberToken: zhou.secret!.token });
    const after = raw(id, liu.id);
    expect(after.status).toBe("in");
    expect(after.private!.inbox.length - before).toBe(1);
    // 群公告 / 回顾用的到场人数：在局的人里除了方案里来不了的都算（含转正的大刘）
    const facts = publicFacts(db.getJu(id)!, db.listMembers(id));
    const absent = getState(id).ju.plan!.proposals.find((p) => p.id === pid)!.experiences.filter((e) => e.status === "absent").length;
    expect(facts.confirmed!.headcount).toBe(getState(id).members.length - absent);
    const lin = all.find((m) => m.name === "小林")!;
    const st = await getStateFull(id, { memberToken: lin.secret!.token });
    expect(st.mine?.itinerary?.proposalId).toBe(pid);
    expect(st.mine?.itinerary?.seatWith).toContain("阿杰");
  });
});

// B3 主动智能体测试：幂等 tick、演示时钟快进触发出发提醒、ETA 不落坐标、结算不暴露谁没转、
// 催款只催没转的、照片校验、回顾写账本。
// 地图相关的算法（行程 / ETA / 重规划）和 LLM 用确定性的桩替换，测的是 B3 自己的逻辑。
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const PHOTO_DIR = vi.hoisted(() => {
  process.env.JUZHANG_DB = ":memory:";
  process.env.JUZHANG_SCHEDULER = "off";
  const dir = `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/juzhang-b3-photos-${process.pid}-${Date.now()}`;
  process.env.JUZHANG_PHOTOS_DIR = dir;
  return dir;
});

vi.mock("../../planner", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  const bj = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(11, 16);
  return {
    ...real,
    // 出发 = 开场前 45 分钟
    itineraryFor: async (_m: unknown, p: { id: string; slot: { start: string } }) => {
      const start = new Date(p.slot.start);
      return {
        proposalId: p.id,
        departAt: bj(new Date(start.getTime() - 45 * 60_000)),
        arriveAt: bj(start),
        commuteMin: 45,
        route: ["步行 400 米到漕宝路站", "地铁 12 号线 5 站"],
      };
    },
    etaFor: async (_pos: unknown, p: { slot: { start: string } }) => {
      const start = new Date(p.slot.start);
      return { arriveAt: bj(new Date(start.getTime() + 12 * 60_000)), lateMin: 12 };
    },
    replanStable: async (_ju: unknown, members: { id: string }[], current: { id: string }) => ({
      proposal: current,
      changes: [`桌子改成 ${members.length} 人`],
      tableSize: members.length,
      keptVenue: true,
    }),
    settle: (total: number, n: number) => ({ total, perPerson: Math.round((total / n) * 100) / 100 }),
    splitBill: (receipt: { total: number }, attendees: { id: string }[]) => {
      const each = Math.round((receipt.total / attendees.length) * 100) / 100;
      return {
        total: receipt.total,
        explain: ["酒水只由喝酒的人分摊"],
        perMember: Object.fromEntries(attendees.map((a) => [a.id, { amount: each, lines: [{ itemName: "菜", amount: each }] }])),
      };
    },
    ledgerEntryFor: (
      juId: string,
      me: { utility: number; commuteMin: number },
      avg: number,
      at: string,
    ) => ({
      juId,
      at,
      commuteMin: me.commuteMin,
      avgCommuteMin: avg,
      utility: me.utility,
      regret: Math.max(0, 100 - me.utility + Math.max(0, me.commuteMin - avg)),
    }),
  };
});

vi.mock("../../llm", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    writeRecap: async (_f: unknown, n: number) => `一起吃了顿火锅，留下 ${n} 张照片。`,
    groupMessages: async () => ({ broadcast: "公告", nudges: [], reservationScript: "您好，订 6 位" }),
    parseReceipt: async () => ({ items: [], total: 600, fallback: true }),
  };
});

import * as db from "../../db";
import type { Ju, Member, Proposal } from "../../types";
import { publicState } from "../firewall";
import { getProfile, saveProfile } from "../profile";
import { markPaid, postEta, recap, remindPay, settleJu } from "./actions";
import { decodePhoto, readPhoto, savePhoto } from "./photos";
import { onMembershipChangedAfterConfirm } from "./changes";
import { tickJu } from "./scheduler";

afterAll(() => fs.rmSync(PHOTO_DIR, { recursive: true, force: true }));

let seq = 0;
const ADMIN = "admin-token-xxxxxxxxxxxx";

function proposal(start: Date, ids: string[]): Proposal {
  const end = new Date(start.getTime() + 2 * 3600_000);
  return {
    id: "p1",
    label: "balanced",
    labelText: "均衡",
    slot: { id: "s1", start: start.toISOString(), end: end.toISOString() },
    poi: { id: "poi1", name: "小龙坎火锅", address: "漕溪北路 1 号", type: "餐饮服务;中餐厅;火锅店", lat: 31.17, lng: 121.43 },
    experiences: ids.map((id, i) => ({
      memberId: id,
      status: "full" as const,
      lateMin: 0,
      stayMin: 120,
      commuteMin: 20 + i * 10,
      utility: 80 - i * 5,
      notes: [],
    })),
    attendCount: ids.length,
    minUtility: 60,
    avgUtility: 70,
    score: 70,
    headline: "全员到齐",
    tradeoffs: [],
    highlights: [],
    recommended: true,
  };
}

function makeJu(over: Partial<Ju> = {}): Ju {
  const id = `ju${++seq}x`;
  const ju: Ju = {
    id,
    title: "周五火锅",
    rawPrompt: "周五晚上火锅",
    organizerName: "小张",
    spec: {
      category: "火锅", poiKeywords: ["火锅"], dates: ["2026-10-23"], earliest: "18:00", latest: "20:00",
      durationMinutes: 120, city: "上海",
    },
    slots: [],
    status: "collecting",
    createdAt: new Date().toISOString(),
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    admin: { tiers: [], auditSecret: "s" },
    ...over,
  };
  ju.id = id;
  db.insertJu(ju, ADMIN);
  return ju;
}

function makeMember(ju: Ju, name: string, over: Partial<Member> = {}): Member {
  const m: Member = {
    id: `${ju.id}-${name}`,
    juId: ju.id,
    name,
    avatar: "🐱",
    location: { lat: 31.2, lng: 121.4, label: "家" },
    role: "guest",
    intake: "done",
    status: "in",
    joinedAt: new Date(Date.now() + seq++).toISOString(),
    isOrganizer: false,
    private: {
      chat: [], availability: {}, dietTags: [], notes: [], swipes: {}, autoFilled: [], wants: [], matches: [],
      billFacts: {}, inbox: [],
    },
    secret: { token: `tok-${ju.id}-${name}`, tier: 1 },
    ...over,
  };
  db.upsertMember(m);
  return m;
}

/** 已定局的局：开场在 startInMin 分钟后 */
function confirmedJu(names: string[], startInMin = 180) {
  const start = new Date(Date.now() + startInMin * 60_000);
  const ju = makeJu({ status: "confirmed" });
  const ms = names.map((n, i) => makeMember(ju, n, { isOrganizer: i === 0 }));
  ju.plan = {
    proposals: [proposal(start, ms.map((m) => m.id))],
    recommendation: "",
    constraintSummaries: [],
    center: { lat: 31.17, lng: 121.43 },
    audit: { inputHash: "", outputHash: "", candidates: 1, evaluations: 1, paretoSize: 1, algorithmVersion: "t" },
    computedAt: new Date().toISOString(),
  };
  ju.confirmedProposalId = "p1";
  db.saveJu(ju);
  return { ju, ms };
}

const inbox = (id: string) => db.getMember(id)!.private!.inbox;
const setOffset = (juId: string, min: number) => {
  const ju = db.getJu(juId)!;
  ju.admin!.clockOffsetMin = min;
  db.saveJu(ju);
};

beforeEach(() => vi.restoreAllMocks());

describe("tickJu", () => {
  it("幂等：投票截止前连 tick 3 次，每个没投的人只被催一次", async () => {
    const ju = makeJu({ status: "voting", deadline: new Date(Date.now() + 30 * 60_000).toISOString() });
    const org = makeMember(ju, "小张", { isOrganizer: true });
    const a = makeMember(ju, "阿杰");
    const b = makeMember(ju, "小林");
    const j = db.getJu(ju.id)!;
    j.votes[b.id] = "p1";
    db.saveJu(j);
    for (let i = 0; i < 3; i++) await tickJu(ju.id);
    expect(inbox(a.id).filter((n) => n.kind === "nudge")).toHaveLength(1);
    expect(inbox(b.id).filter((n) => n.kind === "nudge")).toHaveLength(0); // 投过了
    expect(inbox(org.id).filter((n) => n.kind === "nudge")).toHaveLength(0); // 发起人不催
  });

  it("截止还早时不催", async () => {
    const ju = makeJu({ status: "collecting", deadline: new Date(Date.now() + 5 * 3600_000).toISOString() });
    const a = makeMember(ju, "阿杰", { intake: "chatting" });
    await tickJu(ju.id);
    expect(inbox(a.id)).toHaveLength(0);
  });

  it("出发提醒：演示时钟快进到出发前 10 分钟才发，且只发一次", async () => {
    // 开场在 3 小时后，出发 = 开场前 45 分钟 = 2h15m 后；提醒窗口从 2h05m 开始
    const { ju, ms } = confirmedJu(["小张", "阿杰"], 180);
    await tickJu(ju.id);
    expect(inbox(ms[1].id).filter((n) => n.kind === "depart")).toHaveLength(0);
    setOffset(ju.id, 120); // 2h 后：还差 5 分钟才进窗口
    await tickJu(ju.id);
    expect(inbox(ms[1].id).filter((n) => n.kind === "depart")).toHaveLength(0);
    setOffset(ju.id, 128);
    for (let i = 0; i < 3; i++) await tickJu(ju.id);
    const dep = inbox(ms[1].id).filter((n) => n.kind === "depart");
    expect(dep).toHaveLength(1);
    expect(dep[0].text).toContain("小龙坎火锅");
    expect(inbox(ms[0].id).filter((n) => n.kind === "depart")).toHaveLength(1);
  });

  it("结算 24 小时（演示时钟）后自动私下提醒一次没转的人", async () => {
    const { ju, ms } = confirmedJu(["小张", "阿杰", "小林"], -180);
    await settleJu(ju.id, { total: 300 }, ADMIN);
    await markPaid(ju.id, ms[2].secret!.token);
    await tickJu(ju.id);
    expect(inbox(ms[1].id).filter((n) => n.id.startsWith("pay-remind"))).toHaveLength(0);
    setOffset(ju.id, 24 * 60 + 1);
    for (let i = 0; i < 3; i++) await tickJu(ju.id);
    expect(inbox(ms[1].id).filter((n) => n.id.startsWith("pay-remind"))).toHaveLength(1);
    expect(inbox(ms[2].id).filter((n) => n.id.startsWith("pay-remind"))).toHaveLength(0); // 转过了
    expect(inbox(ms[0].id).filter((n) => n.id.startsWith("pay-remind"))).toHaveLength(0); // 付款人
  });
});

describe("ETA", () => {
  it("坐标算完即丢：DB 里找不到那组经纬度；其他人收到不点名的晚到私信", async () => {
    const { ju, ms } = confirmedJu(["小张", "阿杰", "小林"], 20);
    const log = vi.spyOn(console, "log");
    const warn = vi.spyOn(console, "warn");
    const r = await postEta(ju.id, ms[1].secret!.token, { lat: 31.123457, lng: 121.654321 });
    expect(r.eta.lateMin).toBe(12);
    const dump = JSON.stringify([db.listAllJu(), db.listAllMembers()]);
    expect(dump).not.toContain("31.123457");
    expect(dump).not.toContain("121.654321");
    expect(dump).not.toContain("31.12345"); // 也没存近似值
    const logged = JSON.stringify([log.mock.calls, warn.mock.calls]);
    expect(logged).not.toContain("31.123457");
    expect(db.getMember(ms[1].id)!.eta?.lateMin).toBe(12);

    const n = inbox(ms[2].id).filter((x) => x.kind === "eta");
    expect(n).toHaveLength(1);
    expect(n[0].text).toContain("1 位朋友预计晚到 12 分钟");
    expect(n[0].text).not.toContain("阿杰");
    expect(inbox(ms[1].id).filter((x) => x.kind === "eta")).toHaveLength(0); // 晚到的人自己不收
    // 路上再刷新一次，同样的情况不重复打扰
    await postEta(ju.id, ms[1].secret!.token, { lat: 31.13, lng: 121.6, from: "wgs84" });
    expect(inbox(ms[2].id).filter((x) => x.kind === "eta")).toHaveLength(1);
  });
});

describe("结算 / 催款", () => {
  it("settle 后公开 JuState 只有总额和已转人数，看不到谁没转", async () => {
    const { ju, ms } = confirmedJu(["小张", "阿杰", "小林", "老王"], -180);
    await settleJu(ju.id, { total: 400 }, ADMIN);
    await markPaid(ju.id, ms[1].secret!.token);
    const st = publicState(db.getJu(ju.id)!, db.listMembers(ju.id));
    expect(st.ju.settlement).toMatchObject({ total: 400, payCount: 3, paidCount: 1 });
    expect(st.ju.admin).toBeUndefined();
    const s = JSON.stringify(st);
    expect(s).not.toMatch(/"paid"\s*:/);
    expect(s).not.toContain("payment");
    expect(s).not.toContain("remindedAt");
    // 交换检验：阿杰转了 vs 小林转了，公开视图除了"谁"以外完全一样
    const { ju: ju2, ms: ms2 } = confirmedJu(["小张", "阿杰", "小林", "老王"], -180);
    await settleJu(ju2.id, { total: 400 }, ADMIN);
    await markPaid(ju2.id, ms2[2].secret!.token);
    const strip = (x: ReturnType<typeof publicState>) =>
      JSON.stringify(x.ju.settlement) + JSON.stringify(x.members.map((m) => ({ ...m, id: "", juId: "", joinedAt: "" })));
    expect(strip(publicState(db.getJu(ju2.id)!, db.listMembers(ju2.id)))).toBe(strip(st));

    // 每个人私下知道自己该转多少
    const mine = db.getMember(ms[2].id)!.private!;
    expect(mine.payment?.amount).toBe(100);
    expect(mine.inbox.some((n) => n.kind === "payment" && n.text.includes("¥100"))).toBe(true);
  });

  it("remind-pay 只提醒没转的人（付款人和已转的人不收）", async () => {
    const { ju, ms } = confirmedJu(["小张", "阿杰", "小林", "老王"], -180);
    await settleJu(ju.id, { total: 400 }, ADMIN);
    await markPaid(ju.id, ms[3].secret!.token);
    const before = new Map(ms.map((m) => [m.id, inbox(m.id).length]));
    const r = await remindPay(ju.id);
    expect(r).toEqual({ reminded: 2 });
    const delta = (m: Member) => inbox(m.id).length - before.get(m.id)!;
    expect(delta(ms[0])).toBe(0); // 付款人
    expect(delta(ms[1])).toBe(1);
    expect(delta(ms[2])).toBe(1);
    expect(delta(ms[3])).toBe(0); // 已转
    expect(db.getMember(ms[1].id)!.private!.payment!.remindedAt).toHaveLength(1);
  });
});

describe("照片", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const err = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return (e as { status?: number }).status;
    }
    return 0;
  };

  it("只收 jpeg / png / webp，且文件头要对得上", () => {
    expect(err(() => decodePhoto(`data:image/gif;base64,${Buffer.from("GIF89a").toString("base64")}`))).toBe(415);
    expect(err(() => decodePhoto(`data:image/png;base64,${jpg.toString("base64")}`))).toBe(415);
    expect(err(() => decodePhoto("not a data url"))).toBe(415);
    expect(decodePhoto(`data:image/png;base64,${png.toString("base64")}`).kind).toBe("png");
    expect(decodePhoto(`data:image/jpeg;base64,${jpg.toString("base64")}`).kind).toBe("jpeg");
  });

  it("超过 5MB 拒收", () => {
    const big = Buffer.alloc(5 * 1024 * 1024 + 10);
    jpg.copy(big);
    expect(err(() => decodePhoto(`data:image/jpeg;base64,${big.toString("base64")}`))).toBe(413);
  });

  it("存到 data/photos/<juId>/ 并能读回来；目录不存在会自动建", async () => {
    const { ju } = confirmedJu(["小张"], -180);
    const { url } = await savePhoto(ju.id, `data:image/png;base64,${png.toString("base64")}`);
    const pid = url.split("/").pop()!;
    expect(url).toBe(`/api/ju/${ju.id}/photos/${pid}`);
    expect(fs.existsSync(path.join(PHOTO_DIR, ju.id, `${pid}.png`))).toBe(true);
    const r = readPhoto(ju.id, pid);
    expect(r.mime).toBe("image/png");
    expect(r.buf.equals(png)).toBe(true);
    expect(db.getJu(ju.id)!.recap?.photos).toEqual([url]);
    expect(err(() => readPhoto(ju.id, "../../etc"))).toBe(404);
  });
});

describe("回顾", () => {
  it("写回顾 + 给有档案的在场成员记一笔账本（只记一次）", async () => {
    const { ju, ms } = confirmedJu(["小张", "阿杰", "小林"], -180);
    saveProfile({ id: "prof-a", dietTags: [], ledger: [], tastes: {} });
    const a = db.getMember(ms[1].id)!;
    a.profileId = "prof-a";
    db.upsertMember(a);
    await savePhoto(ju.id, `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString("base64")}`);
    const st = await recap(ju.id, ADMIN);
    expect(st.ju.recap?.text).toContain("1 张照片");
    expect(st.ju.recap?.photos).toHaveLength(1);
    await recap(ju.id, ADMIN);
    const p = getProfile("prof-a")!;
    expect(p.ledger).toHaveLength(1);
    expect(p.ledger[0]).toMatchObject({ juId: ju.id, commuteMin: 30, avgCommuteMin: 30, utility: 75 });
    expect(inbox(ms[1].id).filter((n) => n.kind === "recap")).toHaveLength(1);
  });
});


describe("#12 稳定重规划", () => {
  it("定局后有人退出：候补转正、写 revisions、公告不点名、在场的人收到 revision 私信", async () => {
    const { ju, ms } = confirmedJu(["小张", "阿杰", "小林"], 600);
    const j = db.getJu(ju.id)!;
    j.capacity = 3;
    j.reservation = { status: "booked", tableSize: 3 };
    db.saveJu(j);
    const out = db.getMember(ms[1].id)!;
    out.status = "out";
    db.upsertMember(out);
    const wait = makeMember(ju, "大刘", { status: "waitlist", secret: { token: "tok-w", tier: 1 } });
    await onMembershipChangedAfterConfirm(ju.id, "有朋友临时来不了了");
    const after = db.getJu(ju.id)!;
    expect(after.revisions).toHaveLength(1);
    expect(after.revisions[0].reason).toBe("有朋友临时来不了了");
    expect(after.announcements.at(-1)!.text).not.toContain("阿杰");
    expect(after.reservation).toMatchObject({ status: "booked", tableSize: 3 }); // 候补补上了，桌数不变
    expect(db.getMember(wait.id)!.status).toBe("in");
    // changes 去重：转正只算一次"新加入"，不出现"候补 / 转正"字样
    const changes = after.revisions[0].changes.join("；");
    expect(changes.match(/加入/g)).toHaveLength(1);
    expect(changes).not.toMatch(/候补|转正/);
    // 被转正的人只收到 1 条私信（promoted，不提圈层），没有 revision
    expect(inbox(wait.id)).toHaveLength(1);
    expect(inbox(wait.id)[0].kind).toBe("promoted");
    expect(inbox(wait.id)[0].text).not.toMatch(/圈/);
    expect(inbox(ms[2].id).filter((n) => n.kind === "revision")).toHaveLength(1);
    expect(inbox(ms[1].id).filter((n) => n.kind === "revision")).toHaveLength(0);
  });
});

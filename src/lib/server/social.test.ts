// v4 局内编排的流程单测：私下标记 → 排座 → 本人视图 → 复算 → 按反馈调整 → 有人没到 → 聊得来 → 圈子记忆 → 再约预填。
// 内存库 + mock 地图 + 规则版 LLM（删掉所有 key）。
process.env.JUZHANG_DB = ":memory:";
delete process.env.AMAP_KEY;
delete process.env.LLM_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../db";
import type { JuSpec, Member } from "../types";
import { again, recap } from "./after/actions";
import { chat, join, setWants } from "./intake";
import { confirm, createJu, getState, makePlan } from "./ju";
import { getProfile } from "./profile";
import { seedClub } from "./seed";
import { circle, makeSeating, nextRound, seatAbsent, setClicked, setFeel, setSocial, verifySeating } from "./social";

const SPEC: JuSpec = {
  category: "桌游",
  poiKeywords: ["桌游"],
  dates: ["2030-11-01"],
  earliest: "18:00",
  latest: "19:30",
  durationMinutes: 180,
  city: "上海",
};
const PLACES = [
  { lat: 31.1952, lng: 121.4372, label: "徐家汇" },
  { lat: 31.1675, lng: 121.397, label: "漕河泾" },
  { lat: 31.2005, lng: 121.4335, label: "交大" },
  { lat: 31.2235, lng: 121.446, label: "静安寺" },
];
// 两个小圈子：社团老成员 4 人互相挺熟，新生 4 人互相见过，圈子之间互不认识
const OLD = ["老A", "老B", "老C", "老D"];
const NEW = ["新E", "新F", "新G", "新H"];

beforeEach(() => db._resetDbForTest());

type Who = { name: string; memberId: string; memberToken: string };

async function club() {
  const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "社团团建", organizerName: "老A" } as Parameters<typeof createJu>[0]);
  const ms: Who[] = [];
  for (const [i, name] of [...OLD, ...NEW].entries()) {
    const r = await join(
      id,
      { name, profileId: `pid-${name}-0000`, ...(i === 0 ? { isOrganizer: true } : {}) },
      i === 0 ? { adminToken } : {},
    );
    await chat(id, r.memberToken, { location: PLACES[i % PLACES.length] });
    ms.push({ name, memberId: r.memberId, memberToken: r.memberToken });
  }
  const by = (n: string) => ms.find((m) => m.name === n)!;
  for (const group of [OLD, NEW]) {
    for (const n of group) {
      const know: Record<string, 0 | 1 | 2> = {};
      for (const o of group) if (o !== n) know[by(o).memberId] = OLD.includes(n) ? 2 : 1;
      await setSocial(id, by(n).memberToken, { know, interests: n === "老B" || n === "新F" ? ["剧本杀", "猫"] : ["桌游"] });
    }
  }
  await makePlan(id, { adminToken });
  const st = getState(id);
  const rec = st.ju.plan!.proposals.find((p) => p.recommended) ?? st.ju.plan!.proposals[0];
  await confirm(id, rec.id, { adminToken });
  return { id, adminToken, ms, by };
}

const raw = (id: string, mid: string): Member => db.listMembers(id).find((m) => m.id === mid)!;
const together = (rounds: string[][][], a: string, b: string) => rounds.reduce((n, r) => n + r.filter((t) => t.includes(a) && t.includes(b)).length, 0);

describe("#17 #18 私下标记 + 排座", () => {
  it("标记只进本人 private，公开视图里只有兴趣；排座后每人第一轮都有熟人、跨圈子新认识", async () => {
    const { id, adminToken, by } = await club();
    // 电量 / 回避 / 想认识
    await setSocial(id, by("新G").memberToken, { energy: "low" });
    await setSocial(id, by("老C").memberToken, { avoid: [by("新H").memberId] });
    await setWants(id, by("老D").memberToken, [by("新E").memberId]);
    await setWants(id, by("新E").memberToken, [by("老D").memberId]);

    const pub = JSON.stringify(getState(id));
    for (const k of ['"know"', '"avoid"', '"energy"', '"knowAuto"']) expect(pub).not.toContain(k);
    expect(getState(id).members.find((m) => m.id === by("老B").memberId)!.interests).toEqual(["剧本杀", "猫"]);

    const st = await makeSeating(id, { rounds: 2, tableSize: 4 }, { adminToken });
    const s = st.ju.seating!;
    expect(s.rounds).toHaveLength(2);
    expect(s.current).toBe(-1);
    expect(s.metrics.people).toBe(8);
    expect(s.metrics.knownBefore).toBe(12);
    expect(s.metrics.everyoneAnchored).toBe(true);
    expect(s.metrics.newPairs).toBeGreaterThanOrEqual(12);
    const rounds = s.rounds.map((r) => r.tables.map((t) => t.memberIds));
    expect(together(rounds, by("老D").memberId, by("新E").memberId)).toBeGreaterThanOrEqual(1);
    expect(together(rounds, by("老C").memberId, by("新H").memberId)).toBe(0);
    expect(s.metrics.neverTogether).toBeGreaterThanOrEqual(3);
    // 社交电量低的人每一轮都有认识的人
    for (const r of rounds) {
      const t = r.find((x) => x.includes(by("新G").memberId))!;
      expect(t.some((x) => NEW.map((n) => by(n).memberId).includes(x) && x !== by("新G").memberId)).toBe(true);
    }
    // 公告 + 私信
    expect(getState(id).ju.announcements.at(-1)!.text).toContain("局长排座");
    expect(raw(id, by("新F").memberId).private!.inbox.some((n) => n.kind === "seat")).toBe(true);
    // 公开视图里没有诱饵、没有回避
    expect(JSON.stringify(getState(id))).not.toMatch(/decoy|avoidHonored/);
  });

  it("本人视图：每一轮坐哪 + 只用本人自己的标记解释", async () => {
    const { id, adminToken, by } = await club();
    await makeSeating(id, { rounds: 2, tableSize: 4 }, { adminToken });
    const mine = getState(id, { memberToken: by("新F").memberToken }).mine!;
    expect(mine.seats).toHaveLength(2);
    const r0 = mine.seats![0];
    expect(r0.mates.length).toBeGreaterThanOrEqual(3);
    expect(r0.notes.join()).toMatch(/见过的|还不认识/);
    // 不带 token 的公开视图没有 mine
    expect(getState(id).mine).toBeUndefined();
  });

  it("一键复算：同样的输入 + 同一个密钥，outputHash 一致", async () => {
    const { id, adminToken } = await club();
    await makeSeating(id, {}, { adminToken });
    const v = verifySeating(id);
    expect(v.ok).toBe(true);
    expect(v.recomputedOutputHash).toBe(v.outputHash);
  });

  it("定局前不能排座；开始之后不能整体重排", async () => {
    const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "x", organizerName: "a" } as Parameters<typeof createJu>[0]);
    await expect(makeSeating(id, {}, { adminToken })).rejects.toMatchObject({ status: 409 });
    const c = await club();
    await makeSeating(c.id, {}, { adminToken: c.adminToken });
    await nextRound(c.id, { adminToken: c.adminToken });
    await expect(makeSeating(c.id, {}, { adminToken: c.adminToken })).rejects.toMatchObject({ status: 409 });
  });
});

describe("#19 轮次 + 私下反馈", () => {
  it("多数人觉得拘谨 → 下一轮换成轻松的玩法，公开的只有聚合数字", async () => {
    const { id, adminToken, ms } = await club();
    await makeSeating(id, { rounds: 2, tableSize: 4 }, { adminToken });
    await nextRound(id, { adminToken });
    expect(getState(id).ju.seating!.rounds[0].status).toBe("live");
    for (const [i, m] of ms.entries()) await setFeel(id, m.memberToken, 0, i < 5 ? "stiff" : "ok");
    // 只能给正在进行的那一轮反馈
    await expect(setFeel(id, ms[0].memberToken, 1, "ok")).rejects.toMatchObject({ status: 409 });

    const st = await nextRound(id, { adminToken });
    const [r0, r1] = st.ju.seating!.rounds;
    expect(r0.status).toBe("done");
    expect(r0.feedback).toEqual({ stiff: 5, ok: 3, loud: 0, total: 8 });
    expect(r1.status).toBe("live");
    expect(r1.format.intensity).toBe(1);
    expect(r1.adjust).toContain("有 5 位朋友觉得有点拘谨");
    expect(JSON.stringify(getState(id))).not.toContain('"feel"');

    const end = await nextRound(id, { adminToken });
    expect(end.ju.seating!.current).toBe(2);
    expect(end.ju.announcements.at(-1)!.text).toContain("散场");
    await expect(nextRound(id, { adminToken })).rejects.toMatchObject({ status: 409 });
  });

  it("现场有人没到：还没开始的轮次重排，他不在任何一桌", async () => {
    const { id, adminToken, by } = await club();
    await makeSeating(id, { rounds: 2, tableSize: 4 }, { adminToken });
    const gone = by("新H").memberId;
    const st = await seatAbsent(id, gone, true, { adminToken });
    const s = st.ju.seating!;
    expect(s.absentIds).toEqual([gone]);
    expect(s.rounds.every((r) => r.tables.every((t) => !t.memberIds.includes(gone)))).toBe(true);
    expect(s.rounds[0].tables.flatMap((t) => t.memberIds)).toHaveLength(7);
    expect(s.version).toBe(2);
    expect(verifySeating(id).ok).toBe(true);
  });
});

describe("演示场景 scene = club", () => {
  it("社团团建：回避的人不同桌、互选的人同桌、木木每轮有熟人、圈子三局一局比一局熟", async () => {
    const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "摄影社第 3 次聚会", organizerName: "社长" } as Parameters<typeof createJu>[0]);
    const org = await join(id, { name: "社长", isOrganizer: true }, { adminToken });
    await chat(id, org.memberToken, { location: PLACES[2] });
    await seedClub(id, { adminToken });
    await makePlan(id, { adminToken });
    const st0 = getState(id);
    await confirm(id, (st0.ju.plan!.proposals.find((p) => p.recommended) ?? st0.ju.plan!.proposals[0]).id, { adminToken });
    const s = (await makeSeating(id, { rounds: 3, tableSize: 4 }, { adminToken })).ju.seating!;
    const name = new Map(db.listMembers(id).map((m) => [m.name, m.id]));
    const rounds = s.rounds.map((r) => r.tables.map((t) => t.memberIds));
    expect(s.metrics.people).toBe(10);
    expect(together(rounds, name.get("小鹿")!, name.get("大鹏")!)).toBe(0);
    expect(together(rounds, name.get("橙子")!, name.get("知夏")!)).toBeGreaterThanOrEqual(1);
    expect(s.metrics.everyoneAnchored).toBe(true);
    expect(s.metrics.neverTogether).toBeGreaterThanOrEqual(3);
    for (const r of rounds) {
      const t = r.find((x) => x.includes(name.get("木木")!))!;
      const mumuKnows = ["橙子", "阿June"].map((n) => name.get(n)!);
      expect(t.some((x) => mumuKnows.includes(x))).toBe(true);
    }
    const steps = circle(id);
    expect(steps.map((x) => x.title.slice(-7))).toEqual(["第 1 次聚会", "第 2 次聚会", "第 3 次聚会"].map((t) => t.slice(-7)));
    expect(steps[2].knownBefore).toBeGreaterThanOrEqual(steps[1].knownAfter);
    expect(steps[2].knownAfter).toBeGreaterThan(steps[2].knownBefore);
  });
});

describe("演示场景压测：每个局的密钥不同，设定都要满足", () => {
  it("30 个随机密钥 × 2 / 3 轮：人人有锚点、回避不同桌、互选同桌、木木每轮有熟人、掩护够", { timeout: 60_000 }, async () => {
    const bad: string[] = [];
    for (let k = 0; k < 30; k++) {
      db._resetDbForTest();
      const { id, adminToken } = await createJu({ prompt: "", spec: SPEC, title: "x", organizerName: "社长" } as Parameters<typeof createJu>[0]);
      const org = await join(id, { name: "社长", isOrganizer: true }, { adminToken });
      await chat(id, org.memberToken, { location: PLACES[2] });
      await seedClub(id, { adminToken });
      await makePlan(id, { adminToken });
      const st0 = getState(id);
      await confirm(id, (st0.ju.plan!.proposals.find((p) => p.recommended) ?? st0.ju.plan!.proposals[0]).id, { adminToken });
      const name = new Map(db.listMembers(id).map((m) => [m.name, m.id]));
      for (const rounds of [2, 3]) {
        const s = (await makeSeating(id, { rounds, tableSize: 4 }, { adminToken })).ju.seating!;
        const rs = s.rounds.map((r) => r.tables.map((t) => t.memberIds));
        const mumu = rs.every((r) => r.find((t) => t.includes(name.get("木木")!))!.some((x) => x === name.get("橙子") || x === name.get("阿June")));
        const ok =
          s.metrics.everyoneAnchored &&
          together(rs, name.get("小鹿")!, name.get("大鹏")!) === 0 &&
          together(rs, name.get("橙子")!, name.get("知夏")!) >= 1 &&
          mumu &&
          s.metrics.neverTogether >= 3;
        if (!ok) bad.push(`key#${k} ${rounds} 轮：${JSON.stringify(s.metrics)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("#20 #21 聊得来 + 圈子记忆", () => {
  it("双方都选了才揭晓；单方面的永远没人知道", async () => {
    const { id, by } = await club();
    await setClicked(id, by("老B").memberToken, [by("新F").memberId, by("新G").memberId]);
    const r = await setClicked(id, by("新F").memberToken, [by("老B").memberId]);
    expect(r.clickNames).toEqual(["老B"]);
    expect(getState(id, { memberToken: by("老B").memberToken }).mine!.clickNames).toEqual(["新F"]);
    expect(getState(id, { memberToken: by("新G").memberToken }).mine!.clickNames).toBeUndefined();
    expect(raw(id, by("新G").memberId).private!.inbox.some((n) => n.kind === "click")).toBe(false);
    expect(JSON.stringify(getState(id))).not.toContain("clicked");
  });

  it("回顾后档案记住谁见过谁；再约时局长按记忆预填熟悉度，圈子一局比一局熟", async () => {
    const { id, adminToken, by } = await club();
    await makeSeating(id, { rounds: 2, tableSize: 4 }, { adminToken });
    await setClicked(id, by("老B").memberToken, [by("新F").memberId]);
    await recap(id, adminToken);

    const profB = getProfile("pid-老B-0000")!;
    expect(profB.know?.["pid-新F-0000"]).toBe(2);
    expect(profB.know?.["pid-新H-0000"]).toBe(1);

    const next = await again(id, undefined);
    expect(db.getJu(next.id)!.prevJuId).toBe(id);
    const a = await join(next.id, { name: "老B", profileId: "pid-老B-0000" }, {});
    const f = await join(next.id, { name: "新F", profileId: "pid-新F-0000" }, {});
    const meB = getState(next.id, { memberToken: a.memberToken }).me!;
    expect(meB.private!.know?.[f.memberId]).toBe(2);
    expect(meB.private!.knowAuto).toContain(f.memberId);
    // 新F 没选老B，但上次同桌 / 一起到场 → 至少"见过"
    const meF = getState(next.id, { memberToken: f.memberToken }).me!;
    expect(meF.private!.know?.[a.memberId]).toBeGreaterThanOrEqual(1);

    const steps = circle(next.id);
    expect(steps).toHaveLength(2);
    expect(steps[0].juId).toBe(id);
    expect(steps[0].knownAfter).toBeGreaterThan(steps[0].knownBefore);
    expect(steps[1].knownBefore).toBe(1);
  });
});

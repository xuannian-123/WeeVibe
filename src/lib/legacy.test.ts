import { describe, expect, it } from "vitest";
import { upgradeJu, upgradeMember } from "./legacy";
import { publicState } from "./server/firewall";
import type { Ju, Member } from "./types";

// 线上 v1 局的真实形状（数值脱敏）
const v1Ju = {
  id: "legacy01",
  title: "周五火锅局",
  rawPrompt: "周五火锅",
  spec: { category: "火锅", poiKeywords: ["火锅"], dates: ["2026-10-23"], earliest: "18:00", latest: "19:30", durationMinutes: 120, city: "上海" },
  slots: [{ id: "2026-10-23T18:30", start: "2026-10-23T18:30:00+08:00", end: "2026-10-23T20:30:00+08:00" }],
  status: "confirmed",
  createdAt: "2026-10-22T10:00:00.000Z",
  votes: { m1: "poi-a", m2: "poi-a" },
  plan: {
    slotId: "2026-10-23T18:30",
    attendeeIds: ["m1", "m2"],
    absentIds: [],
    center: { lat: 31.19, lng: 121.43 },
    options: [
      {
        poi: { id: "poi-a", name: "某火锅", address: "徐汇", lat: 31.19, lng: 121.43, type: "火锅店", costPerPerson: 100 },
        score: 57,
        commutes: [
          { memberId: "m1", minutes: 30, distanceKm: 10 },
          { memberId: "m2", minutes: 10, distanceKm: 2 },
        ],
        conflicts: ["小周：清真（不是清真店）"],
        reasons: ["最远的人打车 30 分钟", "人均 100 元"],
        blurb: "综合最稳",
      },
      {
        poi: { id: "poi-b", name: "另一家", address: "徐汇", lat: 31.2, lng: 121.44, type: "火锅店" },
        score: 50,
        commutes: [{ memberId: "m1", minutes: 20, distanceKm: 6 }],
        conflicts: [],
        reasons: ["更近"],
      },
    ],
    computedAt: "2026-10-22T11:00:00.000Z",
  },
  confirmedPoiId: "poi-a",
  settlement: { total: 888, perPerson: 444, payerName: "小陈" },
} as unknown as Ju;

const v1Member = (id: string, name: string) =>
  ({
    id,
    juId: "legacy01",
    name,
    avatar: "🐱",
    location: { lat: 31.2, lng: 121.4, label: "徐家汇" },
    availableSlotIds: ["2026-10-23T18:30"],
    dietRaw: "清真",
    dietTags: ["清真"],
    status: "in",
    joinedAt: "2026-10-22T10:01:00.000Z",
    isOrganizer: id === "m1",
  }) as unknown as Member;

describe("v1 → v3 数据升级", () => {
  it("v1 方案转成 v3 proposals，票和定局跟着走", () => {
    const ju = upgradeJu(v1Ju);
    expect(ju.plan?.proposals.map((p) => p.id)).toEqual(["poi-a", "poi-b"]);
    expect(ju.confirmedProposalId).toBe("poi-a");
    expect(ju.votes.m1).toBe("poi-a");
    expect(ju.announcements).toEqual([]);
    expect(ju.settlement).toMatchObject({ total: 888, itemized: false, payCount: 0, paidCount: 0 });
    expect(new Set(ju.plan!.proposals.map((p) => p.label)).size).toBe(2);
  });

  it("v1 成员的忌口和时间搬进 private，公开视图能生成且不点名", () => {
    const members = [upgradeMember(v1Member("m1", "小陈")), upgradeMember(v1Member("m2", "小周"))];
    expect(members[0].private?.dietTags).toEqual(["清真"]);
    expect(members[0].private?.availability["2026-10-23"]).toEqual({ from: "18:30", pref: "ok" });
    const st = publicState(upgradeJu(v1Ju), members);
    const text = JSON.stringify(st);
    expect(text).not.toContain("清真");
    expect(text).not.toContain("dietRaw");
    expect(st.members.every((m) => !m.private && !m.secret)).toBe(true);
  });

  it("已经是 v3 的数据原样通过", () => {
    const ju = upgradeJu(v1Ju);
    expect(upgradeJu(ju)).toEqual(ju);
    const m = upgradeMember(v1Member("m1", "小陈"));
    expect(upgradeMember(m)).toBe(m);
  });
});

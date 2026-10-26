import { describe, expect, it } from "vitest";
import { decisionOf, groupActionsOf, organizerActionsOf } from "./decision";
import { confirmedText } from "./server/ju-text";
import type { Ju, Proposal, PublicFacts, Risk } from "./types";

const risk = (kind: Risk["kind"], text: string, over: Partial<Risk> = {}): Risk => ({ kind, level: "low", text, mitigation: "x", confidence: "known", ...over });

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  label: "balanced",
  labelText: "均衡",
  slot: { id: "2030-11-02T15:00", start: "2030-11-02T15:00:00+08:00", end: "2030-11-02T18:00:00+08:00" },
  poi: { id: "s", name: "星空桌游馆", address: "某路 1 号", lat: 31, lng: 121, type: "休闲娱乐;桌游" },
  experiences: Array.from({ length: 8 }, (_, i) => ({ memberId: `m${i}`, status: "full", lateMin: 0, stayMin: 180, commuteMin: 20, utility: 90, notes: [] })),
  attendCount: 8,
  minUtility: 80,
  avgUtility: 90,
  score: 90,
  headline: "8 人全到",
  tradeoffs: [],
  highlights: [],
  recommended: true,
  cared: 8,
  ...over,
});

const ju = (p: Proposal, over: Partial<Ju> = {}): Ju => ({
  id: "j",
  title: "摄影社聚会",
  rawPrompt: "",
  spec: { category: "桌游", poiKeywords: ["桌游"], dates: ["2030-11-02"], earliest: "15:00", latest: "15:00", durationMinutes: 180, city: "上海" },
  slots: [p.slot],
  status: "confirmed",
  createdAt: "2030-10-30T00:00:00Z",
  votes: {},
  trace: [],
  announcements: [],
  pendingChanges: 0,
  revisions: [],
  confirmedProposalId: p.id,
  plan: {
    proposals: [p],
    recommendation: "",
    why: ["8 个人都照顾到了", "每个到场的人都全程在，最远的路上 28 分钟"],
    constraintSummaries: [],
    center: { lat: 31, lng: 121 },
    audit: { inputHash: "", outputHash: "", candidates: 1, evaluations: 8, paretoSize: 1, algorithmVersion: "t" },
    computedAt: "2030-10-30T00:00:00Z",
  },
  ...over,
});

describe("决定书", () => {
  it("风险 → 大家要做的事（去重）", () => {
    expect(
      groupActionsOf([
        risk("weather", "周六白天预报小雨"),
        risk("weather", "周六夜间预报阵雨"),
        risk("closing", "店 22:00 打烊，我们 21:30 结束"),
        risk("queue", "饭点可能要排队约 20 分钟"),
        risk("lateNight", "23:00 才结束"),
      ]),
    ).toEqual(["记得带伞", "别太晚点单", "先到的人先取号", "结束得晚，回去结伴或打车，到家报个平安"]);
    expect(groupActionsOf([risk("weather", "周六白天预计 35℃")])).toEqual(["注意防暑"]);
    expect(groupActionsOf([risk("closing", "营业时间未知", { confidence: "unknown" })])).toEqual([]);
  });

  it("发起人待办：订位 / 确认营业时间 / 备案 / 生日蛋糕；订好位就不再提醒", () => {
    const p = proposal({
      risks: [risk("closing", "营业时间未知", { confidence: "unknown" })],
      fallback: { trigger: "到时候下雨（前一天局长再确认天气）", poi: { id: "i", name: "室内桌游吧", address: "" }, proposalId: "p2" },
    });
    const acts = organizerActionsOf(ju(p, { title: "小林生日局" }), p, 8);
    expect(acts).toEqual([
      "订位：8 人，建议订大桌或包间",
      "营业时间没查到，出发前打电话确认一下",
      "备案：如果到时候下雨（前一天局长再确认天气），改去「室内桌游吧」",
      "生日局：别忘了蛋糕",
    ]);
    expect(organizerActionsOf(ju(p, { reservation: { status: "booked" } }), p, 8)[0]).not.toMatch(/订位/);
    expect(organizerActionsOf(ju(p), p, 4).some((a) => a.startsWith("订位"))).toBe(false);
  });

  it("定局后看定局方案；结论一行写清时间、地点、人数", () => {
    const d = decisionOf(ju(proposal()))!;
    expect(d.final).toBe(true);
    expect(d.verdict).toBe("11月2日 周六 15:00 · 星空桌游馆 · 8 人");
    expect(d.why[0]).toBe("8 个人都照顾到了");
  });

  it("群公告：结论 → 为什么 → 注意（每条带应对）→ 备案", () => {
    const f: PublicFacts = {
      title: "摄影社聚会",
      category: "桌游",
      city: "上海",
      status: "confirmed",
      members: [],
      counts: { in: 8, done: 8, waitlist: 0, matchPairs: 0 },
      constraintSummaries: [],
      confirmed: {
        slotLabel: "11月2日 周六 15:00",
        poiName: "星空桌游馆",
        address: "某路 1 号",
        headcount: 8,
        why: ["8 个人都照顾到了"],
        risks: [{ text: "周六白天预报小雨", mitigation: "带伞；这家在室内，不受影响" }],
        fallback: { trigger: "雨下大了（中雨及以上）", poiName: "室内桌游吧" },
      },
    };
    const t = confirmedText(f);
    expect(t).toContain("为什么：8 个人都照顾到了");
    expect(t).toContain("· 周六白天预报小雨 → 带伞；这家在室内，不受影响");
    expect(t).toContain("备案：如果雨下大了（中雨及以上），改去「室内桌游吧」");
    expect(t.indexOf("为什么")).toBeLessThan(t.indexOf("注意"));
  });
});

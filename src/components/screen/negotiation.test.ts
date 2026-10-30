import { describe, expect, it } from "vitest";
import type { AvatarLogEntry, Negotiation, NegotiationEvent, Poi, Proposal, Segment } from "@/lib/types";
import {
  CHAR_MS,
  REVOKE_WINDOW_MS,
  avatarSentence,
  buildSchedule,
  canRevoke,
  explainForMe,
  groupByRound,
  mentionedCodes,
  negotiationStats,
  playhead,
  revokeMinutesLeft,
  seatCodes,
  seatStates,
  segmentTimeline,
  segmentsText,
  segmentsTitle,
  speakerLetter,
  speakerTone,
  walkMinutes,
  wallTime,
} from "./negotiation";

const ev = (round: NegotiationEvent["round"], speaker: string, kind: NegotiationEvent["kind"], text: string): NegotiationEvent => ({ round, speaker, kind, text });

const EVENTS: NegotiationEvent[] = [
  ev(0, "局长", "open", "8 个分身交了授权书，其中 3 个有底线。"),
  ev(1, "局长", "propose", "初版：15:00 攀岩 → 18:30 川菜，21:30 结束。"),
  ev(1, "分身 C", "block", "21:30 碰到我的底线。"),
  ev(1, "分身 A", "block", "15:00 我赶不到。"),
  ev(2, "局长", "propose", "晚饭提前到 18:00。分身 C 的卡点解除。还剩分身 A。"),
  ev(2, "分身 A", "concede", "晚到 15 分钟在授权范围内，同意。"),
  ev(3, "局长", "trade", "分身 B 和分身 G 各让一步。"),
  ev(3, "局长", "compensate", "分身 A 让了步，第二段按 A 的口味挑。"),
  ev(4, "局长", "decide", "拍板：15:00 攀岩 → 18:00 家常菜。"),
];

describe("事件分组", () => {
  it("按轮次连续分组，保留原下标", () => {
    const g = groupByRound(EVENTS);
    expect(g.map((x) => x.round)).toEqual([0, 1, 2, 3, 4]);
    expect(g.map((x) => x.label)).toEqual(["交底", "出方案", "让步", "交换与补偿", "拍板"]);
    expect(g[1].events.map((e) => e.index)).toEqual([1, 2, 3]);
    expect(g[4].events[0].index).toBe(8);
  });
  it("空记录返回空", () => {
    expect(groupByRound([])).toEqual([]);
  });
});

describe("代号与配色", () => {
  it("只认「分身 X」格式，局长没有字母", () => {
    expect(speakerLetter("分身 C")).toBe("C");
    expect(speakerLetter("分身C")).toBe("C");
    expect(speakerLetter("局长")).toBeUndefined();
    expect(speakerLetter("小橘")).toBeUndefined();
  });
  it("同一代号永远同一色，不同代号不同色，局长是朱砂", () => {
    expect(speakerTone("分身 A")).toEqual(speakerTone("分身 A"));
    expect(speakerTone("分身 A").fg).not.toBe(speakerTone("分身 B").fg);
    expect(speakerTone("局长")).toMatchObject({ fg: "#e2412e", letter: "局" });
  });
  it("座位补齐到人数，事件里的代号超出时自动扩展", () => {
    expect(seatCodes(EVENTS, 8)).toEqual(["分身 A", "分身 B", "分身 C", "分身 D", "分身 E", "分身 F", "分身 G", "分身 H"]);
    expect(seatCodes(EVENTS, 0).at(-1)).toBe("分身 G");
    expect(seatCodes([ev(1, "分身 J", "block", "x")], 3)).toHaveLength(10);
  });
  it("文字里点到的其他代号", () => {
    expect(mentionedCodes(EVENTS[6])).toEqual(["分身 B", "分身 G"]);
    expect(mentionedCodes(ev(2, "分身 A", "concede", "分身 A 同意"))).toEqual([]);
  });
  it("座位状态：卡点在被点名解除或让步后消失，让步 / 交换 / 补偿留下角标", () => {
    const after1 = seatStates(EVENTS, 3);
    expect(after1["分身 C"].blocked).toBe(true);
    expect(after1["分身 A"].blocked).toBe(true);
    const after2 = seatStates(EVENTS, 4);
    expect(after2["分身 C"].blocked).toBe(false);
    expect(after2["分身 A"].blocked).toBe(true); // "还剩分身 A" 不在"解除"那一句里
    const all = seatStates(EVENTS, EVENTS.length - 1);
    expect(all["分身 A"]).toEqual({ blocked: false, marks: ["concede", "compensate"] });
    expect(all["分身 B"].marks).toEqual(["trade"]);
  });
});

describe("播放时间表", () => {
  it("入座 → 横幅 → 预备 → 打字 → 停顿，结束后是 done", () => {
    const s = buildSchedule(EVENTS);
    expect(playhead(s, 0, EVENTS).phase).toBe("intro");
    const b0 = s.beats[0];
    expect(b0.banner).not.toBeNull();
    expect(playhead(s, b0.banner![0] + 1, EVENTS)).toMatchObject({ phase: "banner", round: 0, step: -1 });
    expect(playhead(s, b0.anticipate[0] + 1, EVENTS)).toMatchObject({ phase: "anticipate", step: 0 });
    const mid = playhead(s, b0.type[0] + CHAR_MS * 3 + 1, EVENTS);
    expect(mid.phase).toBe("typing");
    expect(mid.typed).toBe(4);
    expect(playhead(s, b0.hold[0] + 1, EVENTS)).toMatchObject({ phase: "hold", typed: EVENTS[0].text.length });
    expect(playhead(s, s.total, EVENTS)).toMatchObject({ phase: "done", step: EVENTS.length - 1 });
  });
  it("同一轮的第二条不再出横幅；时间单调", () => {
    const s = buildSchedule(EVENTS);
    expect(s.beats[2].banner).toBeNull();
    for (let i = 1; i < s.beats.length; i++) expect(s.beats[i].anticipate[0]).toBeGreaterThanOrEqual(s.beats[i - 1].hold[1]);
  });
  it("减少动效：不打字，整句直接出现", () => {
    const s = buildSchedule(EVENTS, { reduced: true });
    const b = s.beats[1];
    expect(b.type[1] - b.type[0]).toBe(0);
    expect(playhead(s, b.hold[0], EVENTS).typed).toBe(EVENTS[1].text.length);
  });
  it("确定性：同样输入同样时间表", () => {
    expect(buildSchedule(EVENTS)).toEqual(buildSchedule(EVENTS));
  });
});

describe("结果卡", () => {
  it("聚合数来自 Negotiation 和推荐方案", () => {
    const neg: Negotiation = { events: EVENTS, autoConcessions: 2, asked: 0, trades: 1, outcome: "x" };
    const p = { cared: 8, experiences: Array.from({ length: 8 }, (_, i) => ({ memberId: `m${i}`, status: "full" })) } as unknown as Proposal;
    expect(negotiationStats(neg, p)).toMatchObject({ cared: 8, total: 8, autoConcessions: 2, trades: 1, asked: 0, compensations: 1, rounds: 5 });
  });
});

describe("撤回窗口", () => {
  const now = Date.parse("2026-11-07T02:00:00.000Z");
  const entry = (minAgo: number, extra: Partial<AvatarLogEntry> = {}): AvatarLogEntry => ({
    id: "e",
    at: new Date(now - minAgo * 60_000).toISOString(),
    kind: "concede",
    dim: "lateMin",
    text: "替你让了 15 分钟",
    ...extra,
  });
  it("30 分钟内的自动让步可以撤回", () => {
    expect(canRevoke(entry(0), now)).toBe(true);
    expect(canRevoke(entry(29), now)).toBe(true);
    expect(revokeMinutesLeft(entry(6), now)).toBe(24);
  });
  it("过了 30 分钟、已撤回、不是让步、没有维度的都不行", () => {
    expect(canRevoke(entry(30), now)).toBe(false);
    expect(canRevoke({ ...entry(5), at: new Date(now - REVOKE_WINDOW_MS).toISOString() }, now)).toBe(false);
    expect(canRevoke(entry(5, { revoked: true }), now)).toBe(false);
    expect(canRevoke(entry(5, { kind: "held" }), now)).toBe(false);
    expect(canRevoke(entry(5, { dim: undefined }), now)).toBe(false);
    expect(canRevoke(entry(5, { at: "bad" }), now)).toBe(false);
    expect(revokeMinutesLeft(entry(40), now)).toBe(0);
  });
});

describe("我的分身", () => {
  const log: AvatarLogEntry[] = [
    { id: "1", at: "2026-11-07T02:00:00.000Z", kind: "concede", dim: "lateMin", text: "替你让了 15 分钟：开始时间改到 19:15" },
    { id: "2", at: "2026-11-07T02:00:00.000Z", kind: "held", text: "守住了你的底线：23:00 前到家" },
    { id: "3", at: "2026-11-07T02:00:00.000Z", kind: "gained", text: "争取到了：第二段按你的口味选" },
  ];
  it("称呼：有名字叫你的 X，没有叫你的分身", () => {
    expect(avatarSentence(log[0], "小橘")).toBe("你的小橘替你让了 15 分钟：开始时间改到 19:15");
    expect(avatarSentence(log[0])).toBe("你的分身替你让了 15 分钟：开始时间改到 19:15");
    expect(avatarSentence(log[1], "小橘")).toBe("守住了你的底线：23:00 前到家");
  });
  it("逐人解释：得到 / 让了 / 为什么，只用本人记录", () => {
    const ex = explainForMe(log, ["23:00 前到家", "人均 100 以内"], { cared: 8, total: 8, why: ["两段式"] });
    expect(ex.got).toEqual(["23:00 前到家", "第二段按你的口味选"]);
    expect(explainForMe(log.slice(0, 2), ["23:00 前到家", "人均 100 以内"]).got).toEqual(["23:00 前到家", "人均 100 以内"]);
    expect(ex.gave.map((e) => e.id)).toEqual(["1"]);
    expect(ex.why[0]).toBe("让这一步，换来8 个人都照顾到了");
    expect(ex.why).toContain("两段式");
  });
  it("没让步时为什么只讲结果", () => {
    const ex = explainForMe(log.slice(1), [], { cared: 7, total: 8 });
    expect(ex.gave).toEqual([]);
    expect(ex.why).toEqual(["照顾到 7/8 人"]);
  });
});

describe("两段式时间线", () => {
  const poi = (id: string, name: string, lat: number, lng: number): Poi => ({ id, name, lat, lng, address: "", type: "" });
  const segs: Segment[] = [
    { activity: "climbing", activityName: "攀岩", poi: poi("a", "岩时攀岩馆", 31.1872, 121.4301), start: "2026-11-07T15:00:00+08:00", end: "2026-11-07T17:40:00+08:00" },
    { activity: "homestyle", activityName: "家常菜", poi: poi("b", "弄堂小馆", 31.1851, 121.4335), start: "2026-11-07T18:00:00+08:00", end: "2026-11-07T21:00:00+08:00" },
  ];
  it("墙上时间：带 +08:00 直接截，Z 换算到北京", () => {
    expect(wallTime("2026-11-07T15:00:00+08:00")).toBe("15:00");
    expect(wallTime("2026-11-07T07:00:00.000Z")).toBe("15:00");
  });
  it("步行分钟数", () => {
    expect(walkMinutes(segs[0].poi, segs[1].poi)).toBe(6);
    expect(walkMinutes(segs[0].poi, segs[0].poi)).toBe(1);
  });
  it("两段才出时间线，一段 / 没有返回 undefined", () => {
    expect(segmentTimeline(undefined)).toBeUndefined();
    expect(segmentTimeline(segs.slice(0, 1))).toBeUndefined();
    const tl = segmentTimeline(segs)!;
    expect(tl.items.map((x) => x.t)).toEqual(["seg", "walk", "seg"]);
    expect(tl.endsAt).toBe("21:00");
    expect(tl.items[0]).toMatchObject({ time: "15:00", name: "攀岩", emoji: "🧗" });
  });
  it("一句话", () => {
    expect(segmentsText(segs)).toBe("15:00 攀岩 @ 岩时攀岩馆 → 步行 6 分钟 → 18:00 家常菜 @ 弄堂小馆，21:00 前结束");
    expect(segmentsTitle(segs)).toBe("攀岩 → 家常菜");
    expect(segmentsText(segs.slice(0, 1))).toBeUndefined();
  });
});

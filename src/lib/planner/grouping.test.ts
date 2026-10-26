import { describe, expect, it } from "vitest";
import type { Familiarity, SocialEnergy } from "../types";
import {
  AVOID_COVER,
  adjustText,
  groupingStats,
  majorityFeel,
  nextIntensity,
  pairKey,
  planFormats,
  solveGrouping,
  symmetricFamiliarity,
  tableSizes,
  tableTopics,
  type GroupingInput,
} from "./index";

const KEY = "test-audit-secret";

const person = (id: string, energy: SocialEnergy = "mid", interests: string[] = []) => ({ id, energy, interests });

/** 两个小圈子：a1-a4 互相挺熟，b1-b4 互相挺熟，圈子之间互不认识 */
function twoCliques(over: Partial<GroupingInput> = {}): GroupingInput {
  const a = ["a1", "a2", "a3", "a4"];
  const b = ["b1", "b2", "b3", "b4"];
  const fam: Record<string, Familiarity> = {};
  for (const g of [a, b]) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) fam[pairKey(g[i], g[j])] = 2;
  return {
    people: [...a, ...b].map((id) => person(id)),
    fam,
    together: [],
    avoid: [],
    rounds: 2,
    tableSize: 4,
    ...over,
  };
}

const together = (rounds: string[][][], x: string, y: string) => rounds.reduce((n, r) => n + r.filter((t) => t.includes(x) && t.includes(y)).length, 0);
const tableOf = (round: string[][], x: string) => round.find((t) => t.includes(x))!;

describe("分桌人数", () => {
  it("尽量平均，每桌至少 2 人", () => {
    expect(tableSizes(8, 4)).toEqual([4, 4]);
    expect(tableSizes(9, 4)).toEqual([5, 4]);
    expect(tableSizes(10, 3)).toEqual([4, 3, 3]);
    expect(tableSizes(3, 4)).toEqual([3]);
    expect(tableSizes(5, 2)).toEqual([3, 2]);
    expect(tableSizes(0, 4)).toEqual([]);
  });
});

describe("对称熟悉度：取两边说的较大值", () => {
  it("对方说了挺熟，我标什么都一样", () => {
    for (const mine of [0, 1, 2] as Familiarity[]) {
      const fam = symmetricFamiliarity({ A: { C: mine }, C: { A: 2 } }, ["A", "C"]);
      expect(fam).toEqual({ [pairKey("A", "C")]: 2 });
    }
  });
  it("不在场的人、自己标自己都忽略", () => {
    expect(symmetricFamiliarity({ A: { A: 2, Z: 2, B: 1 } }, ["A", "B"])).toEqual({ [pairKey("A", "B")]: 1 });
  });
});

describe("分组求解", () => {
  it("确定性：同样输入 + 同一个密钥，逐字节相同；成员顺序不影响结果", () => {
    const input = twoCliques();
    const r1 = solveGrouping(input, KEY);
    const r2 = solveGrouping({ ...input, people: [...input.people].reverse() }, KEY);
    expect(r2.rounds).toEqual(r1.rounds);
    expect(r2.outputHash).toBe(r1.outputHash);
    expect(r2.inputHash).toBe(r1.inputHash);
  });

  it("两个熟人圈子：第一轮每人都有熟人当锚点，两轮下来跨圈子的新认识几乎全覆盖", () => {
    const r = solveGrouping(twoCliques(), KEY);
    expect(r.rounds).toHaveLength(2);
    for (const round of r.rounds) expect(round.map((t) => t.length).sort()).toEqual([4, 4]);
    expect(r.stats.everyoneAnchored).toBe(true);
    // 跨圈子 16 对：每轮每桌 2+2 最多 8 对，两轮最多 16 对
    expect(r.stats.newPairs).toBeGreaterThanOrEqual(14);
    expect(r.stats.knownBefore).toBe(12);
    // 每桌都不是"一桌全熟人"
    for (const t of r.rounds[0]) expect(t.some((x) => x.startsWith("a")) && t.some((x) => x.startsWith("b"))).toBe(true);
  });

  it("互选成功的两个人至少同桌一次", () => {
    const r = solveGrouping(twoCliques({ together: [["a1", "b3"]] }), KEY);
    expect(together(r.rounds, "a1", "b3")).toBeGreaterThanOrEqual(1);
    expect(r.stats.matchesSeated).toBe(1);
    expect(r.stats.matchPairs).toBe(1);
  });

  it("社交电量低的人每一轮桌上都有认识的人", () => {
    const input = twoCliques({ rounds: 3, people: twoCliques().people.map((p) => (p.id === "b2" ? person("b2", "low") : p)) });
    const r = solveGrouping(input, KEY);
    for (const round of r.rounds) expect(tableOf(round, "b2").some((x) => x !== "b2" && x.startsWith("b"))).toBe(true);
  });

  it("公开兴趣有交集的陌生人更容易被排到一起", () => {
    const base = twoCliques({ rounds: 1 });
    base.people = base.people.map((p) => (p.id === "a1" || p.id === "b1" ? person(p.id, "mid", ["爬山", "摄影"]) : p));
    const r = solveGrouping(base, KEY);
    expect(together(r.rounds, "a1", "b1")).toBe(1);
  });

  it("30 人 3 轮也很快", () => {
    const people = Array.from({ length: 30 }, (_, i) => person(`p${String(i).padStart(2, "0")}`, i % 5 === 0 ? "low" : "mid"));
    const fam: Record<string, Familiarity> = {};
    for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) if ((i * 7 + j * 3) % 11 === 0) fam[pairKey(people[i].id, people[j].id)] = ((i + j) % 2 ? 1 : 2) as Familiarity;
    const t0 = Date.now();
    const r = solveGrouping({ people, fam, together: [], avoid: [["p01", "p02"]], rounds: 3, tableSize: 5 }, KEY);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(r.rounds).toHaveLength(3);
    for (const round of r.rounds) expect(round.flat().sort()).toEqual(people.map((p) => p.id));
  });
});

describe("悄悄回避：执行，而且藏得住", () => {
  it("回避的两个人从不同桌，从没同桌的对数 ≥ 3 × 回避数", () => {
    const input = twoCliques({ avoid: [["a1", "b2"]], rounds: 2 });
    const r = solveGrouping(input, KEY);
    expect(r.avoidHonored).toBe(true);
    expect(together(r.rounds, "a1", "b2")).toBe(0);
    expect(r.stats.neverTogether).toBeGreaterThanOrEqual(AVOID_COVER);
  });

  it("三轮几乎每对都会遇到：靠诱饵对把掩护补够", () => {
    // 6 人 2 桌 3 轮：不加掩护时，除了回避的那一对，其他人几乎都会同桌一次
    const people = Array.from({ length: 6 }, (_, i) => person(`p${i}`));
    const r = solveGrouping({ people, fam: {}, together: [], avoid: [["p0", "p5"]], rounds: 3, tableSize: 3 }, KEY);
    expect(r.avoidHonored).toBe(true);
    expect(together(r.rounds, "p0", "p5")).toBe(0);
    expect(r.stats.neverTogether).toBeGreaterThanOrEqual(AVOID_COVER);
    expect(r.decoys.length).toBeGreaterThan(0);
    for (const [a, b] of r.decoys) expect(together(r.rounds, a, b)).toBe(0);
  });

  it("藏不住（只有一桌）就不执行，结果和没人提要求时逐字节相同", () => {
    const people = ["x1", "x2", "x3", "x4"].map((id) => person(id));
    const plain = solveGrouping({ people, fam: {}, together: [], avoid: [], rounds: 1, tableSize: 6 }, KEY);
    const asked = solveGrouping({ people, fam: {}, together: [], avoid: [["x1", "x2"]], rounds: 1, tableSize: 6 }, KEY);
    expect(asked.avoidHonored).toBe(false);
    expect(asked.decoys).toEqual([]);
    expect(asked.rounds).toEqual(plain.rounds);
    expect(asked.outputHash).toBe(plain.outputHash);
    expect(asked.evaluations).toBe(plain.evaluations);
  });

  it("回避对象不在场（私下拒绝了 / 没来）时，回避请求完全不影响结果", () => {
    const base = twoCliques();
    const withGhost = solveGrouping({ ...base, avoid: [["a1", "ghost"]] }, KEY);
    const plain = solveGrouping(base, KEY);
    expect(withGhost.rounds).toEqual(plain.rounds);
  });
});

describe("重排：保留已经进行过的轮次，未来轮次尽量少改", () => {
  it("固定的第一轮原样保留，第二轮不重复第一轮的同桌", () => {
    const first = solveGrouping(twoCliques({ rounds: 1 }), KEY).rounds;
    const r = solveGrouping(twoCliques({ rounds: 2, fixed: first }), KEY);
    expect(r.rounds[0]).toEqual(first[0]);
    let repeats = 0;
    for (const t of r.rounds[1]) for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (together(first, t[i], t[j])) repeats++;
    // 两桌各 2+2 时第二轮至少重复 4 对（每桌必有 2 人来自第一轮同一桌），这是下限
    expect(repeats).toBeLessThanOrEqual(4);
  });

  it("有人没来：其他人的未来座位大多不变", () => {
    const input = twoCliques({ rounds: 2 });
    const before = solveGrouping(input, KEY).rounds;
    const after = solveGrouping(
      { ...input, people: input.people.filter((p) => p.id !== "b4"), fixed: [before[0]], prev: before },
      KEY,
    ).rounds;
    expect(after[0]).toEqual(before[0]);
    // 第二轮：原来同桌的对（不含 b4），大部分还在一起
    const keep = before[1].flatMap((t) => t.filter((x) => x !== "b4").flatMap((x, i, arr) => arr.slice(i + 1).map((y) => [x, y] as const)));
    const kept = keep.filter(([x, y]) => together([after[1]], x, y) === 1).length;
    expect(kept / keep.length).toBeGreaterThanOrEqual(0.6);
  });
});

describe("统计数字", () => {
  it("knownBefore / newPairs / neverTogether 按定义算", () => {
    const input = twoCliques({ rounds: 1 });
    const s = groupingStats(input, [[["a1", "a2", "b1", "b2"], ["a3", "a4", "b3", "b4"]]]);
    expect(s).toMatchObject({ people: 8, pairs: 28, knownBefore: 12, newPairs: 8, everyoneAnchored: true, neverTogether: 16 });
  });
});

describe("玩法与话题卡", () => {
  const ctx = { category: "桌游", people: 8, knownRatio: 0.2, lowEnergy: 0, key: KEY };
  it("大家不熟就从最轻松的开始，之后逐轮升温", () => {
    const fs = planFormats(ctx, 3);
    expect(fs.map((f) => f.intensity)).toEqual([1, 2, 3]);
    expect(new Set(fs.map((f) => f.key)).size).toBe(3);
    expect(planFormats({ ...ctx, knownRatio: 0.8 }, 1)[0].intensity).toBe(2);
    expect(planFormats({ ...ctx, knownRatio: 0.8, lowEnergy: 2 }, 1)[0].intensity).toBe(1);
  });

  it("上一轮拘谨 → 留在轻松档；太吵 → 降一档；刚好 → 升一档", () => {
    expect(nextIntensity(2, "stiff")).toBe(1);
    expect(nextIntensity(3, "loud")).toBe(2);
    expect(nextIntensity(1, "ok")).toBe(2);
    expect(majorityFeel({ stiff: 2, ok: 2, loud: 0, total: 4 })).toBe("stiff");
  });

  it("调整说明：样本够才给数字", () => {
    const f = planFormats(ctx, 1)[0];
    expect(adjustText({ stiff: 4, ok: 1, loud: 0, total: 5 }, f, true)).toContain("有 4 位朋友觉得有点拘谨");
    expect(adjustText({ stiff: 2, ok: 0, loud: 0, total: 2 }, f, false)).not.toMatch(/\d/);
  });

  it("话题卡只说至少 2 人共有的公开兴趣", () => {
    const t = tableTopics([["爬山", "摄影"], ["爬山"], ["猫"]], KEY, "r0t0");
    expect(t[0]).toBe("这桌有 2 个人都喜欢「爬山」");
    expect(t.join()).not.toContain("猫");
    expect(t.at(-1)).toMatch(/^话题卡：/);
    expect(tableTopics([["爬山"], ["爬山"]], KEY, "r0t0")).toEqual(tableTopics([["爬山"], ["爬山"]], KEY, "r0t0"));
  });
});

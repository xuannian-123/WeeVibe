// #18 局内编排：把"让半生不熟的人熟起来"写成一个带约束的多目标优化问题
// （社交高尔夫球手问题 social golfer problem 的变体：多轮分桌，尽量让没同过桌的人坐到一起）。
//
// 目标（全部是可计算的代理指标，不宣称能算出真实友谊）：
//   + 新交流机会：之前互不认识的两个人第一次同桌（见过几次的少加一点，挺熟的几乎不加）
//   + 共同话题：之前不熟、但公开兴趣有交集的两个人同桌
//   - 重复同桌：同一对人多轮坐一起（轮换）
//   - 没有锚点：第一轮谁的桌上都要有一位认识的人；社交电量低的人每一轮都要有
//   - 熟人抱团：一桌全是互相认识的人
//   - 互选成功的两个人一次都没同桌
//   - 悄悄回避的两个人同桌（几乎是硬约束）
//   - 重排时和上一版差太多（中途有人没来 / 按反馈调整时尽量少改）
// 求解：带密钥的多起点 + 最陡下降局部搜索（两人换桌），增量计算分数。
//
// 确定性：同样的输入 + 同一个密钥 → 逐字节同样的输出。不用 Math.random，随机性全部来自 HMAC(密钥, 标签)，
// 所以发起人能一键复算，而不知道密钥的人既不能复算也不能预测。
//
// 隐私（CONTRACT 第十节）：
//   1. 熟悉度先对称化：fam(i,j) = max(i 说的, j 说的)。"你觉得我们挺熟、我觉得不熟"这个尴尬方向永远体现不出来：
//      只要对方说了挺熟，我自己标什么都不影响结果。
//   2. 单方面"想认识"不进算法，只有互选成功的才进。
//   3. 悄悄回避：不同桌是硬约束，同时保证"从没同桌的对数 ≥ 3 × 回避数"——不够就用密钥随机抽诱饵对一起分开。
//      于是任何一对没同过桌的人，是因为有人悄悄提了要求的比例不超过 1/3。藏不住（比如只有一桌）就干脆不执行。
import type { Familiarity, SocialEnergy } from "../types";
import { canonicalJson, cmpStr, hmacHex, sha256Hex } from "./util";

export const GROUPING_VERSION = "juzhang-grouping/1.0";

/** 回避请求的掩护倍数：从没同桌的对数 ≥ COVER × 回避数 */
export const AVOID_COVER = 3;

export type GroupingPerson = {
  id: string;
  energy: SocialEnergy;
  /** 自愿公开的兴趣（已规范化） */
  interests: string[];
};

export type GroupingInput = {
  people: GroupingPerson[];
  /** 对称化后的熟悉度：键 pairKey(a, b)；没出现 = 0 */
  fam: Record<string, Familiarity>;
  /** 互选成功：至少同桌一次 */
  together: [string, string][];
  /** 悄悄回避：不同桌 */
  avoid: [string, string][];
  rounds: number;
  tableSize: number;
  /** 已经进行过（或正在进行）的轮次：原样保留，只参与"谁和谁同过桌"的计数 */
  fixed?: string[][][];
  /** 上一版的完整安排：重排时未来轮次尽量少改 */
  prev?: string[][][];
  /** 未来轮次锚点的加强倍数（上一轮多数人觉得拘谨 → 1.6） */
  anchorBoost?: number;
};

export type GroupingStats = {
  people: number;
  pairs: number;
  knownBefore: number;
  newPairs: number;
  everyoneAnchored: boolean;
  matchesSeated: number;
  matchPairs: number;
  neverTogether: number;
};

export type GroupingResult = {
  /** round -> table -> memberIds（桌内按 id 排序） */
  rounds: string[][][];
  stats: GroupingStats;
  /** 回避是否执行了（藏不住时不执行）。仅服务端 */
  avoidHonored: boolean;
  /** 为掩护回避而一起分开的诱饵对。仅服务端，绝不出接口 */
  decoys: [string, string][];
  restarts: number;
  evaluations: number;
  inputHash: string;
  outputHash: string;
};

// ---------------------------------------------------------------- 小工具

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** 规范化兴趣标签：去空白、去重、最多 6 个、每个最多 12 字 */
export function normalizeInterests(xs: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of xs ?? []) {
    const t = String(raw).replace(/\s+/g, "").replace(/^#/, "").slice(0, 12).toLowerCase();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * 每个人的单方面标记 → 对称熟悉度：fam = max(两边说的)。只保留 ids 里的人之间的对。
 * marks[i][j] = i 觉得和 j 多熟。
 */
export function symmetricFamiliarity(
  marks: Record<string, Record<string, Familiarity> | undefined>,
  ids: readonly string[],
): Record<string, Familiarity> {
  const set = new Set(ids);
  const out: Record<string, Familiarity> = {};
  for (const i of [...ids].sort(cmpStr)) {
    for (const [j, v] of Object.entries(marks[i] ?? {})) {
      if (j === i || !set.has(j) || (v !== 1 && v !== 2)) continue;
      const k = pairKey(i, j);
      if ((out[k] ?? 0) < v) out[k] = v;
    }
  }
  return out;
}

/** mulberry32：种子来自 HMAC(密钥, 标签)，可复现、不可预测 */
function keyedRng(key: string, label: string): () => number {
  let a = parseInt(hmacHex(key, label).slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** n 个人、目标每桌 size 人 → 每桌人数（尽量平均，每桌至少 2 人） */
export function tableSizes(n: number, size: number): number[] {
  if (n <= 0) return [];
  let t = Math.max(1, Math.round(n / Math.max(2, size)));
  while (t > 1 && Math.floor(n / t) < 2) t--;
  const base = Math.floor(n / t);
  const extra = n % t;
  return Array.from({ length: t }, (_, i) => base + (i < extra ? 1 : 0));
}

// ---------------------------------------------------------------- 权重

const W_NEW: Record<Familiarity, number> = { 0: 10, 1: 4, 2: 0.5 };
const W_INTEREST = 1.5;
const W_REPEAT = 6;
const W_MATCH_MISS = 30;
const W_SEPARATE = 80;
// 锚点和回避同级、接近硬约束：产品承诺"第一轮每人桌上都有认识的人""想安静点的人每一轮都留熟人"，
// 一次换座通常牵动 4 对左右的新认识（≈ 40 分），锚点必须比这个重，不能被拿去换
const W_ANCHOR_FIRST = 80;
const W_ANCHOR_LOW = 80;
const W_ANCHOR_MID = 3;
const W_CLIQUE = 8;
const W_STABLE = 2;

// ---------------------------------------------------------------- 求解器

type Model = {
  n: number;
  ids: string[];
  fam: Uint8Array; // n*n
  sep: Uint8Array; // n*n：回避 + 诱饵
  match: Uint8Array; // n*n
  newVal: Float64Array; // n*n：第一次同桌的价值
  knowsAny: Uint8Array; // n：在场的人里至少认识一位
  energy: SocialEnergy[];
  /** 已固定轮次里每对同桌的次数 */
  baseCount: Int32Array;
  fixedRounds: number;
  varRounds: number;
  sizes: number[];
  /** prevMates[v][i] = 上一版第 v 个未来轮次里 i 的同桌（下标），没有上一版为 undefined */
  prevMates: (Set<number>[] | undefined)[];
  anchorBoost: number;
};

function buildModel(input: GroupingInput, sep: Set<string>): Model {
  const people = [...input.people].sort((a, b) => cmpStr(a.id, b.id));
  const ids = people.map((p) => p.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const fam = new Uint8Array(n * n);
  const sepA = new Uint8Array(n * n);
  const match = new Uint8Array(n * n);
  const newVal = new Float64Array(n * n);
  const set2 = (arr: Uint8Array, i: number, j: number, v: number) => {
    arr[i * n + j] = v;
    arr[j * n + i] = v;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const k = pairKey(ids[i], ids[j]);
      const f = (input.fam[k] ?? 0) as Familiarity;
      set2(fam, i, j, f);
      if (sep.has(k)) set2(sepA, i, j, 1);
      const shared = people[i].interests.filter((x) => people[j].interests.includes(x)).length;
      const v = W_NEW[f] + (f <= 1 ? W_INTEREST * Math.min(2, shared) : 0);
      newVal[i * n + j] = v;
      newVal[j * n + i] = v;
    }
  }
  for (const [a, b] of input.together) {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i !== undefined && j !== undefined && i !== j) set2(match, i, j, 1);
  }
  const knowsAny = new Uint8Array(n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && fam[i * n + j] >= 1) knowsAny[i] = 1;

  const fixed = input.fixed ?? [];
  const baseCount = new Int32Array(n * n);
  for (const round of fixed) {
    for (const table of round) {
      const ms = table.map((id) => idx.get(id)).filter((x): x is number => x !== undefined);
      for (let a = 0; a < ms.length; a++)
        for (let b = a + 1; b < ms.length; b++) {
          baseCount[ms[a] * n + ms[b]]++;
          baseCount[ms[b] * n + ms[a]]++;
        }
    }
  }
  const varRounds = Math.max(0, input.rounds - fixed.length);
  const prevMates: (Set<number>[] | undefined)[] = [];
  for (let v = 0; v < varRounds; v++) {
    const round = input.prev?.[fixed.length + v];
    if (!round) {
      prevMates.push(undefined);
      continue;
    }
    const mates = Array.from({ length: n }, () => new Set<number>());
    for (const table of round) {
      const ms = table.map((id) => idx.get(id)).filter((x): x is number => x !== undefined);
      for (const a of ms) for (const b of ms) if (a !== b) mates[a].add(b);
    }
    prevMates.push(mates);
  }
  return {
    n,
    ids,
    fam,
    sep: sepA,
    match,
    newVal,
    knowsAny,
    energy: people.map((p) => p.energy),
    baseCount,
    fixedRounds: fixed.length,
    varRounds,
    sizes: tableSizes(n, input.tableSize),
    prevMates,
    anchorBoost: input.anchorBoost ?? 1,
  };
}

/** 一对人同桌 c 次的分数 */
function pairScore(m: Model, i: number, j: number, c: number): number {
  const k = i * m.n + j;
  if (m.sep[k]) return -W_SEPARATE * c;
  let v = c >= 1 ? m.newVal[k] : 0;
  if (c >= 2) v -= W_REPEAT * (c - 1);
  if (m.match[k] && c === 0) v -= W_MATCH_MISS;
  return v;
}

/** 一桌在第 r 个绝对轮次里的锚点 / 抱团 / 稳定性分数 */
function tableScore(m: Model, absRound: number, varRound: number, table: number[]): number {
  const n = m.n;
  let s = 0;
  let allFamiliar = table.length >= 3;
  for (let a = 0; a < table.length; a++) {
    const i = table[a];
    let best = 0;
    for (let b = 0; b < table.length; b++) {
      if (a === b) continue;
      const f = m.fam[i * n + table[b]];
      if (f > best) best = f;
      if (b > a && f === 0) allFamiliar = false;
    }
    if (m.knowsAny[i] && best === 0) {
      if (absRound === 0) s -= W_ANCHOR_FIRST * m.anchorBoost;
      else if (m.energy[i] === "low") s -= W_ANCHOR_LOW * m.anchorBoost;
      else if (m.energy[i] === "mid") s -= (m.anchorBoost > 1 ? W_ANCHOR_LOW : W_ANCHOR_MID) * m.anchorBoost;
    } else if (best === 2 && m.energy[i] === "low") {
      s += 1;
    }
  }
  if (allFamiliar) s -= W_CLIQUE;
  const prev = m.prevMates[varRound];
  if (prev) {
    const here = new Set(table);
    for (const i of table) for (const j of prev[i]) if (!here.has(j)) s -= W_STABLE;
  }
  return s;
}

type State = {
  /** tables[v][t] = 下标列表 */
  tables: number[][][];
  /** pos[v][i] = 桌号 */
  pos: Int32Array[];
  count: Int32Array;
};

function initState(m: Model, rnd: () => number): State {
  const count = Int32Array.from(m.baseCount);
  const tables: number[][][] = [];
  const pos: Int32Array[] = [];
  for (let v = 0; v < m.varRounds; v++) {
    const order = shuffled(
      Array.from({ length: m.n }, (_, i) => i),
      rnd,
    );
    const ts: number[][] = [];
    const p = new Int32Array(m.n);
    let k = 0;
    m.sizes.forEach((size, t) => {
      const tb = order.slice(k, k + size);
      k += size;
      for (const i of tb) p[i] = t;
      ts.push(tb);
    });
    for (const tb of ts)
      for (let a = 0; a < tb.length; a++)
        for (let b = a + 1; b < tb.length; b++) {
          count[tb[a] * m.n + tb[b]]++;
          count[tb[b] * m.n + tb[a]]++;
        }
    tables.push(ts);
    pos.push(p);
  }
  return { tables, pos, count };
}

function totalScore(m: Model, st: State): number {
  let s = 0;
  for (let i = 0; i < m.n; i++) for (let j = i + 1; j < m.n; j++) s += pairScore(m, i, j, st.count[i * m.n + j]);
  for (let v = 0; v < m.varRounds; v++) for (const tb of st.tables[v]) s += tableScore(m, m.fixedRounds + v, v, tb);
  return s;
}

/** 第 v 轮把 a、b 换桌的分数变化（不改状态） */
function swapDelta(m: Model, st: State, v: number, a: number, b: number): number {
  const n = m.n;
  const ta = st.pos[v][a];
  const tb = st.pos[v][b];
  const A = st.tables[v][ta];
  const B = st.tables[v][tb];
  let d = 0;
  // 成对计数的变化：a 离开 A、进入 B；b 反之
  for (const x of A) {
    if (x === a) continue;
    const ca = st.count[a * n + x];
    const cb = st.count[b * n + x];
    d += pairScore(m, a, x, ca - 1) - pairScore(m, a, x, ca);
    d += pairScore(m, b, x, cb + 1) - pairScore(m, b, x, cb);
  }
  for (const y of B) {
    if (y === b) continue;
    const cb = st.count[b * n + y];
    const ca = st.count[a * n + y];
    d += pairScore(m, b, y, cb - 1) - pairScore(m, b, y, cb);
    d += pairScore(m, a, y, ca + 1) - pairScore(m, a, y, ca);
  }
  const abs = m.fixedRounds + v;
  const newA = A.map((x) => (x === a ? b : x));
  const newB = B.map((y) => (y === b ? a : y));
  d += tableScore(m, abs, v, newA) + tableScore(m, abs, v, newB) - tableScore(m, abs, v, A) - tableScore(m, abs, v, B);
  return d;
}

function applySwap(m: Model, st: State, v: number, a: number, b: number): void {
  const n = m.n;
  const ta = st.pos[v][a];
  const tb = st.pos[v][b];
  const A = st.tables[v][ta];
  const B = st.tables[v][tb];
  for (const x of A) {
    if (x === a) continue;
    st.count[a * n + x]--;
    st.count[x * n + a]--;
    st.count[b * n + x]++;
    st.count[x * n + b]++;
  }
  for (const y of B) {
    if (y === b) continue;
    st.count[b * n + y]--;
    st.count[y * n + b]--;
    st.count[a * n + y]++;
    st.count[y * n + a]++;
  }
  A[A.indexOf(a)] = b;
  B[B.indexOf(b)] = a;
  st.pos[v][a] = tb;
  st.pos[v][b] = ta;
}

const MAX_PASSES = 500;

/** 最陡下降：每次做分数提升最大的那个换位，直到没有能提升的。返回评估次数 */
function descend(m: Model, st: State): number {
  let evals = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let best = 1e-9;
    let bv = -1;
    let ba = -1;
    let bb = -1;
    for (let v = 0; v < m.varRounds; v++) {
      for (let a = 0; a < m.n; a++) {
        for (let b = a + 1; b < m.n; b++) {
          if (st.pos[v][a] === st.pos[v][b]) continue;
          evals++;
          const d = swapDelta(m, st, v, a, b);
          if (d > best) {
            best = d;
            bv = v;
            ba = a;
            bb = b;
          }
        }
      }
    }
    if (bv < 0) break;
    applySwap(m, st, bv, ba, bb);
  }
  return evals;
}

function restartsFor(n: number): number {
  return n <= 6 ? 6 : n <= 14 ? 10 : 8;
}

/** 每个起点收敛后的扰动次数（迭代局部搜索：踢几下再下降，跳出局部最优） */
function kicksFor(n: number): number {
  return n <= 14 ? 12 : 6;
}

function cloneState(st: State): State {
  return { tables: st.tables.map((r) => r.map((t) => [...t])), pos: st.pos.map((p) => Int32Array.from(p)), count: Int32Array.from(st.count) };
}

/** 随机换 2 对人（同一轮、不同桌） */
function kick(m: Model, st: State, rnd: () => number): void {
  if (m.varRounds === 0 || m.sizes.length < 2) return;
  for (let k = 0; k < 2; k++) {
    const v = Math.floor(rnd() * m.varRounds);
    const a = Math.floor(rnd() * m.n);
    let b = Math.floor(rnd() * m.n);
    for (let guard = 0; st.pos[v][a] === st.pos[v][b] && guard < m.n; guard++) b = (b + 1) % m.n;
    if (st.pos[v][a] !== st.pos[v][b]) applySwap(m, st, v, a, b);
  }
}

type Solved = { st: State; score: number; evaluations: number; restarts: number };

function solve(m: Model, key: string, tag: string): Solved {
  const restarts = restartsFor(m.n);
  const kicks = kicksFor(m.n);
  let best: State | undefined;
  let bestScore = -Infinity;
  let evaluations = 0;
  for (let s = 0; s < restarts; s++) {
    const rnd = keyedRng(key, `${tag}:start:${s}`);
    let st = initState(m, rnd);
    evaluations += descend(m, st);
    let score = totalScore(m, st);
    for (let k = 0; k < kicks; k++) {
      const trial = cloneState(st);
      kick(m, trial, rnd);
      evaluations += descend(m, trial);
      const ts = totalScore(m, trial);
      if (ts > score + 1e-9) {
        st = trial;
        score = ts;
      }
    }
    // 严格大于才替换：平分时保留先找到的（确定性）
    if (score > bestScore + 1e-9) {
      best = st;
      bestScore = score;
    }
  }
  return { st: best ?? initState(m, keyedRng(key, `${tag}:empty`)), score: bestScore, evaluations, restarts };
}

// ---------------------------------------------------------------- 对外入口

function present(input: GroupingInput): Set<string> {
  return new Set(input.people.map((p) => p.id));
}

/** 只保留两个人都在场的对，去重、规范化 */
function cleanPairs(pairs: [string, string][], ids: Set<string>): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const [a, b] of pairs) {
    if (a === b || !ids.has(a) || !ids.has(b)) continue;
    const k = pairKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a < b ? [a, b] : [b, a]);
  }
  return out.sort((x, y) => cmpStr(pairKey(...x), pairKey(...y)));
}

/** 规范化输入：只留在场的人之间的对、排好序。哈希和求解都用它 */
export function canonicalInput(input: GroupingInput): GroupingInput {
  const ids = present(input);
  const fam: Record<string, Familiarity> = {};
  for (const [k, v] of Object.entries(input.fam)) {
    const [a, b] = k.split("|");
    if (ids.has(a) && ids.has(b) && (v === 1 || v === 2)) fam[k] = v;
  }
  const out: GroupingInput = {
    people: [...input.people]
      .map((p) => ({ id: p.id, energy: p.energy, interests: normalizeInterests(p.interests) }))
      .sort((a, b) => cmpStr(a.id, b.id)),
    fam,
    together: cleanPairs(input.together, ids),
    avoid: cleanPairs(input.avoid, ids),
    rounds: Math.max(1, Math.min(3, Math.round(input.rounds))),
    tableSize: Math.max(2, Math.min(12, Math.round(input.tableSize))),
  };
  if (input.fixed?.length) out.fixed = input.fixed.map((r) => r.map((t) => [...t].sort(cmpStr)));
  if (input.prev?.length) out.prev = input.prev.map((r) => r.map((t) => [...t].sort(cmpStr)));
  if (input.anchorBoost && input.anchorBoost !== 1) out.anchorBoost = input.anchorBoost;
  return out;
}

function roundsOut(m: Model, st: State, fixed: string[][][]): string[][][] {
  const out: string[][][] = fixed.map((r) => r.map((t) => [...t]));
  for (let v = 0; v < m.varRounds; v++) {
    const tables = st.tables[v].map((tb) => tb.map((i) => m.ids[i]).sort(cmpStr));
    // 桌的顺序：按桌里最小的 id（确定性，和求解时的初始顺序无关）
    tables.sort((a, b) => cmpStr(a[0] ?? "", b[0] ?? ""));
    out.push(tables);
  }
  return out;
}

function countsOf(rounds: string[][][]): Map<string, number> {
  const c = new Map<string, number>();
  for (const r of rounds)
    for (const t of r)
      for (let a = 0; a < t.length; a++) for (let b = a + 1; b < t.length; b++) c.set(pairKey(t[a], t[b]), (c.get(pairKey(t[a], t[b])) ?? 0) + 1);
  return c;
}

/** 在场的人之间从没同桌的对 */
function neverPairs(ids: string[], rounds: string[][][]): string[] {
  const c = countsOf(rounds);
  const out: string[] = [];
  const sorted = [...ids].sort(cmpStr);
  for (let a = 0; a < sorted.length; a++) for (let b = a + 1; b < sorted.length; b++) if (!c.get(pairKey(sorted[a], sorted[b]))) out.push(pairKey(sorted[a], sorted[b]));
  return out;
}

export function groupingStats(input: GroupingInput, rounds: string[][][]): GroupingStats {
  const ids = [...present(input)].sort(cmpStr);
  const n = ids.length;
  const c = countsOf(rounds);
  let knownBefore = 0;
  let newPairs = 0;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const k = pairKey(ids[a], ids[b]);
      const f = input.fam[k] ?? 0;
      if (f >= 1) knownBefore++;
      else if (c.get(k)) newPairs++;
    }
  // 第一轮的锚点：在场的人里认识至少一位的，桌上都要有认识的人
  const knows = (i: string) => ids.some((j) => j !== i && (input.fam[pairKey(i, j)] ?? 0) >= 1);
  const first = rounds[0] ?? [];
  const everyoneAnchored = ids.every((i) => {
    if (!knows(i)) return true;
    const table = first.find((t) => t.includes(i));
    return !!table && table.some((j) => j !== i && (input.fam[pairKey(i, j)] ?? 0) >= 1);
  });
  const matches = cleanPairs(input.together, new Set(ids));
  return {
    people: n,
    pairs: (n * (n - 1)) / 2,
    knownBefore,
    newPairs,
    everyoneAnchored,
    matchesSeated: matches.filter(([a, b]) => c.get(pairKey(a, b))).length,
    matchPairs: matches.length,
    neverTogether: neverPairs(ids, rounds).length,
  };
}

/**
 * 主入口：给定输入和密钥（每个局自己的 auditSecret），出多轮分桌。
 * 回避请求带诱饵掩护；掩护不够就不执行回避（宁可不照顾，也不暴露）。
 */
export function solveGrouping(raw: GroupingInput, key: string): GroupingResult {
  const input = canonicalInput(raw);
  const ids = input.people.map((p) => p.id);
  const fixed = input.fixed ?? [];
  const inputHash = hmacHex(key, canonicalJson(input));
  // 公开的评估次数只记最后一次求解：诱饵迭代了几次本身也是信号（说明有人提过回避），不能从审计数字里看出来
  let evaluations = 0;
  let restarts = 0;

  const run = (sep: Set<string>, tag: string) => {
    const m = buildModel(input, sep);
    const r = solve(m, key, tag);
    evaluations = r.evaluations;
    restarts = r.restarts;
    return roundsOut(m, r.st, fixed);
  };

  const avoidKeys = input.avoid.map(([a, b]) => pairKey(a, b));
  let rounds = run(new Set(avoidKeys), "main");
  let decoys: string[] = [];
  let avoidHonored = avoidKeys.length > 0;

  if (avoidKeys.length > 0) {
    const need = AVOID_COVER * avoidKeys.length;
    const matchKeys = new Set(input.together.map(([a, b]) => pairKey(a, b)));
    const rnd = keyedRng(key, `decoy:${inputHash}`);
    for (let iter = 0; iter < 4; iter++) {
      const c = countsOf(rounds);
      const violated = avoidKeys.some((k) => c.get(k));
      const never = neverPairs(ids, rounds);
      if (!violated && never.length >= need) break;
      if (violated) {
        avoidHonored = false;
        break;
      }
      // 从"现在同桌过、又不是互选 / 回避"的对里，用密钥随机抽诱饵，和回避对一起分开
      const pool = shuffled(
        [...c.entries()].filter(([k, v]) => v > 0 && !matchKeys.has(k) && !avoidKeys.includes(k) && !decoys.includes(k)).map(([k]) => k).sort(cmpStr),
        rnd,
      );
      const fixedCounts = countsOf(fixed);
      const fresh = pool.filter((k) => !fixedCounts.get(k)).slice(0, need - never.length);
      if (!fresh.length) {
        avoidHonored = false;
        break;
      }
      decoys = [...decoys, ...fresh];
      rounds = run(new Set([...avoidKeys, ...decoys]), `decoy:${iter}`);
      avoidHonored = true;
    }
    const c = countsOf(rounds);
    if (avoidKeys.some((k) => c.get(k)) || neverPairs(ids, rounds).length < need) avoidHonored = false;
    if (!avoidHonored) {
      // 藏不住：回避和诱饵都不执行。用和"没人提回避"完全相同的标签重算，结果逐字节一样，看不出任何人提过要求
      decoys = [];
      rounds = run(new Set(), "main");
    }
  }

  const outputHash = sha256Hex(canonicalJson(rounds));
  return {
    rounds,
    stats: groupingStats(input, rounds),
    avoidHonored,
    decoys: decoys.map((k) => k.split("|") as [string, string]),
    restarts,
    evaluations,
    inputHash,
    outputHash,
  };
}

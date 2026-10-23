// 反事实泄露检验（CONTRACT 第二节第 7 条）。privacy.test.ts 和 GET /api/privacy/selftest 共用这一份逻辑。
//
// 每个随机场景（种子化伪随机，可复现；mock 地图；不调 LLM）跑 4 类检验：
//   1. 交换检验：造两个公开信息完全相同的成员 A、B，私密信息不同；生成全部公开输出
//      （JuState 公开视图含 plan / trace / 群公告、PublicFacts、规则版群消息、B1 规则版润色和群消息），再把 A、B 的私密信息对调重跑。
//      私密信息只能以"对称的聚合"影响公开输出，所以两份输出必须逐字节相同。
//   2. 可否认缺席：私下说不来的人，不管他私下说了什么、从哪来、第几圈，对外和"压根没来过"逐字节相同
//      （门限未达成时，和"还没回"逐字节相同）。
//   3. 字面检验：私密备注原文、私密预算数字（因果判定：换一个预算数字它就消失）、不在场的人名、
//      各种 token / 密钥 / profileId、圈层标签，都不能出现在任何公开输出里；公开 JSON 里不能有私密字段名。
//   4. 身份隔离：带 C 的 token 只能拿到 C 自己的 private；拿不到 secret；带错 token 什么都没有；没有 admin token 就没有 ju.admin。
// 这里调用的 computePlan / evalQuorum / publicState / publicFacts 就是线上跑的那一份。
import { ruleGroupMessages as b1GroupMessages, rulePolishPlan } from "../llm";
import { createMockMapProvider } from "../map";
import { buildSwipeDeck, generateSlots } from "../planner";
import type { JuPrivate } from "../db";
import type {
  DayAvailability,
  DietTag,
  Ju,
  JuSpec,
  LedgerEntry,
  MapProvider,
  Member,
  MemberPrivate,
  Poi,
  PrivacySelfTest,
  SeedMember,
  SwipeVerdict,
} from "../types";
import { publicFacts, publicState, quorumHidden, scanText, sensitiveOf, stringsIn, type Sensitive } from "./firewall";
import { computePlan, confirmProposal, emptyPrivate, evalQuorum, inOnly } from "./ju-core";
import { ruleGroupMessages } from "./ju-text";

// ---------------------------------------------------------------- 伪随机

/** mulberry32：种子化、可复现 */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const chance = (r: Rng, p: number) => r() < p;
function shuffle<T>(r: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------- 场景

// 名字之间互不为子串，也不会出现在店名里
const NAMES = ["阿杰", "小林", "老王", "小周", "阿May", "大刘", "阿Ben", "小Kiki", "老Joe", "阿Sam", "大Tom", "小Vivi", "阿Leo", "老Max"];
const SEED_NAMES = ["群友Ada", "群友Bob", "群友Cat", "群友Dan"];
// 私密预算用不太"整"的数字，方便字面检验
const BUDGETS = [67, 83, 97, 113, 127, 143, 157, 173, 187];
const NOTES = [
  "这周在减肥别太油",
  "最近手头有点紧",
  "前任也在别安排挨着",
  "胃不太好不能吃太冰",
  "想早点回去追剧",
  "宿舍门禁比较早",
  "不想喝酒怕被劝",
  "腿受伤了不想走太远",
];
const DIETS: DietTag[] = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"];
const FROMS = ["17:30", "18:00", "18:30", "19:00"];
const HOMES = [undefined, "21:30", "22:00", "23:00"];
const CATS: [string, string[]][] = [
  ["火锅", ["火锅"]],
  ["烧烤", ["烧烤"]],
  ["日料", ["日本料理"]],
  ["桌游", ["桌游"]],
];
// 上海徐汇一带
const CENTER = { lat: 31.1676, lng: 121.432 };
const NOW = new Date("2026-10-28T10:00:00+08:00");

export type Scenario = {
  seed: number;
  ju: Ju;
  members: Member[];
  ledgers: Record<string, LedgerEntry[]>;
  /** 交换检验的两个人 */
  a: string;
  b: string;
  /** 可否认缺席检验的那个人（status = out） */
  x?: string;
  /** 出方案后是否直接定局 */
  confirm: boolean;
};

function randomAvailability(r: Rng, dates: string[]): Record<string, DayAvailability> {
  const out: Record<string, DayAvailability> = {};
  for (const d of dates) {
    if (chance(r, 0.15)) continue; // 那天不行
    const homeBy = pick(r, HOMES);
    out[d] = { from: pick(r, FROMS), ...(homeBy ? { homeBy } : {}), pref: pick(r, ["best", "ok", "meh"] as const) };
  }
  return out;
}

/** 只含"完全隐藏"的私密字段：对外只能以对称聚合的方式起作用 */
function randomHidden(r: Rng, deck: Poi[], others: string[]): Partial<MemberPrivate> {
  const swipes: Record<string, SwipeVerdict> = {};
  for (const p of deck) if (chance(r, 0.8)) swipes[p.id] = pick(r, ["love", "like", "pass"] as const);
  const h: Partial<MemberPrivate> = {
    dietTags: DIETS.filter(() => chance(r, 0.15)),
    notes: NOTES.filter(() => chance(r, 0.2)),
    swipes,
    wants: others.filter(() => chance(r, 0.3)),
    billFacts: chance(r, 0.3) ? { noAlcohol: true } : {},
    chat: [{ role: "me", text: pick(r, NOTES), at: NOW.toISOString() }],
  };
  if (chance(r, 0.7)) h.budgetMax = pick(r, BUDGETS);
  return h;
}

function randomLedger(r: Rng): LedgerEntry[] {
  const n = Math.floor(r() * 4);
  return Array.from({ length: n }, (_, i) => {
    const commuteMin = 15 + Math.floor(r() * 45);
    const avgCommuteMin = 20 + Math.floor(r() * 10);
    const utility = 40 + Math.floor(r() * 60);
    return {
      juId: `past-${i}`,
      at: new Date(NOW.getTime() - (i + 1) * 7 * 86400_000).toISOString(),
      commuteMin,
      avgCommuteMin,
      utility,
      regret: Math.max(0, 100 - utility + Math.max(0, commuteMin - avgCommuteMin)),
    };
  });
}

function near(r: Rng, km: number) {
  const ang = r() * Math.PI * 2;
  const d = 0.5 + r() * km;
  return {
    lat: +(CENTER.lat + (d * Math.cos(ang)) / 111.32).toFixed(5),
    lng: +(CENTER.lng + (d * Math.sin(ang)) / (111.32 * Math.cos((CENTER.lat * Math.PI) / 180))).toFixed(5),
  };
}

/** 生成一个随机场景（只依赖 seed） */
export async function genScenario(seed: number, map: MapProvider): Promise<Scenario> {
  const r = rngOf(seed);
  const [category, poiKeywords] = pick(r, CATS);
  const dates = chance(r, 0.5) ? ["2026-10-30"] : ["2026-10-30", "2026-10-31"];
  const spec: JuSpec = {
    category,
    poiKeywords,
    dates,
    earliest: "18:00",
    latest: pick(r, ["19:00", "19:30"]),
    durationMinutes: 120,
    city: "上海",
    ...(chance(r, 0.5) ? { budgetPerPerson: pick(r, [80, 100, 150]) } : {}),
  };
  const tierCount = 1 + Math.floor(r() * 3);
  const juId = `pt${seed}`;
  const ju: Ju = {
    id: juId,
    title: `${category}局`,
    rawPrompt: `周五 ${category}`,
    organizerName: "组织者",
    spec,
    slots: generateSlots(spec),
    status: "collecting",
    createdAt: NOW.toISOString(),
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
    admin: {
      tiers: Array.from({ length: tierCount }, (_, i) => ({
        token: `tiertok${seed}x${i + 1}`,
        tier: i + 1,
        label: ["核心圈", "好友圈", "扩展圈"][i],
        ...(i === 0 || chance(r, 0.5) ? { openedAt: NOW.toISOString() } : {}),
      })),
      auditSecret: `audit-secret-${seed}`,
    },
  };

  const n = 3 + Math.floor(r() * 5); // 其他人
  const names = shuffle(r, NAMES).slice(0, n + 2);
  const shared = { location: { ...near(r, 8), label: "同一个地方" }, availability: randomAvailability(r, dates) };
  if (Object.keys(shared.availability).length === 0) shared.availability[dates[0]] = { from: "18:00", pref: "ok" };

  const members: Member[] = [];
  const mk = (i: number, name: string): Member => ({
    id: `${juId}m${i}`,
    juId,
    name,
    avatar: "🙂",
    role: "guest",
    intake: "done",
    status: "in",
    joinedAt: new Date(NOW.getTime() - 3600_000 + i * 1000).toISOString(),
    isOrganizer: i === 0,
    private: emptyPrivate(),
    secret: { token: `memtok${seed}x${i}`, tier: 1 },
  });
  // 0 号是发起人；A、B 是交换对；其余随机
  for (let i = 0; i < n + 2; i++) members.push(mk(i, names[i]));
  const A = members[1];
  const B = members[2];
  for (const m of members) {
    const isPair = m === A || m === B;
    m.location = isPair ? { ...shared.location } : { ...near(r, 9), label: `出发点${m.id}` };
    m.private!.availability = isPair ? structuredClone(shared.availability) : randomAvailability(r, dates);
    if (!isPair) {
      m.role = chance(r, 0.1) ? "must" : "guest";
      m.intake = chance(r, 0.85) ? "done" : pick(r, ["chatting", "swiping"] as const);
      m.secret!.tier = 1 + Math.floor(r() * tierCount);
      m.private!.rsvp = m.isOrganizer ? "yes" : chance(r, 0.2) ? "no" : chance(r, 0.85) ? "yes" : undefined;
    } else {
      m.private!.rsvp = chance(r, 0.7) ? "yes" : undefined;
    }
    if (m.private!.rsvp === "no") m.status = "out";
    if (chance(r, 0.2)) m.profileId = `profile-${seed}-${m.id}`;
  }

  // 门限 / 名额
  if (chance(r, 0.35)) {
    ju.quorum = { min: 2 + Math.floor(r() * 4), state: "pending" };
  }
  if (chance(r, 0.3)) {
    const cap = Math.max(3, inOnly(members).length - Math.floor(r() * 2));
    ju.capacity = cap;
    // 超出名额的（按入局顺序，A/B/发起人除外）进候补
    let inCount = 0;
    for (const m of members) {
      if (m.status !== "in") continue;
      inCount++;
      if (inCount > cap && m !== A && m !== B && !m.isOrganizer) m.status = "waitlist";
    }
  }
  // 截图预填：有的被认领了（认领人可能已经不在局里）
  if (chance(r, 0.4)) {
    const seeds: SeedMember[] = SEED_NAMES.slice(0, 2 + Math.floor(r() * 3)).map((name, i) => ({
      id: `s${i + 1}`,
      name,
      said: pick(r, ["yes", "no", "maybe"] as const),
    }));
    for (const s of seeds) if (chance(r, 0.5)) s.claimedBy = pick(r, members.slice(1)).id;
    ju.seeds = seeds;
  }

  // 刷卡牌堆（同一个局所有人同一批）
  let deck: Poi[] = [];
  try {
    deck = await buildSwipeDeck(ju, inOnly(members), members[0], map);
  } catch {
    deck = [];
  }
  const others = (m: Member) => members.filter((o) => o !== m && o !== A && o !== B).map((o) => o.id);
  for (const m of members) Object.assign(m.private!, randomHidden(r, deck, others(m)));
  // 单方面 wants 不能被对方回应（否则 matchPairs 跟着变）：去掉指向 A / B 的回应
  for (const m of members) if (m !== A && m !== B) m.private!.wants = m.private!.wants.filter((id) => id !== A.id && id !== B.id);
  // 一对固定互选（不涉及 A / B）
  const c = members[3];
  const d = members[4];
  if (c && d) {
    c.private!.wants = [...new Set([...c.private!.wants, d.id])];
    d.private!.wants = [...new Set([...d.private!.wants, c.id])];
    c.private!.matches = [d.id];
    d.private!.matches = [c.id];
  }

  const ledgers: Record<string, LedgerEntry[]> = {};
  for (const m of members) {
    const l = randomLedger(r);
    if (l.length) ledgers[m.id] = l;
  }

  const x = members.find((m) => m.status === "out")?.id;
  return { seed, ju, members, ledgers, a: A.id, b: B.id, ...(x ? { x } : {}), confirm: chance(r, 0.3) };
}

// ---------------------------------------------------------------- 公开输出

export type Outputs = { json: string; ju: Ju; members: Member[] };

/** 跑一遍线上同款流程（门限 → 出方案 → 可选定局），收集全部公开输出 */
export async function publicOutputs(sc: Scenario, map: MapProvider): Promise<Outputs> {
  const ju = structuredClone(sc.ju);
  const members = structuredClone(sc.members);
  const priv: JuPrivate = { mine: {}, pendingMembers: [], decks: {} };
  const ledgers: Record<string, LedgerEntry[]> = {};
  for (const m of inOnly(members)) if (sc.ledgers[m.id]) ledgers[m.id] = sc.ledgers[m.id];

  evalQuorum(ju, members, NOW);
  if (!quorumHidden(ju) && inOnly(members).length > 0) {
    // 公开 LLM 用 B1 的确定性规则版（不走网络），同样经过 guardPlan 兜底
    await computePlan(ju, members, priv, { map, now: NOW, ledgers, polish: async (f, p) => rulePolishPlan(f, p) });
    if (sc.confirm && ju.plan) {
      const rec = ju.plan.proposals.find((p) => p.recommended) ?? ju.plan.proposals[0];
      if (rec) confirmProposal(ju, members, rec.id, NOW, "admin");
    }
  }
  const state = publicState(ju, members, undefined, { mine: priv.mine });
  const facts = publicFacts(ju, members);
  const messages = ruleGroupMessages(facts);
  const b1Messages = b1GroupMessages(facts);
  let json = JSON.stringify({ state, facts, messages, b1Messages });
  // inputHash 是用每个局自己的密钥对"含私密数据的规划输入"做的 HMAC-SHA256 承诺：
  // 没有密钥既不能反推、也不能穷举验证，所以它随私密输入变化不构成泄露。比较前把它（及思考流里的前缀）归一化。
  const ih = ju.plan?.audit.inputHash;
  if (ih) json = json.split(ih).join("<inputHash>").split(ih.slice(0, 8)).join("<inputHash>");
  return { json, ju, members };
}

// ---------------------------------------------------------------- 各项检验

const HIDDEN_KEYS: (keyof MemberPrivate)[] = ["dietTags", "notes", "swipes", "wants", "billFacts", "chat", "budgetMax", "autoFilled", "inbox"];

/** 交换 A、B 的全部"隐藏"私密信息（含 secret.tier、账本、档案 id） */
export function swapHidden(sc: Scenario): Scenario {
  const s = structuredClone(sc);
  const A = s.members.find((m) => m.id === s.a)!;
  const B = s.members.find((m) => m.id === s.b)!;
  for (const k of HIDDEN_KEYS) {
    const tmp = A.private![k];
    (A.private as Record<string, unknown>)[k] = B.private![k];
    (B.private as Record<string, unknown>)[k] = tmp;
    if (A.private![k] === undefined) delete A.private![k];
    if (B.private![k] === undefined) delete B.private![k];
  }
  // 门限前 rsvp 也是隐藏的（只体现在 quorumHave 计数里，对调后计数不变）
  [A.private!.rsvp, B.private!.rsvp] = [B.private!.rsvp, A.private!.rsvp];
  if (A.private!.rsvp === undefined) delete A.private!.rsvp;
  if (B.private!.rsvp === undefined) delete B.private!.rsvp;
  [A.secret!.tier, B.secret!.tier] = [B.secret!.tier, A.secret!.tier];
  [A.profileId, B.profileId] = [B.profileId, A.profileId];
  if (A.profileId === undefined) delete A.profileId;
  if (B.profileId === undefined) delete B.profileId;
  [s.ledgers[s.a], s.ledgers[s.b]] = [s.ledgers[s.b], s.ledgers[s.a]];
  if (!s.ledgers[s.a]) delete s.ledgers[s.a];
  if (!s.ledgers[s.b]) delete s.ledgers[s.b];
  return s;
}

/** 可否认缺席的两个对照：X 私下拒绝（私密信息随便换） vs X 压根没来（门限未达成时：X 还没回） */
function absenceVariants(sc: Scenario, r: Rng, pendingMode: boolean): [Scenario, Scenario] | undefined {
  if (!sc.x) return undefined;
  const v1 = structuredClone(sc);
  const X1 = v1.members.find((m) => m.id === sc.x)!;
  Object.assign(X1.private!, randomHidden(r, [], []), { availability: randomAvailability(r, sc.ju.spec.dates), rsvp: "no" });
  X1.location = { ...near(r, 9), label: "随便哪里" };
  X1.secret!.tier = 1 + Math.floor(r() * 3);
  if (v1.ju.seeds?.length && chance(r, 0.5)) v1.ju.seeds[0].claimedBy = X1.id;

  const v2 = structuredClone(sc);
  if (pendingMode) {
    // 跑完流程门限仍未达成：和"进来了但还没表态"比（揭晓之后没表态的人会出现在名单里，那是公开的）
    const X2 = v2.members.find((m) => m.id === sc.x)!;
    X2.status = "in";
    X2.private = { ...emptyPrivate(), availability: {} };
    X2.intake = X1.intake;
    X2.role = X1.role;
  } else {
    // 门限后 / 没有门限：和"压根没来过"比
    v2.members = v2.members.filter((m) => m.id !== sc.x);
    for (const m of v2.members) {
      m.private!.wants = m.private!.wants.filter((id) => id !== sc.x);
      m.private!.matches = m.private!.matches.filter((id) => id !== sc.x);
    }
    for (const s of v2.ju.seeds ?? []) if (s.claimedBy === sc.x) delete s.claimedBy;
    delete v2.ledgers[sc.x];
  }
  if (v1.ju.seeds?.[0]?.claimedBy === X1.id && v2.ju.seeds?.[0]) delete v2.ju.seeds[0].claimedBy;
  return [v1, v2];
}

/** 公开 JSON 里不能出现的字段名 */
const FORBIDDEN_KEYS = ["private", "secret", "admin", "profileId", "wants", "matches", "budgetMax", "tier", "auditSecret", "token", "swipes"];

function forbiddenKeys(x: unknown, path = "", out: string[] = []): string[] {
  if (Array.isArray(x)) x.forEach((v, i) => forbiddenKeys(v, `${path}[${i}]`, out));
  else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      // Experience.notes / proposal 里的 notes 是公开安全说明，不算私密字段
      if (FORBIDDEN_KEYS.includes(k)) out.push(`${path}.${k}`);
      forbiddenKeys(v, `${path}.${k}`, out);
    }
  }
  return out;
}

const tokenRe = (n: number) => new RegExp(`(?<![\d.])${n}(?![\d]|\.\d)`);

/** 字面检验。预算数字命中时做因果判定：把那个人的预算换成别的数再跑，数字消失才算泄露 */
async function literalCheck(sc: Scenario, out: Outputs, map: MapProvider): Promise<string[]> {
  const problems: string[] = [];
  const parsed = JSON.parse(out.json);
  for (const k of forbiddenKeys(parsed)) problems.push(`公开输出里出现了私密字段 ${k}`);
  const sens: Sensitive = sensitiveOf(out.ju, out.members);
  const texts = stringsIn(parsed);
  const hits = texts.flatMap((t) => scanText(t, sens));
  for (const h of hits) {
    if (h.kind !== "budget") {
      problems.push(`字面命中 ${h.kind}：${h.detail}`);
      continue;
    }
    // 因果判定
    const b = Number(h.detail);
    const owners = sc.members.filter((m) => m.private?.budgetMax === b);
    let caused = false;
    for (const o of owners) {
      const alt = structuredClone(sc);
      const am = alt.members.find((m) => m.id === o.id)!;
      // 换成一个原输出里没有的标记数字：标记数字出现在新输出里 = 这个数字跟着私密预算走 = 泄露。
      // 只是"原数字消失"不算：比如综合分恰好等于预算、预算一变分数也变，那是聚合值，不是预算本身。
      const marker = [199, 211, 223, 239, 251].find((v) => !texts.some((t) => tokenRe(v).test(t))) ?? 263;
      am.private!.budgetMax = marker;
      const altOut = await publicOutputs(alt, map);
      const hit = stringsIn(JSON.parse(altOut.json)).find((t) => tokenRe(marker).test(t));
      if (hit) {
        caused = true;
        problems.push(`私密预算 ${b} 跟着走：换成 ${marker} 后公开输出出现「${hit.slice(0, 100)}」`);
        break;
      }
    }
    if (caused) problems.push(`字面命中私密预算 ${b}`);
  }
  return [...new Set(problems)];
}

/** 身份隔离：别人的 token 拿不到 private；任何视图都没有 secret；没 admin token 没有 ju.admin */
function identityCheck(out: Outputs, r: Rng): string[] {
  const problems: string[] = [];
  const viewer = pick(r, out.members);
  const st = publicState(out.ju, out.members, { memberToken: viewer.secret!.token }, { mine: {} });
  if (!st.me || st.me.id !== viewer.id) problems.push("带本人 token 没拿到 me");
  if (st.me?.secret) problems.push("me 里带了 secret");
  if (st.isAdmin || st.ju.admin) problems.push("成员 token 拿到了发起人数据");
  for (const m of st.members) if (m.private || m.secret || m.profileId) problems.push(`公开成员 ${m.id} 带了私密字段`);
  const json = JSON.stringify({ ...st, me: undefined });
  for (const other of out.members) {
    if (other.id === viewer.id) continue;
    for (const n of other.private?.notes ?? []) {
      if (!(viewer.private?.notes ?? []).includes(n) && json.includes(n)) problems.push("看到了别人的私密备注");
    }
    if (json.includes(other.secret!.token)) problems.push("看到了别人的 token");
  }
  const wrong = publicState(out.ju, out.members, { memberToken: viewer.secret!.token + "x" }, { mine: {} });
  if (wrong.me) problems.push("带错 token 也拿到了 me");
  const prefix = publicState(out.ju, out.members, { memberToken: viewer.secret!.token.slice(0, -1) }, { mine: {} });
  if (prefix.me) problems.push("token 前缀也能通过");
  return problems;
}

// ---------------------------------------------------------------- 总入口

export type SelfTestReport = PrivacySelfTest & { failures: { seed: number; check: string; detail: string }[] };

export async function runPrivacySelfTest(opts: { scenarios?: number; seed?: number; map?: MapProvider } = {}): Promise<SelfTestReport> {
  const total = opts.scenarios ?? 200;
  const base = opts.seed ?? 20261022;
  const map = opts.map ?? createMockMapProvider();
  const checks = {
    swap: { name: "交换检验（A、B 对调私密信息，公开输出逐字节相同；audit.inputHash 是带每局密钥的 HMAC 承诺，按设计覆盖私密输入，有意不参与比较）", runs: 0, leaks: 0 },
    absence: { name: "可否认缺席（私下拒绝 = 压根没来 / 还没回）", runs: 0, leaks: 0 },
    literal: { name: "字面检验（备注原文 / 预算数字 / 不在场的名字 / token / 圈层）", runs: 0, leaks: 0 },
    identity: { name: "身份隔离（别人的 token 拿不到 private，任何视图没有 secret）", runs: 0, leaks: 0 },
  };
  const failures: SelfTestReport["failures"] = [];
  const fail = (seed: number, check: keyof typeof checks, detail: string) => {
    checks[check].leaks++;
    if (failures.length < 50) failures.push({ seed, check: checks[check].name, detail });
  };

  for (let i = 0; i < total; i++) {
    const seed = base + i;
    const r = rngOf(seed ^ 0x5bd1e995);
    let sc: Scenario;
    try {
      sc = await genScenario(seed, map);
    } catch (e) {
      fail(seed, "swap", `场景生成失败：${(e as Error)?.message ?? e}`);
      continue;
    }

    // 1. 交换
    checks.swap.runs++;
    let o1: Outputs;
    try {
      o1 = await publicOutputs(sc, map);
      const o2 = await publicOutputs(swapHidden(sc), map);
      if (o1.json !== o2.json) fail(seed, "swap", firstDiff(o1.json, o2.json));
    } catch (e) {
      fail(seed, "swap", `运行出错：${(e as Error)?.message ?? e}`);
      continue;
    }

    // 2. 可否认缺席
    const vs = absenceVariants(sc, r, quorumHidden(o1.ju));
    if (vs) {
      checks.absence.runs++;
      try {
        const [p1, p2] = await Promise.all([publicOutputs(vs[0], map), publicOutputs(vs[1], map)]);
        if (p1.json !== p2.json) fail(seed, "absence", firstDiff(p1.json, p2.json));
      } catch (e) {
        fail(seed, "absence", `运行出错：${(e as Error)?.message ?? e}`);
      }
    }

    // 3. 字面
    checks.literal.runs++;
    for (const p of await literalCheck(sc, o1, map)) fail(seed, "literal", p);

    // 4. 身份隔离
    checks.identity.runs++;
    for (const p of identityCheck(o1, r)) fail(seed, "identity", p);
  }

  const list = Object.values(checks);
  return {
    runs: total,
    leaks: list.reduce((s, c) => s + c.leaks, 0),
    checks: list,
    at: new Date().toISOString(),
    failures,
  };
}

/** 两份输出第一个不同的地方（调试用，只截一小段） */
function firstDiff(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const from = Math.max(0, i - 60);
  return `第 ${i} 字节起不同：…${a.slice(from, i + 60)}… vs …${b.slice(from, i + 60)}…`;
}

// ---------------------------------------------------------------- 缓存（给 API）

const CACHE_MS = 10 * 60_000;
const g = globalThis as unknown as { __privacySelfTest?: { at: number; p: Promise<PrivacySelfTest> } };

export function cachedSelfTest(): Promise<PrivacySelfTest> {
  const c = g.__privacySelfTest;
  if (c && Date.now() - c.at < CACHE_MS) return c.p;
  const p = runPrivacySelfTest().then(({ failures, ...rest }) => {
    if (failures.length) console.warn(`[privacy] 反事实检验发现 ${rest.leaks} 处问题，例：${JSON.stringify(failures.slice(0, 3))}`);
    return rest;
  });
  g.__privacySelfTest = { at: Date.now(), p };
  p.catch(() => {
    if (g.__privacySelfTest?.p === p) g.__privacySelfTest = undefined;
  });
  return p;
}

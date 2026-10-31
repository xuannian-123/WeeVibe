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
// v4 局内编排（排座本身就是由私密标记决定的——这是功能——所以交换检验在排座之前比；排座之后另有三项）：
//   5. 单向标记隐藏：C 说了和 A 挺熟时，A 对 C 标"不认识 / 见过 / 挺熟 / 没标"，排座后的全部公开输出逐字节相同。
//   6. 单方面不可见：A 单方面"想认识" / "聊得来"某人，排座后的全部公开输出不变。
//   7. 可否认回避：悄悄回避的两人从不同桌，并且从没同桌的对数 ≥ 3 × 回避数；做不到时结果和没人提回避逐字节相同。
//   另外可否认缺席、字面检验、身份隔离都在排座 + 轮次推进（含按反馈重排）之后跑。
// v6 分身谈判：
//   8. 谈判不可推断：给每个人随机配上授权书（风格 / 可以让多少 / 确认没确认）、心情、软硬需求，把 A、B 的这些隐藏信息
//      连同 1 里的全部隐藏信息一起互换，公开谈判记录（plan.negotiation）逐字相同；记录里不出现任何人名、私密备注原文、预算数字，
//      说话人只有"局长"和"分身 X"。（公开体验里"谁晚到了"是现场看得见的事实，本来就公开，不在这一项里比）
// 这里调用的 computePlan / evalQuorum / computeSeating / advanceRound / publicState / publicFacts 就是线上跑的那一份。
import { ruleGroupMessages as b1GroupMessages, rulePolishPlan } from "../llm";
import { createMockMapProvider } from "../map";
import { AVOID_COVER, buildSwipeDeck, generateSlots, pairKey } from "../planner";
import { STYLE_GIVE } from "../planner/avatar/mandate";
import type { JuPrivate } from "../db";
import type {
  AvatarStyle,
  DayAvailability,
  DietTag,
  Familiarity,
  Ju,
  JuSpec,
  LedgerEntry,
  MapProvider,
  Member,
  MemberPrivate,
  Mood,
  Need,
  Poi,
  PrivacySelfTest,
  RoundFeel,
  SeedMember,
  SocialEnergy,
  SwipeVerdict,
} from "../types";
import { numbersIn, publicFacts, publicState, quorumHidden, scanText, sensitiveOf, stringsIn, type Sensitive } from "./firewall";
import { HttpError } from "./http";
import { computePlan, confirmProposal, emptyPrivate, evalQuorum, inOnly } from "./ju-core";
import { ruleGroupMessages } from "./ju-text";
import { advanceRound, computeSeating } from "./social-core";

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
// 公开兴趣（本来就公开，交换对 A、B 用同一组）
const INTERESTS = ["爬山", "桌游", "摄影", "猫", "羽毛球", "剧本杀", "咖啡", "动漫"];
const ENERGIES: SocialEnergy[] = ["low", "mid", "high"];
const FEELS: RoundFeel[] = ["stiff", "ok", "loud"];
const FAMS: Familiarity[] = [0, 1, 2];
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
  /** v4 定局后排座：几轮、每桌几人、是否推进两轮（含按反馈调整） */
  seat?: { rounds: number; tableSize: number; advance: boolean };
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
    // v4：熟悉度 / 电量 / 回避 / 第一轮感受 / 聊得来
    know: Object.fromEntries(others.filter(() => chance(r, 0.5)).map((id) => [id, pick(r, FAMS)])),
    energy: pick(r, ENERGIES),
    avoid: chance(r, 0.15) && others.length ? [pick(r, others)] : [],
    feel: chance(r, 0.7) ? { "0": pick(r, FEELS) } : {},
    clicked: others.filter(() => chance(r, 0.2)),
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
  // v4：公开兴趣（A、B 同一组）；别人对 A、B 的熟悉度标记一样（否则 A、B 的公开处境就不对称了）
  const pairInterests = INTERESTS.filter(() => chance(r, 0.3));
  for (const m of members) {
    const xs = m === A || m === B ? pairInterests : INTERESTS.filter(() => chance(r, 0.3));
    if (xs.length) m.interests = [...xs];
    if (m === A || m === B) continue;
    const v = chance(r, 0.5) ? pick(r, FAMS) : undefined;
    const know = { ...(m.private!.know ?? {}) };
    delete know[A.id];
    delete know[B.id];
    if (v !== undefined) {
      know[A.id] = v;
      know[B.id] = v;
    }
    m.private!.know = know;
  }
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
  const confirm = chance(r, 0.45);
  const seat = confirm ? { rounds: 1 + Math.floor(r() * 3), tableSize: 3 + Math.floor(r() * 3), advance: chance(r, 0.6) } : undefined;
  return { seed, ju, members, ledgers, a: A.id, b: B.id, ...(x ? { x } : {}), confirm, ...(seat ? { seat } : {}) };
}

// ---------------------------------------------------------------- 公开输出

export type Outputs = { json: string; ju: Ju; members: Member[] };

/**
 * 跑一遍线上同款流程（门限 → 出方案 → 可选定局 → 可选排座 → 可选推进两轮），收集全部公开输出。
 * opts.seat = false：停在排座之前（交换检验用）；opts.advance = false：排座后不推进轮次（可否认回避检验用）。
 */
export async function publicOutputs(sc: Scenario, map: MapProvider, opts: { seat?: boolean; advance?: boolean } = {}): Promise<Outputs> {
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
  if (opts.seat !== false && sc.seat && ju.status === "confirmed") {
    try {
      computeSeating(ju, members, priv, { rounds: sc.seat.rounds, tableSize: sc.seat.tableSize, now: NOW });
      if (sc.seat.advance && opts.advance !== false) {
        advanceRound(ju, members, priv, NOW); // 第 1 轮开始
        advanceRound(ju, members, priv, NOW); // 第 1 轮结束（聚合私下感受）→ 按反馈调整第 2 轮
      }
    } catch (e) {
      // 人太少（< 3）排不了座：两个对照组里一样会发生
      if (!(e instanceof HttpError)) throw e;
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
  // 排座的 inputHash 同理（HMAC 承诺覆盖私密标记，按设计随之变化）
  const sh = ju.seating?.audit.inputHash;
  if (sh) json = json.split(sh).join("<seatInputHash>");
  return { json, ju, members };
}

// ---------------------------------------------------------------- 各项检验

const HIDDEN_KEYS: (keyof MemberPrivate)[] = [
  "dietTags",
  "notes",
  "swipes",
  "wants",
  "billFacts",
  "chat",
  "budgetMax",
  "autoFilled",
  "inbox",
  "know",
  "knowAuto",
  "energy",
  "avoid",
  "feel",
  "clicked",
  "clickMatches",
];

/** v6：授权书 / 心情 / 需求（谈判检验额外互换这些） */
export const AVATAR_HIDDEN_KEYS: (keyof MemberPrivate)[] = [...HIDDEN_KEYS, "mood", "mandate", "needs", "budgetStrength", "confirmed", "avatarLog"];

/** 交换 A、B 的全部"隐藏"私密信息（含 secret.tier、账本、档案 id）。keys 默认是 v5 的那一组 */
export function swapHidden(sc: Scenario, keys: (keyof MemberPrivate)[] = HIDDEN_KEYS): Scenario {
  const s = structuredClone(sc);
  const A = s.members.find((m) => m.id === s.a)!;
  const B = s.members.find((m) => m.id === s.b)!;
  for (const k of keys) {
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
  // X 私下说了什么都不该有影响：v4 的熟悉度 / 回避 / 感受也随便给
  const otherIds = v1.members.filter((m) => m.id !== sc.x).map((m) => m.id);
  Object.assign(X1.private!, randomHidden(r, [], otherIds), { availability: randomAvailability(r, sc.ju.spec.dates), rsvp: "no" });
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
      const p = m.private!;
      p.wants = p.wants.filter((id) => id !== sc.x);
      p.matches = p.matches.filter((id) => id !== sc.x);
      if (p.know) delete p.know[sc.x!];
      if (p.knowAuto) p.knowAuto = p.knowAuto.filter((id) => id !== sc.x);
      if (p.avoid) p.avoid = p.avoid.filter((id) => id !== sc.x);
      if (p.clicked) p.clicked = p.clicked.filter((id) => id !== sc.x);
      if (p.clickMatches) p.clickMatches = p.clickMatches.filter((id) => id !== sc.x);
    }
    for (const s of v2.ju.seeds ?? []) if (s.claimedBy === sc.x) delete s.claimedBy;
    delete v2.ledgers[sc.x];
  }
  if (v1.ju.seeds?.[0]?.claimedBy === X1.id && v2.ju.seeds?.[0]) delete v2.ju.seeds[0].claimedBy;
  return [v1, v2];
}

/** 公开 JSON 里不能出现的字段名 */
const FORBIDDEN_KEYS = [
  "private",
  "secret",
  "admin",
  "profileId",
  "wants",
  "matches",
  "budgetMax",
  "tier",
  "auditSecret",
  "token",
  "swipes",
  // v4
  "know",
  "knowAuto",
  "energy",
  "avoid",
  "feel",
  "clicked",
  "clickMatches",
  "decoys",
  "seatSnapshot",
  // v5 协商
  "asks",
  "relax",
  "waived",
  // v6 分身
  "mood",
  "mandate",
  "avatarLog",
  "give",
];

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

// ---------------------------------------------------------------- v4 排座检验

/** 排得上座的场景里，挑一个不是 A、B 的在局成员 C */
function thirdOf(sc: Scenario): Member | undefined {
  return sc.members.find((m) => m.id !== sc.a && m.id !== sc.b && m.status === "in");
}

/** 5. 单向标记隐藏：C 说和 A 挺熟时，A 对 C 怎么标（含没标）都不影响任何公开输出 */
async function asymmetryCheck(sc: Scenario, map: MapProvider): Promise<string[]> {
  const C = thirdOf(sc);
  if (!C) return [];
  const base = structuredClone(sc);
  const Cb = base.members.find((m) => m.id === C.id)!;
  Cb.private!.know = { ...(Cb.private!.know ?? {}), [sc.a]: 2 };
  const variants: (Familiarity | undefined)[] = [undefined, 0, 1, 2];
  let first: string | undefined;
  for (const v of variants) {
    const s = structuredClone(base);
    const A = s.members.find((m) => m.id === s.a)!;
    const know = { ...(A.private!.know ?? {}) };
    if (v === undefined) delete know[C.id];
    else know[C.id] = v;
    A.private!.know = know;
    const out = (await publicOutputs(s, map)).json;
    if (first === undefined) first = out;
    else if (out !== first) return [`A 对 C 标 ${v ?? "没标"} 时公开输出变了：${firstDiff(first, out)}`];
  }
  return [];
}

/** 6. 单方面不可见：A 单方面"想认识" / "聊得来" C（C 没回应），排座后的公开输出不变 */
async function unilateralCheck(sc: Scenario, map: MapProvider): Promise<string[]> {
  const C = thirdOf(sc);
  if (!C || C.private?.wants.includes(sc.a) || C.private?.clicked?.includes(sc.a)) return [];
  const s = structuredClone(sc);
  const A = s.members.find((m) => m.id === s.a)!;
  A.private!.wants = [...new Set([...A.private!.wants, C.id])];
  A.private!.clicked = [...new Set([...(A.private!.clicked ?? []), C.id])];
  const [o1, o2] = await Promise.all([publicOutputs(sc, map), publicOutputs(s, map)]);
  return o1.json === o2.json ? [] : [`单方面想认识 / 聊得来改变了公开输出：${firstDiff(o1.json, o2.json)}`];
}

/**
 * 7. 可否认回避（只看第一次排座）：回避的两人从不同桌，且从没同桌的对数 ≥ 3 × 回避数；
 *    做不到时必须和"没人提回避"逐字节相同。返回 undefined = 这个场景没有生效的回避。
 */
async function avoidCheck(sc: Scenario, map: MapProvider): Promise<string[] | undefined> {
  const out = await publicOutputs(sc, map, { advance: false });
  const seating = out.ju.seating;
  if (!seating) return undefined;
  const seated = new Set(seating.rounds[0].tables.flatMap((t) => t.memberIds));
  const pairs = new Set<string>();
  for (const m of out.members) {
    if (!seated.has(m.id)) continue;
    const t = m.private?.avoid?.[0];
    if (t && t !== m.id && seated.has(t)) pairs.add(pairKey(m.id, t));
  }
  if (!pairs.size) return undefined;
  const togetherCount = (k: string) => {
    const [a, b] = k.split("|");
    return seating.rounds.reduce((n, r) => n + r.tables.filter((t) => t.memberIds.includes(a) && t.memberIds.includes(b)).length, 0);
  };
  const ids = [...seated].sort();
  let never = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (!togetherCount(pairKey(ids[i], ids[j]))) never++;
  const honored = [...pairs].every((k) => togetherCount(k) === 0);
  if (honored) {
    if (never < AVOID_COVER * pairs.size) return [`回避执行了但掩护不够：从没同桌 ${never} 对 < ${AVOID_COVER} × ${pairs.size}`];
    if (seating.metrics.neverTogether !== never) return [`neverTogether 统计不对：${seating.metrics.neverTogether} vs ${never}`];
    return [];
  }
  // 没执行：必须和所有人都没提回避时一模一样
  const plain = structuredClone(sc);
  for (const m of plain.members) if (m.private) m.private.avoid = [];
  const o2 = await publicOutputs(plain, map, { advance: false });
  return o2.json === out.json ? [] : [`回避没执行，但结果和没人提回避时不一样：${firstDiff(out.json, o2.json)}`];
}

// ---------------------------------------------------------------- v6 谈判检验

const STYLES: AvatarStyle[] = ["easy", "balanced", "firm"];
const MOODS: Mood[] = ["hype", "chill", "active", "lazy"];
const NEED_POOL: Omit<Need, "id" | "at" | "source">[] = [
  { dim: "travel", kind: "soft", strength: 2, rule: { t: "maxCommute", minutes: 25 }, text: "单程尽量别超过 25 分钟" },
  { dim: "travel", kind: "soft", strength: 3, rule: { t: "maxCommute", minutes: 35 }, text: "单程尽量别超过 35 分钟" },
  { dim: "ambience", kind: "soft", strength: 2, rule: { t: "quiet" }, text: "想安静点、能好好聊天" },
  { dim: "time", kind: "soft", strength: 2, rule: { t: "leaveBy", at: "21:30" }, text: "想 21:30 前结束" },
  { dim: "travel", kind: "hard", strength: 2, rule: { t: "maxCommute", minutes: 45 }, text: "单程不能超过 45 分钟" },
];

/** 给场景里每个人随机配上 v6 的隐藏信息（授权书 / 心情 / 需求）。只依赖 seed */
export function avatarize(sc: Scenario, seed: number): Scenario {
  const r = rngOf(seed ^ 0x2545f491);
  const s = structuredClone(sc);
  // 一半的场景里 A、B（公开处境相同）都晚下班：谁的分身有授权、谁没有，决定了谁替谁让步——正是要测的
  if (chance(r, 0.5)) {
    for (const m of s.members) {
      if (m.id !== s.a && m.id !== s.b) continue;
      for (const d of Object.keys(m.private!.availability)) m.private!.availability[d] = { ...m.private!.availability[d], from: "19:15" };
    }
  }
  for (const m of s.members) {
    const p = m.private!;
    // 手头紧的人（预算不太"整"，方便字面检验）
    if (chance(r, 0.35)) {
      p.budgetMax = pick(r, [53, 59, 61]);
      p.budgetStrength = 3;
    }
    if (chance(r, 0.7)) p.mood = pick(r, MOODS);
    const style = pick(r, STYLES);
    const scale = pick(r, [1, 1, 2]);
    const g = STYLE_GIVE[style];
    p.mandate = {
      status: chance(r, 0.75) ? "confirmed" : "draft",
      style,
      give: { lateMin: g.lateMin * scale, stayCutMin: g.stayCutMin, budgetUp: g.budgetUp * scale, commuteUp: g.commuteUp },
      floors: [],
    };
    const needs = NEED_POOL.filter(() => chance(r, 0.25)).map((n, k) => ({ ...n, id: `n${k + 1}-${n.rule.t}`, source: "chat" as const, at: NOW.toISOString() }));
    if (needs.length) p.needs = needs;
    if (p.budgetMax !== undefined && chance(r, 0.5)) p.budgetStrength = pick(r, [1, 2, 3] as const);
    if (chance(r, 0.3)) p.confirmed = ["homeBy"];
  }
  return s;
}

const SPEAKER_RE = /^(局长|分身 [A-Z]\d*)$/;

/** 8. 谈判不可推断：互换 A、B 的全部隐藏信息（含授权书），公开谈判记录逐字相同；记录里没有人名 / 私密原文 / 预算数字 */
async function negotiationCheck(sc: Scenario, map: MapProvider): Promise<{ problems: string[]; active: boolean }> {
  const av = avatarize(sc, sc.seed);
  const [o1, o2] = await Promise.all([publicOutputs(av, map, { seat: false }), publicOutputs(swapHidden(av, AVATAR_HIDDEN_KEYS), map, { seat: false })]);
  const n1 = o1.ju.plan?.negotiation;
  const n2 = o2.ju.plan?.negotiation;
  const problems: string[] = [];
  const j1 = JSON.stringify(n1 ?? null);
  const j2 = JSON.stringify(n2 ?? null);
  if (j1 !== j2) problems.push(`互换隐藏信息后谈判记录变了：${firstDiff(j1, j2)}`);
  if (!n1) return { problems, active: false };
  const sens = sensitiveOf(o1.ju, o1.members);
  const names = o1.members.map((m) => m.name).filter((x) => x.trim().length > 0);
  for (const e of n1.events) {
    if (!SPEAKER_RE.test(e.speaker)) problems.push(`说话人不是局长或分身代号：${e.speaker}`);
    for (const h of scanText(e.text, sens, numbersIn(JSON.stringify(publicFacts(o1.ju, o1.members))))) problems.push(`谈判记录命中 ${h.kind}：${h.detail}`);
    for (const nm of names) if (e.text.includes(nm) || e.speaker.includes(nm)) problems.push(`谈判记录里出现了人名 ${nm}`);
  }
  for (const k of forbiddenKeys(n1)) problems.push(`谈判记录里出现了私密字段 ${k}`);
  return { problems: [...new Set(problems)], active: n1.autoConcessions > 0 || n1.trades > 0 };
}

// ---------------------------------------------------------------- 总入口

export type SelfTestReport = PrivacySelfTest & {
  failures: { seed: number; check: string; detail: string }[];
  /** 谈判检验里真的发生了自动让步 / 交换的场景数（证明检验不是空转） */
  negotiationActive: number;
};

export async function runPrivacySelfTest(opts: { scenarios?: number; seed?: number; map?: MapProvider } = {}): Promise<SelfTestReport> {
  const total = opts.scenarios ?? 200;
  const base = opts.seed ?? 20261022;
  const map = opts.map ?? createMockMapProvider();
  const checks = {
    swap: { name: "交换检验（A、B 对调私密信息，公开输出逐字节相同；audit.inputHash 是带每局密钥的 HMAC 承诺，按设计覆盖私密输入，有意不参与比较）", runs: 0, leaks: 0 },
    absence: { name: "可否认缺席（私下拒绝 = 压根没来 / 还没回）", runs: 0, leaks: 0 },
    literal: { name: "字面检验（备注原文 / 预算数字 / 不在场的名字 / token / 圈层）", runs: 0, leaks: 0 },
    identity: { name: "身份隔离（别人的 token 拿不到 private，任何视图没有 secret）", runs: 0, leaks: 0 },
    asym: { name: "单向标记隐藏（对方说了挺熟，我标什么都不影响排座和任何公开输出）", runs: 0, leaks: 0 },
    unilateral: { name: "单方面不可见（单方面想认识 / 聊得来不改变任何公开输出）", runs: 0, leaks: 0 },
    avoid: { name: `可否认回避（回避的人从不同桌，且从没同桌的对数 ≥ ${AVOID_COVER} × 回避数；藏不住就不执行）`, runs: 0, leaks: 0 },
    negotiation: { name: "谈判不可推断（A、B 对调授权书 / 心情 / 需求等全部隐藏信息，公开谈判记录逐字相同；说话人只有局长和分身代号）", runs: 0, leaks: 0 },
  };
  let negotiationActive = 0;
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

    // 1. 交换（停在排座之前：排座本身就是由私密标记决定的，排座之后由 5–7 检验）
    checks.swap.runs++;
    let o1: Outputs;
    try {
      o1 = await publicOutputs(sc, map, { seat: false });
      const o2 = await publicOutputs(swapHidden(sc), map, { seat: false });
      if (o1.json !== o2.json) fail(seed, "swap", firstDiff(o1.json, o2.json));
      if (sc.seat) o1 = await publicOutputs(sc, map);
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

    // 8. 谈判不可推断
    checks.negotiation.runs++;
    try {
      const ng = await negotiationCheck(sc, map);
      if (ng.active) negotiationActive++;
      for (const p of ng.problems) fail(seed, "negotiation", p);
    } catch (e) {
      fail(seed, "negotiation", `运行出错：${(e as Error)?.message ?? e}`);
    }

    // 5–7. 排座（只在定局并排座的场景里跑）
    if (o1.ju.seating) {
      try {
        checks.asym.runs++;
        for (const p of await asymmetryCheck(sc, map)) fail(seed, "asym", p);
        checks.unilateral.runs++;
        for (const p of await unilateralCheck(sc, map)) fail(seed, "unilateral", p);
        const av = await avoidCheck(sc, map);
        if (av) {
          checks.avoid.runs++;
          for (const p of av) fail(seed, "avoid", p);
        }
      } catch (e) {
        fail(seed, "asym", `运行出错：${(e as Error)?.message ?? e}`);
      }
    }
  }

  const list = Object.values(checks);
  return {
    runs: total,
    leaks: list.reduce((s, c) => s + c.leaks, 0),
    checks: list,
    at: new Date().toISOString(),
    failures,
    negotiationActive,
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
  const p = runPrivacySelfTest().then(({ failures, negotiationActive: _active, ...rest }) => {
    void _active;
    if (failures.length) console.warn(`[privacy] 反事实检验发现 ${rest.leaks} 处问题，例：${JSON.stringify(failures.slice(0, 3))}`);
    return rest;
  });
  g.__privacySelfTest = { at: Date.now(), p };
  p.catch(() => {
    if (g.__privacySelfTest?.p === p) g.__privacySelfTest = undefined;
  });
  return p;
}

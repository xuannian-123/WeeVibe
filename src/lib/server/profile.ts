// 跨局记忆：设备级档案（#6 偏好预填、#10 公平账本）。
// 档案只按 profileId 读写；profileId 本身在公开视图里会被剥掉（firewall.publicMember），
// 所以拿不到别人的 profileId 就读不到别人的档案。
import * as db from "../db";
import type { AvatarStyle, DayAvailability, DietTag, FeedbackVerdict, Ju, Member, Mood, Poi, Profile, SwipeVerdict, Transport } from "../types";
import { activityKeyOfWord, activityOf } from "../client/activities";
import type { OnboardFloor } from "../client/mandate";
import {
  commuteLimitOf,
  factConfidence,
  FORGET_BELOW,
  HALF_LIFE_DAYS,
  learnedFacts,
  moodDefault,
  needsOnboarding,
  saidFacts,
  tastesOf,
} from "../client/profileFacts";

export function getProfile(pid: string): Profile | null {
  if (!pid) return null;
  return db.getProfileRow(pid);
}

export function saveProfile(p: Profile): void {
  db.upsertProfile(p);
}

export function emptyProfile(id: string): Profile {
  return { id, dietTags: [], ledger: [], tastes: {} };
}

/** 刷卡 → 口味词：品类（高德类型的最后一段）+ 连锁名（店名去掉括号里的分店） */
export function tasteKeys(poi: Pick<Poi, "name" | "type">): string[] {
  const keys = new Set<string>();
  const cat = (poi.type ?? "").split(/[;|]/).filter(Boolean).at(-1)?.trim();
  if (cat) keys.add(cat);
  const chain = poi.name.replace(/[（(].*?[)）]/g, "").trim();
  if (chain) keys.add(chain);
  return [...keys];
}

const VERDICT_DELTA: Record<SwipeVerdict, number> = { love: 0.3, like: 0.1, pass: -0.3 };

const clamp1 = (x: number) => Math.max(-1, Math.min(1, Math.round(x * 100) / 100));

/** 出现次数最多的值；平局取字典序小的（确定性） */
function mode(xs: string[]): string | undefined {
  const cnt = new Map<string, number>();
  for (const x of xs) cnt.set(x, (cnt.get(x) ?? 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

/**
 * 入局完成后把这次学到的东西写回档案（#6）：
 * tastes（刷卡）、typicalBudget（私下说的预算）、usualFrom / usualHomeBy（常用时间）、出发地、忌口。
 * 被局长预填的字段不回写（那不是本人的真实偏好）。
 */
export function learnFromMember(prev: Profile | null, m: Member, deck: Pick<Poi, "id" | "name" | "type">[], now = new Date()): Profile | null {
  if (!m.profileId || !m.private) return prev;
  const p: Profile = prev ? structuredClone(prev) : emptyProfile(m.profileId);
  const priv = m.private;
  const auto = new Set(priv.autoFilled);
  p.name = m.name;
  p.avatar = m.avatar;
  if (m.location) p.lastLocation = m.location;
  if (!auto.has("diet")) p.dietTags = [...priv.dietTags];
  if (!auto.has("budget") && priv.budgetMax !== undefined) p.typicalBudget = priv.budgetMax;
  if (!auto.has("availability")) {
    const days = Object.values(priv.availability) as DayAvailability[];
    const from = mode(days.map((d) => d.from));
    const homeBy = mode(days.map((d) => d.homeBy).filter((x): x is string => !!x));
    if (from) p.usualFrom = from;
    if (homeBy) p.usualHomeBy = homeBy;
  }
  if (!auto.has("swipes")) {
    const byId = new Map(deck.map((x) => [x.id, x]));
    for (const [poiId, v] of Object.entries(priv.swipes).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const poi = byId.get(poiId);
      if (!poi) continue;
      for (const k of tasteKeys(poi)) p.tastes[k] = clamp1((p.tastes[k] ?? 0) + VERDICT_DELTA[v]);
    }
  }
  learnAvatarFromMember(p, m, now);
  return p;
}

// ================================================================ v6 固定档案（docs/AVATAR.md 第 5.3 节）
// 「我说的」（source said：建档 / 卡片 / /me 里本人填的）和「分身猜的」（source learned：从行为里学的）分开存。
// 猜的带把握度、随时间淡化（半衰期 60 天），永远不能当底线——只会被预填成软需求 / 默认值。

// 只读计算（把握度淡化、口味、心情默认值…）在 client/profileFacts.ts，前端也要用；这里只放会改档案的。
export { HALF_LIFE_DAYS, factConfidence, learnedFacts, saidFacts, tastesOf, moodDefault, commuteLimitOf, needsOnboarding };

const CONF_MAX = 0.95;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** 本人说的：覆盖同 key 的旧事实（包括猜的——本人说了就以本人为准） */
export function setSaid(p: Profile, key: string, text: string, now: Date): void {
  p.facts = [...(p.facts ?? []).filter((f) => f.key !== key), { key, text, source: "said", confidence: 1, at: now.toISOString() }];
}

/** 分身猜的：同 key 先按时间淡化再加把握度；本人亲口说过的同 key 不被猜测覆盖 */
export function learn(p: Profile, key: string, text: string, delta: number, now: Date): void {
  const facts = p.facts ?? [];
  const old = facts.find((f) => f.key === key);
  if (old?.source === "said") return;
  const confidence = r3(Math.min(CONF_MAX, Math.max(0, (old ? factConfidence(old, now) : 0) + delta)));
  const rest = facts.filter((f) => f.key !== key);
  p.facts = confidence >= FORGET_BELOW ? [...rest, { key, text, source: "learned", confidence, at: now.toISOString() }] : rest;
}

/** 忘掉：删掉事实（/me 的"忘掉"按钮）。以 * 结尾的 key 按前缀删 */
export function forget(p: Profile, key: string): void {
  const pre = key.endsWith("*") ? key.slice(0, -1) : undefined;
  p.facts = (p.facts ?? []).filter((f) => (pre !== undefined ? !f.key.startsWith(pre) : f.key !== key));
}

/** 淡化到看不清的猜测直接删掉（写档案前顺手做） */
export function pruneFacts(p: Profile, now: Date): void {
  p.facts = (p.facts ?? []).filter((f) => f.source === "said" || factConfidence(f, now) >= FORGET_BELOW);
}

// ---------------------------------------------------------------- 首次建档

export type OnboardingInput = {
  avatarName?: string;
  places?: NonNullable<Profile["places"]>;
  transport?: Transport;
  transports?: Transport[];
  floors?: OnboardFloor[];
  /** 自己写的底线 */
  customFloors?: string[];
  /** 选了"门禁"时几点 */
  homeBy?: string;
  /** 选了"过敏"时对什么过敏 */
  allergy?: string;
  /** 选了"路程上限"时最多几分钟 */
  commuteMax?: number;
  /** 平时人均；0 = 不太在意 */
  budget?: number;
  /** 滑卡：活动 key -> 表态（右滑 like / 上滑 love / 左滑 pass） */
  swipes?: Record<string, SwipeVerdict>;
};

const SWIPE_TASTE: Record<SwipeVerdict, number> = { love: 1, like: 0.5, pass: -0.5 };

/** 建档写的底线事实（入局时由 prefillAvatar 转成这次的硬需求）；noAlcohol / allergy / body:膝盖不好 是旧档案的写法 */
export function isFloorFact(key: string): boolean {
  return key.startsWith("floor:") || key === "noAlcohol" || key === "allergy" || key === "body:膝盖不好";
}

function setTransports(p: Profile, ts: Transport[], now: Date): void {
  const list = [...new Set(ts)].slice(0, 5);
  p.transports = list;
  delete p.transport;
  setSaid(p, "transport", `常用交通：${list.map((t) => TRANSPORT_LABEL[t]).join("、")}`, now);
}

/** 自己写的底线整组替换（原话就是底线的文字） */
function setCustomFloors(p: Profile, texts: string[], now: Date): void {
  forget(p, "floor:custom:*");
  texts
    .map((t) => t.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 3)
    .forEach((t, i) => setSaid(p, `floor:custom:${i + 1}`, t, now));
}
export const TRANSPORT_LABEL: Record<Transport, string> = { metro: "地铁公交", drive: "开车", taxi: "打车", bike: "骑车", walk: "走路" };

/**
 * 建档写进档案。每屏都可以跳过：没填的字段不动（不会把上次的清掉）。走到最后 = 完成，写 onboardedAt。
 * 建档里的每一项都是本人说的（said）。
 */
export function applyOnboarding(prev: Profile | null, pid: string, input: OnboardingInput, now: Date): Profile {
  const p: Profile = prev ? structuredClone(prev) : emptyProfile(pid);
  if (input.avatarName?.trim()) p.avatarName = input.avatarName.trim().slice(0, 12);
  if (input.places?.length) {
    p.places = input.places.slice(0, 4);
    if (!p.lastLocation) p.lastLocation = { ...input.places[0].place };
  }
  const transports = input.transports?.length ? input.transports : input.transport ? [input.transport] : undefined;
  if (transports) setTransports(p, transports, now);
  if (input.floors || input.customFloors) {
    // 这一屏重新选过：换掉上次建档写的底线（门禁时间、清真素食在各自的字段里，下面会重写）
    p.facts = (p.facts ?? []).filter((f) => !(f.source === "said" && isFloorFact(f.key)));
    let n = 0;
    for (const f of [...new Set(input.floors ?? [])]) {
      if (n >= 3) break;
      if (f === "homeBy" && input.homeBy) {
        p.usualHomeBy = input.homeBy;
        setSaid(p, "homeBy", `${input.homeBy} 前必须回去`, now);
      } else if (f === "清真" || f === "素食") {
        p.dietTags = [...new Set([...p.dietTags, f])];
        setSaid(p, `diet:${f}`, `只能吃${f}`, now);
      } else if (f === "不吃辣") {
        p.dietTags = [...new Set([...p.dietTags, f])];
        setSaid(p, "floor:不吃辣", "一点辣都不能吃", now);
      } else if (f === "过敏") {
        // 不写对什么过敏，分身没法守：不记
        const what = input.allergy?.trim().slice(0, 20);
        if (!what) continue;
        setSaid(p, "floor:过敏", `对${what}过敏`, now);
      } else if (f === "commute") {
        if (!input.commuteMax) continue;
        setSaid(p, "floor:commute", `路上最多 ${input.commuteMax} 分钟`, now);
      } else if (f === "剧烈运动") {
        p.body = [...new Set([...(p.body ?? []), "不能剧烈运动"])];
        setSaid(p, "floor:剧烈运动", "不能剧烈运动", now);
      } else if (f === "不喝酒") {
        setSaid(p, "floor:不喝酒", "不喝酒", now);
      } else continue;
      n++;
    }
    setCustomFloors(p, (input.customFloors ?? []).slice(0, Math.max(0, 3 - n)), now);
  }
  if (input.budget !== undefined) {
    if (input.budget > 0) {
      p.typicalBudget = Math.round(input.budget);
      setSaid(p, "budget", `平时人均 ${p.typicalBudget} 左右`, now);
    } else {
      delete p.typicalBudget;
      setSaid(p, "budget", "花多少不太在意", now);
    }
  }
  if (input.swipes) {
    const tastes = { ...(p.activityTastes ?? {}) };
    for (const [k, v] of Object.entries(input.swipes)) if (activityOf(k)) tastes[k] = SWIPE_TASTE[v];
    p.activityTastes = tastes;
  }
  p.onboardedAt = now.toISOString();
  return p;
}

// ---------------------------------------------------------------- 局后一键反馈

export const FEEDBACK_LABEL: Record<FeedbackVerdict, string> = { great: "很棒", tired: "太累", pricey: "太贵", far: "太远", loud: "太吵", ok: "还行" };

/**
 * 局后反馈 → 写 feedback 并更新档案（学到的都是"分身猜的"，会淡化）：
 * 太累 → 心情默认偏 chill、高强度活动降权；太贵 → typicalBudget 下调；太远 → 通勤容忍下调；太吵 → 猜"怕吵"；
 * 很棒 → 这次的活动加分。同一个局只记一次。
 */
export function applyFeedback(
  prev: Profile | null,
  pid: string,
  juId: string,
  verdict: FeedbackVerdict,
  ctx: { activities: string[]; budget?: number; commuteMin?: number },
  now: Date,
): Profile {
  const p: Profile = prev ? structuredClone(prev) : emptyProfile(pid);
  if ((p.feedback ?? []).some((f) => f.juId === juId)) return p;
  p.feedback = [...(p.feedback ?? []), { juId, at: now.toISOString(), verdict }].slice(-30);
  pruneFacts(p, now);
  switch (verdict) {
    case "tired":
      learn(p, "mood:chill", "最近更想安静点", 0.5, now);
      learn(p, "lowEnergy", "累了，高强度的活动往后放", 0.5, now);
      break;
    case "pricey": {
      const base = p.typicalBudget ?? ctx.budget;
      if (base) {
        p.typicalBudget = Math.max(30, Math.round((base * 0.85) / 5) * 5);
        learn(p, "budgetDown", `上次觉得贵，平时人均往下调到 ${p.typicalBudget}`, 0.5, now);
      }
      break;
    }
    case "far": {
      const was = commuteLimitOf(p, now) ?? ctx.commuteMin ?? 45;
      const mins = Math.max(15, Math.round((was - 10) / 5) * 5);
      forget(p, "maxCommute:*");
      learn(p, `maxCommute:${mins}`, `路上尽量别超过 ${mins} 分钟`, 0.6, now);
      break;
    }
    case "loud":
      learn(p, "quiet", "怕吵", 0.5, now);
      break;
    case "great":
      for (const k of ctx.activities) {
        const a = activityOf(k);
        if (a) learn(p, `taste:${k}:+`, `好像挺喜欢${a.name}`, 0.4, now);
      }
      break;
    case "ok":
      break;
  }
  return p;
}

/** 投完票：投的那个方案里的活动加一点分（猜的） */
export function learnFromVote(prev: Profile | null, pid: string, activities: string[], now: Date): Profile {
  const p: Profile = prev ? structuredClone(prev) : emptyProfile(pid);
  pruneFacts(p, now);
  for (const k of activities) {
    const a = activityOf(k);
    if (a) learn(p, `taste:${k}:+`, `好像挺喜欢${a.name}`, 0.15, now);
  }
  return p;
}

/** 方案里的活动 key（两段式取每段；否则按局的品类认） */
export function proposalActivities(ju: Ju, proposalId: string | undefined): string[] {
  const p = ju.plan?.proposals.find((x) => x.id === proposalId);
  const keys = p?.segments?.length ? p.segments.map((s) => s.activity) : [activityKeyOfWord(ju.spec.category)];
  return [...new Set(keys.filter((k): k is string => !!k))];
}

/** 投票后顺手更新本人档案（ju.vote 调用；没有档案就什么都不做） */
export function rememberVote(m: Member, ju: Ju, proposalId: string, now: Date): void {
  if (!m.profileId) return;
  const acts = proposalActivities(ju, proposalId);
  if (acts.length) saveProfile(learnFromVote(getProfile(m.profileId), m.profileId, acts, now));
}

const MOOD_TEXT: Record<Mood, string> ={ hype: "想嗨", chill: "想安静聊聊", active: "想动一动", lazy: "想躺着" };

/** 入局完成：这次的状态 / 讲究 / 想干什么 → 分身猜的；确认过的授权书风格 → 本人的选择 */
export function learnAvatarFromMember(p: Profile, m: Member, now: Date): void {
  const priv = m.private;
  if (!priv) return;
  pruneFacts(p, now);
  if (priv.mandate?.status === "confirmed") p.style = priv.mandate.style;
  if (priv.mood) learn(p, `mood:${priv.mood}`, `常常${MOOD_TEXT[priv.mood]}`, 0.2, now);
  for (const n of priv.needs ?? []) {
    if (n.source === "profile") continue; // 档案预填回来的不算新证据
    if (n.rule.t === "quiet") learn(p, "quiet", "怕吵", 0.25, now);
    if (n.rule.t !== "preferCategory" && n.rule.t !== "avoidCategory") continue;
    if (n.dim === "body") continue;
    const sign = n.rule.t === "preferCategory" ? "+" : "-";
    for (const w of n.rule.words) {
      const a = activityOf(activityKeyOfWord(w) ?? "");
      if (a) learn(p, `taste:${a.key}:${sign}`, `好像${sign === "+" ? "挺喜欢" : "不太喜欢"}${a.name}`, 0.2, now);
    }
  }
}

// ---------------------------------------------------------------- /me「分身眼中的你」：改 / 删 / 忘掉

export type ProfileEdit = {
  avatarName?: string | null;
  style?: AvatarStyle | null;
  places?: NonNullable<Profile["places"]> | null;
  transport?: Transport | null;
  transports?: Transport[];
  /** 自己写的底线（整组替换） */
  customFloors?: string[];
  usualHomeBy?: string | null;
  dietTags?: DietTag[];
  body?: string[];
  typicalBudget?: number | null;
  activityTastes?: Record<string, number>;
  /** 要忘掉的事实 key（猜的、说的都行；以 * 结尾按前缀） */
  forget?: string[];
  /** 全部忘掉：清空分身猜的 */
  forgetLearned?: boolean;
};

/** 本人改档案：null = 删掉这一项。本人改过的都是"我说的" */
export function editProfile(prev: Profile | null, pid: string, e: ProfileEdit, now: Date): Profile {
  const p: Profile = prev ? structuredClone(prev) : emptyProfile(pid);
  if (e.avatarName !== undefined) {
    if (e.avatarName?.trim()) p.avatarName = e.avatarName.trim().slice(0, 12);
    else delete p.avatarName;
  }
  if (e.style !== undefined) {
    if (e.style) p.style = e.style;
    else delete p.style;
  }
  if (e.places !== undefined) {
    if (e.places?.length) p.places = e.places.slice(0, 4);
    else delete p.places;
  }
  if (e.transport !== undefined) {
    if (e.transport) {
      p.transport = e.transport;
      setSaid(p, "transport", `常用交通：${TRANSPORT_LABEL[e.transport]}`, now);
    } else {
      delete p.transport;
      forget(p, "transport");
    }
  }
  if (e.transports) {
    if (e.transports.length) setTransports(p, e.transports, now);
    else {
      delete p.transports;
      delete p.transport;
      forget(p, "transport");
    }
  }
  if (e.customFloors) setCustomFloors(p, e.customFloors, now);
  if (e.usualHomeBy !== undefined) {
    if (e.usualHomeBy) {
      p.usualHomeBy = e.usualHomeBy;
      setSaid(p, "homeBy", `${e.usualHomeBy} 前必须回去`, now);
    } else {
      delete p.usualHomeBy;
      forget(p, "homeBy");
    }
  }
  if (e.dietTags) {
    p.dietTags = [...new Set(e.dietTags)];
    forget(p, "diet:*");
    for (const t of p.dietTags) setSaid(p, `diet:${t}`, t === "清真" || t === "素食" ? `只能吃${t}` : t, now);
  }
  if (e.body) {
    p.body = [...new Set(e.body.map((b) => b.trim().slice(0, 20)).filter(Boolean))].slice(0, 5);
    forget(p, "body:*");
    for (const b of p.body) setSaid(p, `body:${b}`, b, now);
  }
  if (e.typicalBudget !== undefined) {
    if (e.typicalBudget && e.typicalBudget > 0) {
      p.typicalBudget = Math.round(e.typicalBudget);
      setSaid(p, "budget", `平时人均 ${p.typicalBudget} 左右`, now);
    } else {
      delete p.typicalBudget;
      forget(p, "budget");
    }
  }
  if (e.activityTastes) {
    const t: Record<string, number> = {};
    for (const [k, v] of Object.entries(e.activityTastes)) if (activityOf(k) && Number.isFinite(v)) t[k] = clamp1(v);
    p.activityTastes = t;
  }
  for (const k of e.forget ?? []) {
    forget(p, k);
    // 忘掉一条说过的事，对应的档案字段也一起清掉（不然下次又被预填回来）
    if (k === "homeBy") delete p.usualHomeBy;
    else if (k === "budget") delete p.typicalBudget;
    else if (k === "transport") {
      delete p.transport;
      delete p.transports;
    } else if (k === "floor:不吃辣") p.dietTags = p.dietTags.filter((t) => t !== "不吃辣");
    else if (k === "floor:剧烈运动") p.body = (p.body ?? []).filter((x) => x !== "不能剧烈运动");
    else if (k.startsWith("diet:")) p.dietTags = p.dietTags.filter((t) => t !== k.slice(5));
    else if (k.startsWith("body:")) p.body = (p.body ?? []).filter((b) => b !== k.slice(5));
  }
  if (e.forgetLearned) p.facts = (p.facts ?? []).filter((f) => f.source === "said");
  pruneFacts(p, now);
  return p;
}

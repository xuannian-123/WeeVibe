// v6 授权书（docs/AVATAR.md 第 2 节）：本人交给分身的东西 = 底线 floors / 可以让 give / 想要 wants。
// - mandateOf：合成完整授权书（唯一的计算入口，C 的授权书卡片和 D 的本人视图只读它）
// - planMember：规划用的"有效成员"——底线超过 3 条的降成强度 3 的软需求；坚持风格的想要强度 +1
// - giveInEffect / withGive：分身真正能用的让步幅度（授权书确认过才生效，撤回过的那一维视为 0），以及把它套到成员身上
// 确定性：只看成员自己的数据和固定规则；不依赖成员 id、加入顺序。
import type { AvatarStyle, DietTag, Give, MandateView, Member, MemberPrivate, Mood, Need, NeedStrength } from "../../types";
import { HARD_DIET } from "../diet";

/** 底线每人最多 3 条："底线越少，分身越好谈；真正必须的事 3 条够用" */
export const MAX_FLOORS = 3;

/** give 的默认值按风格（AVATAR.md 第 2 节） */
export const STYLE_GIVE: Record<AvatarStyle, Give> = {
  easy: { lateMin: 30, stayCutMin: 30, budgetUp: 30, commuteUp: 20 },
  balanced: { lateMin: 15, stayCutMin: 15, budgetUp: 15, commuteUp: 10 },
  firm: { lateMin: 0, stayCutMin: 0, budgetUp: 0, commuteUp: 0 },
};

export const ZERO_GIVE: Give = { lateMin: 0, stayCutMin: 0, budgetUp: 0, commuteUp: 0 };

/** give 的四个维度（固定顺序：枚举组合、写记录都按它） */
export const GIVE_DIMS: (keyof Give)[] = ["lateMin", "stayCutMin", "budgetUp", "commuteUp"];

/** 每一维 give 的上限：晚到最多再放 45 分钟（总共 90，和 v5 协商的边界一致）、至少待 30 分钟 */
export const GIVE_CAP: Give = { lateMin: 45, stayCutMin: 30, budgetUp: 200, commuteUp: 60 };

export const MOOD_TEXT: Record<Mood, string> = {
  hype: "这次想嗨一点",
  chill: "这次想安静聊聊",
  active: "这次想动一动",
  lazy: "这次想躺着",
};

// ---------------------------------------------------------------- 风格

// "就想 / 非…不可 / 一定要"是坚持；"都行 / 随便 / 你定"是随和。两种都说了按坚持算（说了具体想要的更要紧）
const FIRM_RE = /就想|就要|只想|一定要|非得|非.{0,6}不可|必须|坚决|说什么也|这次要|特别想|超想/;
const EASY_RE = /我都行|都行|都可以|随便|无所谓|你定|你们定|听大家的|随大流|没要求|没什么要求|看大家|都ok|都OK/;

/** 从这次说的话推断谈判风格；看不出来返回 undefined（调用方按平衡算） */
export function styleFromText(text: string): AvatarStyle | undefined {
  const s = (text ?? "").replace(/\s+/g, "");
  if (!s) return undefined;
  if (FIRM_RE.test(s)) return "firm";
  if (EASY_RE.test(s)) return "easy";
  return undefined;
}

/** 从本人的私聊记录推断（只看本人说的话；最近一句能推断出来的为准） */
function styleFromChat(p: MemberPrivate | undefined): AvatarStyle | undefined {
  const mine = (p?.chat ?? []).filter((t) => t.role === "me");
  for (let i = mine.length - 1; i >= 0; i--) {
    const s = styleFromText(mine[i].text);
    if (s) return s;
  }
  return undefined;
}

// ---------------------------------------------------------------- 底线

export type FloorItem = { key: string; text: string };

/** 一天里最早的门禁（多天不同时取最早的，保护本人） */
function homeByOf(p: MemberPrivate | undefined): string | undefined {
  const hbs = Object.keys(p?.availability ?? {})
    .sort()
    .map((d) => p!.availability[d]?.homeBy)
    .filter((x): x is string => !!x);
  if (!hbs.length) return undefined;
  // 凌晨的门禁（00:00–05:59）算更晚
  const rank = (hm: string) => {
    const [h, m] = hm.split(":").map(Number);
    return (h < 6 ? h + 24 : h) * 60 + m;
  };
  return [...hbs].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * 这个人所有的硬约束（底线候选），按"最早确认的在前"排：
 * 先是本人确认过的（按 confirmed 里的顺序），再是没走确认流程的（组件里亲手选的天然算数），按 门禁 → 清真 / 素食 → 硬需求（按时间）。
 */
export function floorCandidates(m: Member): FloorItem[] {
  const p = m.private;
  const items: (FloorItem & { order: number })[] = [];
  const hb = homeByOf(p);
  if (hb) items.push({ key: "homeBy", text: `${hb} 前得回去`, order: 0 });
  const diets = [...new Set(p?.dietTags ?? [])].filter((t) => HARD_DIET.includes(t));
  for (const t of HARD_DIET) if (diets.includes(t)) items.push({ key: `diet:${t}`, text: t === "清真" ? "只吃清真" : "吃素", order: 1 + HARD_DIET.indexOf(t) });
  // "九点门禁"常常被同时听成门禁（homeBy）和一条"21:00 前结束"的硬需求：同一个时刻算一条底线，别重复占名额
  const sameAsHomeBy = (n: Need) => !!hb && n.rule.t === "leaveBy" && n.rule.at === hb;
  const hard = (p?.needs ?? []).filter((n) => n.kind === "hard" && !sameAsHomeBy(n)).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  hard.forEach((n, i) => items.push({ key: n.id, text: n.text, order: 10 + i }));
  const confirmed = p?.confirmed ?? [];
  const rank = (it: { key: string; order: number }) => {
    const c = confirmed.indexOf(it.key);
    return c >= 0 ? c : 1000 + it.order;
  };
  return items.sort((a, b) => rank(a) - rank(b)).map(({ key, text }) => ({ key, text }));
}

/**
 * 底线 + 被降级的：超过 3 条时按本人在授权书里选中的（选了几条就是几条，没勾的是本人亲手降成"想要"的）；
 * 本人没选过才按最早确认的保留 3 条
 */
export function splitFloors(m: Member): { floors: FloorItem[]; demoted: FloorItem[] } {
  const all = floorCandidates(m);
  if (all.length <= MAX_FLOORS) return { floors: all, demoted: [] };
  const picked = (m.private?.mandate?.floors ?? []).filter((k) => all.some((f) => f.key === k)).slice(0, MAX_FLOORS);
  const chosen = new Set(picked.length ? picked : all.slice(0, MAX_FLOORS).map((f) => f.key));
  return { floors: all.filter((f) => chosen.has(f.key)), demoted: all.filter((f) => !chosen.has(f.key)) };
}

// ---------------------------------------------------------------- 授权书

function styleOf(m: Member): AvatarStyle {
  return m.private?.mandate?.style ?? styleFromChat(m.private) ?? "balanced";
}

const bump = (s: NeedStrength, firm: boolean): NeedStrength => (firm ? (Math.min(3, s + 1) as NeedStrength) : s);

/** 合成完整授权书（本人视图 + 局长内部用） */
export function mandateOf(m: Member): MandateView {
  const p = m.private;
  const style = styleOf(m);
  const firm = style === "firm";
  const { floors, demoted } = splitFloors(m);
  const wants: MandateView["wants"] = [];
  // 被降级的底线：想要里最用力的（强度 3），排在最前
  for (const d of demoted) wants.push({ key: d.key, text: d.text, strength: 3 });
  for (const n of p?.needs ?? []) if (n.kind === "soft") wants.push({ key: n.id, text: n.text, strength: bump(n.strength, firm) });
  if (p?.budgetMax !== undefined && p.budgetMax > 0) wants.push({ key: "budget", text: `人均 ${p.budgetMax} 以内`, strength: bump(p.budgetStrength ?? 2, firm) });
  for (const t of [...new Set(p?.dietTags ?? [])]) if (!HARD_DIET.includes(t)) wants.push({ key: `diet:${t}`, text: t, strength: bump(2, firm) });
  if (p?.mood) wants.push({ key: "mood", text: MOOD_TEXT[p.mood], strength: bump(2, firm) });
  return {
    style,
    give: clampGive(p?.mandate?.give ?? STYLE_GIVE[style]),
    floors,
    wants,
    demoted,
    ...(p?.mood ? { mood: p.mood } : {}),
    status: p?.mandate?.status ?? "draft",
  };
}

function clampGive(g: Partial<Give>): Give {
  const out = { ...ZERO_GIVE };
  for (const k of GIVE_DIMS) {
    const v = Number(g?.[k]);
    out[k] = Number.isFinite(v) ? Math.max(0, Math.min(GIVE_CAP[k], Math.round(v))) : 0;
  }
  return out;
}

/** 本人撤回过自动让步的维度（这一维这局里 give 视为 0） */
export function revokedDims(m: Member): Set<keyof Give> {
  return new Set((m.private?.avatarLog ?? []).filter((e) => e.revoked && e.dim).map((e) => e.dim!));
}

/**
 * 分身这次真正能用的让步幅度。
 * 授权书确认过才生效（草稿 = 本人还没把权交给分身，分身只守底线、不替人让步）；撤回过的那一维视为 0。
 */
export function giveInEffect(m: Member): Give {
  const md = m.private?.mandate;
  if (!md || md.status !== "confirmed") return { ...ZERO_GIVE };
  const g = clampGive(md.give ?? STYLE_GIVE[md.style ?? "balanced"]);
  for (const d of revokedDims(m)) g[d] = 0;
  return g;
}

export const hasGive = (g: Give) => GIVE_DIMS.some((k) => g[k] > 0);

// ---------------------------------------------------------------- 规划用的有效成员

/** 被降级的素食：以肉 / 海鲜为主的店按"很在意"扣分（DIET 规则里同一批词） */
const VEG_AVOID = ["烤肉", "烧烤", "海鲜", "火锅", "牛", "羊"];
/** 被降级的清真：不是清真店按"很在意"扣分 */
const HALAL_PREFER = ["清真", "兰州", "新疆", "西北", "回民"];

/** 被降级的底线变成什么软需求（强度 3） */
function demotedNeed(key: string, text: string, p: MemberPrivate, at: string): Need | undefined {
  if (key === "homeBy") {
    const hb = homeByOf(p);
    return hb ? { id: "demoted-homeBy", dim: "time", kind: "soft", strength: 3, rule: { t: "leaveBy", at: hb }, text, source: "widget", at } : undefined;
  }
  if (key === "diet:素食") return { id: "demoted-diet:素食", dim: "food", kind: "soft", strength: 3, rule: { t: "avoidCategory", words: VEG_AVOID }, text, source: "widget", at };
  if (key === "diet:清真") return { id: "demoted-diet:清真", dim: "food", kind: "soft", strength: 3, rule: { t: "preferCategory", words: HALAL_PREFER }, text, source: "widget", at };
  return undefined;
}

/**
 * 规划用的有效成员（不含 give）：
 * - 底线超过 3 条：被降级的门禁 → "想几点前结束"（强度 3），被降级的清真 / 素食 → 强度 3 的口味偏好，被降级的硬需求 → 强度 3 的软需求
 * - 坚持风格（授权书确认过）：软需求和预算的在意程度 +1（上限 3）
 * 没有变化时原样返回同一个对象。
 */
export function planMember(m: Member): Member {
  const p = m.private;
  if (!p) return m;
  const { demoted } = splitFloors(m);
  const firm = p.mandate?.status === "confirmed" && p.mandate.style === "firm";
  if (!demoted.length && !firm) return m;
  const q: MemberPrivate = { ...p };
  const at = "1970-01-01T00:00:00.000Z";
  let needs = [...(p.needs ?? [])];
  for (const d of demoted) {
    if (d.key === "homeBy") {
      q.availability = Object.fromEntries(
        Object.keys(p.availability).map((k) => {
          const { homeBy: _hb, ...rest } = p.availability[k];
          void _hb;
          return [k, rest];
        }),
      );
    } else if (d.key.startsWith("diet:")) {
      q.dietTags = q.dietTags.filter((t: DietTag) => `diet:${t}` !== d.key);
    } else {
      needs = needs.map((n) => (n.id === d.key ? { ...n, kind: "soft" as const, strength: 3 as const } : n));
      continue;
    }
    const n = demotedNeed(d.key, d.text, p, at);
    if (n) needs.push(n);
  }
  if (firm) {
    needs = needs.map((n) => (n.kind === "soft" && !n.id.startsWith("demoted-") ? { ...n, strength: bump(n.strength, true) } : n));
    if (p.budgetMax !== undefined) q.budgetStrength = bump(p.budgetStrength ?? 2, true);
  }
  if (needs.length || p.needs) q.needs = needs;
  return { ...m, private: q };
}

/** 门槛（和 experience.ts 的公开体验常数一致） */
const BASE_LATE = 45;
const BASE_STAY = 60;

/**
 * 把一部分 give 套到成员身上（只在需要时由谈判调用）：
 * 时间 → relax.maxLateMin = 45 + lateMin、relax.minStayMin = 60 − stayCutMin；预算 → 有效预算 budgetMax + budgetUp；
 * 通勤 → "单程别超过 X 分钟"这类软需求放宽 commuteUp。底线（门禁、清真 / 素食、硬需求）永远不放宽。
 */
export function withGive(m: Member, give: Give, dims: Iterable<keyof Give>): Member {
  const p = m.private;
  if (!p) return m;
  const q: MemberPrivate = { ...p };
  const ds = new Set(dims);
  if (ds.has("lateMin") && give.lateMin > 0) q.relax = { ...q.relax, maxLateMin: Math.max(q.relax?.maxLateMin ?? 0, BASE_LATE + give.lateMin) };
  if (ds.has("stayCutMin") && give.stayCutMin > 0) q.relax = { ...q.relax, minStayMin: Math.min(q.relax?.minStayMin ?? BASE_STAY, BASE_STAY - give.stayCutMin) };
  if (ds.has("budgetUp") && give.budgetUp > 0 && q.budgetMax !== undefined && q.budgetMax > 0) q.budgetMax = q.budgetMax + give.budgetUp;
  if (ds.has("commuteUp") && give.commuteUp > 0 && q.needs?.length)
    q.needs = q.needs.map((n) => (n.kind === "soft" && n.rule.t === "maxCommute" ? { ...n, rule: { ...n.rule, minutes: n.rule.minutes + give.commuteUp } } : n));
  return { ...m, private: q };
}

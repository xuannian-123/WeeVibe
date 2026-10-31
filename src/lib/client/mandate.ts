// v6 授权书（docs/AVATAR.md 第 2 节）：本地简化版 mandateOf + 授权书卡片要用的常量和纯函数。
// ⚠️ mandateOf 的正式实现由线 B 写在 planner/avatar/mandate.ts（同签名 mandateOf(member): MandateView）。
//    这里只是给授权书卡片展示用的本地版，合并时 leader 把 import 换成 B 的，常量以 B 的为准。
// 纯函数、无副作用：前端卡片和服务端 intake 都 import 这里（服务端只用常量和"讲究"标签映射）。
import type { AvatarStyle, DietTag, Give, MandateView, Member, MemberPrivate, Mood, Need, NeedStrength } from "../types";
import { activityKeyOfWord, activityOf } from "./activities";

/** 底线每人最多 3 条（AVATAR.md 第 0 节硬指标） */
export const MAX_FLOORS = 3;

/** give 默认值按风格（AVATAR.md 第 2 节） */
export const GIVE_BY_STYLE: Record<AvatarStyle, Give> = {
  easy: { lateMin: 30, stayCutMin: 30, budgetUp: 30, commuteUp: 20 },
  balanced: { lateMin: 15, stayCutMin: 15, budgetUp: 15, commuteUp: 10 },
  firm: { lateMin: 0, stayCutMin: 0, budgetUp: 0, commuteUp: 0 },
};

/** 授权书滑块的上限 */
export const GIVE_MAX: Give = { lateMin: 60, stayCutMin: 60, budgetUp: 100, commuteUp: 40 };

export const STYLE_LABEL: Record<AvatarStyle, string> = { easy: "随和", balanced: "平衡", firm: "坚持" };

export const MOOD_LABEL: Record<Mood, { text: string; emoji: string }> = {
  hype: { text: "想嗨", emoji: "🎉" },
  chill: { text: "想安静聊聊", emoji: "☕" },
  active: { text: "想动一动", emoji: "🏃" },
  lazy: { text: "想躺着", emoji: "🛋️" },
};

/** 建档的底线选项（一点即选，最多 3 条） */
export const ONBOARD_FLOORS = ["homeBy", "清真", "素食", "过敏", "膝盖不好", "不喝酒"] as const;
export type OnboardFloor = (typeof ONBOARD_FLOORS)[number];

/** 硬性的忌口（确认后可以当底线）；其余忌口是"想要" */
export const HARD_DIET: readonly DietTag[] = ["清真", "素食"];

// ---------------------------------------------------------------- 讲究标签 ↔ 需求

/**
 * 授权书「讲究」一栏的标签。每个标签要么是忌口（dietTags），要么是一条能算的需求。
 * match 用来从已有需求里认出这个标签（聊天里抽出来的"想安静点"= 点了「怕吵」），按规则类型认，不看具体参数。
 */
export type CareTag = {
  key: string;
  label: string;
  diet?: DietTag;
  need?: Omit<Need, "id" | "at" | "source">;
  match?: (n: Pick<Need, "dim" | "rule">) => boolean;
};

export const CARE_TAGS: CareTag[] = [
  { key: "quiet", label: "怕吵", need: { dim: "ambience", kind: "soft", strength: 2, rule: { t: "quiet" }, text: "想安静点、能好好聊天" }, match: (n) => n.rule.t === "quiet" },
  { key: "early", label: "不能太晚", need: { dim: "time", kind: "soft", strength: 2, rule: { t: "leaveBy", at: "21:30" }, text: "想 21:30 前结束" }, match: (n) => n.rule.t === "leaveBy" },
  { key: "nospicy", label: "不吃辣", diet: "不吃辣" },
  { key: "light", label: "在减肥", need: { dim: "food", kind: "soft", strength: 2, rule: { t: "lightFood" }, text: "想吃清淡点" }, match: (n) => n.rule.t === "lightFood" },
  { key: "noalcohol", label: "不喝酒", need: { dim: "ambience", kind: "soft", strength: 2, rule: { t: "noAlcohol" }, text: "不喝酒，别去以喝酒为主的地方" }, match: (n) => n.rule.t === "noAlcohol" },
  { key: "halal", label: "清真", diet: "清真" },
  { key: "veg", label: "素食", diet: "素食" },
  { key: "knee", label: "膝盖不好", need: { dim: "body", kind: "soft", strength: 3, rule: { t: "avoidCategory", words: ["徒步", "爬山", "攀岩"] }, text: "膝盖不好：别爬山、徒步、攀岩" }, match: (n) => n.dim === "body" },
  { key: "indoor", label: "想在室内", need: { dim: "ambience", kind: "soft", strength: 2, rule: { t: "indoor" }, text: "想在室内" }, match: (n) => n.rule.t === "indoor" },
  { key: "noqueue", label: "不想排队", need: { dim: "time", kind: "soft", strength: 2, rule: { t: "noQueue" }, text: "不想排队" }, match: (n) => n.rule.t === "noQueue" },
];

const TAG_BY_KEY = new Map(CARE_TAGS.map((t) => [t.key, t]));
export function careTag(key: string): CareTag | undefined {
  return TAG_BY_KEY.get(key);
}

/** 这个人现在点亮了哪些讲究标签（从忌口 + 需求里认） */
export function careTagsOf(p: Pick<MemberPrivate, "dietTags" | "needs">): string[] {
  return CARE_TAGS.filter((t) => (t.diet ? p.dietTags.includes(t.diet) : (p.needs ?? []).some((n) => t.match?.(n)))).map((t) => t.key);
}

/** 想干什么：preferCategory 需求里认得出来的活动 key */
export function wantedActivitiesOf(p: Pick<MemberPrivate, "needs">): string[] {
  const out: string[] = [];
  for (const n of p.needs ?? []) {
    if (n.rule.t !== "preferCategory") continue;
    for (const w of n.rule.words) {
      const k = activityKeyOfWord(w);
      if (k && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** 选中的活动 → 一条 preferCategory 需求（同一维度同一规则只留一条，所以整组一起写） */
export function activityNeed(keys: string[], strength: NeedStrength = 2): Omit<Need, "id" | "at" | "source"> | undefined {
  const acts = keys.map(activityOf).filter((a): a is NonNullable<typeof a> => !!a);
  if (!acts.length) return undefined;
  return { dim: "activity", kind: "soft", strength, rule: { t: "preferCategory", words: acts.map((a) => a.category) }, text: `想去${acts.map((a) => a.name).join("、")}` };
}

// ---------------------------------------------------------------- 底线候选

/**
 * 能当底线的东西（AVATAR.md 第 2 节）：门禁、清真 / 素食、硬需求。
 * 顺序 = 确认的先后（"没选就保留最早确认的 3 条"），没确认过的排在后面、保持原顺序。
 * 只看本次 MemberPrivate：档案里"分身猜的"永远进不来（它们只会被预填成软需求）。
 */
export function floorCandidates(p: MemberPrivate): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  const homeBy = Object.values(p.availability ?? {}).find((a) => a.homeBy)?.homeBy;
  if (homeBy) out.push({ key: "homeBy", text: `${homeBy} 前必须回去` });
  for (const t of p.dietTags ?? []) if (HARD_DIET.includes(t)) out.push({ key: `diet:${t}`, text: `只能吃${t}` });
  // 本人把软忌口（不吃辣…）亲手设成了底线
  for (const k of p.mandate?.floors ?? []) {
    const tag = k.startsWith("diet:") ? (k.slice(5) as DietTag) : undefined;
    if (tag && !HARD_DIET.includes(tag) && p.dietTags.includes(tag)) out.push({ key: k, text: `一点都${tag}` });
  }
  for (const n of p.needs ?? []) if (n.kind === "hard") out.push({ key: n.id, text: n.text });
  const order = new Map((p.confirmed ?? []).map((k, i) => [k, i]));
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (order.get(a.x.key) ?? 1e6 + a.i) - (order.get(b.x.key) ?? 1e6 + b.i))
    .map(({ x }) => x);
}

/** 本人选的底线：在候选里的、最多 3 条；没选过就是最早确认的 3 条 */
export function chosenFloors(p: MemberPrivate): string[] {
  const cands = floorCandidates(p).map((c) => c.key);
  const picked = (p.mandate?.floors ?? []).filter((k) => cands.includes(k));
  return (picked.length ? picked : cands).slice(0, MAX_FLOORS);
}

// ---------------------------------------------------------------- mandateOf（本地简化版）

const bump = (s: NeedStrength, firm: boolean): NeedStrength => (firm ? (Math.min(3, s + 1) as NeedStrength) : s);

/** 合成完整授权书。本地简化版，签名与线 B 的 planner/avatar/mandate.ts 一致 */
export function mandateOf(member: Member): MandateView {
  const p = member.private;
  const style: AvatarStyle = p?.mandate?.style ?? "balanced";
  const give: Give = p?.mandate?.give ?? GIVE_BY_STYLE[style];
  if (!p) return { style, give, floors: [], wants: [], demoted: [], status: "draft" };
  const firm = style === "firm";
  const cands = floorCandidates(p);
  const chosen = chosenFloors(p);
  const floors = chosen.map((k) => cands.find((c) => c.key === k)!).filter(Boolean);
  const demoted = cands.filter((c) => !chosen.includes(c.key));
  const wants: MandateView["wants"] = [];
  // 被降级的底线：强度 3 的"想要"（想要里最用力的）
  for (const d of demoted) wants.push({ key: d.key, text: d.text, strength: 3 });
  for (const n of p.needs ?? []) if (n.kind === "soft") wants.push({ key: n.id, text: n.text, strength: bump(n.strength, firm) });
  for (const t of p.dietTags ?? []) {
    const key = `diet:${t}`;
    if (!cands.some((c) => c.key === key)) wants.push({ key, text: t, strength: bump(2, firm) });
  }
  if (p.budgetMax) wants.push({ key: "budget", text: `人均 ${p.budgetMax} 以内`, strength: bump(p.budgetStrength ?? 2, firm) });
  if (p.mood) wants.push({ key: "mood", text: MOOD_LABEL[p.mood].text, strength: bump(1, firm) });
  return { style, give, floors, wants, demoted, ...(p.mood ? { mood: p.mood } : {}), status: p.mandate?.status ?? "draft" };
}

// v6 授权书（docs/AVATAR.md 第 2 节）：授权书卡片要用的常量和纯函数。
// 授权书怎么算只有一份实现：planner/avatar/mandate.ts（谈判也用它）。卡片上显示的必须和谈判时用的一模一样，
// 所以这里只做转发和 MemberPrivate 入参的包装，不另写规则。
// 纯函数、无副作用：前端卡片和服务端 intake 都 import 这里。
import { GIVE_CAP, MAX_FLOORS, STYLE_GIVE, floorCandidates as floorsOf, mandateOf, splitFloors } from "../planner/avatar/mandate";
import { HARD_DIET } from "../planner/diet";
import type { AvatarStyle, DietTag, Member, MemberPrivate, Mood, Need, NeedStrength } from "../types";
import { activityKeyOfWord, activityOf } from "./activities";

export { HARD_DIET, MAX_FLOORS, mandateOf };

/** give 默认值按风格（AVATAR.md 第 2 节） */
export const GIVE_BY_STYLE = STYLE_GIVE;

/** 授权书滑块的上限 = 谈判时 give 的封顶 */
export const GIVE_MAX = GIVE_CAP;

export const STYLE_LABEL: Record<AvatarStyle, string> = { easy: "随和", balanced: "平衡", firm: "坚持" };

export const MOOD_LABEL: Record<Mood, { text: string; emoji: string }> = {
  hype: { text: "想嗨", emoji: "🎉" },
  chill: { text: "想安静聊聊", emoji: "☕" },
  active: { text: "想动一动", emoji: "🏃" },
  lazy: { text: "想躺着", emoji: "🛋️" },
};

/** 建档的底线选项（一点即选，最多 3 条） */
// 按常见程度排：门禁、不喝酒、不吃辣、路程上限、过敏（要写对什么过敏）、身体原因；清真 / 素食放后面。其余的自己写
export const ONBOARD_FLOORS = ["homeBy", "不喝酒", "不吃辣", "commute", "过敏", "剧烈运动", "清真", "素食"] as const;
export type OnboardFloor = (typeof ONBOARD_FLOORS)[number];

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

/** 能当底线的东西（门禁、清真 / 素食、硬需求），最早确认的在前。档案里"分身猜的"永远进不来 */
export function floorCandidates(p: MemberPrivate): { key: string; text: string }[] {
  return floorsOf({ private: p } as Member);
}

/** 本人的底线：选中的优先，不够 3 条按最早确认的补齐 */
export function chosenFloors(p: MemberPrivate): string[] {
  return splitFloors({ private: p } as Member).floors.map((f) => f.key);
}

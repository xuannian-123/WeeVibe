// v6 发起人说的"安排"和"整体要求"（docs/AVATAR.md 第 3 节）。
// 安排：一句话里常常是一整个下午 + 晚上——"周五下午不知道去哪玩，晚上吃什么也没想好""先打羽毛球，打完吃火锅"
// "白天随便玩玩晚上吃顿好的"。按出现顺序拆成几段（吃 / 玩 / 喝），每段记下指定的活动和大概什么时候。
// 有两段不同的安排时，活动层只出这个顺序的两段式节目，每段的开始时间落在说好的时段里。
// 整体要求：发起人公开说的、关于整个局的约束（"有个人膝盖不好""大家都不喝酒"），不合适的活动直接不考虑。
import type { JuSpec, SpecPart } from "../types";
import { ACTIVITY_LIB, activitiesIn, activityByKey, type ActivityInfo } from "./activities";
import { customNeed } from "./customNeed";

/** 每个时段的开始时间范围（当天分钟） */
export const WHEN_WINDOW: Record<NonNullable<SpecPart["when"]>, [number, number]> = {
  morning: [8 * 60 + 30, 11 * 60 + 30],
  noon: [11 * 60, 13 * 60 + 30],
  afternoon: [13 * 60, 17 * 60 + 30],
  evening: [17 * 60, 20 * 60],
  night: [20 * 60 + 30, 23 * 60 + 30],
};
export const WHEN_LABEL: Record<NonNullable<SpecPart["when"]>, string> = { morning: "上午", noon: "中午", afternoon: "下午", evening: "晚上", night: "夜里" };
export const KIND_LABEL: Record<SpecPart["kind"], string> = { eat: "吃", play: "玩", drink: "喝点什么", any: "干点什么" };

/** 这个活动能不能当这一段 */
export function partMatches(a: ActivityInfo, part: SpecPart): boolean {
  if (part.activities?.length) return part.activities.includes(a.key);
  if (part.kind === "eat") return a.food;
  if (part.kind === "drink") return a.group === "drink";
  if (part.kind === "play") return !a.food && a.group !== "drink";
  return true;
}

/** 有效的两段安排（两段干的事不一样）；否则 undefined */
export function pairShape(spec: Pick<JuSpec, "shape">): [SpecPart, SpecPart] | undefined {
  const s = spec.shape;
  if (!s || s.length < 2) return undefined;
  return [s[0], s[1]];
}

/** 每段的开始时间都在说好的时段里（没说时段的段不限） */
export function segmentsInWindows(starts: number[], shape: SpecPart[]): boolean {
  return starts.every((t, k) => {
    const w = shape[k]?.when;
    if (!w) return true;
    const [a, b] = WHEN_WINDOW[w];
    return t >= a && t <= b;
  });
}

/** "下午玩 → 晚上吃" / "下午羽毛球 → 火锅" */
export function shapeLabel(shape: SpecPart[]): string {
  return shape
    .map((p) => {
      const what = p.activities?.length ? p.activities.map((k) => activityByKey(k)?.name ?? k).join("或") : KIND_LABEL[p.kind];
      return `${p.when ? WHEN_LABEL[p.when] : ""}${what}`;
    })
    .join(" → ");
}

// ---------------------------------------------------------------- 从一句话里认安排

const PERIODS: [RegExp, NonNullable<SpecPart["when"]>][] = [
  [/上午|早上|早晨|一早/, "morning"],
  [/中午|午饭|午餐/, "noon"],
  [/下午|白天|午后/, "afternoon"],
  [/傍晚|晚上|今晚|明晚|晚饭|晚餐|晚间/, "evening"],
  [/夜宵|宵夜|夜里|深夜/, "night"],
];
const EAT_RE = /吃|饭|餐|下馆子|搓一顿|撸串|夜宵|宵夜/;
const DRINK_RE = /喝(?:咖啡|奶茶|茶|酒|一杯|点)|咖啡|奶茶|下午茶|小酌/;
const PLAY_RE = /玩|逛|运动|打球|出汗|活动|散步|溜达|看个?展|看个?电影|看个?演出|唱个?歌|爬山|徒步|骑车|骑行/;
/** 把一句话按标点、先后词、时段词切开（切点留在后一段的开头） */
const SPLIT_RE = /[，,。；;！!？?\n]|(?=先|然后|之后|接着|再去|再吃|再找|打完|玩完|逛完|吃完|完了再)|(?=上午|中午|下午|傍晚|晚上|白天|夜里|晚饭|晚餐|午饭|夜宵|宵夜)/;

function kindOf(clause: string, acts: ActivityInfo[]): SpecPart["kind"] | undefined {
  if (acts.length) {
    if (acts.every((a) => a.food)) return "eat";
    if (acts.every((a) => a.group === "drink")) return "drink";
    if (acts.every((a) => !a.food)) return "play";
  }
  if (DRINK_RE.test(clause)) return "drink";
  if (EAT_RE.test(clause)) return "eat";
  if (PLAY_RE.test(clause)) return "play";
  return undefined;
}

/**
 * 一句话里的安排：按出现顺序拆成几段，相邻同类的合并。只有出现两段不同的事才算安排（返回 2 段），否则 undefined。
 * 没说时段的段：第一段跟着整句话里最早出现的时段，第二段留空（按第一段之后算）。
 */
export function detectShape(text: string): SpecPart[] | undefined {
  const clauses = (text ?? "").split(SPLIT_RE).map((s) => s.trim()).filter(Boolean);
  const parts: SpecPart[] = [];
  let when: SpecPart["when"];
  // 切开后时段词常常单独成一段（"下午 / 先去看个展"）：记下来给后面的那件事
  let pending: SpecPart["when"];
  for (const c of clauses) {
    const w = PERIODS.find(([re]) => re.test(c))?.[1] ?? pending;
    if (w) when = w;
    const acts = activitiesIn(c)
      .map((k) => activityByKey(k))
      .filter((a): a is ActivityInfo => !!a);
    const kind = kindOf(c, acts);
    if (!kind) {
      pending = w;
      continue;
    }
    pending = undefined;
    const prev = parts[parts.length - 1];
    const keys = acts.filter((a) => partMatches(a, { kind })).map((a) => a.key);
    if (prev && prev.kind === kind) {
      if (keys.length) prev.activities = [...new Set([...(prev.activities ?? []), ...keys])];
      if (!prev.when && w) prev.when = w;
      continue;
    }
    parts.push({ kind, ...(keys.length ? { activities: keys } : {}), ...(w ? { when: w } : {}) });
  }
  if (parts.length < 2) return undefined;
  const two = parts.slice(0, 2);
  if (!two[0].when && when) two[0].when = PERIODS.find(([re]) => re.test(text))?.[1];
  // 没说时段的"吃"跟着前一段推：上午玩完吃 = 午饭，下午玩完吃 = 晚饭，晚上玩完吃 = 夜宵（"打完一起吃个火锅"）
  const NEXT_MEAL: Partial<Record<NonNullable<SpecPart["when"]>, NonNullable<SpecPart["when"]>>> = { morning: "noon", noon: "evening", afternoon: "evening", evening: "night" };
  if (two[1].kind === "eat" && !two[1].when && two[0].when && NEXT_MEAL[two[0].when]) two[1].when = NEXT_MEAL[two[0].when];
  // 第二段时段比第一段早（"晚上吃，下午玩"说反了顺序）：按时段排
  const order = (p: SpecPart) => (p.when ? WHEN_WINDOW[p.when][0] : Infinity);
  if (two[0].when && two[1].when && order(two[1]) < order(two[0])) two.reverse();
  return two;
}

// ---------------------------------------------------------------- 整体要求

/** 关于整个局、能排除活动的公开说法："有个人膝盖不好""有人不喝酒""大家都不想爬山" */
const GROUP_RE = /有人|有个人|有一个人|有位|有朋友|有同学|有同事|有个朋友|有个同学|大家都|都不|我们都|室友/;

export function detectConstraints(text: string): string[] | undefined {
  const out = (text ?? "")
    .split(/[，,。；;！!？?\n]/)
    .map((s) => s.trim())
    .filter((s) => s && GROUP_RE.test(s) && bannedBy(s).length > 0)
    .map((s) => s.slice(0, 40));
  return out.length ? [...new Set(out)].slice(0, 5) : undefined;
}

/** 一条整体要求排除了哪些活动 */
function bannedBy(text: string): ActivityInfo[] {
  const cn = customNeed(text, "hard");
  const words = cn.needs.flatMap((n) => (n.rule.t === "avoidCategory" ? n.rule.words : [])).map((w) => w.toLowerCase());
  const noAlcohol = cn.needs.some((n) => n.rule.t === "noAlcohol");
  return ACTIVITY_LIB.filter((a) => (noAlcohol && a.alcohol) || [a.name, ...a.aliases].some((x) => words.includes(x.toLowerCase())));
}

/** 整体要求排除的活动 key */
export function groupBans(constraints: string[] | undefined): Set<string> {
  return new Set((constraints ?? []).flatMap((c) => bannedBy(c).map((a) => a.key)));
}

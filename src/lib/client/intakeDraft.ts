// v6 授权书卡片的草稿（docs/AVATAR.md 5.2）：本人视图 → 卡片格子 → 提交体。纯函数，组件和步数测试共用。
// 格子：哪天有空 / 从哪出发 / 预算 / 这次的状态 / 想干什么 / 讲究。前三格必填，后三格空着 = 交给分身和局长。
import type { AvatarStyle, DayAvailability, DietTag, Give, Ju, JuState, Member, Mood, Place, Profile } from "../types";
import type { ChatBody } from "./api";
import { activityOf } from "./activities";
import { weekday } from "./format";
import { careTag, careTagsOf, chosenFloors, GIVE_BY_STYLE, MOOD_LABEL, wantedActivitiesOf } from "./mandate";
import { moodDefault } from "./profileFacts";

export type Day = DayAvailability & { selected: boolean };

export type Draft = {
  rsvp: "yes" | "no";
  location: Place | null;
  days: Record<string, Day>;
  budget: string;
  /** 全部忌口（含讲究里的不吃辣 / 清真 / 素食） */
  diet: DietTag[];
  mood?: Mood;
  /** 这次的状态是分身按档案猜的（本人没说过） */
  moodGuessed?: boolean;
  activityOpen: boolean;
  activities: string[];
  /** 讲究里的需求类标签（忌口类在 diet 里） */
  tags: string[];
  style: AvatarStyle;
  give: Give;
  floors: string[];
};

export type CellKey = "when" | "from" | "budget" | "mood" | "activity" | "care";
export const CELLS: CellKey[] = ["when", "from", "budget", "mood", "activity", "care"];
/** 必须有值才能「就这样」 */
export const REQUIRED_CELLS: CellKey[] = ["when", "from", "budget"];

export function datesOf(ju: Ju): string[] {
  if (ju.spec.dates?.length) return ju.spec.dates;
  return [...new Set(ju.slots.map((s) => s.start.slice(0, 10)))];
}

/** 本人视图 → 草稿。explicitTimes = 本人已经动过时间（没时间时不再默认全选） */
export function draftFor(state: JuState, me: Member, profile?: Profile | null, opts: { explicitTimes?: boolean; now?: Date } = {}): Draft {
  const p = me.private;
  const [h, m] = state.ju.spec.earliest.split(":").map(Number);
  const minutes = Math.max(0, h * 60 + m - 30);
  const from = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const hasTimes = Object.keys(p?.availability ?? {}).length > 0;
  const guessed = !p?.mood ? moodDefault(profile, opts.now ?? new Date()) : undefined;
  const style = p?.mandate?.style ?? profile?.style ?? "balanced";
  const empty = { dietTags: [] as DietTag[], needs: [] };
  return {
    rsvp: p?.rsvp ?? "yes",
    location: me.location ?? null,
    days: Object.fromEntries(
      datesOf(state.ju).map((date) => [date, { from, pref: "ok" as const, ...p?.availability[date], selected: (!hasTimes && !opts.explicitTimes) || !!p?.availability[date] }]),
    ),
    budget: String(p?.budgetMax ?? state.ju.spec.budgetPerPerson ?? profile?.typicalBudget ?? 100),
    diet: [...(p?.dietTags ?? [])],
    ...(p?.mood ? { mood: p.mood } : guessed ? { mood: guessed, moodGuessed: true } : {}),
    activityOpen: !!p?.activityOpen,
    activities: wantedActivitiesOf(p ?? empty),
    tags: careTagsOf(p ?? empty).filter((k) => !careTag(k)?.diet),
    style,
    give: { ...(p?.mandate?.give ?? GIVE_BY_STYLE[style]) },
    floors: p ? chosenFloors(p) : [],
  };
}

const selectedDays = (d: Draft) => Object.entries(d.days).filter(([, x]) => x.selected);

/** 格子里显示的值；undefined = 空格 */
export function cellValues(d: Draft): Record<CellKey, string | undefined> {
  const days = selectedDays(d);
  const careLabels = [...d.diet, ...d.tags.map((k) => careTag(k)?.label ?? k)].filter((x, i, a) => a.indexOf(x) === i);
  const budget = Number(d.budget);
  return {
    when: days.length ? days.map(([date, x]) => `${weekday(date)} ${x.from} 后${x.homeBy ? `·${x.homeBy}前回` : ""}`).join("、") : undefined,
    from: d.location?.label || (d.location ? "已定位" : undefined),
    budget: Number.isFinite(budget) && budget > 0 ? `人均 ¥${Math.round(budget)} 以内` : undefined,
    mood: d.mood ? `${MOOD_LABEL[d.mood].emoji} ${MOOD_LABEL[d.mood].text}` : undefined,
    activity: d.activityOpen ? "🎲 局长定" : d.activities.length ? d.activities.map((k) => `${activityOf(k)?.emoji ?? ""}${activityOf(k)?.name ?? k}`).join("、") : undefined,
    care: careLabels.length ? careLabels.join("、") : undefined,
  };
}

/** 这一句话让哪些格子变了（亮起来） */
export function litCells(prev: Draft, next: Draft): CellKey[] {
  const a = cellValues(prev);
  const b = cellValues(next);
  return CELLS.filter((k) => a[k] !== b[k] && b[k] !== undefined);
}

/** 还空着的必填格 */
export function missingRequired(d: Draft): CellKey[] {
  const v = cellValues(d);
  return REQUIRED_CELLS.filter((k) => !v[k]);
}

/** 草稿 → 提交体（卡片上的选择都是完整选择） */
export function bodyOf(d: Draft, preferenceAction: "review" | "finish" | "swipe"): ChatBody {
  if (d.rsvp === "no") return { rsvp: "no", preferenceAction };
  const availability = Object.fromEntries(
    selectedDays(d).map(([date, x]) => [date, { from: x.from, pref: x.pref, ...(x.homeBy ? { homeBy: x.homeBy } : {}) }]),
  );
  const budget = Number(d.budget);
  return {
    rsvp: "yes",
    ...(d.location ? { location: d.location } : {}),
    availability,
    ...(Number.isFinite(budget) && budget > 0 ? { budgetMax: Math.round(budget) } : {}),
    dietTags: d.diet,
    mood: d.mood ?? null,
    activityOpen: d.activityOpen,
    activities: d.activityOpen ? [] : d.activities,
    tags: d.tags,
    mandate: { style: d.style, give: d.give, floors: d.floors },
    preferenceAction,
  };
}

/** 卡片上的问题（提交前的本地校验）；没问题返回 null */
export function draftProblem(d: Draft): string | null {
  if (d.rsvp === "no") return null;
  const miss = missingRequired(d);
  if (miss.includes("from")) return "先说一下从哪出发，局长才能算路程。";
  if (miss.includes("when")) return "至少选一天有空；这次都没空可以点「这次来不了」。";
  if (miss.includes("budget")) return "填一个人均预算。";
  if (selectedDays(d).some(([, x]) => !x.from || (x.homeBy && x.homeBy <= x.from))) return "到家时间需要晚于出发时间。";
  return null;
}

/** 输入框里的例句：用这次局的真实日期和城市 */
export function examplePrompt(ju: Ju, place?: string): string {
  const first = datesOf(ju)[0];
  const day = first ? weekday(first) : "周六";
  const from = place ? place.slice(0, 10) : ju.spec.city ? `${ju.spec.city}的公司` : "公司";
  return `比如：「${day}${ju.spec.earliest}后有空，从${from}出发，人均100左右，这周好累想安静聊聊」`;
}

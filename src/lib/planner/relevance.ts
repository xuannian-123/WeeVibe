// v6 这个局用得上哪些信息（docs/AVATAR.md 第 5 节）：前端授权书卡片和服务端预填共用，不依赖 node。
// - 发起人已经定了干什么（"下午去打羽毛球"）：不用再问"想干什么"
// - 这个局不吃饭（羽毛球、桌游、看展…）：忌口、过敏、在减肥这些不用问，也不从档案里拿出来
// 忌口、过敏原这类跟人走的事存在个人档案里，只在这个局可能吃饭时才拿出来用。
import type { JuSpec } from "../types";
import { ACTIVITY_LIB, activityByKey, libActivityOfWord } from "./activityLib";

/** 发起人说的品类词（"火锅""羽毛球/火锅""聚餐"）里认得出的活动 */
function activitiesOfCategory(category: string) {
  const words = (category ?? "").split(/[/→、,，\s]+/).filter(Boolean);
  return words.map((w) => libActivityOfWord(w) ?? ACTIVITY_LIB.find((a) => [a.name, ...a.aliases].some((x) => w.includes(x)))).filter((a): a is NonNullable<typeof a> => !!a);
}

/** 这个局有没有可能吃饭：局长定 / 安排里有吃 / 候选里有吃饭的活动 / 品类是吃的（认不出的品类按可能吃饭算，宁可多问） */
export function juMayEat(spec: Pick<JuSpec, "category" | "open" | "activities" | "shape">): boolean {
  if (spec.shape?.length) return spec.shape.some((p) => p.kind === "eat" || p.kind === "any" || (p.activities ?? []).some((k) => activityByKey(k)?.food));
  if (spec.activities?.length) return spec.activities.some((k) => activityByKey(k)?.food !== false);
  if (spec.open) return true;
  const acts = activitiesOfCategory(spec.category);
  if (!acts.length) return !/球|游戏|桌游|剧本|密室|唱|ktv|电影|展|爬山|徒步|骑|攀岩|滑|保龄|射箭|台球|运动|健身/i.test(spec.category ?? "");
  return acts.some((a) => a.food || a.group === "drink");
}

/** 发起人已经定了干什么：不用问"想干什么"。返回定下的活动名（给卡片显示），没定返回 undefined */
export function fixedActivity(spec: Pick<JuSpec, "category" | "open" | "activities" | "shape">): string | undefined {
  if (spec.open) return undefined;
  if (spec.shape?.length) {
    if (spec.shape.some((p) => !p.activities?.length)) return undefined;
    return spec.shape.map((p) => (p.activities ?? []).map((k) => activityByKey(k)?.name ?? k).join("或")).join(" → ");
  }
  if ((spec.activities?.length ?? 0) >= 2) return undefined;
  return spec.category?.trim() && spec.category !== "局长定" ? spec.category.trim() : undefined;
}

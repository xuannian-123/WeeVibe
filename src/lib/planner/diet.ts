import type { DietTag, Member, Poi } from "../types";

/** [关键词, 冲突原因]；长词在前，命中第一个即停 */
const RULES: Record<Exclude<DietTag, "清真">, [string | RegExp, string][]> = {
  不吃辣: [
    ["重庆", "重庆口味偏辣"],
    ["麻辣", "麻辣口味"],
    ["串串", "串串偏辣"],
    ["冒菜", "冒菜偏辣"],
    ["川", "川味偏辣"],
    ["湘", "湘菜偏辣"],
    ["火锅", "火锅多是辣锅"],
  ],
  素食: [
    ["烤肉", "以烤肉为主"],
    ["烧烤", "以烧烤为主"],
    ["海鲜", "以海鲜为主"],
    ["火锅", "火锅荤菜多"],
    ["牛", "主打牛肉"],
    ["羊", "主打羊肉"],
  ],
  不吃牛肉: [
    [/潮汕.{0,4}牛/, "潮汕牛肉"],
    ["牛排", "牛排店"],
    ["牛肉", "主打牛肉"],
  ],
  不吃海鲜: [
    ["海鲜", "以海鲜为主"],
    ["虾", "有虾"],
    ["蟹", "有蟹"],
    ["鱼", "有鱼"],
  ],
  不吃内脏: [
    ["毛肚", "有毛肚"],
    ["肥肠", "有肥肠"],
    ["卤味", "卤味"],
    ["内脏", "有内脏"],
  ],
};

const HALAL_WORDS = ["清真", "兰州", "新疆", "西北", "回民"];

export type DietCheck = {
  /** 形如 "小王：不吃辣（川味偏辣）" */
  conflicts: string[];
  /** 需要写进 reasons 的提示，如鸳鸯锅 */
  notes: string[];
};

export function isHotpotCategory(category: string | undefined): boolean {
  return (category ?? "").includes("火锅");
}

/** 返回某个忌口对这家店的冲突原因；无冲突返回 undefined */
export function dietConflictReason(tag: DietTag, poi: Pick<Poi, "name" | "type">): string | undefined {
  const text = `${poi.name} ${poi.type}`;
  if (tag === "清真") {
    return HALAL_WORDS.some((w) => text.includes(w)) ? undefined : "不是清真店";
  }
  const rules = RULES[tag];
  if (!rules) return undefined;
  for (const [kw, reason] of rules) if (typeof kw === "string" ? text.includes(kw) : kw.test(text)) return reason;
  return undefined;
}

/**
 * 逐个成员、逐个忌口对照店名 + 高德类型。
 * 例外：活动本身就是火锅时，"不吃辣"不算冲突，改为提示点鸳鸯锅。
 */
export function checkDiet(poi: Pick<Poi, "name" | "type">, members: Member[], category: string): DietCheck {
  const conflicts: string[] = [];
  let needYuanyang = false;
  const hotpot = isHotpotCategory(category);
  for (const m of members) {
    for (const tag of [...new Set(m.dietTags ?? [])]) {
      const reason = dietConflictReason(tag, poi);
      if (!reason) continue;
      if (tag === "不吃辣" && hotpot) {
        needYuanyang = true;
        continue;
      }
      conflicts.push(`${m.name}：${tag}（${reason}）`);
    }
  }
  return { conflicts, notes: needYuanyang ? ["有人不吃辣，记得点鸳鸯锅"] : [] };
}

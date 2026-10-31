// v6 自己写的底线 / 想要（建档、授权书卡片里的"自己写一条"）→ 能算的规则（docs/AVATAR.md 第 2、5 节）。
// 用户写的原话就是这条需求的文字（本人视图里照原样显示）；规则只决定局长能不能把它算进方案：
//   "十点前到家" → 门禁（每天的 homeBy）；"不吃辣 / 海鲜过敏" → 忌口，当底线时再加一条"避开这类店"；
//   "不想去 KTV / 想爬山" → 活动偏好；"路上别超过 40 分钟" → 路程上限；"膝盖不好 / 不能剧烈运动" → 避开累的活动；
//   算不了的（"花生过敏"）照样记下，规则是 custom —— 本人视图里如实说"局长没法算进去"。
import type { DietTag, Need, NeedDim, NeedRule } from "../types";
import { ACTIVITY_LIB, activitiesIn, activityByKey } from "./activities";
import { clockIn, extractNeeds, minutesIn } from "./needs";

export type CustomNeed = {
  needs: Omit<Need, "id" | "at" | "source">[];
  /** 识别出的忌口（不吃辣本身是软的；当底线时另有一条硬的"避开这类店"） */
  dietTags: DietTag[];
  /** "X 点前到家" = 门禁 */
  homeBy?: string;
};

const NEG_RE = /不|别|没法|讨厌|过敏|戒|忌/;
const HOME_RE = /到家|回家|回去|回宿舍|门禁|宿舍/;
const BODY_RE = /剧烈|运动不了|膝盖|腰|腿|脚踝|体力|累不得|心脏|哮喘|怀孕/;
const SPICY_WORDS = ["川菜", "湘菜", "麻辣", "串串", "冒菜", "干锅", "麻辣烫", "重庆", "辣"];
const SEAFOOD_WORDS = ["海鲜", "小龙虾", "蟹", "生蚝", "刺身"];

/** 运动量大的活动（膝盖不好、不能剧烈运动时避开）：名字 + 常见说法 */
function tiringWords(): string[] {
  return ACTIVITY_LIB.filter((a) => a.energy >= 2).flatMap((a) => [a.name, ...a.aliases]);
}

export function customNeed(raw: string, kind: "hard" | "soft"): CustomNeed {
  const text = raw.trim().replace(/\s+/g, " ").slice(0, 40);
  const strength = kind === "hard" ? 3 : 2;
  const out: CustomNeed = { needs: [], dietTags: [] };
  if (!text) return out;
  const add = (dim: NeedDim, rule: NeedRule) => out.needs.push({ dim, kind, strength, rule, text });
  const neg = NEG_RE.test(text);

  // 时间：几点前到家 = 门禁；几点前结束 = 最晚结束
  const clock = clockIn(text);
  if (clock && HOME_RE.test(text)) out.homeBy = clock;
  else if (clock && /前|之前|以前/.test(text)) add("time", { t: "leaveBy", at: clock });

  // 吃的
  if (/辣/.test(text) && neg) {
    out.dietTags.push("不吃辣");
    if (kind === "hard") add("food", { t: "avoidCategory", words: SPICY_WORDS });
  }
  if (/海鲜|虾|蟹|生蚝/.test(text) && neg) {
    out.dietTags.push("不吃海鲜");
    if (kind === "hard") add("food", { t: "avoidCategory", words: SEAFOOD_WORDS });
  }
  if (/牛肉/.test(text) && neg) out.dietTags.push("不吃牛肉");
  if (/内脏|下水/.test(text) && neg) out.dietTags.push("不吃内脏");
  if (/清真/.test(text)) out.dietTags.push("清真");
  if (/素食|吃素/.test(text)) out.dietTags.push("素食");
  if (/喝酒|酒精|不喝|酒局/.test(text) && neg && !/酒吧/.test(text)) add("ambience", { t: "noAlcohol" });

  // 身体：避开累的活动
  if (BODY_RE.test(text) && (neg || /不好|受伤|伤/.test(text))) add("body", { t: "avoidCategory", words: tiringWords() });

  // 活动：不想去 / 想去（"不想去 KTV" "想爬山"）
  const acts = activitiesIn(text)
    .map((k) => activityByKey(k))
    .filter((a): a is NonNullable<typeof a> => !!a)
    // "不喝酒"已经是一条规则了，别再把"喝酒"听成"不去清吧"
    .filter((a) => !(a.alcohol && out.needs.some((x) => x.rule.t === "noAlcohol")));
  if (acts.length && !out.needs.some((n) => n.dim === "body")) {
    const words = [...new Set(acts.flatMap((a) => [a.name, ...a.aliases]))];
    add("activity", neg ? { t: "avoidCategory", words } : { t: "preferCategory", words });
  }

  // 路程
  const mins = minutesIn(text);
  if (mins && /路|通勤|远|过去|单程|地铁|打车/.test(text)) add("travel", { t: "maxCommute", minutes: mins });

  // 其余能算的（想安静、不想排队、在室内…）
  if (!out.needs.length && !out.dietTags.length && !out.homeBy) for (const n of extractNeeds(text)) add(n.dim, n.rule);

  // 实在算不了：照样记下（本人视图里如实说局长没法算进去）
  if (!out.needs.length && !out.dietTags.length && !out.homeBy) add(/过敏|吃/.test(text) ? "food" : BODY_RE.test(text) ? "body" : "ambience", { t: "custom" });
  out.dietTags = [...new Set(out.dietTags)];
  return out;
}

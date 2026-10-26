// #19 每一轮玩什么：规则库 + 按"大家熟不熟、电量高不高、上一轮的反馈"选强度。
// 全是确定性规则（同样的输入同样的结果），只吃聚合数字，公开文案里不会出现任何个人信息。
import type { FeelCounts, RoundFeel, RoundFormat } from "../types";
import { hmacHex } from "./util";

const DINING = /火锅|烧烤|烤肉|日料|聚餐|吃饭|饭局|自助|串|料理|大排档|餐/;

/** 吃饭的局：轮次 = 换座；其他（桌游 / 团建 / 小组活动）：轮次 = 分组环节 */
export function isDiningCategory(category: string): boolean {
  return DINING.test(category);
}

const ACTIVITY: RoundFormat[] = [
  { key: "cards", name: "题目卡轮流答", intensity: 1, minutes: 25, how: "每桌一叠题目卡，轮流抽一张答，不想答的可以跳过，没人会追问" },
  { key: "pair-task", name: "两两搭档小任务", intensity: 1, minutes: 25, how: "同桌两两搭档，花 10 分钟找出 3 个你们的共同点，再互相介绍给桌上其他人" },
  { key: "coop", name: "小组合作挑战", intensity: 2, minutes: 35, how: "每桌一起完成一个小任务：30 分钟做出一份「周末去哪玩」攻略，最后每桌推荐一个" },
  { key: "undercover", name: "桌游：谁是卧底", intensity: 2, minutes: 30, how: "每桌一局谁是卧底，规则 1 分钟就能学会，边玩边认识" },
  { key: "relay", name: "跨桌你画我猜接力", intensity: 3, minutes: 30, how: "每桌一队，轮流派人上来画，全场一起猜，猜中得分" },
  { key: "mingle", name: "串桌聊天", intensity: 3, minutes: 30, how: "先按新座位坐下，聊开了可以拿着话题卡串到别桌，局长的话题卡管够" },
];

const DINING_FORMATS: RoundFormat[] = [
  { key: "dine-cards", name: "边吃边抽题目卡", intensity: 1, minutes: 40, how: "桌上放一叠题目卡，等菜的时候轮流抽，答不上来就吃一口" },
  { key: "dine-pick", name: "每桌合点一道", intensity: 1, minutes: 40, how: "每桌一起挑一道谁都没吃过的菜，点菜就是最好的破冰" },
  { key: "dine-swap", name: "吃到一半换座", intensity: 2, minutes: 45, how: "按局长排的座位换一次，换过来的人先讲讲上一桌聊了什么" },
  { key: "dine-toast", name: "串桌碰杯", intensity: 3, minutes: 30, how: "每人端着饮料去别的桌坐 10 分钟，不喝酒的以茶代酒，没人劝" },
];

function libraryFor(category: string): RoundFormat[] {
  return isDiningCategory(category) ? DINING_FORMATS : ACTIVITY;
}

export type FormatContext = {
  category: string;
  people: number;
  /** 排座前就认识的对数 / 总对数 */
  knownRatio: number;
  /** 今天想安静点的人数 */
  lowEnergy: number;
  /** 用来在同强度里挑一个（每个局不一样，同一个局复算一样） */
  key: string;
};

/** 第一轮的强度：大家不熟，或者有人想安静点（哪怕只有一位，对本人承诺过"先从轻松的开始"）→ 从最轻松的开始 */
export function firstIntensity(ctx: FormatContext): 1 | 2 {
  if (ctx.people <= 0) return 1;
  if (ctx.lowEnergy > 0 || ctx.knownRatio < 0.35) return 1;
  return 2;
}

/** 多数派感受（并列时按 拘谨 > 吵 > 刚好 的顺序保守处理） */
export function majorityFeel(feel: FeelCounts | undefined): RoundFeel | undefined {
  if (!feel || feel.total === 0) return undefined;
  const order: RoundFeel[] = ["stiff", "loud", "ok"];
  let best: RoundFeel | undefined;
  let bestN = 0;
  for (const k of order) {
    const n = feel[k];
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** 第 index 轮的强度：默认一轮比一轮热闹；上一轮拘谨就留在轻松档，太吵就降一档 */
export function nextIntensity(prev: 1 | 2 | 3, feel: RoundFeel | undefined): 1 | 2 | 3 {
  if (feel === "stiff") return 1;
  if (feel === "loud") return Math.max(1, prev - 1) as 1 | 2 | 3;
  return Math.min(3, prev + 1) as 1 | 2 | 3;
}

/** 在同强度里挑一个，尽量不和已经用过的重复 */
export function pickFormat(ctx: FormatContext, intensity: 1 | 2 | 3, index: number, used: string[]): RoundFormat {
  const lib = libraryFor(ctx.category);
  let pool = lib.filter((f) => f.intensity === intensity && !used.includes(f.key));
  if (!pool.length) pool = lib.filter((f) => !used.includes(f.key));
  if (!pool.length) pool = lib.filter((f) => f.intensity === intensity);
  if (!pool.length) pool = lib;
  const h = parseInt(hmacHex(ctx.key, `format:${index}:${intensity}`).slice(0, 8), 16);
  return { ...pool[h % pool.length] };
}

/** 整套轮次的初始玩法：第一轮按 firstIntensity，之后逐轮 +1 */
export function planFormats(ctx: FormatContext, rounds: number): RoundFormat[] {
  const out: RoundFormat[] = [];
  let level: 1 | 2 | 3 = firstIntensity(ctx);
  for (let i = 0; i < rounds; i++) {
    if (i > 0) level = nextIntensity(level, undefined);
    out.push(pickFormat(ctx, level, i, out.map((f) => f.key)));
  }
  return out;
}

/** 为什么第一轮这么安排（公开安全：只说"有朋友"，不说是谁、几个） */
export function firstRoundWhy(ctx: FormatContext): string {
  if (ctx.lowEnergy > 0 && ctx.knownRatio < 0.35) return "大家还不太熟，也有朋友今天想安静点，第一轮先玩轻松的，每桌都留了认识的人";
  if (ctx.lowEnergy > 0) return "有朋友今天想安静点，第一轮先玩轻松的，每桌都留了认识的人";
  if (ctx.knownRatio < 0.35) return "大家还不太熟，第一轮先玩轻松的，每桌都留了认识的人";
  return "大家多少都见过，第一轮直接分组玩，每桌都有认识的人";
}

/** 根据上一轮反馈调整后的说明（公开安全：只有聚合数字，样本太少就只说"根据反馈"） */
export function adjustText(feel: FeelCounts | undefined, next: RoundFormat, reseated: boolean): string {
  const maj = majorityFeel(feel);
  const counted = feel && feel.total >= 3;
  const lead =
    maj === "stiff"
      ? counted
        ? `上一轮有 ${feel!.stiff} 位朋友觉得有点拘谨`
        : "上一轮大家有点拘谨"
      : maj === "loud"
        ? counted
          ? `上一轮有 ${feel!.loud} 位朋友觉得有点吵`
          : "上一轮有点闹"
        : maj === "ok"
          ? "上一轮的节奏大家觉得刚好"
          : "";
  const tail =
    maj === "stiff"
      ? `这一轮换成「${next.name}」，有题目、不用当众表现${reseated ? "，座位也调了一下，每桌都留了认识的人" : ""}`
      : maj === "loud"
        ? `这一轮换成安静点的「${next.name}」`
        : `这一轮玩「${next.name}」`;
  return lead ? `${lead}，${tail}。` : `${tail}。`;
}

// ---------------------------------------------------------------- 话题卡

const QUESTIONS = [
  "最近一次说走就走，去了哪？",
  "如果明天放假一天，你会怎么过？",
  "最近循环最多的一首歌是什么？",
  "有没有一个小众但你超推荐的地方？",
  "小时候最想成为什么样的人？",
  "最近吃到最好吃的一顿是什么？",
  "你身上有什么别人想不到的小技能？",
  "最近一次笑到停不下来是因为什么？",
  "如果能立刻学会一样东西，你选什么？",
  "这学期 / 这个月最开心的一件事？",
];

/**
 * 一桌的话题卡：先放"这桌 N 个人都喜欢 X"（只来自大家自愿公开的兴趣，至少 2 人共有才说），
 * 再补一张通用题目卡（按密钥和桌号挑，复算一致）。
 */
export function tableTopics(interestsOf: string[][], key: string, tableId: string): string[] {
  const cnt = new Map<string, number>();
  for (const xs of interestsOf) for (const x of new Set(xs)) cnt.set(x, (cnt.get(x) ?? 0) + 1);
  const shared = [...cnt.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 2)
    .map(([x, n]) => `这桌有 ${n} 个人都喜欢「${x}」`);
  const h = parseInt(hmacHex(key, `topic:${tableId}`).slice(0, 8), 16);
  return [...shared, `话题卡：${QUESTIONS[h % QUESTIONS.length]}`];
}

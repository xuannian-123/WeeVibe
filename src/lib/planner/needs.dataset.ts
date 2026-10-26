// 理解测试集的数据（docs/DECISION.md 第 11 节）：真实说法 → 局长应该听出的需求。
// needs.test.ts（规则版）和 scripts/eval-needs.ts（大模型版）共用这一份。
import type { ExtractedNeed } from "./needs";

export type Exp = { dim: ExtractedNeed["dim"]; t: ExtractedNeed["rule"]["t"]; kind?: "hard" | "soft"; strength?: 1 | 2 | 3; minutes?: number; at?: string; words?: string[] };

/** 每条：原话 → 期望的需求（顺序无关）。空数组 = 什么都不该抽出来 */
export const UNDERSTANDING_SET: [string, Exp[]][] = [
  // 身体 / 通勤
  ["我腿受伤了，不想走太远", [{ dim: "body", t: "maxCommute", minutes: 25, strength: 3 }]],
  ["脚崴了，最近走路不方便", [{ dim: "body", t: "maxCommute" }]],
  ["腿脚不好，路上别超过二十分钟", [{ dim: "body", t: "maxCommute", minutes: 20 }]],
  ["别太远就行，我不想跑", [{ dim: "travel", t: "maxCommute", minutes: 30, kind: "soft" }]],
  ["路上最多一个小时，再远我就不去了", [{ dim: "travel", t: "maxCommute", minutes: 60, kind: "hard" }]],
  ["地铁半小时以内都可以", [{ dim: "travel", t: "maxCommute", minutes: 30, kind: "soft" }]],
  ["离我近点呗", [{ dim: "travel", t: "maxCommute" }]],
  ["太远了真的受不了", [{ dim: "travel", t: "maxCommute", strength: 3 }]],
  ["通勤不想超过40分钟", [{ dim: "travel", t: "maxCommute", minutes: 40 }]],
  ["最多半小时路程", [{ dim: "travel", t: "maxCommute", minutes: 30, kind: "hard" }]],
  // 环境
  ["想找个安静点的地方好好聊天", [{ dim: "ambience", t: "quiet" }]],
  ["别去太吵的地方", [{ dim: "ambience", t: "quiet" }]],
  ["能聊天的地方就行", [{ dim: "ambience", t: "quiet" }]],
  ["带着娃，最好别太吵", [{ dim: "ambience", t: "quiet" }]],
  ["我不喝酒，怕被劝", [{ dim: "ambience", t: "noAlcohol" }]],
  ["开车去的，喝不了酒", [{ dim: "ambience", t: "noAlcohol" }]],
  ["我对酒精过敏", [{ dim: "ambience", t: "noAlcohol" }]],
  ["最近怕冷，最好在室内", [{ dim: "ambience", t: "indoor" }]],
  ["别安排户外的，怕晒", [{ dim: "ambience", t: "indoor" }]],
  ["我怕热，夏天别在外面", [{ dim: "ambience", t: "indoor" }]],
  // 口味
  ["我在减肥，别太油", [{ dim: "food", t: "lightFood" }]],
  ["胃不好，吃清淡点", [{ dim: "food", t: "lightFood" }]],
  ["不想排队，等位太烦了", [{ dim: "time", t: "noQueue" }]],
  ["最怕排队了", [{ dim: "time", t: "noQueue" }]],
  // 时间（软）
  ["我想早点回去，明天早八", [{ dim: "time", t: "leaveBy", at: "21:30" }]],
  ["最好十点前结束", [{ dim: "time", t: "leaveBy", at: "22:00" }]],
  ["别搞太晚，第二天还要上班", [{ dim: "time", t: "leaveBy", at: "21:30" }]],
  ["明天要早起", [{ dim: "time", t: "leaveBy" }]],
  ["希望能早点散，十点前吧", [{ dim: "time", t: "leaveBy", at: "22:00" }]],
  ["9点半之前得走", [{ dim: "time", t: "leaveBy", at: "21:30" }]],
  // 品类
  ["不想吃火锅，上周刚吃过", [{ dim: "activity", t: "avoidCategory", words: ["火锅"] }]],
  ["KTV 就算了吧", [{ dim: "activity", t: "avoidCategory", words: ["KTV"] }]],
  ["火锅烧烤都不想吃", [{ dim: "activity", t: "avoidCategory", words: ["火锅", "烧烤"] }]],
  ["能不能别去酒吧", [{ dim: "activity", t: "avoidCategory", words: ["酒吧"] }]],
  ["不要KTV", [{ dim: "activity", t: "avoidCategory", words: ["KTV"] }]],
  ["想吃烤肉！", [{ dim: "activity", t: "preferCategory", words: ["烤肉"] }]],
  ["好想去剧本杀", [{ dim: "activity", t: "preferCategory", words: ["剧本杀"] }]],
  ["最好是桌游，大家能一起玩", [{ dim: "activity", t: "preferCategory", words: ["桌游"] }]],
  ["吃完想去唱歌", [{ dim: "activity", t: "preferCategory", words: ["KTV"] }]],
  ["想去密室", [{ dim: "activity", t: "preferCategory", words: ["密室"] }]],
  // 几条一起
  ["我腿不方便，而且不喝酒", [{ dim: "body", t: "maxCommute" }, { dim: "ambience", t: "noAlcohol" }]],
  ["想安静点，别太远，最好十点前能回", [{ dim: "ambience", t: "quiet" }, { dim: "travel", t: "maxCommute" }, { dim: "time", t: "leaveBy", at: "22:00" }]],
  ["减肥中，不想吃火锅", [{ dim: "food", t: "lightFood" }, { dim: "activity", t: "avoidCategory", words: ["火锅"] }]],
  // 什么都不该抽出来
  ["都行", []],
  ["没有了，谢谢局长", []],
  ["周五晚上可以", []],
  ["我从漕河泾出发", []],
  ["人均一百左右吧", []],
  ["哈哈好的", []],
  ["这个店远不远啊？", []],
  ["我没什么要求", []],
  ["宿舍11点门禁", []],
  ["不吃海鲜", []],
  ["日料或者火锅都行", []],
  ["唱歌也行，不唱也行", []],
  ["太晚也没关系", []],
  ["我是社长", []],
  ["好久没见大家了", []],
];

// v6 边说边填：从一句话里听出"这次的状态 / 想干什么 / 谈判风格"（规则版，确定性、不联网）。
// 只抽说了的；听不出来就不填，让格子保持空着（空格即方向）。
import type { AvatarStyle, Mood } from "../types";
import { LOCAL_ACTIVITIES } from "../client/activities";

const s0 = (t: string) => t.replace(/[\s，,。.!！?？~～、…]+/g, "");

// 顺序有讲究："不想动"里有"想动"，所以先认躺；"好累想聊聊"是想安静聊，不是想躺
const LAZY_RE = /不想动|懒得动|想躺|躺平|躺着|瘫着|葛优躺|宅着|不想出门|没力气|累(死|瘫|趴)?了?|好累|很累|太累|疲惫|乏了|困死/;
const CHILL_RE = /安静|聊聊|聊天|叙叙旧|叙旧|说说话|坐坐|慢慢吃|清净|别太吵|能聊/;
const HYPE_RE = /嗨|热闹|疯一下|疯一把|蹦迪|放飞|high|喝一杯|喝两杯|喝点|尽兴|闹一闹|撒欢/i;
const ACTIVE_RE = /出汗|出出汗|运动|动一动|动动|活动筋骨|锻炼|打球|爬山|攀岩|徒步|跑跑|消耗|燃脂/;

/** 这次的状态 */
export function ruleMood(text: string): Mood | undefined {
  const s = s0(text);
  if (!s) return undefined;
  const lazy = LAZY_RE.test(s);
  const chill = CHILL_RE.test(s);
  if (lazy) return chill ? "chill" : "lazy";
  if (ACTIVE_RE.test(s) && !/不想(运动|出汗|动)/.test(s)) return "active";
  if (chill) return "chill";
  if (HYPE_RE.test(s) && !/不想(嗨|喝)/.test(s)) return "hype";
  return undefined;
}

const EASY_RE = /我都行|都行|都可以|随便|无所谓|都ok|听大家的|你们定|大家定|不挑|看大家|随大流|都好/i;
const FIRM_RE = /就想|就要|只想|非得|非要|一定要|必须(是|得)?(吃|去|玩)|这次就|不然不去/;

/** 谈判风格：说了"我都行"= 随和；"这次就想吃火锅"= 坚持；听不出来不填（默认平衡） */
export function ruleStyle(text: string): AvatarStyle | undefined {
  const s = s0(text);
  if (!s) return undefined;
  if (FIRM_RE.test(s)) return "firm";
  if (EASY_RE.test(s)) return "easy";
  return undefined;
}

const OPEN_RE = /局长定|局长来定|听局长的|交给局长|(干|玩|吃|去)(啥|什么|哪)都(行|可以|ok)|没想好(干|玩|吃)|干什么都行/i;

/** 想干什么交给局长定 */
export function ruleActivityOpen(text: string): boolean {
  return OPEN_RE.test(s0(text));
}

const NEG_BEFORE = /(不想|不要|别去|别玩|别吃|别|不去|不吃|不玩|讨厌|受不了|不太想|不|没)$/;

/** 想干什么：认出来的活动 key（否定的不算："不想唱歌"）。 */
export function ruleActivities(text: string): string[] {
  const s = s0(text);
  const out: string[] = [];
  for (const a of LOCAL_ACTIVITIES) {
    const re = new RegExp(a.words.source, a.words.flags.includes("i") ? "gi" : "g");
    for (const m of s.matchAll(re)) {
      const before = s.slice(Math.max(0, (m.index ?? 0) - 3), m.index ?? 0);
      const after = s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 4);
      if (NEG_BEFORE.test(before) || /^(都?不想|算了|就算了|不去|pass)/i.test(after)) continue;
      if (!out.includes(a.key)) out.push(a.key);
    }
  }
  return out;
}

export type Intent = { mood?: Mood; style?: AvatarStyle; activityOpen?: boolean; activities?: string[] };

/** 一句话里的 v6 意图 */
export function ruleIntent(text: string): Intent {
  const out: Intent = {};
  const mood = ruleMood(text);
  if (mood) out.mood = mood;
  const style = ruleStyle(text);
  if (style) out.style = style;
  const acts = ruleActivities(text);
  if (acts.length) out.activities = acts;
  else if (ruleActivityOpen(text)) out.activityOpen = true;
  return out;
}

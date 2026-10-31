// v6 建档滑卡 / 授权书「想干什么」用的活动清单。LOCAL_ACTIVITIES 带滑卡文案；其余的从活动库（planner/activityLib，不依赖 node）补齐。
// 纯数据 + 纯函数：前端组件和服务端（intake / profile）都能 import。
import { ACTIVITY_LIB } from "../planner/activityLib";

export type LocalActivity = {
  /** = ActivityDef.key */
  key: string;
  name: string;
  emoji: string;
  /** 动静：0 躺 … 3 很累（同 ActivityDef.energy） */
  energy: 0 | 1 | 2 | 3;
  /** 能不能聊天：0 基本聊不了 … 2 就是来聊天的 */
  talk: 0 | 1 | 2;
  loud: boolean;
  /** 一句话卖点（滑卡上显示） */
  blurb: string;
  /** 话里怎么说它（意向抽取用） */
  words: RegExp;
  /** 写进 preferCategory 需求的品类词（planner/needs 认得的词） */
  category: string;
};

export const LOCAL_ACTIVITIES: LocalActivity[] = [
  { key: "hotpot", name: "火锅", emoji: "🍲", energy: 1, talk: 2, loud: true, blurb: "热气腾腾，边涮边聊", words: /火锅|涮/, category: "火锅" },
  { key: "bbq", name: "烧烤", emoji: "🍢", energy: 1, talk: 2, loud: true, blurb: "撸串配汽水，越晚越香", words: /烧烤|撸串|烤串|烤肉/, category: "烧烤" },
  { key: "ktv", name: "KTV", emoji: "🎤", energy: 2, talk: 0, loud: true, blurb: "麦霸的主场，吼完神清气爽", words: /ktv|唱歌|k歌|唱k|唱个歌/i, category: "KTV" },
  { key: "boardgame", name: "桌游", emoji: "🎲", energy: 1, talk: 2, loud: false, blurb: "狼人杀、阿瓦隆，坐着就能嗨", words: /桌游|狼人杀|阿瓦隆|uno|三国杀/i, category: "桌游" },
  { key: "jubensha", name: "剧本杀", emoji: "🕵️", energy: 1, talk: 2, loud: false, blurb: "沉浸推理，每个人都是主角", words: /剧本杀/, category: "剧本杀" },
  { key: "escape", name: "密室", emoji: "🔐", energy: 2, talk: 1, loud: true, blurb: "尖叫 + 解谜，一起逃出去", words: /密室/, category: "密室" },
  { key: "climbing", name: "攀岩", emoji: "🧗", energy: 3, talk: 1, loud: false, blurb: "出一身汗，手臂第二天会说话", words: /攀岩|抱石/, category: "攀岩" },
  { key: "hiking", name: "徒步", emoji: "🥾", energy: 3, talk: 2, loud: false, blurb: "走走山路，边走边聊", words: /徒步|爬山|登山|走山路/, category: "徒步" },
  { key: "exhibition", name: "看展", emoji: "🖼️", energy: 1, talk: 1, loud: false, blurb: "慢慢逛，拍照很出片", words: /看展|展览|美术馆|博物馆/, category: "展览" },
  { key: "livehouse", name: "Livehouse", emoji: "🎸", energy: 2, talk: 0, loud: true, blurb: "现场的鼓点，跟着蹦就对了", words: /livehouse|演出|看现场|音乐节/i, category: "Livehouse" },
  // 以下不进建档滑卡，只用于「想干什么」和意向抽取
  { key: "coffee", name: "咖啡", emoji: "☕", energy: 0, talk: 2, loud: false, blurb: "找个角落慢慢聊", words: /咖啡|喝杯咖啡/, category: "咖啡" },
  { key: "bar", name: "清吧", emoji: "🍸", energy: 0, talk: 2, loud: false, blurb: "小酌一杯", words: /清吧|小酌|喝一杯|喝两杯|酒吧/, category: "酒吧" },
  { key: "movie", name: "电影", emoji: "🎬", energy: 0, talk: 0, loud: false, blurb: "一起看场电影", words: /电影/, category: "电影" },
  { key: "homestyle", name: "家常菜", emoji: "🍚", energy: 0, talk: 2, loud: false, blurb: "安安静静吃顿好的", words: /家常菜|小炒|吃顿饭/, category: "家常菜" },
  { key: "badminton", name: "羽毛球", emoji: "🏸", energy: 3, talk: 1, loud: false, blurb: "打几局，出出汗", words: /羽毛球|打球/, category: "羽毛球" },
];

/** 建档滑卡的 10 张 */
export const ONBOARD_DECK = ["hotpot", "bbq", "ktv", "boardgame", "jubensha", "escape", "climbing", "hiking", "exhibition", "livehouse"] as const;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 授权书「想干什么」里能点的全部活动：带文案的在前，活动库里其余的补在后面 */
export const ALL_ACTIVITIES: LocalActivity[] = [
  ...LOCAL_ACTIVITIES,
  ...ACTIVITY_LIB.filter((a) => !LOCAL_ACTIVITIES.some((l) => l.key === a.key)).map((a) => ({
    key: a.key,
    name: a.name,
    emoji: a.emoji,
    energy: a.energy,
    talk: a.talk,
    loud: a.loud,
    blurb: "",
    words: new RegExp([a.name, ...a.aliases].map(escapeRe).join("|"), "i"),
    category: a.name,
  })),
];

const BY_KEY = new Map(ALL_ACTIVITIES.map((a) => [a.key, a]));

export function activityOf(key: string): LocalActivity | undefined {
  return BY_KEY.get(key);
}

/** 品类词（preferCategory.words 里的）→ 活动 key；认不出返回 undefined */
export function activityKeyOfWord(word: string): string | undefined {
  const w = word.trim();
  if (!w) return undefined;
  return ALL_ACTIVITIES.find((a) => a.category === w || a.name === w || a.words.test(w))?.key;
}

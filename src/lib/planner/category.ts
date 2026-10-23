// 品类过滤：搜出来的店必须是这次活动的品类（火锅局只出火锅店）。
// 高德按关键词搜周边时会带出菜单 / 标签里提到关键词的店（炒鸡、海鲜排档、酒店餐厅、咖啡厅…），必须先过滤。
import type { JuSpec, Poi } from "../types";

/** 品类 -> 店名 / 高德 type 里常见的写法（命中任意一个即算该品类） */
const SYNONYMS: [RegExp, string[]][] = [
  [/火锅|涮/, ["火锅", "串串", "涮肉", "涮锅", "涮", "打边炉", "旋转小火锅"]],
  [/烧烤|撸串|烤串/, ["烧烤", "烤串", "撸串", "串", "烧鸟", "烤肉"]],
  [/烤肉|烧肉/, ["烤肉", "烧肉", "炙子", "韩国料理", "烤肉店"]],
  [/ktv|k歌|唱歌|唱k/i, ["ktv", "k歌", "量贩", "唱吧", "练歌"]],
  [/桌游|狼人杀|棋牌/, ["桌游", "狼人杀", "棋牌", "桌面游戏"]],
  [/剧本杀|推理/, ["剧本杀", "推理", "剧本"]],
  [/密室/, ["密室"]],
  [/羽毛球/, ["羽毛球"]],
  [/台球|桌球/, ["台球", "桌球"]],
  [/咖啡/, ["咖啡"]],
];

/** 这次活动的品类词（关键词 + 品类 + 同义写法），小写去重 */
export function categoryWords(spec: Pick<JuSpec, "category" | "poiKeywords">): string[] {
  const base = [spec.category, ...(spec.poiKeywords ?? [])].map((x) => (x ?? "").trim()).filter(Boolean);
  const out = new Set<string>(base.map((x) => x.toLowerCase()));
  for (const w of base) for (const [re, syn] of SYNONYMS) if (re.test(w)) syn.forEach((s) => out.add(s.toLowerCase()));
  return [...out].sort();
}

/** 店名或高德 type 命中品类词 */
export function categoryMatches(poi: Pick<Poi, "name" | "type">, words: string[]): boolean {
  if (words.length === 0) return true;
  const text = `${poi.name} ${poi.type ?? ""}`.toLowerCase();
  return words.some((w) => w && text.includes(w));
}

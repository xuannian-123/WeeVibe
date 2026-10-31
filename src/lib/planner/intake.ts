// 入局相关：刷卡卡片（#6）、局长猜你（#6）、档案预填（#6）、课表 → 可出发时间（#7）。
import type { BusyBlock, DayAvailability, DietTag, Ju, JuSpec, MapProvider, Member, Poi, Profile, SwipeVerdict } from "../types";
import { juMayEat } from "./relevance";
import { haversineKm } from "../map/geo";
import { fairCenter } from "./center";
import { searchPois } from "./plan";
import { chainName, cmpStr, hmToMin, minToHm, sha256Hex, weekdayOf } from "./util";

export const DECK_MIN = 5;
export const DECK_MAX = 6;

/**
 * 刷卡卡片：公平集合点附近的 5–6 家真实店，刻意覆盖 最近 / 最便宜 / 最贵 / 评分最高，
 * 同品牌只出一张。同一个局里所有人看到同一批卡（只依赖局 id 和大家的出发地），确定性。
 */
export async function buildSwipeDeck(ju: Ju, members: Member[], me: Member, map: MapProvider): Promise<Poi[]> {
  const pts = members.filter((m) => m.status === "in" && m.location).map((m) => m.location!);
  if (pts.length === 0 && me.location) pts.push(me.location);
  const center = fairCenter(pts);
  const { pois } = await searchPois(ju, center, map);
  const byDist = pois
    .map((p) => ({ p, d: haversineKm(center, p) }))
    .sort((a, b) => a.d - b.d || cmpStr(a.p.id, b.p.id))
    .map((x) => x.p);
  const chains = new Set<string>();
  const uniq: Poi[] = [];
  for (const p of byDist) {
    const key = chainName(p.name);
    if (chains.has(key)) continue;
    chains.add(key);
    uniq.push(p);
  }
  const priced = uniq.filter((p) => p.costPerPerson !== undefined);
  const picks: Poi[] = [];
  const add = (p: Poi | undefined) => {
    if (p && !picks.includes(p) && picks.length < DECK_MAX) picks.push(p);
  };
  add(uniq[0]);
  add([...priced].sort((a, b) => a.costPerPerson! - b.costPerPerson! || cmpStr(a.id, b.id))[0]);
  add([...priced].sort((a, b) => b.costPerPerson! - a.costPerPerson! || cmpStr(a.id, b.id))[0]);
  add([...uniq].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || cmpStr(a.id, b.id))[0]);
  for (const p of uniq) add(p);
  return picks.sort((a, b) => cmpStr(sha256Hex(`${ju.id}|${a.id}`), sha256Hex(`${ju.id}|${b.id}`)));
}

/** 档案口味对一家店的打分（-1..1 附近） */
export function tasteScore(profile: Profile | undefined, poi: Poi): number {
  if (!profile) return 0;
  const text = `${poi.name} ${poi.type}`;
  let s = 0;
  for (const k of Object.keys(profile.tastes ?? {}).sort(cmpStr)) {
    const v = profile.tastes[k];
    if (k && Number.isFinite(v) && (text.includes(k) || chainName(poi.name) === k)) s += v;
  }
  const typical = profile.typicalBudget;
  if (typical && poi.costPerPerson !== undefined) {
    if (poi.costPerPerson > typical * 1.3) s -= 0.5;
    else if (poi.costPerPerson <= typical) s += 0.1;
  }
  for (const tag of profile.dietTags ?? []) {
    if (tag === "不吃辣" && /重庆|麻辣|川|湘|串串/.test(text)) s -= 0.6;
  }
  return s;
}

/** #6 局长猜你：按档案口味预测每张卡；没有档案时一律"想去"（温和默认） */
export function predictSwipes(profile: Profile | undefined, deck: Poi[]): Record<string, SwipeVerdict> {
  const out: Record<string, SwipeVerdict> = {};
  for (const poi of deck) {
    const s = tasteScore(profile, poi);
    out[poi.id] = s >= 0.6 ? "love" : s <= -0.3 ? "pass" : "like";
  }
  return out;
}

/**
 * #6 "都行"：按档案预填时间 / 预算 / 忌口。
 * 几点能出发跟这次活动有关（下午局 / 晚上局、周末 / 工作日都不一样），一律按这次的时间给温和默认值
 * （比最早开局提前 30 分钟）；门禁是跟人走的事实，才沿用档案。
 */
export function autofillFromProfile(
  profile: Profile | undefined,
  ju: Ju,
): { availability: Record<string, DayAvailability>; budgetMax?: number; dietTags: DietTag[] } {
  const earliest = hmToMin(ju.spec.earliest) ?? 18 * 60;
  const from = minToHm(Math.max(0, earliest - 30));
  const homeBy = hmToMin(profile?.usualHomeBy) !== undefined ? profile!.usualHomeBy : undefined;
  const availability: Record<string, DayAvailability> = {};
  for (const date of [...new Set(ju.spec.dates ?? [])].sort(cmpStr)) {
    availability[date] = { from, ...(homeBy ? { homeBy } : {}), pref: "ok" };
  }
  const out: { availability: Record<string, DayAvailability>; budgetMax?: number; dietTags: DietTag[] } = {
    availability,
    // 忌口跟人走、存在档案里：只在这个局可能吃饭时拿出来（打羽毛球就不用）
    dietTags: juMayEat(ju.spec) ? [...new Set(profile?.dietTags ?? [])] : [],
  };
  if (profile?.typicalBudget && profile.typicalBudget > 0) out.budgetMax = Math.round(profile.typicalBudget);
  return out;
}

/**
 * #7 课表 → 每天的可出发时间。
 * - 开局前（最晚开局时刻之前开始）的忙碌块：结束后才能出发 → from = 最晚的结束时刻
 * - 出发之后才开始的忙碌块（晚课 / 晚上有事）：之前得回来 → homeBy = 最早的开始时刻
 * - 忙到最晚开局之后：那天不行（不出现在结果里）
 * - pref：那天没课 best，有课 ok
 */
export function availabilityFromBusy(
  busy: BusyBlock[],
  spec: JuSpec,
  base?: { from?: string; homeBy?: string },
): Record<string, DayAvailability> {
  const earliest = hmToMin(spec.earliest) ?? 18 * 60;
  const latest = Math.max(earliest, hmToMin(spec.latest) ?? earliest);
  const baseFrom = hmToMin(base?.from) ?? Math.max(0, earliest - 60);
  const baseHome = hmToMin(base?.homeBy);
  const out: Record<string, DayAvailability> = {};
  for (const date of [...new Set(spec.dates ?? [])].sort(cmpStr)) {
    const wd = weekdayOf(date);
    const blocks = (busy ?? [])
      .filter((b) => b && b.weekday === wd)
      .map((b) => ({ from: hmToMin(b.from), to: hmToMin(b.to) }))
      .filter((b): b is { from: number; to: number } => b.from !== undefined && b.to !== undefined && b.to > b.from)
      .sort((a, b) => a.from - b.from || a.to - b.to);
    let from = baseFrom;
    for (const b of blocks) if (b.from < latest && b.to > from) from = Math.max(from, b.to);
    if (from > latest) continue; // 忙到最晚开局之后：那天不行
    let homeBy = baseHome;
    for (const b of blocks) if (b.from >= from && b.from > latest && (homeBy === undefined || b.from < homeBy)) homeBy = b.from;
    const day: DayAvailability = { from: minToHm(from), pref: blocks.length ? "ok" : "best" };
    if (homeBy !== undefined) day.homeBy = minToHm(homeBy);
    out[date] = day;
  }
  return out;
}

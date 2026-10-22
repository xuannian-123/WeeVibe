import type { Commute, Ju, LatLng, MapProvider, Member, Plan, PlanOption, Poi } from "../types";
import { estimateCommute, haversineKm, round1 } from "../map/geo";
import { fairCenter } from "./center";
import { checkDiet } from "./diet";
import { scoreOption } from "./score";
import { generateSlots, pickSlot } from "./slots";

export const SEARCH_RADIUS_M = 3000;
export const SEARCH_RADIUS_WIDE_M = 6000;
export const MIN_RESULTS = 5;
export const PREFILTER_TOP = 8;
export const OPTION_COUNT = 3;

/** 去掉括号里的分店名，用于同名连锁去重 */
export function chainName(name: string): string {
  return name.replace(/[（(][^）)]*[）)]/g, "").trim();
}

/** 预算 = spec.budgetPerPerson 与各 attendee budgetMax 中最小的正数 */
export function effectiveBudget(specBudget: number | undefined, attendees: Member[]): number | undefined {
  const all = [specBudget, ...attendees.map((m) => m.budgetMax)].filter(
    (x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0,
  );
  return all.length ? Math.min(...all) : undefined;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildReasons(
  poi: Poi,
  commutes: Commute[],
  maxCommute: number,
  budget: number | undefined,
  notes: string[],
): string[] {
  const reasons: string[] = [`最远的人打车 ${maxCommute} 分钟`];
  if (commutes.length >= 2) {
    const minC = Math.min(...commutes.map((c) => c.minutes));
    const diff = maxCommute - minC;
    reasons.push(
      diff <= 2
        ? `${commutes.length} 个人通勤时间几乎一样`
        : `${commutes.length} 个人里最远和最近${diff <= 10 ? "只" : ""}差 ${diff} 分钟`,
    );
  }
  const cost = poi.costPerPerson;
  if (cost !== undefined && budget !== undefined) {
    reasons.push(cost <= budget ? `人均 ${cost} 元，在 ${budget} 元预算内` : `人均 ${cost} 元，超预算 ${cost - budget} 元`);
  } else if (cost !== undefined) {
    reasons.push(`人均 ${cost} 元`);
  }
  if (poi.rating !== undefined) reasons.push(`评分 ${poi.rating}`);
  return [...reasons, ...notes];
}

/**
 * 出方案：
 * 1. pickSlot 选时间 → attendees 位置求 minimax 公平中心
 * 2. 中心 3km 搜店，不足 5 家扩到 6km
 * 3. 按"到各人直线距离最大值"预筛 8 家，并发查通勤（单家失败用直线估算兜底）
 * 4. 确定性打分 → 同名连锁去重 → 取前 3
 */
export async function planJu(
  ju: Ju,
  members: Member[],
  map: MapProvider,
  opts: { now?: Date } = {},
): Promise<Plan> {
  const spec = ju.spec;
  const slots = ju.slots?.length ? ju.slots : generateSlots(spec);
  if (slots.length === 0) throw new Error("没有候选时间，无法出方案");

  const pick = pickSlot(slots, members);
  const byId = new Map(members.map((m) => [m.id, m]));
  const attendees = pick.attendeeIds.map((id) => byId.get(id)!).filter(Boolean);
  if (attendees.length === 0) throw new Error("还没有人能在任何候选时间到场，无法出方案");

  const center = fairCenter(attendees.map((m) => m.location));
  const keywords = (spec.poiKeywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (keywords.length === 0 && spec.category?.trim()) keywords.push(spec.category.trim());
  if (keywords.length === 0) throw new Error("没有场地关键词，无法搜店");

  let pois = await map.searchAround(center, keywords, SEARCH_RADIUS_M, spec.city);
  if (pois.length < MIN_RESULTS) {
    const wide = await map.searchAround(center, keywords, SEARCH_RADIUS_WIDE_M, spec.city);
    if (wide.length > pois.length) pois = wide;
  }
  const uniq = new Map<string, Poi>();
  for (const p of pois) if (!uniq.has(p.id)) uniq.set(p.id, p);
  pois = [...uniq.values()];
  if (pois.length === 0) throw new Error(`公平集合点 ${SEARCH_RADIUS_WIDE_M / 1000} 公里内没找到「${keywords.join("/")}」`);

  // 预筛：到各 attendee 直线距离的最大值最小的 8 家
  const origins: LatLng[] = attendees.map((m) => m.location);
  const shortlist = pois
    .map((poi) => ({ poi, far: Math.max(...origins.map((o) => haversineKm(o, poi))) }))
    .sort((a, b) => a.far - b.far || cmpStr(a.poi.id, b.poi.id))
    .slice(0, PREFILTER_TOP)
    .map((x) => x.poi);

  const commuteRows = await Promise.all(
    shortlist.map(async (poi) => {
      try {
        const rows = await map.commute(origins, poi);
        if (rows.length !== origins.length) throw new Error("通勤结果条数不对");
        return rows;
      } catch {
        return origins.map((o) => estimateCommute(o, poi));
      }
    }),
  );

  const budget = effectiveBudget(spec.budgetPerPerson, attendees);
  const categoryWords = [spec.category, ...keywords].filter((x): x is string => !!x && !!x.trim());

  const scored: PlanOption[] = shortlist.map((poi, i) => {
    const commutes: Commute[] = attendees.map((m, j) => ({
      memberId: m.id,
      minutes: Math.round(commuteRows[i][j].minutes),
      distanceKm: round1(commuteRows[i][j].distanceKm),
    }));
    const maxCommute = Math.max(...commutes.map((c) => c.minutes));
    const avgCommute = round1(commutes.reduce((s, c) => s + c.minutes, 0) / commutes.length);
    const diet = checkDiet(poi, attendees, spec.category);
    const score = scoreOption({
      poi,
      center,
      maxCommute,
      avgCommute,
      budget,
      categoryWords,
      conflictCount: diet.conflicts.length,
    });
    return {
      poi,
      score,
      commutes,
      maxCommute,
      avgCommute,
      conflicts: diet.conflicts,
      reasons: buildReasons(poi, commutes, maxCommute, budget, diet.notes),
    };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.maxCommute - b.maxCommute ||
      a.avgCommute - b.avgCommute ||
      cmpStr(a.poi.id, b.poi.id),
  );

  const options: PlanOption[] = [];
  const chains = new Set<string>();
  for (const opt of scored) {
    const key = chainName(opt.poi.name);
    if (chains.has(key)) continue;
    chains.add(key);
    options.push(opt);
    if (options.length >= OPTION_COUNT) break;
  }

  return {
    slotId: pick.slotId,
    attendeeIds: pick.attendeeIds,
    absentIds: pick.absentIds,
    center,
    options,
    computedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** AA：人均向上取整到 1 元 */
export function settle(total: number, attendeeCount: number): { total: number; perPerson: number } {
  const t = Number.isFinite(total) && total > 0 ? Math.round(total * 100) / 100 : 0;
  const n = Math.max(1, Math.floor(Number.isFinite(attendeeCount) ? attendeeCount : 1));
  const cents = Math.round(t * 100);
  return { total: t, perPerson: Math.ceil(cents / n / 100 - 1e-9) };
}

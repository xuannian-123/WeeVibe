// 确定性打分（0–100）。所有常数集中在这里，路演讲技术 / 写推荐语时以此为准。
import type { LatLng, Poi } from "../types";
import { clamp01, haversineKm } from "../map/geo";

export const WEIGHTS = {
  maxCommute: 45, // 最长通勤：≤10 分钟满分，≥60 分钟 0 分，线性
  avgCommute: 15, // 平均通勤：≤10 分钟满分，≥50 分钟 0 分，线性
  budget: 20, // 人均 ≤ 预算满分；超出按比例扣，超 50% 记 0；无数据/无预算记中性 14
  rating: 10, // 评分 3.5 → 0，5.0 → 10；无评分记中性 5
  fit: 10, // 品类匹配 5 + 离公平中心距离余量 5（0 km 满分，≥3 km 0 分）
  conflict: 15, // 每个忌口冲突扣 15
} as const;

export const BUDGET_NEUTRAL = 14;
export const RATING_NEUTRAL = 5;

export function maxCommuteScore(maxMin: number): number {
  return WEIGHTS.maxCommute * clamp01((60 - maxMin) / 50);
}
export function avgCommuteScore(avgMin: number): number {
  return WEIGHTS.avgCommute * clamp01((50 - avgMin) / 40);
}
export function budgetScore(cost: number | undefined, budget: number | undefined): number {
  if (cost === undefined || budget === undefined || budget <= 0) return BUDGET_NEUTRAL;
  if (cost <= budget) return WEIGHTS.budget;
  return WEIGHTS.budget * clamp01(1 - (2 * (cost - budget)) / budget);
}
export function ratingScore(rating: number | undefined): number {
  if (rating === undefined) return RATING_NEUTRAL;
  return WEIGHTS.rating * clamp01((rating - 3.5) / 1.5);
}
export function categoryMatches(poi: Pick<Poi, "name" | "type">, words: string[]): boolean {
  const text = `${poi.name} ${poi.type}`.toLowerCase();
  return words.some((w) => w.trim() && text.includes(w.trim().toLowerCase()));
}
export function fitScore(poi: Poi, center: LatLng, words: string[]): number {
  const cat = categoryMatches(poi, words) ? 5 : 0;
  const near = 5 * clamp01(1 - haversineKm(center, poi) / 3);
  return cat + near;
}

export type ScoreInput = {
  poi: Poi;
  center: LatLng;
  maxCommute: number;
  avgCommute: number;
  budget?: number;
  categoryWords: string[];
  conflictCount: number;
};

export function scoreOption(i: ScoreInput): number {
  const raw =
    maxCommuteScore(i.maxCommute) +
    avgCommuteScore(i.avgCommute) +
    budgetScore(i.poi.costPerPerson, i.budget) +
    ratingScore(i.poi.rating) +
    fitScore(i.poi, i.center, i.categoryWords) -
    WEIGHTS.conflict * i.conflictCount;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

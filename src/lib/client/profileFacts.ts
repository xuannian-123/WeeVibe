// v6 固定档案的只读计算（纯函数，前端卡片 / /me 页面和服务端 profile.ts 共用）。
// 「我说的」不淡化；「分身猜的」按半衰期 60 天淡化，淡到 0.1 以下就当忘了。
import type { Mood, Profile, ProfileFact } from "../types";
import { LOCAL_ACTIVITIES } from "./activities";

export const HALF_LIFE_DAYS = 60;
const DAY_MS = 86_400_000;
/** 淡化到这个把握度以下就当忘了（写档案时会被删掉） */
export const FORGET_BELOW = 0.1;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp1 = (x: number) => Math.max(-1, Math.min(1, Math.round(x * 100) / 100));

/** 一条事实现在的把握度：said 不淡化；learned 按半衰期 60 天衰减 */
export function factConfidence(f: ProfileFact, now: Date): number {
  if (f.source === "said") return f.confidence;
  const days = Math.max(0, (now.getTime() - Date.parse(f.at)) / DAY_MS);
  return r3(f.confidence * 0.5 ** (days / HALF_LIFE_DAYS));
}

/** 分身现在还记得的猜测（把握度是淡化后的，从高到低） */
export function learnedFacts(p: Profile | null | undefined, now: Date): ProfileFact[] {
  return (p?.facts ?? [])
    .filter((f) => f.source === "learned")
    .map((f) => ({ ...f, confidence: factConfidence(f, now) }))
    .filter((f) => f.confidence >= FORGET_BELOW)
    .sort((a, b) => b.confidence - a.confidence || (a.key < b.key ? -1 : 1));
}

/** 本人说过的事实 */
export function saidFacts(p: Profile | null | undefined): ProfileFact[] {
  return (p?.facts ?? []).filter((f) => f.source === "said");
}

const confOf = (p: Profile | null | undefined, key: string, now: Date) => learnedFacts(p, now).find((f) => f.key === key)?.confidence ?? 0;

/**
 * 活动口味（给活动打分用）：activityTastes（本人滑卡 / 改过的）+ 分身猜的增减（按淡化后的把握度）。
 * 线 A 打分时请读这个，而不是直接读 activityTastes（那里只有本人说的）。
 */
export function tastesOf(p: Profile | null | undefined, now: Date): Record<string, number> {
  const out: Record<string, number> = { ...(p?.activityTastes ?? {}) };
  for (const f of learnedFacts(p, now)) {
    const m = /^taste:([a-z]+):([+-])$/.exec(f.key);
    if (m) out[m[1]] = clamp1((out[m[1]] ?? 0) + (m[2] === "+" ? 0.5 : -0.5) * f.confidence);
  }
  // 上次太累：高强度的活动降权
  const tired = confOf(p, "lowEnergy", now);
  if (tired) for (const a of LOCAL_ACTIVITIES) if (a.energy >= 2) out[a.key] = clamp1((out[a.key] ?? 0) - 0.4 * tired);
  return out;
}

/** 下次授权书里"这次的状态"的默认值（猜的，把握度 ≥ 0.3 才给） */
export function moodDefault(p: Profile | null | undefined, now: Date): Mood | undefined {
  const best = learnedFacts(p, now).find((f) => f.key.startsWith("mood:") && f.confidence >= 0.3);
  return best ? (best.key.slice(5) as Mood) : undefined;
}

/** 分身猜的通勤容忍（分钟）；没猜过返回 undefined */
export function commuteLimitOf(p: Profile | null | undefined, now: Date): number | undefined {
  const f = learnedFacts(p, now).find((x) => x.key.startsWith("maxCommute:"));
  return f ? Number(f.key.slice(11)) : undefined;
}

/** 还没完成首次建档 */
export function needsOnboarding(p: Profile | null | undefined): boolean {
  return !p?.onboardedAt;
}

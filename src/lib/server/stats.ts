// GET /api/stats：PMF 数据。只统计非演示成员（isDemo !== true）。
// 口径：真实成员按人次计（退出的也算一次入局）；“真实局” = 至少 2 个真实成员。
import * as db from "../db";
import type { Ju, Member, Stats } from "../types";

export const HOURLY_WINDOW = 72;
const HOUR_MS = 3600_000;
const SH_OFFSET_MS = 8 * HOUR_MS;

const pad = (n: number) => String(n).padStart(2, "0");

/** 北京时间整点标签，如 "2026-10-22T18:00+08:00" */
function hourLabel(utcMs: number): string {
  const d = new Date(utcMs + SH_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:00+08:00`;
}

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return Math.round(v * 10) / 10;
}

/** 这个成员有没有在私聊里主动说过私密约束（预算 / 门禁 / 备注 / 私下拒绝）。局长预填的不算 */
export function sharedPrivate(m: Member): boolean {
  const p = m.private;
  if (!p) return false;
  const auto = new Set(p.autoFilled ?? []);
  if (p.rsvp === "no") return true;
  if (p.budgetMax !== undefined && !auto.has("budget")) return true;
  if ((p.notes ?? []).length > 0) return true;
  if (!auto.has("availability") && Object.values(p.availability ?? {}).some((d) => !!d.homeBy)) return true;
  return false;
}

/** 私聊里真的开过口的人（至少说过一句话） */
function chatted(m: Member): boolean {
  return (m.private?.chat ?? []).some((t) => t.role === "me");
}

export function computeStats(jus: Ju[], members: Member[], now = new Date()): Stats {
  const real = members.filter((m) => !m.isDemo);
  const realByJu = new Map<string, number>();
  for (const m of real) realByJu.set(m.juId, (realByJu.get(m.juId) ?? 0) + 1);

  const realJus = jus
    .filter((j) => (realByJu.get(j.id) ?? 0) >= 2)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const fills = real.map((m) => m.fillSeconds).filter((x): x is number => typeof x === "number" && Number.isFinite(x));

  // 最近 72 个北京时间整点（含当前这个小时），按时间正序。+08:00 是整小时偏移，UTC 取整点即可
  const currentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const firstHour = currentHour - (HOURLY_WINDOW - 1) * HOUR_MS;
  const buckets = new Array<number>(HOURLY_WINDOW).fill(0);
  for (const m of real) {
    const t = Date.parse(m.joinedAt);
    if (!Number.isFinite(t) || t < firstHour || t >= currentHour + HOUR_MS) continue;
    buckets[Math.floor((t - firstHour) / HOUR_MS)]++;
  }

  const medianFillSeconds = median(fills);
  const talkers = real.filter(chatted);
  const privateShareRate =
    talkers.length > 0 ? Math.round((talkers.filter(sharedPrivate).length / talkers.length) * 1000) / 1000 : undefined;
  return {
    juCount: realJus.length,
    confirmedCount: realJus.filter((j) => j.status === "confirmed").length,
    memberCount: real.length,
    ...(medianFillSeconds !== undefined ? { medianFillSeconds } : {}),
    ...(privateShareRate !== undefined ? { privateShareRate } : {}),
    recent: realJus.slice(0, 10).map((j) => ({
      id: j.id,
      title: j.title,
      members: realByJu.get(j.id) ?? 0,
      status: j.status,
      createdAt: j.createdAt,
    })),
    hourly: buckets.map((joins, i) => ({ hour: hourLabel(firstHour + i * HOUR_MS), joins })),
    generatedAt: now.toISOString(),
  };
}

export function getStats(): Stats {
  return computeStats(db.listAllJu(), db.listAllMembers());
}

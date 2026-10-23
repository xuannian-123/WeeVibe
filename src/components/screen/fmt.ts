// A2 自用的展示小工具（v3）。不依赖 A1 的 src/lib/client/format.ts，避免并行改动互相踩。
import type { Ju, JuState, Proposal, Slot } from "@/lib/types";

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function beijingDate(d: Date): string {
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

export function weekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "10/24 周五"，今天 / 明天换成口语 */
export function dayLabel(date: string, now = new Date()): string {
  const [, m, d] = date.split("-").map(Number);
  const today = beijingDate(now);
  const tomorrow = beijingDate(new Date(now.getTime() + 86400000));
  const rel = date === today ? "今天" : date === tomorrow ? "明天" : weekday(date);
  return `${m}/${d} ${rel}`;
}

/** Slot.start 带 +08:00，直接截墙上时间 */
export const slotTime = (s: Slot) => s.start.slice(11, 16);
export const slotDate = (s: Slot) => s.start.slice(0, 10);
export const slotLabel = (s?: Slot) => (s ? `${dayLabel(slotDate(s))} ${slotTime(s)}` : "时间待定");

/** ISO → 北京时间 HH:mm */
export function hhmm(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return new Date(t.getTime() + 8 * 3600000).toISOString().slice(11, 16);
}

export function confirmedProposal(ju: Ju): Proposal | undefined {
  const ps = ju.plan?.proposals ?? [];
  if (ju.confirmedProposalId) return ps.find((p) => p.id === ju.confirmedProposalId);
  return undefined;
}

/** 当前该聚焦的方案：已定的 > 推荐的 > 第一个 */
export function focusProposal(ju: Ju): Proposal | undefined {
  const ps = ju.plan?.proposals ?? [];
  return confirmedProposal(ju) ?? ps.find((p) => p.recommended) ?? ps[0];
}

export function voteTally(ju: Ju): Record<string, number> {
  const t: Record<string, number> = {};
  for (const pid of Object.values(ju.votes ?? {})) t[pid] = (t[pid] ?? 0) + 1;
  return t;
}

export function quorumPending(state: JuState) {
  return state.ju.quorum?.state === "pending";
}

const CAT_EMOJI: [RegExp, string][] = [
  [/火锅|涮/, "🍲"],
  [/烧烤|烤肉|串/, "🍢"],
  [/桌游|剧本|狼人/, "🎲"],
  [/羽毛球|网球|球/, "🏸"],
  [/KTV|唱/i, "🎤"],
  [/咖啡|下午茶/, "☕"],
  [/酒|吧/, "🍻"],
  [/电影/, "🎬"],
  [/徒步|爬山|露营/, "⛰️"],
  [/宵夜|夜宵|小龙虾/, "🦞"],
  [/日料|寿司/, "🍣"],
];

export function categoryEmoji(cat?: string): string {
  if (!cat) return "🍽️";
  for (const [re, e] of CAT_EMOJI) if (re.test(cat)) return e;
  return "🍽️";
}

export function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function shortHash(h?: string, n = 10) {
  if (!h) return "—";
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

/** 满意度 0-100 → 热力色（低：朱砂，中：芥末，高：翠绿），深色底用 */
export function heatColor(u: number): string {
  const v = Math.max(0, Math.min(100, u)) / 100;
  const stops: [number, [number, number, number]][] = [
    [0, [226, 65, 46]],
    [0.55, [242, 181, 48]],
    [1, [62, 207, 142]],
  ];
  let i = 0;
  while (i < stops.length - 2 && v > stops[i + 1][0]) i++;
  const [a, ca] = stops[i];
  const [b, cb] = stops[i + 1];
  const k = (v - a) / (b - a || 1);
  const c = ca.map((x, j) => Math.round(x + (cb[j] - x) * k));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

export const yuan = (n: number) => (Number.isInteger(n) ? `¥${n}` : `¥${n.toFixed(2)}`);

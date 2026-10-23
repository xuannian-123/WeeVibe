import type { DayAvailability, Ju, JuState, Member, Proposal, Slot } from "@/lib/types";

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Slot.start 是带 +08:00 的 ISO，直接截取墙上时间 */
export function slotDate(s: Slot): string {
  return s.start.slice(0, 10);
}
export function slotTime(s: Slot): string {
  return s.start.slice(11, 16);
}

export function weekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "10/24 周五"，今天 / 明天替换成口语 */
export function dayLabel(date: string, now = new Date()): string {
  const [, m, d] = date.split("-").map(Number);
  const today = beijingDate(now);
  const tomorrow = beijingDate(new Date(now.getTime() + 86400000));
  const rel = date === today ? "今天" : date === tomorrow ? "明天" : weekday(date);
  return `${m}/${d} ${rel}`;
}

export function beijingDate(d: Date): string {
  const t = new Date(d.getTime() + 8 * 3600000);
  return t.toISOString().slice(0, 10);
}

/** ISO 时间 → 北京时间 HH:mm */
export function hhmm(iso: string | undefined): string {
  if (!iso) return "";
  if (/^\d{2}:\d{2}$/.test(iso)) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(11, 16);
  return new Date(d.getTime() + 8 * 3600000).toISOString().slice(11, 16);
}

/** "刚刚 / 5 分钟前 / 10/23 18:30" */
export function ago(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  const d = new Date(t + 8 * 3600000).toISOString();
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))} ${d.slice(11, 16)}`;
}

export function groupSlots(slots: Slot[]): { date: string; slots: Slot[] }[] {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = slotDate(s);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return [...map.entries()].map(([date, slots]) => ({ date, slots }));
}

export function slotText(s: Slot | undefined): string {
  if (!s) return "时间待定";
  return `${dayLabel(slotDate(s))} ${slotTime(s)}`;
}

/** 兼容旧调用：按 slotId 找 */
export function slotLabel(ju: Ju, slotId?: string): string {
  return slotText(ju.slots.find((x) => x.id === slotId));
}

export function activeMembers(state: JuState): Member[] {
  return state.members.filter((m) => m.status === "in");
}

export function organizer(state: JuState): Member | undefined {
  return state.members.find((m) => m.isOrganizer);
}

/** proposalId -> 投票人 memberId[] */
export function voteTally(ju: Ju): Record<string, string[]> {
  const t: Record<string, string[]> = {};
  for (const [mid, pid] of Object.entries(ju.votes ?? {})) (t[pid] ??= []).push(mid);
  return t;
}

/** 已定的方案；没定就是推荐的那个 */
export function leadingOption(ju: Ju): Proposal | undefined {
  const ps = ju.plan?.proposals ?? [];
  if (ju.confirmedProposalId) return ps.find((p) => p.id === ju.confirmedProposalId) ?? ps[0];
  return ps.find((p) => p.recommended) ?? ps[0];
}
export const confirmedProposal = (ju: Ju): Proposal | undefined =>
  ju.confirmedProposalId ? ju.plan?.proposals.find((p) => p.id === ju.confirmedProposalId) : undefined;

export function mostVoted(ju: Ju): Proposal | undefined {
  const ps = ju.plan?.proposals ?? [];
  const t = voteTally(ju);
  let best = ps[0];
  let bestN = -1;
  for (const p of ps) {
    const n = t[p.id]?.length ?? 0;
    if (n > bestN) {
      best = p;
      bestN = n;
    }
  }
  return best;
}

export function specChips(ju: Ju): { icon: string; text: string }[] {
  const s = ju.spec;
  const out: { icon: string; text: string }[] = [];
  if (s.dates?.length) out.push({ icon: "📅", text: s.dates.map((d) => dayLabel(d)).join("、") });
  if (s.earliest && s.latest) out.push({ icon: "⏰", text: `${s.earliest}–${s.latest}` });
  if (s.headcount) out.push({ icon: "👥", text: `${s.headcount} 人` });
  if (s.budgetPerPerson) out.push({ icon: "💰", text: `人均 ≤${s.budgetPerPerson}` });
  if (s.city) out.push({ icon: "📍", text: s.city });
  return out;
}

export function amapUrl(lng: number, lat: number, name: string): string {
  return `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(name)}&coordinate=gaode&callnative=1`;
}

export function shortPlace(label: string | undefined, max = 14): string {
  if (!label) return "出发地待定";
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

/** 一天的时间情况 → "18:30 出发 · 22:00 前回" */
export function availText(a: DayAvailability): string {
  const parts = [`${a.from} 后能出发`];
  if (a.homeBy) parts.push(`${a.homeBy} 前要回`);
  return parts.join(" · ");
}

export const PREF_TEXT: Record<DayAvailability["pref"], string> = { best: "最好这天", ok: "可以", meh: "勉强" };

export function yuan(n: number | undefined): string {
  if (n == null) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export const INTAKE_TEXT: Record<Member["intake"], string> = {
  chatting: "在和局长聊",
  swiping: "在刷卡",
  done: "说好了",
};

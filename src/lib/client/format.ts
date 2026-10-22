import type { Ju, JuState, Member, PlanOption, Slot } from "@/lib/types";

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

export function groupSlots(slots: Slot[]): { date: string; slots: Slot[] }[] {
  const map = new Map<string, Slot[]>();
  for (const s of slots) {
    const k = slotDate(s);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(s);
  }
  return [...map.entries()].map(([date, slots]) => ({ date, slots }));
}

export function slotLabel(ju: Ju, slotId?: string): string {
  const s = ju.slots.find((x) => x.id === slotId);
  if (!s) return "时间待定";
  return `${dayLabel(slotDate(s))} ${slotTime(s)}`;
}

export function activeMembers(state: JuState): Member[] {
  return state.members.filter((m) => m.status === "in");
}

export function organizer(state: JuState): Member | undefined {
  return state.members.find((m) => m.isOrganizer);
}

export function slotCounts(state: JuState): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of state.ju.slots) c[s.id] = 0;
  for (const m of activeMembers(state)) for (const id of m.availableSlotIds) if (id in c) c[id]++;
  return c;
}

export function voteTally(ju: Ju): Record<string, string[]> {
  const t: Record<string, string[]> = {};
  for (const [mid, poi] of Object.entries(ju.votes ?? {})) (t[poi] ??= []).push(mid);
  return t;
}

/** 当前领先 / 已定的方案 */
export function leadingOption(ju: Ju): PlanOption | undefined {
  const opts = ju.plan?.options ?? [];
  if (ju.confirmedPoiId) return opts.find((o) => o.poi.id === ju.confirmedPoiId) ?? opts[0];
  return opts[0];
}

export function mostVoted(ju: Ju): PlanOption | undefined {
  const opts = ju.plan?.options ?? [];
  const t = voteTally(ju);
  let best = opts[0];
  let bestN = -1;
  for (const o of opts) {
    const n = t[o.poi.id]?.length ?? 0;
    if (n > bestN) {
      best = o;
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

export function shortPlace(label: string, max = 14): string {
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

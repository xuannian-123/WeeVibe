// 跨局记忆：设备级档案（#6 偏好预填、#10 公平账本）。
// 档案只按 profileId 读写；profileId 本身在公开视图里会被剥掉（firewall.publicMember），
// 所以拿不到别人的 profileId 就读不到别人的档案。
import * as db from "../db";
import type { DayAvailability, Member, Poi, Profile, SwipeVerdict } from "../types";

export function getProfile(pid: string): Profile | null {
  if (!pid) return null;
  return db.getProfileRow(pid);
}

export function saveProfile(p: Profile): void {
  db.upsertProfile(p);
}

export function emptyProfile(id: string): Profile {
  return { id, dietTags: [], ledger: [], tastes: {} };
}

/** 刷卡 → 口味词：品类（高德类型的最后一段）+ 连锁名（店名去掉括号里的分店） */
export function tasteKeys(poi: Pick<Poi, "name" | "type">): string[] {
  const keys = new Set<string>();
  const cat = (poi.type ?? "").split(/[;|]/).filter(Boolean).at(-1)?.trim();
  if (cat) keys.add(cat);
  const chain = poi.name.replace(/[（(].*?[)）]/g, "").trim();
  if (chain) keys.add(chain);
  return [...keys];
}

const VERDICT_DELTA: Record<SwipeVerdict, number> = { love: 0.3, like: 0.1, pass: -0.3 };

const clamp1 = (x: number) => Math.max(-1, Math.min(1, Math.round(x * 100) / 100));

/** 出现次数最多的值；平局取字典序小的（确定性） */
function mode(xs: string[]): string | undefined {
  const cnt = new Map<string, number>();
  for (const x of xs) cnt.set(x, (cnt.get(x) ?? 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
}

/**
 * 入局完成后把这次学到的东西写回档案（#6）：
 * tastes（刷卡）、typicalBudget（私下说的预算）、usualFrom / usualHomeBy（常用时间）、出发地、忌口。
 * 被局长预填的字段不回写（那不是本人的真实偏好）。
 */
export function learnFromMember(prev: Profile | null, m: Member, deck: Pick<Poi, "id" | "name" | "type">[]): Profile | null {
  if (!m.profileId || !m.private) return prev;
  const p: Profile = prev ? structuredClone(prev) : emptyProfile(m.profileId);
  const priv = m.private;
  const auto = new Set(priv.autoFilled);
  p.name = m.name;
  p.avatar = m.avatar;
  if (m.location) p.lastLocation = m.location;
  if (!auto.has("diet")) p.dietTags = [...priv.dietTags];
  if (!auto.has("budget") && priv.budgetMax !== undefined) p.typicalBudget = priv.budgetMax;
  if (!auto.has("availability")) {
    const days = Object.values(priv.availability) as DayAvailability[];
    const from = mode(days.map((d) => d.from));
    const homeBy = mode(days.map((d) => d.homeBy).filter((x): x is string => !!x));
    if (from) p.usualFrom = from;
    if (homeBy) p.usualHomeBy = homeBy;
  }
  if (!auto.has("swipes")) {
    const byId = new Map(deck.map((x) => [x.id, x]));
    for (const [poiId, v] of Object.entries(priv.swipes).sort(([a], [b]) => (a < b ? -1 : 1))) {
      const poi = byId.get(poiId);
      if (!poi) continue;
      for (const k of tasteKeys(poi)) p.tastes[k] = clamp1((p.tastes[k] ?? 0) + VERDICT_DELTA[v]);
    }
  }
  return p;
}

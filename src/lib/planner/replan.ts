// #12 稳定重规划：定局后人数变了，原方案还行就只改桌数 / 通知；不行才在"和原方案差异最小"的约束下换。
import type { Ju, MapProvider, Member, Proposal } from "../types";
import { haversineKm } from "../map/geo";
import { computeCandidates, inMembersOf, toProposal, type Candidate } from "./plan";
import { slotTimes } from "./experience";
import { slotLabel } from "./util";

/** 原方案还能不能用：主角能来、至少 2 人（单人局 1 人）、到场过半 */
export function feasible(c: Candidate, n: number): boolean {
  return !c.vetoed && c.attend >= Math.min(2, n) && c.attend >= Math.ceil(n / 2);
}

/** 和原方案的差异：换店（+ 两店距离）比换时间代价大；换日期再加 1 */
export function diffFrom(c: Candidate, cur: Proposal): number {
  let d = 0;
  if (c.poi.id !== cur.poi.id) d += 2 + haversineKm(c.poi, cur.poi);
  if (c.slot.id !== cur.slot.id) {
    const a = slotTimes(c.slot);
    const b = slotTimes(cur.slot);
    d += 1 + Math.abs(a.start - b.start) / 60 + (a.date !== b.date ? 1 : 0);
  }
  return Math.round(d * 1000) / 1000;
}

function headcountChanges(prev: Proposal, next: Proposal, members: Member[]): string[] {
  const out: string[] = [];
  if (prev.attendCount !== next.attendCount) out.push(`到场人数从 ${prev.attendCount} 人变为 ${next.attendCount} 人`);
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const wasAbsent = new Set(prev.experiences.filter((e) => e.status === "absent").map((e) => e.memberId));
  const known = new Set(prev.experiences.map((e) => e.memberId));
  const nowAbsent = next.experiences.filter((e) => e.status === "absent" && !wasAbsent.has(e.memberId) && known.has(e.memberId));
  if (nowAbsent.length) out.push(`${nowAbsent.map((e) => nameOf.get(e.memberId) ?? "有人").join("、")}这个时间来不了了`);
  const joined = next.experiences.filter((e) => !known.has(e.memberId) && e.status !== "absent").length;
  if (joined) out.push(`新加入 ${joined} 位朋友`);
  return out;
}

export async function replanStable(
  ju: Ju,
  members: Member[],
  current: Proposal,
  map: MapProvider,
  opts: { now?: Date } = {},
): Promise<{ proposal: Proposal; changes: string[]; tableSize: number; keptVenue: boolean }> {
  void opts; // 目前不依赖当前时刻；保留参数以便以后排除已过去的时段
  const inMembers = inMembersOf(members);
  const n = inMembers.length;
  const noop = () => {};
  if (n === 0) return { proposal: current, changes: ["局里暂时没有人了"], tableSize: 0, keptVenue: true };

  // 1. 原方案原地重算
  const here = await computeCandidates(ju, inMembers, map, {}, noop, { slots: [current.slot], pois: [current.poi] });
  const c0 = here.cands[0];
  if (feasible(c0, n)) {
    const proposal = { ...toProposal(c0, current.label, inMembers, here.weights, undefined, here.ctx, current.recommended), id: current.id };
    if (current.blurb) proposal.blurb = current.blurb;
    const changes = headcountChanges(current, proposal, inMembers);
    if (proposal.attendCount !== current.attendCount) changes.push(`订位改为 ${proposal.attendCount} 人`);
    if (!changes.length) changes.push("原方案不变");
    return { proposal, changes, tableSize: proposal.attendCount, keptVenue: true };
  }

  // 2. 原方案不行了：全量重算，在可行的候选里找和原方案差异最小的（同差异再看综合分）
  const all = await computeCandidates(ju, inMembers, map, {}, noop);
  let cands = all.cands;
  if (!all.pois.some((p) => p.id === current.poi.id)) {
    const extra = await computeCandidates(ju, inMembers, map, {}, noop, { slots: all.slots, pois: [current.poi] });
    cands = [...cands, ...extra.cands.map((c) => ({ ...c, idx: c.idx + all.cands.length }))];
  }
  const ok = cands.filter((c) => feasible(c, n));
  if (ok.length === 0) {
    const proposal = { ...toProposal(c0, current.label, inMembers, here.weights, undefined, here.ctx, current.recommended), id: current.id };
    return {
      proposal,
      changes: ["人数变化后原方案不太理想，但暂时没有更合适的替代，先保留原方案"],
      tableSize: proposal.attendCount,
      keptVenue: true,
    };
  }
  ok.sort((a, b) => diffFrom(a, current) - diffFrom(b, current) || b.score - a.score || a.idx - b.idx);
  const best = ok[0];
  const proposal = toProposal(best, current.label, inMembers, all.weights, undefined, all.ctx, true);
  const changes: string[] = [];
  const keptVenue = best.poi.id === current.poi.id;
  if (best.slot.id !== current.slot.id)
    changes.push(`时间从 ${slotLabel(current.slot.start)} 改到 ${slotLabel(best.slot.start)}${keptVenue ? "（店不变）" : ""}`);
  if (!keptVenue) changes.push(`换到${best.poi.name}（离原来那家 ${Math.round(haversineKm(best.poi, current.poi) * 10) / 10} km）`);
  changes.push(...headcountChanges(current, proposal, inMembers));
  changes.push(`订位改为 ${proposal.attendCount} 人`);
  return { proposal, changes, tableSize: proposal.attendCount, keptVenue };
}

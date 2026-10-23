// #11 个人行程卡 / 路上 ETA：只算结论（几点出发、几点到），坐标用完即丢。
import type { Itinerary, LatLng, MapProvider, Member, Proposal } from "../types";
import { estimateCommute } from "../map/geo";
import { dayAvailability, slotTimes } from "./experience";
import { bjParts, hmToMin, minToHm } from "./util";

/** 提前到的余量（分钟） */
export const ARRIVE_BUFFER_MIN = 5;

async function transit(map: MapProvider, origin: LatLng, dest: LatLng, city: string): Promise<{ minutes: number; steps: string[] }> {
  try {
    const r = await map.transitRoute(origin, dest, city);
    if (Number.isFinite(r?.minutes) && r.minutes >= 0) return { minutes: Math.round(r.minutes), steps: r.steps ?? [] };
  } catch {
    /* 退回打车估算 */
  }
  const e = estimateCommute(origin, dest);
  return { minutes: e.minutes, steps: [`打车约 ${e.minutes} 分钟（约 ${e.distanceKm} 公里）`] };
}

export async function itineraryFor(member: Member, proposal: Proposal, map: MapProvider, city: string): Promise<Itinerary> {
  const exp = proposal.experiences.find((e) => e.memberId === member.id);
  const { date, start } = slotTimes(proposal.slot);
  let minutes: number;
  let route: string[];
  if (member.location) {
    const t = await transit(map, member.location, proposal.poi, city);
    minutes = t.minutes;
    route = t.steps;
  } else {
    minutes = exp?.commuteMin ?? 20;
    route = ["还没告诉局长出发地，按集合点估算"];
  }
  const day = dayAvailability(member, date);
  const from = hmToMin(day?.from) ?? 0;
  const depart = Math.max(from, start - minutes - ARRIVE_BUFFER_MIN);
  const it: Itinerary = {
    proposalId: proposal.id,
    departAt: minToHm(depart),
    arriveAt: minToHm(depart + minutes),
    commuteMin: minutes,
    route,
  };
  if (exp?.leaveAt) it.leaveAt = exp.leaveAt;
  // #2 互选成功、且这次都到场的人（memberId；名字由调用方换）
  const present = new Set(proposal.experiences.filter((e) => e.status !== "absent").map((e) => e.memberId));
  const seat = (member.private?.matches ?? []).filter((id) => present.has(id));
  if (seat.length) it.seatWith = seat;
  const pay = member.private?.payment;
  if (pay) it.aaAmount = pay.amount;
  return it;
}

/** 路上 ETA：现在出发（打车 / 驾车）几点到、会晚多少 */
export async function etaFor(
  pos: LatLng,
  proposal: Proposal,
  map: MapProvider,
  now: Date,
): Promise<{ arriveAt: string; lateMin: number }> {
  let minutes: number;
  try {
    const [r] = await map.commute([pos], proposal.poi);
    minutes = Number.isFinite(r?.minutes) ? Math.round(r.minutes) : estimateCommute(pos, proposal.poi).minutes;
  } catch {
    minutes = estimateCommute(pos, proposal.poi).minutes;
  }
  const arriveMs = now.getTime() + minutes * 60000;
  const lateMin = Math.max(0, Math.round((arriveMs - new Date(proposal.slot.start).getTime()) / 60000));
  return { arriveAt: minToHm(bjParts(new Date(arriveMs)).min), lateMin };
}

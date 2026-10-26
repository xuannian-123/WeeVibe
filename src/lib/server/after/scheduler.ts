// #11 #14 主动智能体：定时巡检每个活跃的局，到点了就私下提醒。
// - 门限截止 / 方案截止：交给 B2 的函数（它们自己拿锁）
// - 截止前 / 投票期：私下催没完成的人（nudge）
// - 定局后：按真实路线算出发时间，到点前 10 分钟发"该出发了"（depart）
// - 结算后 24 小时（演示时钟）还没转：私下提醒一次（payment）
// 幂等：每条提醒用确定的 key 当 notice.id，发过就不再发；时间一律用 nowFor(ju)（叠加演示时钟）。
import * as db from "../../db";
import { getMapProvider } from "../../map";
import { itineraryFor } from "../../planner";
import type { Itinerary, Ju, Member, Proposal } from "../../types";
import { nowFor, withJuLock } from "../ju";
import { runCoreDeadlines } from "./core";
import { ensurePrivate, pushNoticeOnce } from "./inbox";
import { dueLeaveAndLateNight, dueWeatherCheck, isQuietHour } from "./reminders";
import { HOUR, MIN, at, confirmedProposal, hhmm, inOnly, money, saveMembers, ymd } from "./util";

/** 截止前多久开始催 */
export const NUDGE_BEFORE_MIN = 60;
/** 出发前多久提醒 */
export const DEPART_LEAD_MIN = 10;
/** 结算后多久自动私下提醒没转的人 */
export const PAY_REMIND_AFTER_H = 24;
/** 巡检间隔 */
export const TICK_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------- 行程缓存

type CacheEntry = { at: number; itin: Itinerary };
const g = globalThis as unknown as {
  __juItinCache?: Map<string, CacheEntry>;
  __juScheduler?: ReturnType<typeof setInterval>;
  __juTicking?: boolean;
};
const itinCache = (g.__juItinCache ??= new Map());
const ITIN_TTL_MS = 20 * MIN;

/** 某人在定局方案下的行程（带 20 分钟缓存，避免每 30 秒都去问地图） */
export async function cachedItinerary(ju: Ju, m: Member, proposal: Proposal): Promise<Itinerary> {
  // 没出发地时 C 会按方案里的通勤估算
  const loc = m.location ? `${m.location.lat},${m.location.lng}` : "none";
  const key = `${ju.id}|${m.id}|${proposal.id}|${proposal.slot.id}|${proposal.poi.id}|${loc}`;
  const hit = itinCache.get(key);
  if (hit && Date.now() - hit.at < ITIN_TTL_MS) return hit.itin;
  const itin = await itineraryFor(m, proposal, getMapProvider(), ju.spec.city);
  itinCache.set(key, { at: Date.now(), itin });
  if (itinCache.size > 500) itinCache.delete(itinCache.keys().next().value as string);
  return itin;
}

/** 行程卡上的出发时刻（HH:mm）落到方案那天 */
export function departDate(proposal: Proposal, itin: Itinerary): Date {
  const slotStart = new Date(proposal.slot.start);
  let d = at(ymd(slotStart), itin.departAt);
  // 出发时刻比开场还晚 12 小时以上 → 实际是前一天（跨零点的极端情况）
  if (d.getTime() - slotStart.getTime() > 12 * HOUR) d = new Date(d.getTime() - 24 * HOUR);
  return d;
}

// ---------------------------------------------------------------- 各项提醒

/** 截止前 / 投票期私下催没完成的人。返回被催的成员 */
export function dueNudges(ju: Ju, members: Member[], now: Date, opts: { force?: boolean } = {}): Member[] {
  const list: Member[] = [];
  const quorumPending = ju.quorum?.state === "pending";
  const deadlineStr = quorumPending ? (ju.quorum?.deadline ?? ju.deadline) : ju.deadline;

  let stage: "quorum" | "collect" | "vote" | null = null;
  if (ju.status === "collecting") stage = quorumPending ? "quorum" : "collect";
  else if (ju.status === "voting") stage = "vote";
  if (!stage) return list;

  if (!opts.force) {
    if (!deadlineStr) return list;
    const dl = new Date(deadlineStr).getTime();
    const left = dl - now.getTime();
    if (left <= 0 || left > NUDGE_BEFORE_MIN * MIN) return list;
  }
  const by = deadlineStr ? hhmm(new Date(deadlineStr)) : null;

  for (const m of members) {
    if (m.isOrganizer) continue;
    const p = ensurePrivate(m);
    if (p.rsvp === "no" || m.status === "out") continue;
    let text: string | null = null;
    if (stage === "quorum") {
      if (p.rsvp) continue;
      text = `大家在等一句话：这次你能来吗？${by ? `局长 ${by} 统计，` : ""}来不来都只有局长知道。`;
    } else if (stage === "collect") {
      if (m.intake === "done") continue;
      text = `就差你啦：${by ? `局长 ${by} 出方案，` : ""}花 1 分钟说说时间和口味；懒得填就回"都行"，局长帮你预填。`;
    } else {
      if (m.status !== "in" || ju.votes[m.id]) continue;
      text = `方案出来了，${by ? `${by} 前` : "有空时"}挑一个投一票吧；不投的话局长就按推荐定了。`;
    }
    const key = opts.force
      ? `nudge:${stage}:manual:${now.toISOString()}`
      : `nudge:${stage}:${deadlineStr}`;
    if (pushNoticeOnce(m, "nudge", key, text, now)) list.push(m);
  }
  return list;
}

/** 定局后：出发前 10 分钟私信。返回被提醒的成员 */
export async function dueDeparts(ju: Ju, members: Member[], now: Date): Promise<Member[]> {
  const proposal = confirmedProposal(ju);
  if (!proposal) return [];
  const start = new Date(proposal.slot.start).getTime();
  // 只在开场前 4 小时 ~ 开场后 30 分钟之间算路线
  if (now.getTime() < start - 4 * HOUR || now.getTime() > start + 30 * MIN) return [];
  const list: Member[] = [];
  for (const m of inOnly(members)) {
    const key = `depart:${proposal.id}:${proposal.slot.id}`;
    if ((m.private?.inbox ?? []).some((n) => n.id === key)) continue;
    let itin: Itinerary;
    try {
      itin = await cachedItinerary(ju, m, proposal);
    } catch (e) {
      console.warn(`[after ${ju.id}] 行程计算失败：${(e as Error).message}`);
      continue;
    }
    const dep = departDate(proposal, itin);
    if (now.getTime() < dep.getTime() - DEPART_LEAD_MIN * MIN) continue;
    // 没出发地时 C 给的是"按集合点估算"，不念给本人听
    const route = m.location ? itin.route.slice(0, 2).join("，") : "";
    // v5：出发提醒里带上天气（复查结果优先，其次是定局时的预报）
    const rain = ju.weatherAlert ? ju.weatherAlert.kind === "light" || ju.weatherAlert.kind === "heavy" : (proposal.risks ?? []).some((r) => r.kind === "weather" && /雨|雪/.test(r.text));
    const text =
      `该准备出发啦：建议 ${itin.departAt} 出门${route ? `，${route}` : ""}，预计 ${itin.arriveAt} 到 ${proposal.poi.name}。` +
      (rain ? "外面有雨，记得带伞。" : "") +
      (itin.leaveAt ? `别忘了 ${itin.leaveAt} 得往回走。` : "");
    if (pushNoticeOnce(m, "depart", key, text, now)) list.push(m);
  }
  return list;
}

/** 结算后 24 小时还没转的人：私下提醒一次（不告诉任何人是谁） */
export function duePayReminders(ju: Ju, members: Member[], now: Date): Member[] {
  if (!ju.settlement) return [];
  const list: Member[] = [];
  for (const m of members) {
    const pay = m.private?.payment;
    if (!pay || pay.paid) continue;
    const due = latestPayDue(m);
    if (!due) continue;
    if (now.getTime() - new Date(due.at).getTime() < PAY_REMIND_AFTER_H * HOUR) continue;
    const key = `pay-remind:auto:${due.id}`;
    const text = `悄悄提醒一下：上次${ju.title}你那份是 ¥${money(pay.amount)}${ju.settlement.payerName ? `，转给${ju.settlement.payerName}` : ""}，方便时转一下就好～转完点"我已转"。`;
    if (pushNoticeOnce(m, "payment", key, text, now)) {
      pay.remindedAt.push(now.toISOString());
      list.push(m);
    }
  }
  return list;
}

/** 本人最近一次"该转钱"通知（settle 时发，id 以 pay-due: 开头） */
export function latestPayDue(m: Member) {
  const inbox = m.private?.inbox ?? [];
  for (let i = inbox.length - 1; i >= 0; i--) if (inbox[i].id.startsWith("pay-due:")) return inbox[i];
  return undefined;
}

// ---------------------------------------------------------------- tick

/** 幂等：同一时刻 tick 多少次都只发一次。从不抛错（GET 局页面会懒调用它兜底） */
export async function tickJu(juId: string): Promise<void> {
  try {
    if (!db.getJu(juId)) return;
    // 1) 门限截止 / 方案截止：B2 的函数自己拿锁，不能嵌在我们的锁里调
    await runCoreDeadlines(juId);
    // 2) 主动提醒
    await withJuLock(juId, async () => {
      const ju = db.getJu(juId);
      if (!ju || ju.status === "cancelled") return;
      const members = db.listMembers(juId);
      const now = nowFor(ju);
      const touched = new Set<Member>();
      // v5：催入局、催转账不紧急，23:00–8:00 不打扰
      const quiet = isQuietHour(now);
      if (!quiet) for (const m of dueNudges(ju, members, now)) touched.add(m);
      for (const m of await dueDeparts(ju, members, now)) touched.add(m);
      if (!quiet) for (const m of duePayReminders(ju, members, now)) touched.add(m);
      // v5：天气复查（前 24 / 3 小时）、该往回走了、夜归
      const wx = await dueWeatherCheck(ju, members, now);
      for (const m of wx.touched) touched.add(m);
      for (const m of await dueLeaveAndLateNight(ju, members, now)) touched.add(m);
      if (touched.size) saveMembers(touched);
      if (wx.dirty) db.saveJu(ju);
    });
  } catch (e) {
    console.warn(`[after] tickJu(${juId}) 失败：${(e as Error)?.message ?? e}`);
  }
}

/** 需要巡检的局：没取消、最近 3 天内创建或活动在最近 3 天内 */
export function activeJuIds(now = new Date()): string[] {
  const horizon = now.getTime() - 3 * 24 * HOUR;
  return db
    .listAllJu()
    .filter((ju) => {
      if (ju.status === "cancelled") return false;
      if (new Date(ju.createdAt).getTime() >= horizon) return true;
      const p = confirmedProposal(ju);
      // 结算后 24 小时还要提醒，所以活动结束后再多看 3 天
      return !!p && new Date(p.slot.end).getTime() >= horizon;
    })
    .map((ju) => ju.id);
}

export async function tickAll(): Promise<void> {
  if (g.__juTicking) return; // 上一轮还没跑完（地图慢）就跳过
  g.__juTicking = true;
  try {
    for (const id of activeJuIds()) await tickJu(id);
  } finally {
    g.__juTicking = false;
  }
}

/** instrumentation.ts 里调用；挂在 globalThis 上，dev HMR 重复执行也只有一个定时器 */
export function startScheduler(): void {
  if (g.__juScheduler) return;
  if (process.env.JUZHANG_SCHEDULER === "off") return;
  g.__juScheduler = setInterval(() => {
    void tickAll().catch((e) => console.warn(`[after] 巡检失败：${(e as Error)?.message ?? e}`));
  }, TICK_INTERVAL_MS);
  g.__juScheduler.unref?.();
  console.log(`[after] 局长主动提醒已启动，每 ${TICK_INTERVAL_MS / 1000} 秒巡检一次`);
}

export function stopScheduler(): void {
  if (g.__juScheduler) clearInterval(g.__juScheduler);
  g.__juScheduler = undefined;
}

// B3 路由背后的业务逻辑：行程 / ETA / 站内信 / 催人 / 订位 / 小票分账 / 结算催款 / 回顾 / 再约 / 演示时钟。
// route 文件只做参数解析；所有写操作经 withJuLock 串行化。
import * as db from "../../db";
import { parseReceipt, writeRecap } from "../../llm";
import { getMapProvider, wgs84ToGcj02 } from "../../map";
import { etaFor, ledgerEntryFor, settle as settleEven, splitBill } from "../../planner";
import type {
  BillShareLine,
  GroupMessages,
  Itinerary,
  Ju,
  JuState,
  LatLng,
  Member,
  Notice,
  Receipt,
  BillSplit,
} from "../../types";
import { guardPublicText, publicFacts, publicState, selfMember } from "../firewall";
import { HttpError } from "../http";
import { announce, appendTrace, loadJu, memberByToken, messagesFor, nowFor, withJuLock } from "../ju";
import { getProfile, saveProfile } from "../profile";
import { rememberAttendance } from "../social";
import { createJuForAgain, myUtilityFor } from "./core";
import { ensurePrivate, markRead, pushNotice, pushNoticeOnce } from "./inbox";
import { listPhotos } from "./photos";
import { cachedItinerary, dueNudges, tickJu } from "./scheduler";
import { confirmedProposal, inOnly, money, requireConfirmed, saveMembers, yuan } from "./util";

/** ETA 晚到多少分钟才通知其他人 */
export const ETA_LATE_NOTIFY_MIN = 10;

// ---------------------------------------------------------------- #11 行程卡

export async function getItinerary(juId: string, token: string): Promise<Itinerary> {
  const ju = loadJu(juId);
  const me = memberByToken(juId, token);
  const proposal = requireConfirmed(ju);
  if (me.status !== "in") throw new HttpError(409, "你不在这次的局里");
  const itin = await cachedItinerary(ju, me, proposal);
  return decorateItinerary(ju, me, itin);
}

/**
 * 叠加只有本人能看的东西：坐在一起的人（互选）、该转多少。
 * C 的 itineraryFor 给的 seatWith 是 memberId（算法拿不到名字），这里换成名字，只留仍在局里的人。
 * 行程有缓存，aaAmount 也在这里按最新的账单覆盖。
 */
export function decorateItinerary(ju: Ju, me: Member, itin: Itinerary): Itinerary {
  const members = db.listMembers(ju.id);
  const byId = new Map(members.map((m) => [m.id, m]));
  const ids = itin.seatWith ?? me.private?.matches ?? [];
  const seatWith = ids
    .map((id) => byId.get(id))
    .filter((m): m is Member => !!m && m.status === "in")
    .map((m) => m.name);
  const out: Itinerary = { ...itin };
  if (seatWith.length) out.seatWith = seatWith;
  else delete out.seatWith;
  const pay = me.private?.payment;
  if (pay) out.aaAmount = pay.amount;
  else delete out.aaAmount;
  if (ju.settlement?.payerName) out.payerName = ju.settlement.payerName;
  return out;
}

// ---------------------------------------------------------------- #11 ETA（坐标算完即丢）

export async function postEta(
  juId: string,
  token: string,
  pos: { lat: number; lng: number; from?: "wgs84" },
): Promise<{ eta: NonNullable<Member["eta"]> }> {
  const ju0 = loadJu(juId);
  const proposal = requireConfirmed(ju0);
  const me0 = memberByToken(juId, token);
  if (me0.status !== "in") throw new HttpError(409, "你不在这次的局里");
  // 坐标只活在这个函数的局部变量里：不存库、不打日志、不进 trace
  const p: LatLng = pos.from === "wgs84" ? wgs84ToGcj02({ lat: pos.lat, lng: pos.lng }) : { lat: pos.lat, lng: pos.lng };
  let r: { arriveAt: string; lateMin: number };
  try {
    r = await etaFor(p, proposal, getMapProvider(), nowFor(ju0));
  } catch {
    throw new HttpError(502, "暂时算不出到达时间，稍后再试");
  }
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    const members = db.listMembers(juId);
    const me = members.find((m) => m.id === me0.id);
    if (!me) throw new HttpError(404, "成员不存在");
    const now = nowFor(ju);
    me.eta = { arriveAt: r.arriveAt, lateMin: Math.max(0, Math.round(r.lateMin)), updatedAt: now.toISOString() };
    const touched = new Set<Member>([me]);
    for (const m of notifyLateArrivals(ju, members, me.id, now)) touched.add(m);
    saveMembers(touched);
    return { eta: me.eta };
  });
}

/**
 * 有人预计晚到 > 10 分钟：给其他在场成员发一条聚合私信。
 * 不点名、不说原因（迟到在现场本来就看得到，但为什么晚到是他自己的事）。
 * 同样的"几个人晚到、最多晚几分钟（按 5 分钟取整）"只发一次，避免路上每次刷新都打扰。
 */
export function notifyLateArrivals(ju: Ju, members: Member[], changedId: string, now: Date): Member[] {
  const attendees = inOnly(members);
  const late = attendees.filter((m) => (m.eta?.lateMin ?? 0) > ETA_LATE_NOTIFY_MIN);
  if (!late.some((m) => m.id === changedId)) return [];
  const maxLate = Math.max(...late.map((m) => m.eta!.lateMin));
  const bucket = Math.ceil(maxLate / 5) * 5;
  const text =
    late.length === 1
      ? `有 1 位朋友预计晚到 ${maxLate} 分钟，可以先点菜 / 先开始，不用干等。`
      : `有 ${late.length} 位朋友预计晚到，最多晚 ${maxLate} 分钟，可以先点菜 / 先开始。`;
  const out: Member[] = [];
  for (const m of attendees) {
    if (late.some((x) => x.id === m.id)) continue; // 晚到的人自己不用收
    if (pushNoticeOnce(m, "eta", `eta:${late.length}:${bucket}`, text, now)) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------- 站内信

export function getInbox(juId: string, token: string): Notice[] {
  loadJu(juId);
  const me = memberByToken(juId, token);
  return [...(me.private?.inbox ?? [])];
}

export function readInbox(juId: string, token: string, ids?: string[]): Promise<Notice[]> {
  loadJu(juId);
  const me0 = memberByToken(juId, token);
  return withJuLock(juId, async () => {
    const me = db.getMember(me0.id);
    if (!me) throw new HttpError(404, "成员不存在");
    if (markRead(me, ids)) db.upsertMember(me);
    return [...(me.private?.inbox ?? [])];
  });
}

// ---------------------------------------------------------------- #11 发起人点"局长去催"

/** 发起人只知道催了几个人，不知道是谁 */
export function nudge(juId: string): Promise<{ nudged: number }> {
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    if (ju.status === "cancelled") throw new HttpError(409, "局已取消");
    if (ju.status === "confirmed") throw new HttpError(409, "已经定局了，不用催啦");
    const members = db.listMembers(juId);
    const now = nowFor(ju);
    // 5 分钟内催过的人不再催，免得发起人连点把人催烦
    const recent = (m: Member) =>
      (m.private?.inbox ?? []).some(
        (n) => n.kind === "nudge" && now.getTime() - new Date(n.at).getTime() < 5 * 60_000,
      );
    const candidates = members.filter((m) => !recent(m));
    const sent = dueNudges(ju, candidates, now, { force: true });
    saveMembers(sent);
    if (sent.length) appendTrace(ju, "listen", `局长私下提醒了 ${sent.length} 位朋友`);
    db.saveJu(ju);
    return { nudged: sent.length };
  });
}

// ---------------------------------------------------------------- #13 订位

export async function reservation(
  juId: string,
  body: { status?: NonNullable<Ju["reservation"]>["status"]; tableSize?: number },
): Promise<GroupMessages> {
  await withJuLock(juId, async () => {
    const ju = loadJu(juId);
    const proposal = requireConfirmed(ju);
    const members = db.listMembers(juId);
    const prev = ju.reservation;
    const tableSize = body.tableSize ?? prev?.tableSize ?? inOnly(members).length;
    // 第一次点"订位"：从 none 进到 scripted（话术已生成）；显式传了 status 就按传的
    const status = body.status ?? (!prev || prev.status === "none" ? "scripted" : prev.status);
    ju.reservation = { ...prev, status, tableSize };
    if (body.tableSize !== undefined || body.status !== undefined) delete ju.reservation.note;
    if (status === "booked" && prev?.status !== "booked") {
      announce(ju, `【已订位】${proposal.poi.name}，${tableSize} 位，到店报发起人名字就行。`);
    }
    db.saveJu(ju);
  });
  // B2 的 messagesFor：B1 groupMessages(publicFacts) → 防火墙兜底 → 规则版（锁外调，它只读）
  return messagesFor(juId);
}

// ---------------------------------------------------------------- #15 小票分账

export async function receipt(juId: string, image: string): Promise<{ receipt: Receipt; split: BillSplit }> {
  requireConfirmed(loadJu(juId));
  const rc = await parseReceipt(image); // B1 保证降级不抛错
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    requireConfirmed(ju);
    const attendees = inOnly(db.listMembers(juId));
    if (!attendees.length) throw new HttpError(409, "局里没有人，没法分账");
    const split = splitBill(rc, attendees);
    ju.admin = { ...ju.admin!, receipt: rc, split };
    db.saveJu(ju);
    return { receipt: rc, split };
  });
}

// ---------------------------------------------------------------- #14 结算 / 催款

function recountPaid(ju: Ju, members: Member[]): void {
  if (!ju.settlement) return;
  const owing = members.filter((m) => m.private?.payment && !isPayer(ju, m));
  ju.settlement.payCount = owing.length;
  ju.settlement.paidCount = owing.filter((m) => m.private!.payment!.paid).length;
  const payments: Record<string, { amount: number; paid: boolean }> = {};
  for (const m of members) if (m.private?.payment) payments[m.id] = { amount: m.private.payment.amount, paid: m.private.payment.paid };
  ju.admin = { ...ju.admin!, payments };
}

function isPayer(ju: Ju, m: Member): boolean {
  const name = ju.settlement?.payerName;
  return !!name && m.name === name;
}

export function settleJu(
  juId: string,
  body: { total?: number; payerName?: string; useReceipt?: boolean },
  adminToken: string,
): Promise<JuState> {
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    requireConfirmed(ju);
    const members = db.listMembers(juId);
    const attendees = inOnly(members);
    if (!attendees.length) throw new HttpError(409, "局里没有人，没法 AA");
    const now = nowFor(ju);

    const payerName =
      body.payerName?.trim() ||
      attendees.find((m) => m.isOrganizer)?.name ||
      ju.organizerName ||
      undefined;

    let total: number;
    let perPerson: number | undefined;
    let itemized = false;
    const shares = new Map<string, { amount: number; lines: BillShareLine[] }>();
    if (body.useReceipt) {
      const split = ju.admin?.split;
      if (!split) throw new HttpError(409, "还没拍小票，先上传小票再按明细分");
      // 小票之后局里人数变了：重新按现在在场的人分一次
      const ids = attendees.map((m) => m.id).sort().join();
      const fresh =
        Object.keys(split.perMember).sort().join() === ids || !ju.admin?.receipt
          ? split
          : splitBill(ju.admin.receipt, attendees);
      ju.admin = { ...ju.admin!, split: fresh };
      total = fresh.total;
      itemized = true;
      for (const m of attendees) {
        const s = fresh.perMember[m.id];
        if (s) shares.set(m.id, { amount: yuan(s.amount), lines: s.lines });
      }
    } else {
      const t = body.total ?? ju.admin?.receipt?.total;
      if (!t || t <= 0) throw new HttpError(400, "告诉局长一共花了多少钱");
      const s = settleEven(t, attendees.length);
      total = s.total;
      perPerson = s.perPerson;
      for (const m of attendees) {
        shares.set(m.id, { amount: s.perPerson, lines: [{ itemName: `AA 均摊（${attendees.length} 人）`, amount: s.perPerson }] });
      }
    }

    ju.settlement = {
      total: yuan(total),
      ...(perPerson !== undefined ? { perPerson } : {}),
      itemized,
      ...(payerName ? { payerName } : {}),
      payCount: 0,
      paidCount: 0,
    };

    const dueKey = `pay-due:${now.toISOString()}`;
    // 先清掉所有人的旧账单（重新结算时，已经退出的人不该还欠钱）
    for (const m of members) if (m.private?.payment) delete m.private.payment;
    for (const m of attendees) {
      const share = shares.get(m.id);
      if (!share) continue;
      const p = ensurePrivate(m);
      const payer = isPayer(ju, m);
      p.payment = { amount: share.amount, lines: share.lines, paid: payer, remindedAt: [] };
      if (payer) continue; // 付款人自己不用转给自己
      const detail = itemized ? "（按小票明细算的，只有你看得到）" : "";
      pushNoticeOnce(
        m,
        "payment",
        dueKey,
        `这次一共 ¥${money(total)}，你该转 ¥${money(share.amount)}${payerName ? ` 给${payerName}` : ""}${detail}。转完点"我已转"就好。`,
        now,
      );
    }
    recountPaid(ju, members);
    announce(
      ju,
      itemized
        ? `【AA】一共 ¥${money(total)}，按小票明细分好了，局长已经私下告诉每个人该转多少。`
        : `【AA】一共 ¥${money(total)}，人均 ¥${money(perPerson!)}，局长已经私下告诉每个人该转多少。`,
    );
    saveMembers(members);
    db.saveJu(ju);
    return publicState(ju, db.listMembers(juId), { adminToken });
  });
}

export function markPaid(juId: string, token: string): Promise<{ me: Member }> {
  loadJu(juId);
  const me0 = memberByToken(juId, token);
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    const members = db.listMembers(juId);
    const me = members.find((m) => m.id === me0.id);
    if (!me) throw new HttpError(404, "成员不存在");
    const pay = me.private?.payment;
    if (!ju.settlement || !pay) throw new HttpError(409, "还没结算，不用转钱");
    if (!pay.paid) {
      pay.paid = true;
      recountPaid(ju, members);
      db.upsertMember(me);
      db.saveJu(ju);
    }
    return { me: selfMember(me) };
  });
}

/** 只私下提醒没转的人；发起人只知道提醒了几个 */
export function remindPay(juId: string): Promise<{ reminded: number }> {
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    if (!ju.settlement) throw new HttpError(409, "还没结算");
    const members = db.listMembers(juId);
    const now = nowFor(ju);
    const owing = members.filter((m) => m.private?.payment && !m.private.payment.paid);
    for (const m of owing) {
      const pay = m.private!.payment!;
      pushNotice(
        m,
        "payment",
        `悄悄提醒一下：这次你那份是 ¥${money(pay.amount)}${ju.settlement.payerName ? `，转给${ju.settlement.payerName}` : ""}，方便时转一下就好～这条只有你看得到。`,
        now,
      );
      pay.remindedAt.push(now.toISOString());
    }
    saveMembers(owing);
    return { reminded: owing.length };
  });
}

export function payments(juId: string): Record<string, { name: string; amount: number; paid: boolean }> {
  loadJu(juId);
  const out: Record<string, { name: string; amount: number; paid: boolean }> = {};
  for (const m of db.listMembers(juId)) {
    const p = m.private?.payment;
    if (p) out[m.id] = { name: m.name, amount: p.amount, paid: p.paid };
  }
  return out;
}

// ---------------------------------------------------------------- #16 回顾 + #10 账本

export function recap(juId: string, adminToken: string): Promise<JuState> {
  return withJuLock(juId, async () => {
    const ju = loadJu(juId);
    const proposal = requireConfirmed(ju);
    const members = db.listMembers(juId);
    const now = nowFor(ju);
    const photos = listPhotos(juId);
    const facts = publicFacts(ju, members);
    const fallback = `${facts.confirmed ? `${facts.confirmed.headcount} 个人在${facts.confirmed.poiName}` : "大家"}一起度过了「${ju.title}」${photos.length ? `，留下 ${photos.length} 张照片` : ""}。下次再约！`;
    let text = fallback;
    try {
      text = guardPublicText(ju, members, (await writeRecap(facts, photos.length)) || fallback, fallback, "recap");
    } catch (e) {
      console.warn(`[after ${juId}] writeRecap 失败，用规则版：${(e as Error)?.message ?? e}`);
    }
    ju.recap = { text, photos, at: now.toISOString() };

    // #10 账本：每个在场且有档案的人记一笔（同一个局只记一次）
    const attendees = inOnly(members);
    const present = proposal.experiences.filter((e) => e.status !== "absent");
    const avg = present.length ? present.reduce((s, e) => s + e.commuteMin, 0) / present.length : 0;
    for (const m of attendees) {
      if (!m.profileId) continue;
      const exp = proposal.experiences.find((e) => e.memberId === m.id);
      if (!exp || exp.status === "absent") continue;
      const profile = getProfile(m.profileId);
      if (!profile) continue;
      if (profile.ledger.some((l) => l.juId === ju.id)) continue;
      const utility = myUtilityFor(ju, m, proposal) ?? exp.utility;
      profile.ledger.push(
        ledgerEntryFor(ju.id, { proposalId: proposal.id, utility, notes: [], commuteMin: exp.commuteMin }, avg, now.toISOString()),
      );
      saveProfile(profile);
    }
    // #21 一起到场的人，在各自档案里至少是"见过"（再约时局长记得）
    rememberAttendance(attendees.filter((m) => proposal.experiences.find((e) => e.memberId === m.id)?.status !== "absent" && !ju.seating?.absentIds.includes(m.id)));
    for (const m of attendees) {
      pushNoticeOnce(m, "recap", `recap:${ju.id}`, `局后回顾出来啦，去看看大家的照片吧～和谁聊得来，悄悄告诉局长，下次还安排你们一起。`, now);
    }
    saveMembers(attendees);
    db.saveJu(ju);
    return publicState(ju, db.listMembers(juId), { adminToken });
  });
}

// ---------------------------------------------------------------- #16 一键再约

export async function again(
  juId: string,
  prompt: string | undefined,
): Promise<{ id: string; adminToken: string; tierLinks: { tier: number; label: string; token: string }[] }> {
  const ju = loadJu(juId);
  if (ju.nextJuId) {
    const next = db.getJu(ju.nextJuId);
    const token = db.getAdminToken(ju.nextJuId);
    if (next && token) {
      return {
        id: next.id,
        adminToken: token,
        tierLinks: (next.admin?.tiers ?? []).map((t) => ({ tier: t.tier, label: t.label, token: t.token })),
      };
    }
  }
  const attendees = inOnly(db.listMembers(juId));
  const created = await createJuForAgain(ju, attendees, prompt);
  await withJuLock(juId, async () => {
    const cur = loadJu(juId);
    cur.nextJuId = created.id;
    announce(cur, `【再约】同一拨人，下次见！发起人已经开了新局。`);
    db.saveJu(cur);
  });
  return created;
}

// ---------------------------------------------------------------- 演示时钟

export async function devClock(juId: string, offsetMin: number, adminToken: string): Promise<JuState> {
  await withJuLock(juId, async () => {
    const ju = loadJu(juId);
    ju.admin = { ...ju.admin!, clockOffsetMin: offsetMin };
    db.saveJu(ju);
  });
  await tickJu(juId);
  return publicState(loadJu(juId), db.listMembers(juId), { adminToken });
}

export { confirmedProposal };

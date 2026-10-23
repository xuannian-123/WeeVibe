// #12 稳定重规划：定局后有人退出 / 加入时，优先保住原方案（同店同时段），只调桌数 / 候补转正。
// 对外只说"有朋友临时有变化"，不说是谁、为什么。
import * as db from "../../db";
import { getMapProvider } from "../../map";
import { replanStable } from "../../planner";
import type { Ju, Member } from "../../types";
import { announce, nowFor, withJuLock } from "../ju";
import { promoteWaitlist } from "../ju-core";
import { pushNotice } from "./inbox";
import { confirmedProposal, inOnly, saveMembers } from "./util";

/**
 * 不拿锁的版本：调用方已经在 withJuLock 里时用这个（锁不可重入，嵌套会死锁）。
 * 会修改并保存 ju 和受影响的成员。
 */
export async function replanAfterChangeLocked(ju: Ju, members: Member[], reason: string): Promise<boolean> {
  const current = confirmedProposal(ju);
  if (!current || !ju.plan) return false;
  const now = nowFor(ju);

  // 定局后的候补转正由这里负责（B2 不再转）：复用 B2 的 promoteWaitlist（先核心圈、再按先来后到）。
  // 被转正的人只收它发的那 1 条 promoted 私信（不提圈层），下面的 revision 私信跳过他们
  const promoted = promoteWaitlist(ju, members, now);
  const attendees = inOnly(members);

  const r = await replanStable(ju, attendees, current, getMapProvider(), { now });
  const idx = ju.plan.proposals.findIndex((p) => p.id === current.id);
  ju.plan.proposals[idx] = r.proposal;
  ju.confirmedProposalId = r.proposal.id;

  // C 的 changes 已经把转正的人算进"新加入 N 位朋友"了，不再另写一条"候补转正"（对外也不该区分是不是候补）
  const changes = [...r.changes];
  if (promoted.length && !changes.some((c) => /加入/.test(c))) changes.push(`新加入 ${promoted.length} 位朋友`);
  ju.revisions.push({ at: now.toISOString(), reason, changes });

  // 订位：桌数变了要提醒发起人去改
  if (ju.reservation && ju.reservation.tableSize !== r.tableSize) {
    const was = ju.reservation.status;
    ju.reservation = {
      ...ju.reservation,
      tableSize: r.tableSize,
      note:
        was === "booked" || was === "called"
          ? `人数有变，记得跟店家改成 ${r.tableSize} 位`
          : ju.reservation.note,
    };
  }

  const summary = changes.length ? changes.join("；") : "原方案不变";
  announce(
    ju,
    `【局长更新】${reason}。${r.keptVenue ? `还是 ${r.proposal.poi.name}，` : `改到 ${r.proposal.poi.name}，`}${summary}。现在 ${attendees.length} 人。`,
  );
  const notice = `局有一点变化：${reason}。${summary}。${r.keptVenue ? "时间地点不变。" : `新地点：${r.proposal.poi.name}。`}`;
  const promotedIds = new Set(promoted.map((m) => m.id));
  for (const m of attendees) if (!promotedIds.has(m.id)) pushNotice(m, "revision", notice, now);

  saveMembers(members.filter((m) => m.status === "in" || promotedIds.has(m.id)));
  db.saveJu(ju);
  return true;
}

/**
 * B2 在定局后有人退出 / 加入时调用。自己拿 withJuLock ——
 * 注意：调用方不要在同一个局的 withJuLock 里 await 它（会死锁）；在锁里请用 replanAfterChangeLocked，
 * 或者锁外 await / `void` 触发。reason 必须公开安全，如"有朋友临时有事来不了"。
 */
export async function onMembershipChangedAfterConfirm(juId: string, reason: string): Promise<void> {
  await withJuLock(juId, async () => {
    const ju = db.getJu(juId);
    if (!ju) return;
    try {
      await replanAfterChangeLocked(ju, db.listMembers(juId), reason);
    } catch (e) {
      console.warn(`[after ${juId}] 稳定重规划失败，保留原方案：${(e as Error)?.message ?? e}`);
    }
  });
}

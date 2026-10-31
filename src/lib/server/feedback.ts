// v6 局后一键反馈（docs/AVATAR.md 5.3）："昨晚怎么样？很棒 / 太累 / 太贵 / 太远 / 太吵"。
// 第二天在局页面和站内信（kind "feedback"）里出现；点一下就写进本人档案，分身下次据此调整默认值。
// 反馈是私密的：只写本人档案，不进任何公开输出。
import type { FeedbackVerdict, Ju, Member, Profile } from "../types";
import { shanghaiNow } from "../llm/time";
import { findByToken } from "./firewall";
import { HttpError } from "./http";
import { mutateJu, type MutateCtx } from "./ju";
import { notify } from "./ju-core";
import { applyFeedback, FEEDBACK_LABEL, getProfile, proposalActivities, saveProfile } from "./profile";

const HOUR_MS = 3_600_000;
/** 一周后不再问 */
const ASK_WITHIN_MS = 7 * 24 * HOUR_MS;

/** 定局方案几点结束（两段式取最后一段） */
function endOf(ju: Ju): Date | undefined {
  if (ju.status !== "confirmed" || !ju.plan) return undefined;
  const p = ju.plan.proposals.find((x) => x.id === ju.confirmedProposalId);
  if (!p) return undefined;
  const end = p.segments?.length ? p.segments[p.segments.length - 1].end : p.slot.end;
  const t = Date.parse(end);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/** 该问反馈了：局结束后的第二天（上海日期变了，或者已经过了 12 小时），一周内 */
export function feedbackDue(ju: Ju, now: Date): boolean {
  const end = endOf(ju);
  if (!end) return false;
  const since = now.getTime() - end.getTime();
  if (since <= 0 || since > ASK_WITHIN_MS) return false;
  return shanghaiNow(now).ymd > shanghaiNow(end).ymd || since >= 12 * HOUR_MS;
}

export type FeedbackStatus = { due: boolean; verdict?: FeedbackVerdict; title: string };

function requireMe(ctx: MutateCtx, token: string): Member {
  if (!token) throw new HttpError(401, "需要成员身份（x-member-token）");
  const me = findByToken(ctx.members, token);
  if (!me) throw new HttpError(403, "成员身份不对");
  return me;
}

const given = (p: Profile | null, juId: string) => p?.feedback?.find((f) => f.juId === juId)?.verdict;

/** 本人的反馈状态。第一次到期时顺手发一条站内信（每个局只发一次） */
export function feedbackStatus(juId: string, token: string): Promise<FeedbackStatus> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    const profile = me.profileId ? getProfile(me.profileId) : null;
    const verdict = given(profile, juId);
    const due = !verdict && me.status === "in" && !!me.profileId && feedbackDue(ctx.ju, ctx.now);
    if (due && !(me.private?.inbox ?? []).some((n) => n.kind === "feedback")) {
      notify(me, "feedback", `「${ctx.ju.title}」怎么样？点一下告诉局长：很棒 / 太累 / 太贵 / 太远 / 太吵，下次替你安排得更合心意。`, ctx.now);
      ctx.members = ctx.members.filter((m) => m.id === me.id);
    } else {
      ctx.save = false;
    }
    return { due, ...(verdict ? { verdict } : {}), title: ctx.ju.title };
  });
}

/** 一键反馈：写进本人档案（同一个局只记一次），站内信标成已读 */
export function submitFeedback(juId: string, token: string, verdict: FeedbackVerdict): Promise<{ verdict: FeedbackVerdict; reply: string; profile: Profile }> {
  return mutateJu(juId, (ctx) => {
    const me = requireMe(ctx, token);
    if (me.status !== "in") throw new HttpError(409, "这次你没参加，不用反馈");
    if (!me.profileId) throw new HttpError(409, "这台设备还没有档案");
    if (ctx.ju.status !== "confirmed") throw new HttpError(409, "局还没定下来");
    const end = endOf(ctx.ju);
    if (!end || ctx.now.getTime() < end.getTime()) throw new HttpError(409, "局还没结束，结束后再来说说");
    const prev = getProfile(me.profileId);
    if (given(prev, juId)) throw new HttpError(409, "这次已经反馈过了，谢谢");
    const next = applyFeedback(prev, me.profileId, juId, verdict, { activities: proposalActivities(ctx.ju, ctx.ju.confirmedProposalId), budget: me.private?.budgetMax }, ctx.now);
    saveProfile(next);
    for (const n of me.private?.inbox ?? []) if (n.kind === "feedback") n.read = true;
    ctx.members = ctx.members.filter((m) => m.id === me.id);
    return { verdict, reply: REPLY[verdict], profile: next };
  });
}

const REPLY: Record<FeedbackVerdict, string> = {
  great: "太好了！这次的安排我记住了，下次照着来。",
  tired: `「${FEEDBACK_LABEL.tired}」收到，下次默认安排轻松点的。`,
  pricey: `「${FEEDBACK_LABEL.pricey}」收到，下次预算往下调一点。`,
  far: `「${FEEDBACK_LABEL.far}」收到，下次替你守住路程。`,
  loud: `「${FEEDBACK_LABEL.loud}」收到，下次优先找安静的地方。`,
  ok: "收到，谢谢你告诉我。",
};

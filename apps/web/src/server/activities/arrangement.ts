import { Prisma } from '@prisma/client';
import { arrangementReviewV3Schema, arrangementAgreementV3, reacceptArrangementCommandSchema, type ActivityDetail, type ArrangementReviewV3, type ArrangementReviewV4, type ReacceptArrangementCommand } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { withDb } from '../db';
import { loadActivity, lockActivity, type Tx } from './state';
import { mutation } from './mutation';
import { replay, remember } from './idempotency';
import { activitySnapshot } from './snapshot';
import { checkNotCancelled, checkRevision, requestFingerprint } from './rules';
import { arrangementHistory, arrangementPlan } from './arrangement-history';
import { reviewGeneralHistory } from './arrangement-history-v4';
type State = Awaited<ReturnType<typeof loadActivity>>;
function ownJoined(activity: State, segmentId: string, actorId: string) {
  const segment = activity.segments.find(s => s.id === segmentId);
  if (!segment) throw new ServiceError('NOT_FOUND', 404, '未找到此活动环节');
  const participation = segment.participations.find(p => p.userId === actorId && p.status === 'joined');
  if (!participation) throw new ServiceError('FORBIDDEN', 403, '仅本人仍占位的环节可查看变化或重新接受，管理身份不能代替成员接受');
  return { segment, participation };
}
async function review(tx: Tx, activity: State, segmentId: string, actorId: string): Promise<ArrangementReviewV3 | ArrangementReviewV4> {
  const { segment, participation } = ownJoined(activity, segmentId, actorId);
  const current = arrangementPlan(segment);
  const base = { schema_version: 3 as const, history_format: 'verified_v3' as const, activity_id: activity.id, segment_id: segment.id, viewer_user_id: actorId, revision: activity.revision,
    current_plan_revision: segment.planRevision, accepted_plan_revision: participation.acceptedPlanRevision,
    server_time: new Date().toISOString(), current_plan: current };
  if (participation.acceptedPlanRevision === segment.planRevision) return arrangementReviewV3Schema.parse({ ...base,
    state: 'up_to_date', can_reaccept: false, reason: 'UP_TO_DATE', accepted_plan: arrangementAgreementV3(current), history_digest: null, history_anchor: null, changes: [], capacity_changes: [], deadline_changes: [] });
  const general = await reviewGeneralHistory(tx, activity, segment, actorId, participation.acceptedPlanRevision);
  if (general) return general;
  const history = await arrangementHistory(tx, activity, segment, actorId, participation.acceptedPlanRevision, current);
  base.server_time = new Date().toISOString();
  if (!history) return arrangementReviewV3Schema.parse({ ...base, state: 'unavailable', can_reaccept: false, reason: 'HISTORY_UNAVAILABLE', accepted_plan: null, history_digest: null, history_anchor: null, changes: [], capacity_changes: [], deadline_changes: [] });
  const now = new Date();
  base.server_time = now.toISOString();
  const reason = activity.cancelledAt || segment.cancelledAt ? 'CANCELLED' : now >= segment.startsAt ? 'SEGMENT_STARTED' : null;
  return arrangementReviewV3Schema.parse({ ...base, state: 'ready', can_reaccept: reason === null, reason, accepted_plan: history.accepted, history_digest: history.digest, history_anchor: history.anchor, changes: history.changes, capacity_changes: history.capacityChanges, deadline_changes: history.deadlineChanges });
}
export function getArrangementReview(activityId: string, segmentId: string, actorId: string): Promise<ArrangementReviewV3 | ArrangementReviewV4> {
  return withDb(db => db.$transaction(async tx => {
    const activity = await loadActivity(tx, activityId);
    return review(tx, activity, segmentId, actorId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}
export function reacceptArrangement(activityId: string, segmentId: string, actorId: string, raw: ReacceptArrangementCommand): Promise<ActivityDetail> {
  const parsed = reacceptArrangementCommandSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '重新接受请求格式不正确');
  const input = parsed.data, scope = `reaccept:${activityId}:${segmentId}`;
  const fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    // Current actor's retained seat is required even for a read-only processed-key replay.
    const { segment, participation } = ownJoined(activity, segmentId, actorId);
    if (await replay(tx, actorId, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt);
    if (segment.cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '此环节已取消，不能重新接受');
    checkRevision(activity.revision, input.expected_revision);
    if (segment.planRevision !== input.expected_plan_revision || participation.acceptedPlanRevision !== input.from_accepted_plan_revision || participation.acceptedPlanRevision === segment.planRevision) throw new ServiceError('ARRANGEMENT_STALE', 409, '安排或本人接受版本已变化，请重新查看完整差异');
    const now = new Date(); // After parent lock; never use the new-applicant deadline for retained seats.
    if (now >= segment.startsAt) throw new ServiceError('ARRANGEMENT_ACCEPTANCE_CLOSED', 409, '本环节已开始，线上重新接受已关闭；席位和未确认状态保留，请联系组织者');
    const checked = await review(tx, activity, segmentId, actorId);
    const acceptedAt = new Date();
    if (acceptedAt >= segment.startsAt) throw new ServiceError('ARRANGEMENT_ACCEPTANCE_CLOSED', 409, '本环节已开始，线上重新接受已关闭；席位和未确认状态保留，请联系组织者');
    if (checked.state !== 'ready' || !checked.can_reaccept || checked.history_digest !== input.history_digest) throw new ServiceError('ARRANGEMENT_HISTORY_UNAVAILABLE', 409, '完整可信变化历史暂不可核对，未确认本次接受；请刷新，不会用当前安排伪造旧承诺');
    const written = await tx.participation.updateMany({ where: { activityId, segmentId, userId: actorId, status: 'joined', acceptedPlanRevision: input.from_accepted_plan_revision }, data: { acceptedPlanRevision: segment.planRevision, acceptedAt } });
    if (written.count !== 1) throw new ServiceError('CONCURRENT_MODIFICATION', 409, '本人参加状态已变化，请刷新后重试');
    const updated = await tx.activity.update({ where: { id: activityId }, data: { revision: { increment: 1 } } });
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: 'arrangement_reaccepted', revision: updated.revision,
      detail: { segment_id: segmentId, from_plan_revision: input.from_accepted_plan_revision, to_plan_revision: segment.planRevision, history_digest: checked.history_digest } } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}

import { activityIdSchema, cancelActivityInputSchema, type ActivityDetail, type CancelActivityInput } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { replay, remember } from './idempotency';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint } from './rules';
import { activitySnapshot } from './snapshot';
import { invalidatePendingHandovers } from './handover';

/** Deliberately limited to the fully before-start phase. No undo operation,
 * external cancellation/refund, seat deletion or historical-state rewriting.
 */
export function cancelActivity(rawActivityId: string, rawActorId: string, raw: CancelActivityInput): Promise<ActivityDetail> {
  const activityId = activityIdSchema.safeParse(rawActivityId), actorId = activityIdSchema.safeParse(rawActorId);
  const parsed = cancelActivityInputSchema.safeParse(raw);
  if (!activityId.success || !actorId.success || !parsed.success) throw new ServiceError('INVALID_INPUT', 400, '取消活动的标识或内容不正确');
  const id = activityId.data, actor = actorId.data, input = parsed.data, scope = `cancel:${id}`;
  const fingerprint = requestFingerprint(actor, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, id);
    // An old key cannot restore a former manager's authority.
    checkManager(activity.currentManagerId, actor);
    if (await replay(tx, actor, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, id, actor);
    checkNotCancelled(activity.cancelledAt);
    checkRevision(activity.revision, input.expected_revision);
    const now = new Date(); // After lock and all awaited permission/key reads.
    const main = activity.segments.find(segment => segment.id === activity.mainSegmentId);
    if (!main || main.cancelledAt || !activity.segments.length
      || new Set(activity.segments.map(segment => segment.id)).size !== activity.segments.length
      || !activity.segments.some(segment => !segment.cancelledAt)
      || activity.segments.some(segment => !Number.isFinite(segment.startsAt.getTime()) || !Number.isFinite(segment.endsAt.getTime())
        || !Number.isFinite(segment.deadlineAt.getTime()) || segment.endsAt <= segment.startsAt || segment.deadlineAt > segment.startsAt || now >= segment.startsAt)) {
      throw new ServiceError('CANCELLATION_RULE_UNCONFIRMED', 409, '已有环节开始或活动安排无法完整核对；此范围的首次取消尚未启用，规则待确认');
    }
    // Keep all original arrangements, seats, acceptance, pending applications,
    // requirements, quoted fees, verification/booking and formation history.
    const updated = await tx.activity.update({ where: { id }, data: { cancelledAt: now, revision: { increment: 1 } } });
    // Same parent lock: cancellation invalidates only pending handovers; accepted
    // history and the current manager are never reversed.
    await invalidatePendingHandovers(tx, id, now);
    await tx.activityEvent.create({ data: { activityId: id, actorUserId: actor, type: 'activity_cancelled', revision: updated.revision, detail: { scope: 'whole_activity', source: 'manager_explicit_confirmation' } } });
    await remember(tx, actor, input.idempotency_key, scope, fingerprint, id);
    return activitySnapshot(tx, id, actor);
  });
}

import { activityIdSchema, changeCapacityInputSchema, type ChangeCapacityInput, type ActivityDetail } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { replay, remember } from './idempotency';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint, segmentCounts } from './rules';
import { activitySnapshot } from './snapshot';
import { arrangementPlan } from './arrangement-history';
const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647;
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
function unavailable(): never { throw new ServiceError('CAPACITY_SCOPE_UNAVAILABLE', 409, '当前环节人数或安排来源无法完整核对，请刷新查看；未调整人数上限'); }
/** A capacity-only change is not a new agreement, verification, booking or formation proof. */
export function changeCapacity(rawId: string, rawSegment: string, rawActor: string, raw: ChangeCapacityInput): Promise<ActivityDetail> {
  const id = activityIdSchema.safeParse(rawId), target = activityIdSchema.safeParse(rawSegment), actor = activityIdSchema.safeParse(rawActor), parsed = changeCapacityInputSchema.safeParse(raw);
  if (!id.success || !target.success || !actor.success || !parsed.success) throw new ServiceError('INVALID_INPUT', 400, '人数上限的标识或内容不正确');
  const activityId = id.data, segmentId = target.data, actorId = actor.data, input = parsed.data;
  const scope = `capacity:${activityId}:${segmentId}`, fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    checkManager(activity.currentManagerId, actorId);
    // Original-key replay observes current facts, never restores the old capacity.
    if (await replay(tx, actorId, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt); checkRevision(activity.revision, input.expected_revision);
    if (!positiveInt(activity.revision) || activity.revision === 2_147_483_647 || !activity.mainSegmentId
      || !activity.segments.some(s => s.id === activity.mainSegmentId)
      || new Set(activity.segments.map(s => s.id)).size !== activity.segments.length
      || activity.segments.some(s => s.activityId !== activityId || !activityIdSchema.safeParse(s.id).success)) unavailable();
    const segment = activity.segments.find(s => s.id === segmentId);
    if (!segment) throw new ServiceError('NOT_FOUND', 404, '未找到此活动环节');
    if (!positiveInt(segment.capacity) || !positiveInt(segment.minimumParticipants) || !positiveInt(segment.planRevision)
      || segment.minimumParticipants > segment.capacity || !validDate(segment.startsAt) || !validDate(segment.endsAt)
      || !validDate(segment.deadlineAt) || segment.endsAt <= segment.startsAt || segment.deadlineAt > segment.startsAt
      || new Set(segment.participations.map(p => p.userId)).size !== segment.participations.length
      || segment.participations.some(p => !activityIdSchema.safeParse(p.userId).success || !['joined', 'exited'].includes(p.status)
        || (p.acceptedPlanRevision !== null && (!positiveInt(p.acceptedPlanRevision) || p.acceptedPlanRevision > segment.planRevision)))) unavailable();
    if (segment.capacity !== input.expected_capacity) throw new ServiceError('VERSION_CONFLICT', 409, '人数上限已变化，请刷新后重新查看');
    // Read time only after awaited parent-lock and replay reads. Deadline does not close this action.
    const now = new Date();
    if (segment.cancelledAt || now >= segment.startsAt) throw new ServiceError('CAPACITY_CHANGE_CLOSED', 409, '此环节已开始或已取消，线上人数上限调整已关闭；其它未开始环节仍可单独调整');
    const occupied = segmentCounts(segment).occupied_count;
    if (occupied > segment.capacity) unavailable();
    if (input.capacity < occupied) throw new ServiceError('CAPACITY_BELOW_OCCUPIED', 409, '新上限不能低于当前占用人数，待重新接受的保留席位也计入');
    if (input.capacity < segment.minimumParticipants) throw new ServiceError('CAPACITY_BELOW_MINIMUM', 409, '新上限不能低于当前最低成行人数');
    const before = arrangementPlan(segment), after = { ...before, capacity: input.capacity };
    const changed = await tx.activity.updateMany({ where: { id: activityId, currentManagerId: actorId, revision: activity.revision, cancelledAt: null }, data: { revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ServiceError('CONCURRENT_MODIFICATION', 409, '管理权限或活动状态已变化，请刷新后重试');
    if (new Date() >= segment.startsAt) throw new ServiceError('CAPACITY_CHANGE_CLOSED', 409, '此环节已经开始，未调整人数上限');
    await tx.segment.update({ where: { id: segmentId }, data: { capacity: input.capacity } });
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: 'segment_capacity_changed', revision: activity.revision + 1,
      detail: { schema_version: 1, segment_id: segmentId, plan_revision: segment.planRevision, before, after, occupied_count: occupied } } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}

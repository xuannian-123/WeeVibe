import { activityIdSchema, extendDeadlineInputSchema, deadlineExtensionEventSchema, DEADLINE_EXTENSION_EVENT_TYPE, type ExtendDeadlineInput, type ActivityDetail } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { replay, remember } from './idempotency';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint } from './rules';
import { activitySnapshot } from './snapshot';
import { arrangementPlan } from './arrangement-history';
const positiveInt = (n: number) => Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647;
function unavailable(): never { throw new ServiceError('DEADLINE_SCOPE_UNAVAILABLE', 409, '当前环节安排来源无法完整核对，请刷新查看；未延长报名截止'); }
/** This changes only the application/approval window; never a member's accepted agreement. */
export function extendDeadline(rawId: string, rawSegment: string, rawActor: string, raw: ExtendDeadlineInput): Promise<ActivityDetail> {
  const id = activityIdSchema.safeParse(rawId), target = activityIdSchema.safeParse(rawSegment), actor = activityIdSchema.safeParse(rawActor), parsed = extendDeadlineInputSchema.safeParse(raw);
  if (!id.success || !target.success || !actor.success || !parsed.success) throw new ServiceError('INVALID_INPUT', 400, '延期请求格式不正确；新截止必须晚于原截止');
  const activityId = id.data, segmentId = target.data, actorId = actor.data, input = parsed.data;
  const scope = `deadline:${activityId}:${segmentId}`, fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    checkManager(activity.currentManagerId, actorId);
    // Current-manager permission precedes even a successful-key read-only replay.
    if (await replay(tx, actorId, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt); checkRevision(activity.revision, input.expected_revision);
    if (!positiveInt(activity.revision) || activity.revision === 2_147_483_647 || !activity.mainSegmentId
      || !activity.segments.some(s => s.id === activity.mainSegmentId)
      || new Set(activity.segments.map(s => s.id)).size !== activity.segments.length
      || activity.segments.some(s => s.activityId !== activityId || !activityIdSchema.safeParse(s.id).success)) unavailable();
    const segment = activity.segments.find(s => s.id === segmentId);
    if (!segment) throw new ServiceError('NOT_FOUND', 404, '未找到此活动环节');
    if (!positiveInt(segment.planRevision)) unavailable();
    let before;
    try { before = arrangementPlan(segment); } catch { unavailable(); }
    if (before.deadline_at !== input.expected_deadline_at) throw new ServiceError('VERSION_CONFLICT', 409, '报名截止已变化，请刷新后重新查看');
    if (segment.cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '此环节已取消，不能延期');
    const deadline = new Date(input.deadline_at);
    const checkTime = () => {
      const now = new Date();
      if (now >= segment.startsAt) throw new ServiceError('DEADLINE_EXTENSION_CLOSED', 409, '此环节已开始，本片延期功能未启用；没有修改原安排');
      if (now >= deadline || deadline > segment.startsAt) throw new ServiceError('DEADLINE_OUT_OF_RANGE', 409, '新截止必须晚于当前时间，且不能晚于此环节开始时间');
      return now;
    };
    checkTime(); // Lock/replay awaited before sampling; an expired old cutoff may be reopened.
    const event = deadlineExtensionEventSchema.parse({ schema_version: 1, segment_id: segmentId, plan_revision: segment.planRevision,
      before, after: { ...before, deadline_at: input.deadline_at } });
    const changed = await tx.activity.updateMany({ where: { id: activityId, currentManagerId: actorId, revision: activity.revision, cancelledAt: null }, data: { revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ServiceError('CONCURRENT_MODIFICATION', 409, '管理权限或活动状态已变化，请刷新后重试');
    const changedAt = checkTime(); // The whole mutation rolls back if the awaited CAS crossed start/new cutoff.
    await tx.segment.update({ where: { id: segmentId }, data: { deadlineAt: deadline } });
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: DEADLINE_EXTENSION_EVENT_TYPE, revision: activity.revision + 1, createdAt: changedAt, detail: event } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}

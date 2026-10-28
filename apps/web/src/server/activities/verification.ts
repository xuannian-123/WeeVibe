import { verifySegmentInputSchema, type VerifySegmentInput } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { lockActivity } from './state';
import { mutation } from './mutation';
import { replay, remember } from './idempotency';
import { checkManager, checkRevision, checkNotCancelled, requestFingerprint } from './rules';
import { activitySnapshot } from './snapshot';
export function verifySegment(id: string, actor: string, raw: VerifySegmentInput) {
  const parsed = verifySegmentInputSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '人工核实声明格式不正确');
  const input = parsed.data, scope = `segment-verification:${id}:${input.segment_id}`, hash = requestFingerprint(actor, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, id); checkManager(activity.currentManagerId, actor);
    if (await replay(tx, actor, input.idempotency_key, scope, hash)) return activitySnapshot(tx, id, actor);
    checkRevision(activity.revision, input.expected_revision); checkNotCancelled(activity.cancelledAt);
    const segment = activity.segments.find(s => s.id === input.segment_id);
    if (!segment) throw new ServiceError('NOT_FOUND', 404, '未找到此活动环节');
    if (segment.planRevision !== input.expected_plan_revision) throw new ServiceError('ARRANGEMENT_STALE', 409, '安排已变化，请重新核实');
    if (segment.cancelledAt || new Date() >= segment.startsAt) throw new ServiceError('INVALID_INPUT', 409, '已取消或已开始环节不能新增线上核实声明');
    await tx.segment.update({ where: { id: segment.id }, data: { verificationStatus: input.verified ? 'manual_checked' : 'unknown' } });
    if (new Date() >= segment.startsAt) throw new ServiceError('INVALID_INPUT', 409, '核实时环节已经开始，本次未生效');
    const clear = activity.mainSegmentId === segment.id && (!input.verified || segment.verificationStatus !== 'manual_checked');
    const updated = await tx.activity.update({ where: { id }, data: { revision: { increment: 1 }, ...(clear ? { confirmedAt: null, confirmedMainRevision: null, confirmedPlanRevision: null } : {}) } });
    await tx.activityEvent.create({ data: { activityId: id, actorUserId: actor, type: 'segment_verification_changed', revision: updated.revision,
      detail: { segment_id: segment.id, plan_revision: segment.planRevision, verified: input.verified, source: 'manager_manual_declaration' } } });
    await remember(tx, actor, input.idempotency_key, scope, hash, id);
    return activitySnapshot(tx, id, actor);
  });
}

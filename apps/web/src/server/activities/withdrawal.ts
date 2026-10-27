import { activityIdSchema, withdrawApplicationInputSchema, type ActivityDetail, type WithdrawApplicationInput } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { replay, remember } from './idempotency';
import { checkRevision, requestFingerprint } from './rules';
import { activitySnapshot } from './snapshot';

/** First slice: a person's whole pending request, before all target cutoffs.
 * Later/cancelled phases are not yet enabled; this is not a product prohibition.
 * No participant/seat, acceptance, arrangement, price or formation writes occur.
 */
export function withdrawApplication(rawActivityId: string, rawApplicationId: string, rawActorId: string, raw: WithdrawApplicationInput): Promise<ActivityDetail> {
  const activityId = activityIdSchema.safeParse(rawActivityId);
  const applicationId = activityIdSchema.safeParse(rawApplicationId);
  const actorId = activityIdSchema.safeParse(rawActorId);
  const parsed = withdrawApplicationInputSchema.safeParse(raw);
  if (!activityId.success || !applicationId.success || !actorId.success || !parsed.success) {
    throw new ServiceError('INVALID_INPUT', 400, '撤回申请的标识或内容不正确');
  }
  const id = activityId.data, targetId = applicationId.data, actor = actorId.data, input = parsed.data;
  const scope = `withdraw:${id}:${targetId}`;
  const fingerprint = requestFingerprint(actor, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, id);
    // Ownership is checked even before successful-key replay. No existence or
    // contents of another person's application are exposed to this actor.
    const application = await tx.activityApplication.findFirst({
      where: { id: targetId, activityId: id, applicantUserId: actor }, include: { targets: true }
    });
    if (!application) throw new ServiceError('NOT_FOUND', 404, '未找到本人在此活动的申请');
    if (await replay(tx, actor, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, id, actor);
    if (application.status !== 'pending') throw new ServiceError('APPLICATION_ALREADY_DECIDED', 409, '申请已处理，不能作为待审批申请撤回；请刷新查看，已获席位不会因此退出');
    checkRevision(activity.revision, input.expected_revision);
    const targets = application.targets.map(target => activity.segments.find(segment => segment.id === target.segmentId));
    if (!targets.length || targets.some(target => !target)) throw new ServiceError('WITHDRAWAL_RULE_UNCONFIRMED', 409, '申请环节无法完整核对，暂未启用此撤回操作，请刷新核对');
    // Current time is sampled after the parent lock AND asynchronous reads.
    const now = new Date();
    if (activity.cancelledAt || targets.some(target => target!.cancelledAt || now >= target!.deadlineAt || now >= target!.startsAt)) {
      throw new ServiceError('WITHDRAWAL_RULE_UNCONFIRMED', 409, '截止、开始或取消后的新撤回操作尚未启用，规则待确认；已加入的席位不受影响');
    }
    const changed = await tx.activityApplication.updateMany({
      where: { id: targetId, activityId: id, applicantUserId: actor, status: 'pending' },
      data: { status: 'withdrawn', decidedAt: now }
    });
    if (changed.count !== 1) throw new ServiceError('APPLICATION_ALREADY_DECIDED', 409, '申请状态已变化，请刷新查看；本次未确认撤回');
    const updated = await tx.activity.update({ where: { id }, data: { revision: { increment: 1 } } });
    await tx.activityEvent.create({ data: {
      activityId: id, actorUserId: actor, type: 'application_withdrawn', revision: updated.revision,
      detail: { application_id: targetId }
    } });
    await remember(tx, actor, input.idempotency_key, scope, fingerprint, id);
    return activitySnapshot(tx, id, actor);
  });
}

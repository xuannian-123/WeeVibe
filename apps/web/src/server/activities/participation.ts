import { participationActionSchema, type ParticipationAction, type ParticipationActionResult } from '@weevibe/contracts/src/participation-actions';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { replay, remember } from './idempotency';
import { activitySnapshot } from './snapshot';
import { lockActivity } from './state';
import { checkNotCancelled, checkRevision, requestFingerprint } from './rules';
import { checkParticipationAction } from './participation-rules';

const exitNotice = '已退出所选环节并释放席位。人数变化，费用需重新核实；没有自动扣款、退款、分摊或处理线下预约。';
const lateNotice = '已记录所选环节的预计到达时间；保留原席位及安排接受状态，不代表同意任何新安排。';
export function changeParticipation(activityId: string, actorId: string, raw: ParticipationAction): Promise<ParticipationActionResult> {
  const parsed = participationActionSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '参加状态变更格式不正确');
  const input = parsed.data;
  const scope = `participation:${activityId}`;
  const normalized = { ...input, segment_ids: [...input.segment_ids].sort(), ...(input.action === 'late' ? { estimated_arrival_at: new Date(input.estimated_arrival_at).toISOString() } : {}) };
  const fingerprint = requestFingerprint(actorId, scope, normalized);
  return mutation(async tx => {
    // Same parent lock as applications and approvals: seats cannot race approval.
    const activity = await lockActivity(tx, activityId);
    const result = async (replayed = false) => ({
      activity: await activitySnapshot(tx, activityId, actorId),
      // A user may already have rejoined since an earlier exit succeeded.
      // A read-only replay must not present that historic exit as a new one.
      notice: replayed ? '原请求已处理，本次未重复变更。当前席位、晚到及接受状态请以最新参加记录为准。' : input.action === 'exit' ? exitNotice : lateNotice,
      fee_recheck_required: input.action === 'exit'
    });
    if (await replay(tx, actorId, input.idempotency_key, scope, fingerprint)) return result(true);
    checkNotCancelled(activity.cancelledAt);
    checkRevision(activity.revision, input.expected_revision);
    const now = new Date();
    const selected = checkParticipationAction(activity.segments, actorId, input, now);
    const updatedRows = await tx.participation.updateMany({
      where: { activityId, userId: actorId, segmentId: { in: input.segment_ids }, status: 'joined' },
      data: input.action === 'exit'
        ? { status: 'exited', exitedAt: now, acceptedAt: null, acceptedPlanRevision: null, lateArrivalAt: null, lateNoticeAt: null }
        : { lateArrivalAt: new Date(input.estimated_arrival_at), lateNoticeAt: now }
    });
    if (updatedRows.count !== selected.length) throw new ServiceError('CONCURRENT_MODIFICATION', 409, '参加状态已变化，请刷新后再操作');
    const main = selected.find(s => s.id === activity.mainSegmentId);
    const mainBelowMinimum = input.action === 'exit' && main && main.participations.filter(p => p.status === 'joined' && p.userId !== actorId).length < main.minimumParticipants;
    const updated = await tx.activity.update({ where: { id: activityId }, data: {
      revision: { increment: 1 },
      ...(input.action === 'exit' ? { membershipRevision: { increment: 1 } } : {}),
      // Never silently restore formation merely because another participant joins later.
      ...(mainBelowMinimum ? { confirmedAt: null, confirmedMainRevision: null, confirmedPlanRevision: null } : {})
    } });
    await tx.activityEvent.create({ data: {
      activityId, actorUserId: actorId, type: input.action === 'exit' ? 'participation_exited' : 'participation_late', revision: updated.revision,
      detail: { segment_ids: [...input.segment_ids].sort(), ...(input.action === 'late' ? { estimated_arrival_at: new Date(input.estimated_arrival_at).toISOString() } : { fee_recheck_required: true }) }
    } });
    // Requirement response tables and application history are deliberately untouched.
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return result();
  });
}

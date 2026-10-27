import type { ApplyToActivityInput, DecideApplicationInput } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { replay, remember } from './idempotency';
import { activitySnapshot } from './snapshot';
import { lockActivity } from './state';
import { checkManager, checkNotCancelled, checkRevision, checkSelectedSegments, requestFingerprint } from './rules';

export function applyToActivity(activityId: string, actorId: string, input: ApplyToActivityInput) {
  const scope = `apply:${activityId}`;
  const fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    const previous = await replay(tx, actorId, input.idempotency_key, scope, fingerprint);
    if (previous) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt);
    checkRevision(activity.revision, input.expected_revision);
    checkSelectedSegments(activity.segments, input.segments, actorId, new Date());
    const overlapping = await tx.activityApplication.findFirst({ where: {
      activityId, applicantUserId: actorId, status: 'pending',
      targets: { some: { segmentId: { in: input.segments.map(s => s.segment_id) } } }
    } });
    if (overlapping) throw new ServiceError('APPLICATION_ALREADY_PENDING', 409, '所选环节已有待处理申请，请勿重复申请');
    // Existing public invitation sources remain usable after their inviter exits.
    // This is attribution only: it cannot bypass the ordinary application rules.
    if (input.invitation_source_id !== undefined) {
      const source = await tx.invitationSource.findFirst({
        where: { id: input.invitation_source_id, activityId }, select: { id: true, activityId: true }
      });
      if (!source || source.id !== input.invitation_source_id || source.activityId !== activityId)
        throw new ServiceError('INVALID_INPUT', 409, '邀请入口与此活动不匹配，请重新打开活动入口');
      // The source read is awaited under the lock: do not accept a cutoff crossed while it resolves.
      checkSelectedSegments(activity.segments, input.segments, actorId, new Date());
    }
    const application = await tx.activityApplication.create({ data: {
      activityId, applicantUserId: actorId, displayName: input.display_name ?? null,
      ...(input.invitation_source_id !== undefined ? { invitationSourceId: input.invitation_source_id } : {})
    } });
    await tx.applicationTarget.createMany({ data: input.segments.map(s => ({ activityId, applicationId: application.id, segmentId: s.segment_id, acceptedPlanRevision: s.plan_revision })) });
    const updated = await tx.activity.update({ where: { id: activityId }, data: { revision: { increment: 1 } } });
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: 'application_created', revision: updated.revision, detail: { application_id: application.id } } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}

export function decideApplication(activityId: string, applicationId: string, actorId: string, input: DecideApplicationInput) {
  const scope = `decision:${activityId}:${applicationId}`;
  const fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    // Replayed approvals do not revive an old manager's authority.
    checkManager(activity.currentManagerId, actorId);
    const previous = await replay(tx, actorId, input.idempotency_key, scope, fingerprint);
    if (previous) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt);
    checkRevision(activity.revision, input.expected_revision);
    const application = await tx.activityApplication.findFirst({ where: { id: applicationId, activityId }, include: { targets: true } });
    if (!application) throw new ServiceError('NOT_FOUND', 404, '未找到此申请');
    if (application.status !== 'pending') throw new ServiceError('APPLICATION_ALREADY_DECIDED', 409, '此申请已处理，请刷新活动');
    const now = new Date();
    if (input.decision === 'approve') {
      const selected = application.targets.map(t => ({ segment_id: t.segmentId, plan_revision: t.acceptedPlanRevision }));
      if (!selected.length) throw new ServiceError('INVALID_INPUT', 400, '申请环节为空');
      checkSelectedSegments(activity.segments, selected, application.applicantUserId, now);
      // All target upserts share this ONE serializable transaction. A failure of
      // any target rolls back all seats, acceptance, application and key writes.
      for (const target of application.targets) {
        const data = { status: 'joined' as const, acceptedPlanRevision: target.acceptedPlanRevision, acceptedAt: now, displayName: application.displayName, sourceApplicationId: applicationId, joinedAt: now, exitedAt: null };
        await tx.participation.upsert({
          where: { segmentId_userId: { segmentId: target.segmentId, userId: application.applicantUserId } },
          create: { ...data, activityId, segmentId: target.segmentId, userId: application.applicantUserId }, update: data
        });
      }
    }
    // Rejection is allowed after segment closure/version change to clear a
    // pending request; it never acquires seats or claims acceptance of new terms.
    await tx.activityApplication.update({ where: { id: applicationId }, data: { status: input.decision === 'approve' ? 'approved' : 'rejected', decidedAt: now } });
    const updated = await tx.activity.update({ where: { id: activityId }, data: { revision: { increment: 1 }, ...(input.decision === 'approve' ? { membershipRevision: { increment: 1 } } : {}) } });
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: `application_${input.decision === 'approve' ? 'approved' : 'rejected'}`, revision: updated.revision, detail: { application_id: applicationId } } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  activityDetailSchema, activityFeeSchema, activityLocationSchema,
  type ActivityDetail, type ApplyToActivityInput, type CreateActivityInput, type DecideApplicationInput
} from '@weego/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { applicationVisibility, checkJoinOpen, checkManager, checkNotCancelled, checkRevision, checkSelectedSegments, requestFingerprint, segmentCounts, verifyReplay } from './rules';

type Tx = Prisma.TransactionClient;
const stateInclude = {
  segments: { orderBy: { position: 'asc' as const }, include: { participations: { select: { userId: true, status: true, acceptedPlanRevision: true } } } }
} satisfies Prisma.ActivityInclude;

async function loadActivity(tx: Tx, id: string) {
  const activity = await tx.activity.findUnique({ where: { id }, include: stateInclude });
  if (!activity) throw new ServiceError('NOT_FOUND', 404, '未找到此活动');
  return activity;
}
async function lockActivity(tx: Tx, id: string) {
  // Every seat-affecting operation takes this parent lock before reading counts.
  // Identifier already passes UUID validation; values remain parameterized.
  await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return loadActivity(tx, id);
}

export async function activitySnapshot(tx: Tx, activityId: string, actorId: string | null): Promise<ActivityDetail> {
  const activity = await loadActivity(tx, activityId);
  if (!activity.mainSegmentId) throw new ServiceError('INTERNAL_ERROR', 500, '活动安排暂时不可用');
  const isManager = activity.currentManagerId === actorId;
  const applications = actorId ? await tx.activityApplication.findMany({
    where: { activityId, ...(isManager ? {} : { applicantUserId: actorId }) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { targets: { orderBy: { segmentId: 'asc' } } }
  }) : [];
  const applicationViews = applications.map(a => ({
    application_id: a.id, applicant_user_id: a.applicantUserId, display_name: a.displayName,
    status: a.status, segments: a.targets.map(t => ({ segment_id: t.segmentId, plan_revision: t.acceptedPlanRevision })),
    created_at: a.createdAt.toISOString(), decided_at: a.decidedAt?.toISOString() ?? null
  }));
  const visibility = applicationVisibility(applicationViews, actorId, activity.currentManagerId);
  const now = new Date();
  const segments = activity.segments.map(s => {
    const counts = segmentCounts(s);
    return {
      segment_id: s.id, client_ref: s.clientRef, position: s.position, type: s.type, name: s.name,
      starts_at: s.startsAt.toISOString(), ends_at: s.endsAt.toISOString(), deadline_at: s.deadlineAt.toISOString(),
      minimum_participants: s.minimumParticipants, capacity: s.capacity, plan_revision: s.planRevision,
      location: activityLocationSchema.parse(s.location), fee: activityFeeSchema.parse(s.fee), requirements: s.requirements,
      cancelled_at: s.cancelledAt?.toISOString() ?? null,
      has_started: now >= s.startsAt,
      is_join_open: !activity.cancelledAt && !s.cancelledAt && now < s.startsAt && now < s.deadlineAt && counts.remaining_capacity > 0,
      verification_status: s.verificationStatus, booking_status: s.bookingStatus, counts
    };
  });
  const main = segments.find(s => s.segment_id === activity.mainSegmentId);
  const confirmed = !!main && !activity.cancelledAt && !main.cancelled_at && !!activity.confirmedAt
    && activity.confirmedMainRevision === activity.mainRevision && activity.confirmedPlanRevision === main.plan_revision
    && main.counts.meets_minimum && main.counts.pending_acceptance_count === 0 && main.verification_status === 'manual_checked';
  return activityDetailSchema.parse({
    activity_id: activity.id, name: activity.name, timezone: activity.timezone, revision: activity.revision,
    server_time: now.toISOString(), main_segment_id: activity.mainSegmentId, cancelled_at: activity.cancelledAt?.toISOString() ?? null,
    formation_status: confirmed ? 'confirmed' : 'not_confirmed', segments,
    viewer: {
      user_id: actorId, is_manager: isManager,
      participations: actorId ? activity.segments.flatMap(s => s.participations.filter(p => p.userId === actorId).map(p => ({
        segment_id: s.id, status: p.status === 'exited' ? 'exited' : p.acceptedPlanRevision === s.planRevision ? 'joined' : 'awaiting_acceptance',
        accepted_plan_revision: p.acceptedPlanRevision
      }))) : [],
      applications: visibility.own_applications
    },
    ...(visibility.applications ? { applications: visibility.applications } : {})
  });
}

async function mutation<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  return withDb(async db => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await db.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 }); }
      catch (error) {
        // A unique-key race must roll back the WHOLE operation, then re-read the
        // idempotency winner or current seats. Never continue a failed transaction.
        const retryable = error instanceof Prisma.PrismaClientKnownRequestError && (
          ['P2034', 'P2002'].includes(error.code)
          || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code)))
        );
        if (retryable) {
          if (attempt < 2) continue;
          throw new ServiceError('CONCURRENT_MODIFICATION', 409, '其他成员正在更新活动，请刷新后重试');
        }
        throw error;
      }
    }
    throw new ServiceError('CONCURRENT_MODIFICATION', 409, '活动正在更新，请刷新后重试');
  });
}
async function replay(tx: Tx, actorId: string, key: string, scope: string, fingerprint: string) {
  const row = await tx.activityMutationKey.findUnique({ where: { actorUserId_key: { actorUserId: actorId, key } } });
  if (!row) return null;
  verifyReplay(row, scope, fingerprint);
  return row;
}
async function remember(tx: Tx, actorId: string, key: string, scope: string, fingerprint: string, activityId: string) {
  await tx.activityMutationKey.create({ data: { actorUserId: actorId, key, scope, requestHash: fingerprint, activityId } });
}

export function getActivity(activityId: string, actorId: string | null) {
  return withDb(db => db.$transaction(tx => activitySnapshot(tx, activityId, actorId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

export function createActivity(actorId: string, input: CreateActivityInput) {
  const scope = 'create';
  const fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const previous = await replay(tx, actorId, input.idempotency_key, scope, fingerprint);
    if (previous) return activitySnapshot(tx, previous.activityId, actorId);
    const now = new Date();
    // Management never implicitly joins. Explicit self-selection follows the
    // same open/started boundaries as any seat acquisition.
    for (const s of input.segments.filter(s => input.participating_segment_refs.includes(s.client_ref))) {
      checkJoinOpen({ startsAt: new Date(s.starts_at), deadlineAt: new Date(s.deadline_at), cancelledAt: null }, now);
    }
    const activityId = randomUUID();
    const refs = new Map(input.segments.map(s => [s.client_ref, randomUUID()]));
    await tx.activity.create({ data: { id: activityId, name: input.name, timezone: input.timezone, currentManagerId: actorId } });
    await tx.segment.createMany({ data: input.segments.map((s, position) => ({
      id: refs.get(s.client_ref)!, activityId, clientRef: s.client_ref, position, type: s.type, name: s.name,
      startsAt: new Date(s.starts_at), endsAt: new Date(s.ends_at), deadlineAt: new Date(s.deadline_at),
      minimumParticipants: s.minimum_participants, capacity: s.capacity, location: s.location, fee: s.fee, requirements: s.requirements
    })) });
    await tx.activity.update({ where: { id: activityId }, data: { mainSegmentId: refs.get(input.main_segment_ref)! } });
    if (input.participating_segment_refs.length) {
      await tx.participation.createMany({ data: input.participating_segment_refs.map(ref => ({
        activityId, segmentId: refs.get(ref)!, userId: actorId, acceptedPlanRevision: 1, acceptedAt: now, displayName: input.display_name ?? null
      })) });
    }
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: 'activity_created', revision: 1, detail: { segment_ids: [...refs.values()] } } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}

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
    const application = await tx.activityApplication.create({ data: {
      activityId, applicantUserId: actorId, displayName: input.display_name ?? null
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

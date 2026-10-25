import { Prisma } from '@prisma/client';
import { activityDetailSchema, activityFeeSchema, activityLocationSchema, type ActivityDetail } from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { loadActivity, type Tx } from './state';
import { applicationVisibility, segmentCounts } from './rules';

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

export function getActivity(activityId: string, actorId: string | null) {
  return withDb(db => db.$transaction(tx => activitySnapshot(tx, activityId, actorId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

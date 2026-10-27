import { Prisma } from '@prisma/client';
import { activityIdSchema, PUBLIC_ROSTER_LIMIT, publicRosterSnapshotSchema, type PublicRosterSnapshot } from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';

function positiveInt(value: unknown): value is number { return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647; }
function dateOrNull(value: unknown) { return value === null || value instanceof Date && Number.isFinite(value.getTime()); }
function unavailable(): never { throw new ServiceError('ROSTER_UNAVAILABLE', 503, '完整报名名单暂不可用，请刷新后重试'); }
function overLimit(): never { throw new ServiceError('ROSTER_LIMIT_EXCEEDED', 503, '当前完整报名名单超出读取上限，未返回截断名单'); }

// A single repeatable-read snapshot binds the names to their exact plan/version
// counts. No profile/user/application/answer/private-origin relation is read.
export function getActivityRoster(rawActivityId: string, actorId: string | null = null): Promise<PublicRosterSnapshot> {
  const id = activityIdSchema.safeParse(rawActivityId);
  if (!id.success) throw new ServiceError('INVALID_INPUT', 400, '活动标识无效');
  return withDb(db => db.$transaction(async tx => {
    const raw = await tx.activity.findUnique({ where: { id: id.data }, select: {
      id: true, revision: true, cancelledAt: true, currentManagerId: true,
      segments: { orderBy: [{ position: 'asc' }, { id: 'asc' }], take: PUBLIC_ROSTER_LIMIT + 1, select: {
        id: true, activityId: true, name: true, position: true, planRevision: true, cancelledAt: true
      } }
    } });
    if (!raw) throw new ServiceError('NOT_FOUND', 404, '未找到此活动');
    if (Array.isArray(raw.segments) && raw.segments.length > PUBLIC_ROSTER_LIMIT) overLimit();
    const activity = raw;
    if (activity.id !== id.data || !positiveInt(activity.revision) || !dateOrNull(activity.cancelledAt) || !Array.isArray(activity.segments) || !activity.segments.length) unavailable();
    if (activity.segments.some(s => !s || s.activityId !== id.data || !activityIdSchema.safeParse(s.id).success || !positiveInt(s.planRevision) || !dateOrNull(s.cancelledAt) || !Number.isInteger(s.position) || s.position < 0 || s.position > 2_147_483_647)) unavailable();
    if (new Set(activity.segments.map(s => s.id)).size !== activity.segments.length || new Set(activity.segments.map(s => s.position)).size !== activity.segments.length) unavailable();
    const segments = [...activity.segments].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
    const active = activity.cancelledAt ? [] : segments.filter(s => !s.cancelledAt);
    // Authenticate at the route, then authorize from this transaction's current
    // management/seat state. Knowing an activity or invitation ID grants no names.
    const canSeeNames = actorId !== null && (activity.currentManagerId === actorId || Boolean(active.length && await tx.participation.findFirst({
      where: { activityId: id.data, userId: actorId, status: 'joined', segmentId: { in: active.map(s => s.id) } }, select: { id: true }
    })));
    const rawMembers = active.length ? await tx.participation.findMany({
      where: { activityId: id.data, status: 'joined', segmentId: { in: active.map(s => s.id) } },
      // joinedAt/id only order rows; neither is selected or exposed.
      orderBy: [{ segmentId: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }], take: PUBLIC_ROSTER_LIMIT + 1,
      select: { segmentId: true, acceptedPlanRevision: true, ...(canSeeNames ? { displayName: true } : {}) }
    }) : [];
    if (Array.isArray(rawMembers) && rawMembers.length > PUBLIC_ROSTER_LIMIT) overLimit();
    if (!Array.isArray(rawMembers) || rawMembers.some(row => !row || typeof row !== 'object'
      || Object.keys(row).length !== (canSeeNames ? 3 : 2) || !activityIdSchema.safeParse(row.segmentId).success
      || canSeeNames && !(row.displayName === null || typeof row.displayName === 'string' && row.displayName.length <= 40)
      || !(row.acceptedPlanRevision === null || positiveInt(row.acceptedPlanRevision)))) unavailable();
    const members = new Map<string, NonNullable<PublicRosterSnapshot['segments'][number]['members']>>(active.map(s => [s.id, []]));
    const versions = new Map(active.map(s => [s.id, s.planRevision]));
    for (const row of rawMembers) {
      const version = versions.get(row.segmentId), list = members.get(row.segmentId);
      if (version === undefined || !list || (row.acceptedPlanRevision !== null && row.acceptedPlanRevision > version)) unavailable();
      list.push({ display_name: canSeeNames ? row.displayName : null, status: row.acceptedPlanRevision === version ? 'joined' : 'awaiting_acceptance' });
    }
    const response = publicRosterSnapshotSchema.safeParse({
      activity_id: activity.id, activity_revision: activity.revision, server_time: new Date().toISOString(),
      cancelled: activity.cancelledAt !== null, complete: true, limit: PUBLIC_ROSTER_LIMIT,
      segments: segments.map(s => {
        const hidden = activity.cancelledAt !== null || s.cancelledAt !== null;
        const list = members.get(s.id) ?? [];
        const accepted = list.filter(m => m.status === 'joined').length;
        return { segment_id: s.id, name: s.name, position: s.position, plan_revision: s.planRevision, cancelled: s.cancelledAt !== null,
          availability: hidden ? 'cancelled_history_not_exposed' : canSeeNames ? 'available' : 'counts_only', members: hidden || !canSeeNames ? null : list,
          counts: hidden ? null : { occupied_count: list.length, accepted_count: accepted, pending_acceptance_count: list.length - accepted } };
      })
    });
    if (!response.success) unavailable();
    return response.data;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

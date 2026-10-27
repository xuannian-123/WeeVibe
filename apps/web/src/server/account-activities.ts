import { accountActivityRecordSchema, type AccountActivityRecord } from '@weevibe/contracts';
import type { Tx } from './activities/state';

/** Authenticated account discovery only. Public browsing and saved invitations are not membership. */
export async function accountActivityRecords(tx: Tx, userId: string, now: Date): Promise<AccountActivityRecord[]> {
  const rows = await tx.activity.findMany({
    where: { OR: [
      { currentManagerId: userId },
      { segments: { some: { participations: { some: { userId, status: { in: ['joined', 'exited'] } } } } } },
      { applications: { some: { applicantUserId: userId, status: 'pending' } } }
    ] },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100,
    select: { id: true, name: true, timezone: true, currentManagerId: true, cancelledAt: true,
      segments: { orderBy: { position: 'asc' }, select: { startsAt: true, endsAt: true, cancelledAt: true, location: true, planRevision: true,
        participations: { where: { userId, status: { in: ['joined', 'exited'] } }, select: { userId: true, status: true, acceptedPlanRevision: true } } } },
      applications: { where: { applicantUserId: userId, status: 'pending' }, select: { applicantUserId: true, status: true } }
    }
  });
  const records = new Map<string, AccountActivityRecord>();
  for (const row of rows) {
    const joined = row.segments.filter(s => s.participations.some(p => p.userId === userId && p.status === 'joined'));
    const exited = row.segments.filter(s => s.participations.some(p => p.userId === userId && p.status === 'exited'));
    const pending = row.applications.filter(a => a.applicantUserId === userId && a.status === 'pending').length;
    const manager = row.currentManagerId === userId;
    if (!manager && !joined.length && !exited.length && !pending) continue;
    // Keep personal joined-segment dates where they exist, otherwise explicitly label activity-wide dates.
    const scoped = joined.length ? joined : row.segments;
    const active = scoped.filter(s => !s.cancelledAt);
    const dated = (active.length ? active : scoped).filter(s => Number.isFinite(s.startsAt.getTime()) && Number.isFinite(s.endsAt.getTime()));
    const start = dated.length ? Math.min(...dated.map(s => s.startsAt.getTime())) : null;
    const end = dated.length ? Math.max(...dated.map(s => s.endsAt.getTime())) : null;
    const location = dated[0]?.location;
    const phase = start === null || end === null ? 'undated' : now.getTime() < start ? 'upcoming' : now.getTime() >= end ? 'ended' : 'ongoing';
    records.set(row.id, accountActivityRecordSchema.parse({
      activity_id: row.id, title: row.name, timezone: row.timezone,
      starts_at: start === null ? null : new Date(start).toISOString(), ends_at: end === null ? null : new Date(end).toISOString(),
      phase, time_scope: joined.length ? 'participation' : 'activity',
      location: location && typeof location === 'object' && !Array.isArray(location) && typeof location.name === 'string' ? location.name : '',
      cancelled: Boolean(row.cancelledAt) || (row.segments.length > 0 && row.segments.every(s => s.cancelledAt)),
      participation_cancelled: joined.length > 0 && joined.every(s => s.cancelledAt),
      is_manager: manager, joined_segment_count: joined.length, exited_segment_count: exited.length, pending_application_count: pending,
      awaiting_acceptance: joined.some(s => !s.cancelledAt && s.participations.some(p => p.userId === userId && p.status === 'joined' && p.acceptedPlanRevision !== s.planRevision))
    }));
  }
  // Current/upcoming plans first, completed history most recent first; stable tie-breaking avoids duplicates/jumps.
  const rank = { ongoing: 0, upcoming: 1, ended: 2, undated: 3 };
  return [...records.values()].sort((a, b) => rank[a.phase] - rank[b.phase] ||
    (a.phase === 'ended' ? (b.ends_at || '').localeCompare(a.ends_at || '') : (a.starts_at || '').localeCompare(b.starts_at || '')) || a.activity_id.localeCompare(b.activity_id));
}

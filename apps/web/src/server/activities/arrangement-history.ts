import { createHash } from 'node:crypto';
import { ARRANGEMENT_CHANGE_EVENT_TYPE, CAPACITY_CHANGE_EVENT_TYPE, DEADLINE_EXTENSION_EVENT_TYPE, ARRANGEMENT_HISTORY_LIMIT, arrangementChangeEventSchema, capacityChangeEventSchema, deadlineExtensionEventSchema,
  arrangementPlanSchema, arrangementAgreementV3, type ArrangementPlan, type ArrangementAgreementV3, type ArrangementReviewV3 } from '@weevibe/contracts';
import type { loadActivity, Tx } from './state';
type ActivityState = Awaited<ReturnType<typeof loadActivity>>;
export type ArrangementSegment = ActivityState['segments'][number];
export function arrangementPlan(segment: ArrangementSegment): ArrangementPlan {
  return arrangementPlanSchema.parse({
    segment_id: segment.id, client_ref: segment.clientRef, position: segment.position, type: segment.type, name: segment.name,
    starts_at: segment.startsAt.toISOString(), ends_at: segment.endsAt.toISOString(), deadline_at: segment.deadlineAt.toISOString(),
    minimum_participants: segment.minimumParticipants, capacity: segment.capacity,
    location: segment.location, fee: segment.fee, requirements: segment.requirements
  });
}
type CompleteHistory = { anchor: NonNullable<ArrangementReviewV3['history_anchor']>; accepted: ArrangementAgreementV3; changes: ArrangementReviewV3['changes']; capacityChanges: ArrangementReviewV3['capacity_changes']; deadlineChanges: ArrangementReviewV3['deadline_changes']; digest: string };
/** Reconstruct FULL immutable event snapshots, then project agreement and capacity separately.
 * Capacity records cover plan-version intervals, NOT the member's precise acceptance time.
 * Missing/forked/unknown events fail closed; current data never fills a historical gap.
 */
export async function arrangementHistory(tx: Tx, activity: ActivityState, segment: ArrangementSegment, actorId: string, from: number | null, current: ArrangementPlan): Promise<CompleteHistory | null> {
  if (from === null || from < 1 || from >= segment.planRevision || segment.planRevision - from > ARRANGEMENT_HISTORY_LIMIT) return null;
  const read = (type: string) => tx.activityEvent.findMany({
    where: { activityId: activity.id, type, detail: { path: ['segment_id'], equals: segment.id } },
    orderBy: [{ revision: 'asc' }, { id: 'asc' }], take: ARRANGEMENT_HISTORY_LIMIT + 1,
    select: { activityId: true, revision: true, detail: true, createdAt: true }
  });
  const requirements = await read(ARRANGEMENT_CHANGE_EVENT_TYPE), capacities = await read(CAPACITY_CHANGE_EVENT_TYPE), deadlines = await read(DEADLINE_EXTENSION_EVENT_TYPE);
  if (requirements.length + capacities.length + deadlines.length > ARRANGEMENT_HISTORY_LIMIT) return null;
  type Row = { kind: 'requirements'; event: ReturnType<typeof arrangementChangeEventSchema.parse>; revision: number; at: string }
    | { kind: 'capacity'; event: ReturnType<typeof capacityChangeEventSchema.parse>; revision: number; at: string }
    | { kind: 'deadline'; event: ReturnType<typeof deadlineExtensionEventSchema.parse>; revision: number; at: string };
  const parsed: Row[] = [], seenRevisions = new Set<number>();
  const validRow = (row: (typeof requirements)[number]) => row.activityId === activity.id && Number.isSafeInteger(row.revision) && row.revision >= 1 && row.revision <= activity.revision
    && row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime()) && row.createdAt <= new Date() && !seenRevisions.has(row.revision);
  for (const row of requirements) {
    const event = arrangementChangeEventSchema.safeParse(row.detail);
    if (!event.success || event.data.segment_id !== segment.id || event.data.to_plan_revision > segment.planRevision || !validRow(row)) return null;
    seenRevisions.add(row.revision);
    if (event.data.from_plan_revision >= from) parsed.push({ kind: 'requirements', event: event.data, revision: row.revision, at: row.createdAt.toISOString() });
  }
  for (const row of capacities) {
    const event = capacityChangeEventSchema.safeParse(row.detail);
    if (!event.success || event.data.segment_id !== segment.id || event.data.plan_revision > segment.planRevision || !validRow(row)) return null;
    seenRevisions.add(row.revision);
    if (event.data.plan_revision >= from) parsed.push({ kind: 'capacity', event: event.data, revision: row.revision, at: row.createdAt.toISOString() });
  }
  for (const row of deadlines) {
    const event = deadlineExtensionEventSchema.safeParse(row.detail);
    if (!event.success || event.data.segment_id !== segment.id || event.data.plan_revision > segment.planRevision || !validRow(row)
      || row.createdAt.getTime() >= Date.parse(event.data.after.deadline_at) || row.createdAt.getTime() >= Date.parse(event.data.before.starts_at)) return null;
    seenRevisions.add(row.revision);
    if (event.data.plan_revision >= from) parsed.push({ kind: 'deadline', event: event.data, revision: row.revision, at: row.createdAt.toISOString() });
  }
  parsed.sort((a, b) => a.revision - b.revision);
  let revision = from;
  let previous: ArrangementPlan | null = null;
  const changes: ArrangementReviewV3['changes'] = [], capacityChanges: ArrangementReviewV3['capacity_changes'] = [], deadlineChanges: ArrangementReviewV3['deadline_changes'] = [];
  for (const row of parsed) {
    const e = row.event;
    if (previous && JSON.stringify(previous) !== JSON.stringify(e.before)) return null;
    if (row.kind === 'requirements') {
      const e = row.event;
      if (e.from_plan_revision !== revision) return null;
      changes.push({ kind: 'requirements', activity_revision: row.revision, capacity_at_change: e.before.capacity, deadline_at_change: e.before.deadline_at, from_plan_revision: e.from_plan_revision,
        to_plan_revision: e.to_plan_revision, changed_at: row.at, before: arrangementAgreementV3(e.before), after: arrangementAgreementV3(e.after) });
      revision = e.to_plan_revision;
    } else if (row.kind === 'capacity') {
      const e = row.event;
      if (e.plan_revision !== revision) return null;
      capacityChanges.push({ activity_revision: row.revision, plan_revision: e.plan_revision, changed_at: row.at, deadline_at_change: e.before.deadline_at, before_capacity: e.before.capacity, capacity: e.after.capacity });
    } else {
      const e = row.event;
      if (e.plan_revision !== revision) return null;
      deadlineChanges.push({ activity_revision: row.revision, plan_revision: e.plan_revision, changed_at: row.at, capacity_at_change: e.before.capacity, before_deadline_at: e.before.deadline_at, deadline_at: e.after.deadline_at });
    }
    previous = e.after;
  }
  if (!previous || revision !== segment.planRevision || changes.length !== segment.planRevision - from || JSON.stringify(previous) !== JSON.stringify(current)) return null;
  const digest = createHash('sha256').update(JSON.stringify({ schema_version: 3, activity_id: activity.id, segment_id: segment.id, actor_id: actorId, from, to: segment.planRevision, current, chain: parsed })).digest('hex');
  return { anchor: { activity_revision: parsed[0].revision, plan_revision: from, capacity: parsed[0].event.before.capacity, deadline_at: parsed[0].event.before.deadline_at }, accepted: arrangementAgreementV3(parsed[0].event.before), changes, capacityChanges, deadlineChanges, digest };
}

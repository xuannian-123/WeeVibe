import { createHash } from 'node:crypto';
import { PLAN_CHANGE_EVENT_TYPE, planChangeEventSchema, arrangementChangeEventSchema, capacityChangeEventSchema, deadlineExtensionEventSchema,
  ARRANGEMENT_CHANGE_EVENT_TYPE, CAPACITY_CHANGE_EVENT_TYPE, DEADLINE_EXTENSION_EVENT_TYPE, ARRANGEMENT_HISTORY_LIMIT,
  arrangementAgreementV3, arrangementReviewV4Schema, type ArrangementReviewV4 } from '@weevibe/contracts';
import { arrangementPlan } from './arrangement-history';
import type { loadActivity, Tx } from './state';
type State = Awaited<ReturnType<typeof loadActivity>>;
export async function reviewGeneralHistory(tx: Tx, activity: State, segment: State['segments'][number], actor: string, from: number | null): Promise<ArrangementReviewV4 | null> {
  const generic = await tx.activityEvent.findMany({ where: { activityId: activity.id, type: PLAN_CHANGE_EVENT_TYPE, detail: { path: ['segment_id'], equals: segment.id } },
    orderBy: [{ revision: 'asc' }, { id: 'asc' }], take: ARRANGEMENT_HISTORY_LIMIT + 1, select: { activityId: true, type: true, revision: true, createdAt: true, detail: true } });
  if (!generic.length) return null;
  const plan = arrangementPlan(segment), base = { schema_version: 4 as const, history_format: 'verified_v4' as const, activity_id: activity.id, segment_id: segment.id,
    viewer_user_id: actor, revision: activity.revision, current_plan_revision: segment.planRevision, accepted_plan_revision: from, current_plan: plan,
    changes: [], capacity_changes: [], deadline_changes: [] };
  const unavailable = () => arrangementReviewV4Schema.parse({ ...base, server_time: new Date().toISOString(), state: 'unavailable', reason: 'HISTORY_UNAVAILABLE', can_reaccept: false,
    accepted_plan: null, history_digest: null, history_anchor: null, plan_changes: [] });
  if (from === null || from >= segment.planRevision) return unavailable();
  const extra = await tx.activityEvent.findMany({ where: { activityId: activity.id, type: { in: [ARRANGEMENT_CHANGE_EVENT_TYPE, CAPACITY_CHANGE_EVENT_TYPE, DEADLINE_EXTENSION_EVENT_TYPE] }, detail: { path: ['segment_id'], equals: segment.id } },
    orderBy: [{ revision: 'asc' }, { id: 'asc' }], take: ARRANGEMENT_HISTORY_LIMIT + 1, select: { activityId: true, type: true, revision: true, createdAt: true, detail: true } });
  if (generic.length + extra.length > ARRANGEMENT_HISTORY_LIMIT) return unavailable();
  const changes: ArrangementReviewV4['plan_changes'] = [];
  for (const row of [...generic, ...extra].sort((a, b) => a.revision - b.revision)) {
    const kind = row.type === PLAN_CHANGE_EVENT_TYPE ? 'plan' : row.type === ARRANGEMENT_CHANGE_EVENT_TYPE ? 'requirements' : row.type === CAPACITY_CHANGE_EVENT_TYPE ? 'capacity' : 'deadline';
    const event = kind === 'plan' ? planChangeEventSchema.safeParse(row.detail) : kind === 'requirements' ? arrangementChangeEventSchema.safeParse(row.detail)
      : kind === 'capacity' ? capacityChangeEventSchema.safeParse(row.detail) : deadlineExtensionEventSchema.safeParse(row.detail);
    if (!event.success || row.activityId !== activity.id || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) return unavailable();
    const revision = 'from_plan_revision' in event.data ? event.data.from_plan_revision : event.data.plan_revision;
    if (revision >= from) changes.push({ kind, event: event.data, activity_revision: row.revision, changed_at: row.createdAt.toISOString() });
  }
  if (!changes.length) return unavailable();
  const now = new Date(), reason = activity.cancelledAt || segment.cancelledAt ? 'CANCELLED' : now >= segment.startsAt ? 'SEGMENT_STARTED' : null;
  const before = changes[0].event.before;
  const response = arrangementReviewV4Schema.safeParse({ ...base, server_time: now.toISOString(), state: 'ready', reason, can_reaccept: reason === null,
    accepted_plan: arrangementAgreementV3(before), history_anchor: { activity_revision: changes[0].activity_revision, plan_revision: from, capacity: before.capacity, deadline_at: before.deadline_at },
    history_digest: createHash('sha256').update(JSON.stringify({ activity_id: activity.id, actor_id: actor, from, to: segment.planRevision, current: plan, changes })).digest('hex'), plan_changes: changes });
  return response.success ? response.data : unavailable();
}

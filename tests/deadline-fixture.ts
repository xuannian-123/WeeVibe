import { vi } from 'vitest';
import { createHandoverFixture, handoverIds as I } from './handover-fixture';
import { arrangementPlan } from '../apps/web/src/server/activities/arrangement-history';
export { handoverIds as deadlineIds } from './handover-fixture';
export function createDeadlineFixture(history = false) {
  const f = createHandoverFixture();
  if (history) {
    f.activity.revision = 3; f.activity.segments[0].participations[1].acceptedPlanRevision = 1;
    const current = arrangementPlan(f.activity.segments[0]);
    f.events = [
      { activityId: I.activity, revision: 2, createdAt: new Date('2030-01-01T09:01:00Z'), type: 'segment_arrangement_changed', detail: { schema_version: 1, segment_id: I.main, from_plan_revision: 1, to_plan_revision: 2, before: { ...current, minimum_participants: 2 }, after: { ...current, minimum_participants: 3 } } },
      { activityId: I.activity, revision: 3, createdAt: new Date('2030-01-01T09:02:00Z'), type: 'segment_arrangement_changed', detail: { schema_version: 1, segment_id: I.main, from_plan_revision: 2, to_plan_revision: 3, before: { ...current, minimum_participants: 3 }, after: { ...current, minimum_participants: 2 } } }
    ];
  }
  f.tx.activityEvent.create.mockImplementation(async ({ data }: any) => { const row = { createdAt: new Date(), ...structuredClone(data) }; f.events.push(row); return row; });
  f.tx.activityEvent.findMany = vi.fn(async ({ where, take }: any) => structuredClone(f.events.filter((e: any) => e.activityId === where.activityId && e.type === where.type && e.detail.segment_id === where.detail.equals).sort((a: any, b: any) => a.revision - b.revision).slice(0, take)));
  return f;
}

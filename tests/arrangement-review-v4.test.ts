import { describe, expect, it } from 'vitest';
import { arrangementReviewV4Schema, arrangementAgreementV3, normalizeArrangementReview } from '../packages/contracts/src';
import { arrangementFixturePlan, arrangementIds } from './arrangement-fixtures';
function review() {
  const before = arrangementFixturePlan(4), after = { ...before, location: { ...before.location, name: 'New restaurant' } };
  return { schema_version: 4, history_format: 'verified_v4', activity_id: arrangementIds.activity, segment_id: before.segment_id, viewer_user_id: arrangementIds.actor,
    revision: 2, current_plan_revision: 2, accepted_plan_revision: 1, server_time: '2030-01-01T10:00:00Z', current_plan: after,
    state: 'ready', reason: null, can_reaccept: true, accepted_plan: arrangementAgreementV3(before), history_digest: 'a'.repeat(64),
    history_anchor: { activity_revision: 2, plan_revision: 1, capacity: before.capacity, deadline_at: before.deadline_at },
    changes: [], capacity_changes: [], deadline_changes: [], plan_changes: [{ kind: 'plan', activity_revision: 2, changed_at: '2030-01-01T09:00:00Z',
      event: { schema_version: 1, segment_id: before.segment_id, from_plan_revision: 1, to_plan_revision: 2, before, after, reasons: ['arrangement'] } }] };
}
describe('versioned full arrangement history', () => {
  it('validates actual location differences and exposes them to the existing participant view', () => {
    const value = review(); expect(arrangementReviewV4Schema.safeParse(value).success).toBe(true);
    const normalized = normalizeArrangementReview(value); expect(normalized.history_format).toBe('verified_v4');
    expect(normalized.plan_changes?.[0].event.after.location.name).toBe('New restaurant');
  });
  it('refuses to reconstruct missing history from the current plan', () => {
    const value = review(); value.plan_changes[0].event.from_plan_revision = 2;
    expect(arrangementReviewV4Schema.safeParse(value).success).toBe(false);
  });
  it('rejects a forged current plan or duplicate event revision', () => {
    const value = review(); value.current_plan = { ...value.current_plan, requirements: 'Different' };
    expect(arrangementReviewV4Schema.safeParse(value).success).toBe(false);
    const duplicate = review(); duplicate.plan_changes.push(duplicate.plan_changes[0]);
    expect(arrangementReviewV4Schema.safeParse(duplicate).success).toBe(false);
  });
  it('does not make a full or cancelled seat imply permission to accept', () => {
    const value = review(); value.reason = 'CANCELLED' as unknown as null;
    expect(arrangementReviewV4Schema.safeParse(value).success).toBe(false);
  });
});

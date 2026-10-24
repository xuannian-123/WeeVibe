import { describe, expect, it } from 'vitest';
import { applicationVisibility, checkJoinOpen, checkManager, checkNotCancelled, checkRevision, checkSelectedSegments, requestFingerprint, segmentCounts, verifyReplay, type SegmentRuleState } from '../apps/web/src/server/activities/rules';

const now = new Date('2026-10-24T06:00:00Z');
function segment(id = 'a'): SegmentRuleState {
  return { id, planRevision: 2, minimumParticipants: 2, capacity: 3, startsAt: new Date('2026-10-24T10:00:00Z'), deadlineAt: new Date('2026-10-24T09:00:00Z'), cancelledAt: null, participations: [] };
}
describe('offline domain guards (NOT PostgreSQL concurrency/rollback acceptance)', () => {
  it('counts retained but unaccepted seats against capacity and ignores exited seats', () => {
    const s = segment();
    s.participations = [{ userId: 'one', status: 'joined', acceptedPlanRevision: 2 }, { userId: 'two', status: 'joined', acceptedPlanRevision: 1 }, { userId: 'old', status: 'exited', acceptedPlanRevision: 2 }];
    expect(segmentCounts(s)).toEqual({ occupied_count: 2, accepted_count: 1, pending_acceptance_count: 1, remaining_capacity: 1, meets_minimum: true, is_full: false });
  });
  it('checks every requested segment and does not silently approve a subset', () => {
    const a = segment('a'), b = segment('b');
    b.capacity = 1; b.minimumParticipants = 1;
    b.participations = [{ userId: 'retained', status: 'joined', acceptedPlanRevision: 1 }];
    expect(() => checkSelectedSegments([a, b], [{ segment_id: 'a', plan_revision: 2 }, { segment_id: 'b', plan_revision: 2 }], 'new', now)).toThrow(expect.objectContaining({ code: 'CAPACITY_FULL' }));
    expect(a.participations).toHaveLength(0);
  });
  it('rechecks capacity from current occupied state, not applicant count', () => {
    const s = segment(); s.capacity = 1; s.minimumParticipants = 1;
    expect(() => checkSelectedSegments([s], [{ segment_id: 'a', plan_revision: 2 }], 'new', now)).not.toThrow();
    s.participations.push({ userId: 'other', status: 'joined', acceptedPlanRevision: 2 });
    expect(() => checkSelectedSegments([s], [{ segment_id: 'a', plan_revision: 2 }], 'new', now)).toThrow(expect.objectContaining({ code: 'CAPACITY_FULL' }));
  });
  it('rejects stale accepted versions even if global revision appears current', () => {
    expect(() => checkSelectedSegments([segment()], [{ segment_id: 'a', plan_revision: 1 }], 'new', now)).toThrow(expect.objectContaining({ code: 'ARRANGEMENT_STALE' }));
  });
  it('rejects joined targets but permits adding another open segment without touching the original', () => {
    const a = segment('a'), b = segment('b');
    a.participations.push({ userId: 'me', status: 'joined', acceptedPlanRevision: 2 });
    expect(() => checkSelectedSegments([a, b], [{ segment_id: 'a', plan_revision: 2 }], 'me', now)).toThrow(expect.objectContaining({ code: 'ALREADY_JOINED' }));
    expect(() => checkSelectedSegments([a, b], [{ segment_id: 'b', plan_revision: 2 }], 'me', now)).not.toThrow();
    expect(a.participations).toHaveLength(1);
  });
  it('uses each segment cutoff exactly and keeps later segments independently open', () => {
    const a = segment('a'), b = segment('b');
    a.startsAt = now; a.deadlineAt = now;
    expect(() => checkJoinOpen(a, now)).toThrow(expect.objectContaining({ code: 'SEGMENT_APPLICATION_CLOSED' }));
    expect(() => checkJoinOpen(b, now)).not.toThrow();
    b.deadlineAt = now;
    expect(() => checkJoinOpen(b, now)).toThrow();
  });
  it('rejects cancelled segments, foreign targets, cancelled activity and stale global revision', () => {
    expect(() => checkSelectedSegments([{ ...segment(), cancelledAt: now }], [{ segment_id: 'a', plan_revision: 2 }], 'new', now)).toThrow(expect.objectContaining({ code: 'SEGMENT_APPLICATION_CLOSED' }));
    expect(() => checkSelectedSegments([segment()], [{ segment_id: 'foreign', plan_revision: 2 }], 'new', now)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => checkNotCancelled(now)).toThrow(expect.objectContaining({ code: 'ACTIVITY_CANCELLED' }));
    expect(() => checkRevision(8, 7)).toThrow(expect.objectContaining({ code: 'VERSION_CONFLICT' }));
  });
  it('uses current manager identity, not previous manager or role hints', () => {
    expect(() => checkManager('current', 'old')).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => checkManager('current', 'current')).not.toThrow();
  });
  it('does not expose other applications to non-manager or anonymous projection', () => {
    const rows = [{ applicant_user_id: 'one', application_id: 'first' }, { applicant_user_id: 'two', application_id: 'second' }];
    expect(applicationVisibility(rows, 'one', 'manager')).toEqual({ own_applications: [rows[0]] });
    expect(applicationVisibility(rows, null, 'manager')).toEqual({ own_applications: [] });
    expect(applicationVisibility(rows, 'old-manager', 'manager')).not.toHaveProperty('applications');
    expect(applicationVisibility(rows, 'manager', 'manager').applications).toHaveLength(2);
  });
});

describe('idempotency semantics, offline hash guards only', () => {
  const scope = 'apply:activity';
  const input = { idempotency_key: 'test-key-001', expected_revision: 3, segments: [{ segment_id: 'a', plan_revision: 1 }, { segment_id: 'b', plan_revision: 1 }] };
  it('is stable for object key order and immaterial selection order', () => {
    expect(requestFingerprint('one', scope, input)).toBe(requestFingerprint('one', scope, { segments: [...input.segments].reverse(), expected_revision: 3, idempotency_key: 'other-key-001' }));
  });
  it('binds actor, operation, scope, revision, selected segments and payload', () => {
    const record = { scope, requestHash: requestFingerprint('one', scope, input) };
    expect(() => verifyReplay(record, scope, requestFingerprint('one', scope, input))).not.toThrow();
    for (const hash of [requestFingerprint('two', scope, input), requestFingerprint('one', 'apply:other-activity', input), requestFingerprint('one', scope, { ...input, expected_revision: 4 }), requestFingerprint('one', scope, { ...input, segments: [input.segments[0]] })]) {
      expect(() => verifyReplay(record, scope, hash)).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    }
    expect(() => verifyReplay(record, 'decision:activity:application', record.requestHash)).toThrow();
  });
});

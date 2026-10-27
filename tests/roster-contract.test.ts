import { describe, expect, it } from 'vitest';
import { publicRosterSnapshotSchema } from '../packages/contracts/src';
import { rosterId, rosterIds as I } from './roster-fixture';
const valid = () => ({ activity_id: I.activity, activity_revision: 1, server_time: '2030-01-01T00:00:00Z', cancelled: false, complete: true, limit: 2000,
  segments: [{ segment_id: I.main, name: '聚会', position: 0, plan_revision: 3, cancelled: false, availability: 'available', members: [{ display_name: '同名', status: 'joined' }, { display_name: '同名', status: 'awaiting_acceptance' }, { display_name: null, status: 'awaiting_acceptance' }, { display_name: '', status: 'joined' }], counts: { occupied_count: 4, accepted_count: 2, pending_acceptance_count: 2 } }] });
describe('strict public roster DTO', () => {
  it('preserves duplicate, null and empty signup names, not account identity', () => { expect(publicRosterSnapshotSchema.parse(valid())).toEqual(valid()); });
  it('supports explicit cancelled history unavailability, not invented empty membership', () => { const r: any = valid(); r.segments[0] = { ...r.segments[0], cancelled: true, availability: 'cancelled_history_not_exposed', members: null, counts: null }; expect(publicRosterSnapshotSchema.safeParse(r).success).toBe(true); r.cancelled = true; r.segments[0].cancelled = false; expect(publicRosterSnapshotSchema.safeParse(r).success).toBe(true); });
  it('canonicalizes legal UUID casing', () => { const r = valid(); r.activity_id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; expect(publicRosterSnapshotSchema.parse(r).activity_id).toBe(r.activity_id.toLowerCase()); });
  it.each(['no-segments', 'blank-segment-name', 'top-extra', 'segment-extra', 'member-extra', 'count-extra', 'missing-members', 'bad-status', 'long-name', 'display-number', 'false-complete', 'wrong-limit', 'bad-time', 'no-offset', 'bad-activity', 'negative-revision', 'negative-position', 'zero-plan', 'bad-occupied', 'bad-accepted', 'bad-pending', 'negative-count', 'cancel-exposes', 'activity-cancel-exposes', 'active-hidden', 'duplicate-segment', 'duplicate-position', 'wrong-order'] as const)('rejects %s', kind => {
    const r: any = valid(), s = r.segments[0];
    if (kind === 'no-segments') r.segments = [];
    if (kind === 'blank-segment-name') s.name = '  ';
    if (kind === 'top-extra') r.privateProfile = 'PRIVATE';
    if (kind === 'segment-extra') s.user_id = I.actor;
    if (kind === 'member-extra') s.members[0].user_id = I.actor;
    if (kind === 'count-extra') s.counts.internal = 4;
    if (kind === 'missing-members') delete s.members;
    if (kind === 'bad-status') s.members[0].status = 'pending';
    if (kind === 'long-name') s.members[0].display_name = 'a'.repeat(41);
    if (kind === 'display-number') s.members[0].display_name = 7;
    if (kind === 'false-complete') r.complete = false;
    if (kind === 'wrong-limit') r.limit = 100;
    if (kind === 'bad-time') r.server_time = 'no';
    if (kind === 'no-offset') r.server_time = '2030-01-01T00:00:00';
    if (kind === 'bad-activity') r.activity_id = '../other';
    if (kind === 'negative-revision') r.activity_revision = -1;
    if (kind === 'negative-position') s.position = -1;
    if (kind === 'zero-plan') s.plan_revision = 0;
    if (kind === 'bad-occupied') s.counts.occupied_count = 3;
    if (kind === 'bad-accepted') s.counts.accepted_count = 1;
    if (kind === 'bad-pending') s.counts.pending_acceptance_count = 1;
    if (kind === 'negative-count') s.counts.pending_acceptance_count = -1;
    if (kind === 'cancel-exposes') s.cancelled = true;
    if (kind === 'activity-cancel-exposes') r.cancelled = true;
    if (kind === 'active-hidden') { s.members = null; s.counts = null; s.availability = 'cancelled_history_not_exposed'; }
    if (kind === 'duplicate-segment') r.segments.push({ ...structuredClone(s), position: 1 });
    if (kind === 'duplicate-position') r.segments.push({ ...structuredClone(s), segment_id: I.second });
    if (kind === 'wrong-order') { s.position = 1; r.segments.push({ ...structuredClone(s), segment_id: I.second, position: 0 }); }
    expect(publicRosterSnapshotSchema.safeParse(r).success).toBe(false);
  });
  it('allows exactly 2000 names but never a hidden truncated or overcap total', () => {
    const r: any = valid(), s = r.segments[0]; s.members = Array.from({ length: 2000 }, () => ({ display_name: null, status: 'joined' })); s.counts = { occupied_count: 2000, accepted_count: 2000, pending_acceptance_count: 0 };
    expect(publicRosterSnapshotSchema.safeParse(r).success).toBe(true);
    r.segments.push({ ...structuredClone(s), segment_id: I.second, position: 1, members: [{ display_name: null, status: 'joined' }], counts: { occupied_count: 1, accepted_count: 1, pending_acceptance_count: 0 } });
    expect(publicRosterSnapshotSchema.safeParse(r).success).toBe(false);
  });
  it('rejects more than 2000 segments', () => { const r: any = valid(); r.segments = Array.from({ length: 2001 }, (_, i) => ({ ...structuredClone(r.segments[0]), segment_id: rosterId(100 + i), position: i, members: [], counts: { occupied_count: 0, accepted_count: 0, pending_acceptance_count: 0 } })); expect(publicRosterSnapshotSchema.safeParse(r).success).toBe(false); });
});

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
const db = vi.hoisted(() => ({ tx: {} as Record<string, unknown>, authenticate: vi.fn() }));
vi.mock('../apps/web/src/server/db', () => ({ withDb: async (fn: (db: unknown) => unknown) => fn({ $transaction: async (fn: (tx: unknown) => unknown) => fn(db.tx) }) }));
vi.mock('../apps/web/src/server/auth', () => ({ identityService: { authenticate: db.authenticate } }));
import { accountSnapshot } from '../apps/web/src/server/account';
import { GET } from '../apps/web/src/app/api/v1/account/route';
const alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222';
const now = new Date('2030-01-01T00:00:00Z');
type Row = Record<string, any>; // Prisma-shaped fixture evaluator, never a production database adapter.
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (key === 'OR') return wanted.some((clause: Row) => matches(row, clause));
    if (key === 'AND') return wanted.every((clause: Row) => matches(row, clause));
    if (wanted && typeof wanted === 'object') {
      if ('some' in wanted) return (row[key] || []).some((child: Row) => matches(child, wanted.some));
      if ('in' in wanted) return wanted.in.includes(row[key]);
    }
    return row[key] === wanted;
  });
}
function selectRows(rows: Row[], query: Row): Row[] {
  const orders: Row[] = query.orderBy ? Array.isArray(query.orderBy) ? query.orderBy : [query.orderBy] : [];
  const sorted = rows.filter(row => matches(row, query.where)).sort((a, b) => {
    for (const order of orders) for (const [key, direction] of Object.entries(order)) {
      const left = a[key] instanceof Date ? a[key].getTime() : a[key];
      const right = b[key] instanceof Date ? b[key].getTime() : b[key];
      const compare = left < right ? -1 : left > right ? 1 : 0;
      if (compare) return direction === 'desc' ? -compare : compare;
    }
    return 0;
  });
  return sorted.slice(0, query.take ?? sorted.length).map(row => projection(row, query));
}
function projection(row: Row, query: Row): Row {
  const selected: Row = query.select ? {} : { ...row };
  for (const [key, value] of Object.entries(query.select || query.include || {})) {
    if (value === true) selected[key] = row[key];
    else if (value && typeof value === 'object') {
      const q = value as Row;
      selected[key] = Array.isArray(row[key]) ? selectRows(row[key], q) : projection(row[key], q);
    }
  }
  return selected;
}
const part = (userId: string, status = 'joined', acceptedPlanRevision: number | null = 1) => ({ userId, status, acceptedPlanRevision, displayName: 'PRIVATE_PARTICIPANT_NAME' });
const application = (applicantUserId: string, status = 'pending') => ({ id: 'application', applicantUserId, status, displayName: 'PRIVATE_APPLICANT_NAME' });
function activity(num: number, overrides: Row = {}): Row {
  return { id: `${String(num).padStart(8, '0')}-3333-4333-8333-333333333333`, name: `activity-${num}`, currentManagerId: bob, timezone: 'Asia/Shanghai', cancelledAt: null, createdAt: now,
    segments: [{ id: `${num}-segment`, position: 0, startsAt: new Date('2030-01-02T00:00:00Z'), endsAt: new Date('2030-01-02T02:00:00Z'), planRevision: 1, cancelledAt: null, location: { name: 'Public venue' }, participations: [] }], applications: [], privateField: 'NEVER_RETURN', ...overrides };
}
let rows: Row[]; let query: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); rows = [];
  db.authenticate.mockReset().mockResolvedValue({ user_id: alice });
  query = vi.fn(async (args: Prisma.ActivityFindManyArgs) => selectRows(rows, args));
  db.tx = { privateProfile: { findUnique: vi.fn(async () => null) }, savedVenue: { findMany: vi.fn(async () => []) }, messageRead: { findMany: vi.fn(async () => []) }, activity: { findMany: query }, activityApplication: { findMany: vi.fn(async () => []) }, receivedInvitation: { findMany: vi.fn(async () => []) }, requirementSurvey: { findMany: vi.fn(async () => []) } };
});
afterEach(() => vi.useRealTimers());
describe('account activity discovery through actual accountSnapshot (Prisma query double, not live PG)', () => {
  it('returns managed nonparticipant, own pending and own exited activities without claiming joined seats', async () => {
    const manager = activity(1, { currentManagerId: alice }), pending = activity(2, { applications: [application(alice)] }), exited = activity(3);
    exited.segments[0].participations = [part(alice, 'exited')]; rows = [manager, pending, exited];
    const result = await accountSnapshot(alice);
    expect(result.activities).toEqual([]);
    expect(result.activity_records?.map(row => row.activity_id) ?? []).toEqual(rows.map(row => row.id));
    expect(result.activity_records.map(row => [row.is_manager, row.joined_segment_count, row.pending_application_count, row.exited_segment_count])).toEqual([[true, 0, 0, 0], [false, 0, 1, 0], [false, 0, 0, 1]]);
  });
  it('does not list browsed/public activities or another user applications and seats', async () => {
    const browsed = activity(1), otherPending = activity(2, { applications: [application(bob)] }), otherSeat = activity(3), rejected = activity(4, { applications: [application(alice, 'rejected')] });
    otherSeat.segments[0].participations = [part(bob)]; rows = [browsed, otherPending, otherSeat, rejected];
    const result = await accountSnapshot(alice); expect(result.activity_records).toEqual([]); expect(result.activities).toEqual([]);
  });
  it('deduplicates manager + joined + partial exit + pending into one card without losing relationship flags', async () => {
    const mixed = activity(1, { currentManagerId: alice, applications: [application(alice), application(bob)] });
    mixed.segments[0].participations = [part(alice), part(bob)]; mixed.segments.push({ ...mixed.segments[0], id: 'second', position: 1, participations: [part(alice, 'exited')] }); rows = [mixed];
    const result = await accountSnapshot(alice); expect(result.activities).toHaveLength(1); expect(result.activity_records).toHaveLength(1);
    expect(result.activity_records[0]).toMatchObject({ is_manager: true, joined_segment_count: 1, exited_segment_count: 1, pending_application_count: 1, time_scope: 'participation' });
  });
  it('uses only own joined-segment dates and acceptance, not another participant schedule or private fields', async () => {
    const item = activity(1); item.segments[0].participations = [part(bob, 'joined', null)];
    item.segments.push({ ...item.segments[0], position: 1, startsAt: new Date('2030-01-03T00:00:00Z'), endsAt: new Date('2030-01-03T02:00:00Z'), participations: [part(alice)] }); rows = [item];
    const result = await accountSnapshot(alice); expect(result.activity_records[0]).toMatchObject({ starts_at: '2030-01-03T00:00:00.000Z', awaiting_acceptance: false, time_scope: 'participation' });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PARTICIPANT_NAME|PRIVATE_APPLICANT_NAME|NEVER_RETURN|currentManagerId|applicantUserId/);
    const select = query.mock.calls.find(([args]) => args.select)?.[0].select;
    expect(select.segments.select.participations.where.userId).toBe(alice); expect(select.applications.where.applicantUserId).toBe(alice);
    expect(select).not.toHaveProperty('privateProfile'); expect(select).not.toHaveProperty('requirementCollection');
  });
  it('keeps calendar phase separate from pending/exit relations and distinguishes cancellation', async () => {
    const pending = activity(1, { applications: [application(alice)] }), exited = activity(2), cancelled = activity(3, { currentManagerId: alice, cancelledAt: now });
    exited.segments[0].participations = [part(alice, 'exited')]; rows = [pending, exited, cancelled];
    const result = await accountSnapshot(alice); expect(result.activity_records.map(row => row.phase)).toEqual(['upcoming', 'upcoming', 'upcoming']);
    expect(result.activity_records[0].joined_segment_count).toBe(0); expect(result.activity_records[1].exited_segment_count).toBe(1); expect(result.activity_records[2].cancelled).toBe(true);
  });
  it('computes begin/end boundaries from server time and handles no-date rows without crashing', async () => {
    const joined = activity(1); joined.segments[0].participations = [part(alice)]; rows = [joined, activity(2, { currentManagerId: alice, segments: [] })];
    vi.setSystemTime('2030-01-02T00:00:00Z'); expect((await accountSnapshot(alice)).activity_records[0].phase).toBe('ongoing');
    vi.setSystemTime('2030-01-02T02:00:00Z'); const result = await accountSnapshot(alice); expect(result.activity_records[0].phase).toBe('ended');
    expect(result.activity_records[1]).toMatchObject({ phase: 'undated', starts_at: null, ends_at: null, cancelled: false });
  });
  it('marks own cancelled segment separately from a still-active whole activity', async () => {
    const item = activity(1); item.segments[0].participations = [part(alice, 'joined', null)]; item.segments[0].cancelledAt = now;
    item.segments.push({ ...item.segments[0], position: 1, cancelledAt: null, participations: [] }); rows = [item];
    expect((await accountSnapshot(alice)).activity_records[0]).toMatchObject({ cancelled: false, participation_cancelled: true, awaiting_acceptance: false });
  });
  it('orders current/upcoming plans by participation time, ended history newest first, stably', async () => {
    const dated = (num: number, start: string, end: string) => { const row = activity(num, { currentManagerId: alice }); row.segments[0].startsAt = new Date(start); row.segments[0].endsAt = new Date(end); return row; };
    rows = [dated(1, '2029-10-01', '2029-10-02'), dated(2, '2030-01-05', '2030-01-06'), dated(3, '2029-12-31', '2030-01-02'), dated(4, '2030-01-03', '2030-01-04'), dated(5, '2029-12-01', '2029-12-02')];
    expect((await accountSnapshot(alice)).activity_records.map(row => row.title)).toEqual(['activity-3', 'activity-4', 'activity-2', 'activity-5', 'activity-1']);
  });
  it('route binds discovery to authenticated identity, never a query user_id', async () => {
    rows = [activity(1, { currentManagerId: alice }), activity(2)];
    const response = await GET(new Request(`http://localhost/api/v1/account?user_id=${bob}`, { headers: { Authorization: 'Bearer fixture-only' } }));
    expect(db.authenticate).toHaveBeenCalledWith('Bearer fixture-only'); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).activity_records.map((row: Row) => row.title)).toEqual(['activity-1']);
  });
  it('keeps a bounded newest-created query and never claims the full historical list', async () => {
    rows = Array.from({ length: 101 }, (_, index) => activity(index + 1, { currentManagerId: alice, createdAt: new Date(now.getTime() + index * 1000) }));
    const result = await accountSnapshot(alice); expect(result.activity_records).toHaveLength(100);
    expect(result.activity_records.map(row => row.title)).not.toContain('activity-1'); expect(result.activity_records.map(row => row.title)).toContain('activity-101');
    expect(query.mock.calls.find(([args]) => args.select)?.[0].orderBy).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
  });
  it('account reads never execute membership, approval or answer mutations', async () => {
    rows = [activity(1, { currentManagerId: alice })]; await accountSnapshot(alice);
    expect(Object.keys(db.tx)).not.toContain('participation'); expect(Object.keys(db.tx)).not.toContain('requirementSubmission');
    expect(query).toHaveBeenCalledTimes(2); expect(query.mock.calls.find(([args]) => args.select)?.[0].take).toBe(100);
  });
});

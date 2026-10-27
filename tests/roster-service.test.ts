import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRosterFixture, rosterId, rosterIds as I } from './roster-fixture';
import { CLOUD_HTTP_ENVELOPE_HEADER, CLOUD_HTTP_ENVELOPE_VERSION, publicRosterSnapshotSchema } from '../packages/contracts/src';
const h = vi.hoisted(() => ({ f: null as any, authenticate: vi.fn() }));
vi.mock('../apps/web/src/server/db', () => ({ withDb: async (action: any) => action(h.f.db) }));
vi.mock('../apps/web/src/server/auth', () => ({ identityService: { authenticate: h.authenticate } }));
import { ServiceError } from '../apps/web/src/server/http';
import { getActivityRoster } from '../apps/web/src/server/activities/roster';
import { GET } from '../apps/web/src/app/api/v1/activities/[activityId]/roster/route';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2031-01-01T00:00:00Z')); h.f = createRosterFixture(); h.authenticate.mockReset(); h.authenticate.mockResolvedValue({ user_id: I.actor }); });
afterEach(() => vi.useRealTimers());
const read = () => getActivityRoster(I.activity, I.actor);
const route = (headers: Record<string, string> = {}, id = I.activity) => GET(new Request(`https://local.invalid/api/v1/activities/${id}/roster`, { headers }), { params: Promise.resolve({ activityId: id }) });
describe('actual roster service and route with offline transaction/query doubles, not real PG', () => {
  it('logged-in outsider and pending applicant get only counts, never signup names', async () => {
    const outsider = rosterId(9000); h.authenticate.mockResolvedValueOnce({ user_id: outsider });
    const response = await route({ authorization: 'Bearer outsider-fixture' });
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.segments[0]).toMatchObject({ availability: 'counts_only', members: null, counts: { occupied_count: 3 } });
    expect(h.f.tx.participation.findMany.mock.calls[0][0].select).not.toHaveProperty('displayName');
  });
  it('an actual retained joined seat may read names; exiting it removes that access', async () => {
    const row = h.f.rows[0];
    expect((await getActivityRoster(I.activity, row.userId)).segments[0].availability).toBe('available');
    row.status = 'exited';
    expect((await getActivityRoster(I.activity, row.userId)).segments[0]).toMatchObject({ availability: 'counts_only', members: null });
  });
  it('old manager with no seat loses name access after handover', async () => {
    h.f.activity.currentManagerId = rosterId(9001);
    expect((await getActivityRoster(I.activity, I.actor)).segments[0].members).toBeNull();
  });
  it('returns complete distinct occupied rows per segment, including retained seats with old/null acceptance', async () => {
    const r = await read(); expect(publicRosterSnapshotSchema.parse(r)).toEqual(r);
    expect(r.segments[0]).toMatchObject({ counts: { occupied_count: 3, accepted_count: 1, pending_acceptance_count: 2 }, members: [{ display_name: '同名', status: 'joined' }, { display_name: '同名', status: 'awaiting_acceptance' }, { display_name: null, status: 'awaiting_acceptance' }] });
    expect(r.segments[1]).toMatchObject({ members: [{ display_name: '', status: 'joined' }], counts: { occupied_count: 1, accepted_count: 1, pending_acceptance_count: 0 } });
  });
  it('uses one RepeatableRead transaction for activity/version and complete joined rows', async () => {
    await read(); expect(h.f.db.$transaction).toHaveBeenCalledTimes(1); expect(h.f.db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'RepeatableRead' }); expect(h.f.trace).toEqual(['activity', 'participation']);
    const a = h.f.tx.activity.findUnique.mock.calls[0][0], p = h.f.tx.participation.findMany.mock.calls[0][0];
    expect(Object.keys(a.select).sort()).toEqual(['cancelledAt', 'currentManagerId', 'id', 'revision', 'segments']); expect(a.select.segments).toEqual({ orderBy: [{ position: 'asc' }, { id: 'asc' }], take: 2001, select: { id: true, activityId: true, name: true, position: true, planRevision: true, cancelledAt: true } });
    expect(p).toEqual({ where: { activityId: I.activity, status: 'joined', segmentId: { in: [I.main, I.second] } }, orderBy: [{ segmentId: 'asc' }, { joinedAt: 'asc' }, { id: 'asc' }], take: 2001, select: { segmentId: true, displayName: true, acceptedPlanRevision: true } });
  });
  it('never reads other identity, profile, application, origin or response fields; never writes', async () => {
    const before = structuredClone({ activity: h.f.activity, rows: h.f.rows }); const r = await read();
    expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|userId|user_id|sourceApplicationId|joinedAt|lateArrivalAt|privateOrigin|publicAnswers|PRIVATE_EXITED/);
    for (const [model, fn] of [['user', 'findMany'], ['privateProfile', 'findMany'], ['activityApplication', 'findMany'], ['requirementSubmission', 'findMany'], ['activity', 'update'], ['activity', 'create'], ['participation', 'updateMany'], ['participation', 'createMany'], ['activityEvent', 'create'], ['activityMutationKey', 'create']]) expect(h.f.tx[model][fn]).not.toHaveBeenCalled();
    expect(h.f.tx.$queryRaw).not.toHaveBeenCalled(); expect({ activity: h.f.activity, rows: h.f.rows }).toEqual(before);
  });
  it('does not merge one person or duplicate names across segments', async () => {
    h.f.rows.push({ ...h.f.rows[0], id: rosterId(90), segmentId: I.second }); const r = await read(); expect(r.segments[0].counts?.occupied_count).toBe(3); expect(r.segments[1].counts?.occupied_count).toBe(2);
  });
  it('keeps stable position and joined-time/id ordering, regardless of source fixture input order', async () => {
    h.f.activity.segments.reverse(); h.f.rows.reverse(); const r = await read(); expect(r.segments.map(s => s.segment_id)).toEqual([I.main, I.second, I.cancelled]); expect(r.segments[0].members?.map(m => m.status)).toEqual(['joined', 'awaiting_acceptance', 'awaiting_acceptance']);
  });
  it('does not read cancelled segment names as empty or complete historic lists', async () => {
    const r = await read(); expect(r.segments[2]).toMatchObject({ cancelled: true, availability: 'cancelled_history_not_exposed', members: null, counts: null }); expect(JSON.stringify(r)).not.toContain('PRIVATE_CANCELLED');
  });
  it('cancelled activity hides all member history and skips membership query without deleting it', async () => {
    h.f.activity.cancelledAt = new Date(); const before = structuredClone(h.f.rows); const r = await read(); expect(r.cancelled).toBe(true); expect(r.segments.every(s => s.members === null && s.counts === null && s.availability === 'cancelled_history_not_exposed')).toBe(true); expect(h.f.tx.participation.findMany).not.toHaveBeenCalled(); expect(h.f.rows).toEqual(before);
  });
  it('all cancelled segments do not query any members', async () => { h.f.activity.segments.forEach((s: any) => { s.cancelledAt = new Date(); }); await read(); expect(h.f.tx.participation.findMany).not.toHaveBeenCalled(); });
  it('does not impose join deadlines or end-time rules on current public names', async () => { const r = await read(); expect(r.server_time).toBe('2031-01-01T00:00:00.000Z'); expect(r.segments[0].members).toHaveLength(3); const q = h.f.tx.activity.findUnique.mock.calls[0][0]; expect(q.select.segments.select).not.toHaveProperty('endsAt'); expect(q.select.segments.select).not.toHaveProperty('deadlineAt'); });
  it('samples server clock after awaited snapshot reads', async () => { const old = h.f.tx.participation.findMany.getMockImplementation(); h.f.tx.participation.findMany.mockImplementationOnce(async (q: any) => { const rows = await old(q); vi.setSystemTime(new Date('2031-01-01T00:01:00Z')); return rows; }); expect((await read()).server_time).toBe('2031-01-01T00:01:00.000Z'); });
  it('empty active segment is an actual empty list, not a failed read', async () => { h.f.rows = []; expect((await read()).segments[0]).toMatchObject({ members: [], counts: { occupied_count: 0, accepted_count: 0, pending_acceptance_count: 0 } }); });
  it('invalid input ID is rejected before starting a database transaction', () => { expect(() => getActivityRoster('../private')).toThrowError(ServiceError); expect(h.f.db.$transaction).not.toHaveBeenCalled(); });
  it('canonical input IDs are queried consistently', async () => { h.f.activity.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; h.f.activity.segments.forEach((s: any) => { s.activityId = h.f.activity.id; }); h.f.rows.forEach((r: any) => { r.activityId = h.f.activity.id; }); expect((await getActivityRoster(h.f.activity.id.toUpperCase())).activity_id).toBe(h.f.activity.id); });
  it('missing activity is a safe404', async () => { h.f.activity = null; await expect(read()).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 }); });
  it.each(['no-segments', 'blank-segment-name', 'activity-id', 'revision', 'cancel-date', 'segment-id', 'foreign-segment', 'duplicate-id', 'duplicate-position', 'negative-position', 'plan', 'empty-name', 'long-name', 'segment-date', 'rows-not-array', 'unknown-segment', 'cancelled-segment-row', 'future-accepted', 'zero-accepted', 'long-display', 'bad-display', 'extra-row-field'] as const)('fails closed for malformed source: %s', async kind => {
    const s = h.f.activity.segments[0];
    if (kind === 'no-segments') h.f.activity.segments = [];
    if (kind === 'blank-segment-name') s.name = '  ';
    if (kind === 'activity-id') h.f.tx.activity.findUnique.mockImplementationOnce(async (q: any) => ({ ...(await createRosterFixture().tx.activity.findUnique(q)), id: rosterId(999) }));
    if (kind === 'revision') h.f.activity.revision = 0;
    if (kind === 'cancel-date') h.f.activity.cancelledAt = new Date('bad');
    if (kind === 'segment-id') s.id = 'bad';
    if (kind === 'foreign-segment') s.activityId = rosterId(800);
    if (kind === 'duplicate-id') h.f.activity.segments[1].id = s.id;
    if (kind === 'duplicate-position') h.f.activity.segments[1].position = s.position;
    if (kind === 'negative-position') s.position = -1;
    if (kind === 'plan') s.planRevision = -2;
    if (kind === 'empty-name') s.name = '';
    if (kind === 'long-name') s.name = 'x'.repeat(101);
    if (kind === 'segment-date') s.cancelledAt = new Date('bad');
    if (kind === 'rows-not-array') h.f.tx.participation.findMany.mockResolvedValueOnce({});
    const malformed: any = { segmentId: I.main, displayName: 'SAFE', acceptedPlanRevision: 3 };
    if (kind === 'unknown-segment') malformed.segmentId = rosterId(700);
    if (kind === 'cancelled-segment-row') malformed.segmentId = I.cancelled;
    if (kind === 'future-accepted') malformed.acceptedPlanRevision = 4;
    if (kind === 'zero-accepted') malformed.acceptedPlanRevision = 0;
    if (kind === 'long-display') malformed.displayName = 'X'.repeat(41);
    if (kind === 'bad-display') malformed.displayName = 7;
    if (kind === 'extra-row-field') malformed.privateOrigin = 'PRIVATE_ORIGIN';
    if (['unknown-segment', 'cancelled-segment-row', 'future-accepted', 'zero-accepted', 'long-display', 'bad-display', 'extra-row-field'].includes(kind)) h.f.tx.participation.findMany.mockResolvedValueOnce([malformed]);
    await expect(read()).rejects.toMatchObject({ code: 'ROSTER_UNAVAILABLE', status: 503 });
  });
  it('returns all2000 without truncation; 2001 occupied rows fail503 without a partial body', async () => {
    h.f.rows = Array.from({ length: 2000 }, (_, i) => h.f.participation(100 + i, I.main, '公开报名名')); expect((await read()).segments[0].members).toHaveLength(2000);
    h.f.rows.push(h.f.participation(3100, I.second, null)); await expect(read()).rejects.toMatchObject({ code: 'ROSTER_LIMIT_EXCEEDED', status: 503 });
  });
  it('counts capacity across all active segments rather than per-segment truncation', async () => { h.f.rows = Array.from({ length: 2001 }, (_, i) => h.f.participation(100 + i, i % 2 ? I.main : I.second, null)); await expect(read()).rejects.toMatchObject({ code: 'ROSTER_LIMIT_EXCEEDED' }); });
  it('allows2000 segments and rejects2001 before member queries', async () => {
    const old = structuredClone(h.f.activity.segments[0]); h.f.rows = []; h.f.activity.segments = Array.from({ length: 2000 }, (_, i) => ({ ...old, id: rosterId(100 + i), position: i })); expect((await read()).segments).toHaveLength(2000);
    h.f.activity.segments.push({ ...old, id: rosterId(6000), position: 2000 }); h.f.tx.participation.findMany.mockClear(); await expect(read()).rejects.toMatchObject({ code: 'ROSTER_LIMIT_EXCEEDED' }); expect(h.f.tx.participation.findMany).not.toHaveBeenCalled();
  });
  it('anonymous GET exposes counts only and never selects signup names', async () => { const response=await route(); expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');const body=await response.json();expect(body.segments[0]).toMatchObject({availability:'counts_only',members:null,counts:{occupied_count:3}});expect(JSON.stringify(body)).not.toContain('同名');expect(h.f.tx.participation.findMany.mock.calls[0][0].select).not.toHaveProperty('displayName');expect(h.authenticate).not.toHaveBeenCalled(); });
  it('authenticated public GET authenticates bearer but does not reveal extra private fields', async () => { const response = await route({ authorization: 'Bearer fixture-session' }); expect(response.status).toBe(200); expect(h.authenticate).toHaveBeenCalledExactlyOnceWith('Bearer fixture-session'); expect(await response.json()).toEqual(await read()); });
  it.each(['', 'Bearer invalid'])('invalid supplied bearer %s never downgrades to public anonymous', async authorization => { h.authenticate.mockRejectedValueOnce(new ServiceError('UNAUTHENTICATED', 401, '请重新登录')); const response = await route({ authorization }); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store'); expect(h.f.db.$transaction).not.toHaveBeenCalled(); expect(JSON.stringify(await response.json())).not.toContain('同名'); });
  it('malformed non-array activity segments failclosed', async () => { h.f.tx.activity.findUnique.mockResolvedValueOnce({ id: I.activity, revision: 1, cancelledAt: null, segments: null }); await expect(read()).rejects.toMatchObject({ code: 'ROSTER_UNAVAILABLE' }); });
  it('safe failed route never serializes malformed private raw source', async () => { h.f.tx.participation.findMany.mockResolvedValueOnce([{ privateOrigin: 'SENSITIVE_COORDINATES', publicAnswers: 'SENSITIVE_ANSWERS' }]); const response = await route(); expect(response.status).toBe(503); const text = await response.text(); expect(text).toContain('ROSTER_UNAVAILABLE'); expect(text).not.toMatch(/SENSITIVE|privateOrigin|publicAnswers/); });
  it('uses original cloud envelope and no-store for both success and invalid-bearer error', async () => { const headers = { [CLOUD_HTTP_ENVELOPE_HEADER]: CLOUD_HTTP_ENVELOPE_VERSION }; const response = await route(headers); expect(response.headers.get('cache-control')).toBe('no-store'); expect(await response.json()).toMatchObject({ transport: 'weego.http.v1', status: 200, body: { activity_id: I.activity } }); h.authenticate.mockRejectedValueOnce(new ServiceError('UNAUTHENTICATED', 401, '请重新登录')); const denied = await route({ ...headers, authorization: 'Bearer invalid' }); expect(denied.status).toBe(200); expect(await denied.json()).toMatchObject({ transport: 'weego.http.v1', status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }); });
});

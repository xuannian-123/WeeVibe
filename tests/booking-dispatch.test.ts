import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ auth: vi.fn(), change: vi.fn() }));
vi.mock('../apps/web/src/server/auth', () => ({ identityService: { authenticate: h.auth } }));
vi.mock('../apps/web/src/server/activities/booking', () => ({ declareBooking: h.change }));
import { POST } from '../apps/web/src/app/api/v1/activities/[activityId]/segments/[segmentId]/booking/route';
import { ServiceError } from '../apps/web/src/server/http';
const activityId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', segmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const context = { params: Promise.resolve({ activityId, segmentId }) }, input = { idempotency_key: 'route-booking-key', expected_revision: 1, expected_plan_revision: 3, expected_booking_status: 'unknown' };
const request = (body: unknown, envelope = false) => new Request('http://localhost/api', { method: 'POST', headers: { Authorization: 'Bearer fixture-session', ...(envelope ? { 'X-Weego-Response-Envelope': '1' } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { h.auth.mockReset().mockResolvedValue({ user_id: actor }); h.change.mockReset().mockResolvedValue({}); });
describe('booking authenticated dispatch with service double', () => {
  it('canonicalizes both path UUIDs, retains strict body and uses only authenticated actor', async () => { const r = await POST(request(input), { params: Promise.resolve({ activityId: activityId.toUpperCase(), segmentId: segmentId.toUpperCase() }) }); expect(r.status).toBe(200); expect(h.change).toHaveBeenCalledExactlyOnceWith(activityId, segmentId, actor, input); });
  it.each([{ actor_id: actor }, { segment_id: segmentId }, { minimum_participants: 1 }, { fee: {} }, { requirements: '' }, { plan_revision: 8 }, { occupied_count: 0 }, { confirmed: true }, { force: true }])('rejects caller-authority or unrelated %j before dispatch', async extra => { expect((await POST(request({ ...input, ...extra }), context)).status).toBe(400); expect(h.change).not.toHaveBeenCalled(); });
  it.each(['activityId', 'segmentId'])('rejects malformed %s path without service', async field => { expect((await POST(request(input), { params: Promise.resolve({ ...{ activityId, segmentId }, [field]: 'invalid' }) })).status).toBe(400); expect(h.change).not.toHaveBeenCalled(); });
  it('rejects no-op or incomplete expected state before dispatch', async () => { expect((await POST(request({ ...input, expected_booking_status: 'manual_booked' }), context)).status).toBe(400); const { expected_plan_revision, ...missing } = input; expect((await POST(request(missing), context)).status).toBe(400); expect(h.change).not.toHaveBeenCalled(); });
  it.each(['BOOKING_DECLARATION_CLOSED', 'BOOKING_SCOPE_UNAVAILABLE'] as const)('retains %s inside cloud409 envelope', async code => { h.change.mockRejectedValueOnce(new ServiceError(code, 409, '明确人工声明边界')); const r = await POST(request(input, true), context); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ status: 409, body: { error: { code } } }); });
  it('does not leak raw exceptions', async () => { h.change.mockRejectedValueOnce(Error('PRIVATE_RAW_SENTINEL')); const r = await POST(request(input), context); expect(r.status).toBe(500); expect(JSON.stringify(await r.json())).not.toContain('PRIVATE_RAW_SENTINEL'); });
});

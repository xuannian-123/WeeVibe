import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applicantA, applicantB, applicationActivity, applicationDetail, applicationId, applicationSegment } from './application-fixtures';
import { uncertain } from '../apps/miniprogram/src/platform/write-policy';
const state = vi.hoisted(() => ({ token: 'session-a', reads: 0, changeAt: 0, transport: vi.fn() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => { state.reads++; if (state.changeAt === state.reads) state.token = 'session-b'; return state.token; }, transport: state.transport }));
import { applyForActor, decideForActor } from '../apps/miniprogram/src/features/applications/api';
const input = { idempotency_key: 'original-application-key', expected_revision: 1, segments: [{ segment_id: applicationSegment, plan_revision: 1 }], display_name: 'A的活动昵称' };
beforeEach(() => { state.token = 'session-a'; state.reads = 0; state.changeAt = 0; state.transport.mockReset().mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 200, body: applicationDetail() }); });
const apply = () => applyForActor(applicationActivity, input, applicantA, 'session-a');
const writes = () => state.transport.mock.calls.filter(call => call[0].method === 'POST');
describe('application identity and frozen transport preflight', () => {
  it('verifies the displayed actor and sends only the original bearer and request payload', async () => {
    await expect(apply()).resolves.toEqual(applicationDetail());
    expect(state.transport.mock.calls[0][0]).toMatchObject({ path: '/api/v1/me', headers: { Authorization: 'Bearer session-a' } });
    expect(writes()[0][0]).toMatchObject({ path: `/api/v1/activities/${applicationActivity}/applications`, headers: { Authorization: 'Bearer session-a' }, body: input });
  });
  it.each(['approve', 'reject'] as const)('retains the original %s decision schema and target', async decision => {
    const command = { idempotency_key: 'original-decision-key', expected_revision: 1, decision };
    await expect(decideForActor(applicationActivity, applicationId, command, applicantA, 'session-a')).resolves.toEqual(applicationDetail());
    expect(writes()[0][0]).toMatchObject({ path: `/api/v1/activities/${applicationActivity}/applications/${applicationId}/decision`, body: command, headers: { Authorization: 'Bearer session-a' } });
  });
  it.each(['session-b', ''])('rejects switched/absent session %s before even fetching identity', async token => {
    state.token = token; await expect(apply()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(state.transport).not.toHaveBeenCalled();
  });
  it('rejects a mismatched verified actor without sending a mutation', async () => {
    state.transport.mockResolvedValueOnce({ status: 200, body: { user_id: applicantB } }); await expect(apply()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(writes()).toHaveLength(0);
  });
  it('rejects token rotation while the identity request is in flight', async () => {
    state.transport.mockImplementationOnce(async () => { state.token = 'session-b'; return { status: 200, body: { user_id: applicantA } }; });
    await expect(apply()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(writes()).toHaveLength(0);
  });
  it('rechecks at final POST transport preflight even after me was successfully verified', async () => {
    // Reads: start, me preflight, me return, identity verified, POST preflight.
    state.changeAt = 5; await expect(apply()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(writes()).toHaveLength(0); expect(state.transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a late result after session rotation instead of acknowledging the old write', async () => {
    state.transport.mockImplementation(async request => { if (request.path === '/api/v1/me') return { status: 200, body: { user_id: applicantA } }; state.token = 'session-b'; return { status: 200, body: applicationDetail() }; });
    await expect(apply()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(writes()[0][0].headers.Authorization).toBe('Bearer session-a');
  });
  it.each(['activity', 'actor'])('rejects an otherwise valid success for a wrong %s', async kind => {
    const detail = applicationDetail(); if (kind === 'activity') detail.activity_id = applicationId; else detail.viewer.user_id = applicantB;
    state.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 200, body: detail });
    await expect(apply()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not call unknown success a business rejection or an acknowledged commit', async () => {
    state.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 200, body: { ok: true } });
    let failure: unknown; try { await apply(); } catch (error) { failure = error; } expect(failure).toBeTruthy(); expect(uncertain(failure)).toBe(true);
  });
  it.each(['ACTIVITY_CANCELLED', 'ARRANGEMENT_STALE', 'CAPACITY_FULL'])('keeps %s as an existing server decision', async code => {
    state.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 409, body: { error: { code, message: '服务端业务状态拒绝' }, request_id: 'fixture' } });
    await expect(apply()).rejects.toMatchObject({ code, status: 409 });
  });
  it('accepts an idempotent replay returning a newer/cancelled snapshot without changing identity', async () => {
    const detail = applicationDetail(); detail.revision = 8; detail.cancelled_at = '2030-01-01T00:00:00Z'; detail.viewer.is_manager = false;
    state.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 200, body: detail });
    await expect(apply()).resolves.toEqual(detail);
  });
  it('normalizes valid UUID casing without relaxing wrong-target checks', async () => {
    await expect(applyForActor(applicationActivity.toUpperCase(), input, applicantA.toUpperCase(), 'session-a')).resolves.toEqual(applicationDetail());
  });
});

it('does not turn a fabricated approval action or actor field into a valid decision write', async () => {
 await expect(decideForActor(applicationActivity, applicationId, { idempotency_key: 'original-key', expected_revision: 1, decision: 'approve', user_id: applicantB } as never, applicantA, 'session-a')).rejects.toBeDefined();expect(writes()).toHaveLength(0);
});

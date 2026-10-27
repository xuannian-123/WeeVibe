import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';
const h = vi.hoisted(() => ({ token: undefined as string | undefined, transport: vi.fn(), me: vi.fn(), login: vi.fn(), forget: vi.fn() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token, transport: h.transport, api: { me: h.me }, establishSession: h.login, forgetSession: h.forget }));
import { readSceneInvitation, sceneEntryErrorText } from '../apps/miniprogram/src/features/activity-entry/scene-client';
const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ACTIVITY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const source = () => ({ invitation_id: SOURCE, activity_id: ACTIVITY, title: '公开活动', inviter_display_name: '昵称', inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'Asia/Shanghai', cancelled: false, source_only: true as const });
const read = (guard = () => {}) => readSceneInvitation(SOURCE, h.token, guard);
beforeEach(() => { h.token = undefined; h.transport.mockReset().mockResolvedValue({ status: 200, body: source() }); h.me.mockReset(); h.login.mockReset(); h.forget.mockReset(); });
describe('scene public source client (offline transport)', () => {
  it.each([undefined, 'session-a'])('reads exact source with captured session %s, without bearer or side effects', async token => {
    h.token = token; const guard = vi.fn(); expect(await read(guard)).toEqual(source());
    expect(h.transport).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: `/api/v1/invitations/${SOURCE}`, headers: { 'Content-Type': 'application/json' } });
    expect(guard.mock.calls.length).toBeGreaterThanOrEqual(3); expect(h.me).not.toHaveBeenCalled(); expect(h.login).not.toHaveBeenCalled(); expect(h.forget).not.toHaveBeenCalled();
  });
  it('canonicalizes IDs but never invents a source revision', async () => {
    h.transport.mockResolvedValueOnce({ status: 200, body: { ...source(), invitation_id: SOURCE.toUpperCase(), activity_id: ACTIVITY.toUpperCase() } });
    const value = await readSceneInvitation(SOURCE.toUpperCase(), undefined, () => {}); expect(value.activity_id).toBe(ACTIVITY); expect(value).not.toHaveProperty('revision');
  });
  it('preserves cancelled source truth for the canonical current detail page', async () => {
    h.transport.mockResolvedValueOnce({ status: 200, body: { ...source(), cancelled: true } }); expect((await read()).cancelled).toBe(true);
  });
  it.each([{ invitation_id: ACTIVITY }, { activity_id: 'not-an-id' }, { source_only: false }, { revision: 42 }, { private_profile: { phone: 'PRIVATE_PHONE' } }])('rejects mismatched or widened source DTO %j', async extra => {
    h.transport.mockResolvedValueOnce({ status: 200, body: { ...source(), ...extra } }); await expect(read()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects malformed input before any transport', async () => { await expect(readSceneInvitation('../bad', undefined, () => {})).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(h.transport).not.toHaveBeenCalled(); });
  it('runs page guard synchronously immediately before transport', async () => {
    const events: string[] = []; h.transport.mockImplementationOnce(() => { events.push('send'); return Promise.resolve({ status: 200, body: source() }); });
    await read(() => { events.push('guard'); }); expect(events.slice(0, 2)).toEqual(['guard', 'send']);
  });
  it('does not send after caller page guard rejects or changes the session', async () => {
    await expect(read(() => { throw new ApiClientError('ENTRY_CHANGED', 'PRIVATE', 409); })).rejects.toMatchObject({ code: 'ENTRY_CHANGED' }); expect(h.transport).not.toHaveBeenCalled();
    await expect(read(() => { h.token = 'new-session'; })).rejects.toMatchObject({ code: 'SESSION_CHANGED' }); expect(h.transport).not.toHaveBeenCalled(); expect(h.forget).not.toHaveBeenCalled();
  });
  it('checks session before sending; undefined is a bound guest session, not a bypass', async () => {
    h.token = 'new-session'; await expect(readSceneInvitation(SOURCE, undefined, () => {})).rejects.toMatchObject({ code: 'SESSION_CHANGED' }); expect(h.transport).not.toHaveBeenCalled();
  });
  it.each(['success', '401', 'network'])('rejects late %s after a session switch without clearing newer token', async outcome => {
    h.token = 'session-a'; h.transport.mockImplementationOnce(async () => { h.token = 'session-b'; if (outcome === 'network') throw new Error('PRIVATE'); return outcome === 'success' ? { status: 200, body: source() } : { status: 401, body: { error: { code: 'UNAUTHENTICATED', message: 'PRIVATE' } } }; });
    await expect(read()).rejects.toMatchObject({ code: 'SESSION_CHANGED' }); expect(h.token).toBe('session-b'); expect(h.forget).not.toHaveBeenCalled();
  });
  it('checks page after response before publishing source', async () => {
    let active = true; h.transport.mockImplementationOnce(async () => { active = false; return { status: 200, body: source() }; });
    await expect(read(() => { if (!active) throw new ApiClientError('ENTRY_CHANGED', 'PRIVATE', 409); })).rejects.toMatchObject({ code: 'ENTRY_CHANGED' });
  });
  it.each([
    [404, { error: { code: 'NOT_FOUND', message: 'PRIVATE_SQL' }, request_id: 'fixture' }, 'NOT_FOUND'],
    [404, '<html>PRIVATE_404</html>', 'ENTRY_UNAVAILABLE'],
    [405, '<html>PRIVATE_405</html>', 'ENTRY_UNAVAILABLE'],
    [503, { error: { code: 'DATABASE_UNAVAILABLE', message: 'PRIVATE_DB' } }, 'SERVICE_UNAVAILABLE'],
    [200, '<html>PRIVATE_200</html>', 'INVALID_RESPONSE'],
    [200, {}, 'INVALID_RESPONSE'],
    [201, source(), 'INVALID_RESPONSE'],
    [401, { error: { code: 'UNAUTHENTICATED', message: 'PRIVATE_SESSION' } }, 'INVALID_RESPONSE']
  ])('classifies HTTP %s truthfully and sanitizes all response content', async (status, body, code) => {
    h.transport.mockResolvedValueOnce({ status, body }); let error: unknown; try { await read(); } catch (value) { error = value; }
    expect(error).toMatchObject({ code }); expect(sceneEntryErrorText(error)).not.toContain('PRIVATE'); expect(String(error)).not.toContain('PRIVATE'); expect(h.forget).not.toHaveBeenCalled();
  });
  it('handles cloud HTML response rejection without declaring invitation missing', async () => {
    h.transport.mockRejectedValueOnce(new ApiClientError('INVALID_RESPONSE', 'PRIVATE_HTML', 404));
    await expect(read()).rejects.toMatchObject({ code: 'ENTRY_UNAVAILABLE', status: 404 });
  });
  it('never displays arbitrary transport or unrecognized server errors', async () => {
    h.transport.mockRejectedValueOnce(new Error('PRIVATE_TOKEN')); await expect(read()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(sceneEntryErrorText(new Error('PRIVATE_TOKEN'))).not.toContain('PRIVATE'); expect(sceneEntryErrorText(new ApiClientError('UNKNOWN', 'PRIVATE', 500))).not.toContain('PRIVATE');
  });
});

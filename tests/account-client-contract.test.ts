import { beforeEach, describe, expect, it, vi } from 'vitest';
import { accountActor, accountActivity, accountVenue, emptyAccountFixture } from './account-fixtures';
const state = vi.hoisted(() => ({ token: 'session-a', transport: vi.fn() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => state.token, transport: state.transport }));
import { requestAccount } from '../apps/miniprogram/src/platform/account-api';
import { uncertain } from '../apps/miniprogram/src/platform/write-policy';
beforeEach(() => { state.token = 'session-a'; state.transport.mockReset(); });
function reply(body: unknown) { state.transport.mockResolvedValueOnce({ status: 200, body }); }
describe('account success contract and editor-session boundary', () => {
  it('accepts empty optional personal values and nullable saved-place fields', async () => {
    const value = emptyAccountFixture(); value.favorites = [accountVenue()]; reply(value);
    await expect(requestAccount('session-a')).resolves.toEqual(value);
  });
  it('keeps missing older additive activity_records and capabilities absent instead of claiming a complete list', async () => {
    const { activity_records: _records, capabilities: _capabilities, ...older } = emptyAccountFixture(); reply(older);
    const result = await requestAccount('session-a'); expect(result).toEqual(older); expect(result).not.toHaveProperty('activity_records');
  });
  it('accepts public invitation source with nullable dates and avatar, and real message routes', async () => {
    const value = { ...emptyAccountFixture(), invitations: [{ invitation_id: accountActor, activity_id: accountActivity, title: '测试邀请', inviter_display_name: null, inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'UTC', cancelled: true, source_only: true, saved_at: '2030-01-01T00:00:00Z', status: '已取消', location: '' }],
      messages: [{ id: `requirement:${accountActor}:closed`, activity_id: accountActivity, requirement_id: accountActor, title: '测试截止通知', created_at: '2030-01-01T00:00:00Z', read: false }] };
    reply(value); await expect(requestAccount('session-a')).resolves.toEqual(value);
  });
  it.each([['unrelated object', { ok: true }], ['missing messages', { ...emptyAccountFixture(), messages: undefined }], ['null profile', { ...emptyAccountFixture(), profile: null }], ['wrong nickname', { ...emptyAccountFixture(), profile: { nickname: 3 } }], ['wrong favorites', { ...emptyAccountFixture(), favorites: null }], ['malformed venue', { ...emptyAccountFixture(), favorites: [{ name: 'PRIVATE_SENTINEL' }] }], ['wrong new records', { ...emptyAccountFixture(), activity_records: {} }]])('rejects %s without losing unknown-write classification', async (_name, body) => {
    reply(body);
    try { await requestAccount('session-a', 'PATCH', { action: 'profile' }); throw new Error('expected rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'INVALID_RESPONSE' }); expect(uncertain(error)).toBe(true); expect((error as Error).message).not.toContain('PRIVATE_SENTINEL'); }
  });
  it('strips unknown private extras and never trusts a remote account avatar URL', async () => {
    const value = emptyAccountFixture(); reply({ ...value, private_secret: 'SENTINEL', profile: { ...value.profile, avatar_url: 'https://untrusted.test/SENTINEL', foreign_user: 'SENTINEL' } });
    const result = await requestAccount('session-a'); expect(result).toEqual(value); expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });
  it.each(['session-b', ''])('cannot replay the displayed A account operation using %s', async token => {
    state.token = token; await expect(requestAccount('session-a', 'PATCH', { action: 'favorite' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(state.transport).not.toHaveBeenCalled();
  });
  it('cannot publish late private data into another session', async () => {
    state.transport.mockImplementationOnce(async () => { state.token = 'session-b'; return { status: 200, body: emptyAccountFixture() }; });
    await expect(requestAccount('session-a')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
  it('retains structured backend rejection, and uses the established cloud-compatible update method', async () => {
    state.transport.mockResolvedValueOnce({ status: 400, body: { error: { code: 'INVALID_INPUT', message: '资料格式不正确' }, request_id: 'fixture' } });
    await expect(requestAccount('session-a', 'PATCH', { action: 'profile' })).rejects.toMatchObject({ code: 'INVALID_INPUT', status: 400 });
    expect(state.transport.mock.calls[0][0]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer session-a' } });
  });
});

import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createIdentityService, hashToken, type IdentityStore } from '../apps/web/src/server/auth/service';
import { exchangeWechatCode } from '../apps/web/src/server/auth/wechat';
import { loginRequestSchema } from '../packages/contracts/src';

// This fake store is TEST ONLY. Production always uses Prisma/PostgreSQL.
function testStore() {
  const users = new Map<string, string>();
  const sessions = new Map<string, { user_id: string; expiresAt: Date }>();
  const store: IdentityStore = {
    async findOrCreateUser({ appId, openId }) { const key = `${appId}:${openId}`; if (!users.has(key)) users.set(key, randomUUID()); return { user_id: users.get(key)! }; },
    async saveSession(hash, user_id, expiresAt) { sessions.set(hash, { user_id, expiresAt }); },
    async findSession(hash) { return sessions.get(hash) ?? null; }
  };
  return { store, users, sessions };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('identity service (injected test store, not real WeChat or database)', () => {
  it('maps repeated platform identity to same user, distinct identities/apps to distinct users', async () => {
    const { store, sessions } = testStore();
    const service = createIdentityService(store, async code => ({ appId: 'test-app', openId: code }));
    const one = await service.login('test-identity-one');
    const again = await service.login('test-identity-one');
    const two = await service.login('test-identity-two');
    const otherApp = await createIdentityService(store, async () => ({ appId: 'other-app', openId: 'test-identity-one' })).login('unused');
    expect(one.user).toEqual(again.user);
    expect(one.user).not.toEqual(two.user);
    expect(one.user).not.toEqual(otherApp.user);
    expect(one.token).not.toBe(again.token);
    expect(sessions.has(one.token)).toBe(false);
    expect(sessions.has(hashToken(one.token))).toBe(true);
    expect(await service.authenticate(`Bearer ${one.token}`)).toEqual(one.user);
  });
  it('rejects expired/missing/fabricated sessions and restores user after relogin', async () => {
    const { store } = testStore();
    let now = new Date('2026-10-24T00:00:00Z');
    const service = createIdentityService(store, async () => ({ appId: 'test-app', openId: 'test-user' }), () => now);
    const first = await service.login('test-code');
    now = new Date('2026-10-25T00:00:01Z');
    await expect(service.authenticate(`Bearer ${first.token}`)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.authenticate(null)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(service.authenticate(`Bearer ${'x'.repeat(43)}`)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect((await service.login('new-test-code')).user).toEqual(first.user);
  });
  it('never creates a session if provider verification fails', async () => {
    const { store, sessions, users } = testStore();
    const service = createIdentityService(store, async () => { throw new Error('test rejection'); });
    await expect(service.login('test-code')).rejects.toThrow('test rejection');
    expect(sessions.size).toBe(0); expect(users.size).toBe(0);
  });
  it('rejects client identity claims rather than accepting openid fields', () => {
    expect(loginRequestSchema.safeParse({ code: 'test', openid: 'forged' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ openid: 'forged' }).success).toBe(false);
  });
  it('returns NOT_CONFIGURED without calling WeChat when configuration is missing', async () => {
    vi.stubEnv('WECHAT_APP_ID', ''); vi.stubEnv('WECHAT_APP_SECRET', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(exchangeWechatCode('test-only')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

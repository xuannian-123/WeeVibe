import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ storage: new Map<string, unknown>(), request: vi.fn(), callFunction: vi.fn() }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js', () => ({ default: {
  getStorageSync: (key: string) => h.storage.get(key),
  setStorageSync: (key: string, value: unknown) => h.storage.set(key, value),
  removeStorageSync: (key: string) => h.storage.delete(key),
  request: h.request, cloud: { init: vi.fn(), callFunction: h.callFunction }
} }));
const key = 'weego_session_v1';
const issued = { token: 'A'.repeat(43), expires_at: '2040-01-01T00:00:00Z', user: { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } };
const expired = { statusCode: 401, data: { error: { code: 'UNAUTHENTICATED', message: 'expired' }, request_id: 'fixture' } };
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  vi.resetModules(); h.storage.clear(); h.request.mockReset().mockResolvedValue({ statusCode: 200, data: issued.user }); h.callFunction.mockReset().mockResolvedValue({ result: issued });
  vi.stubGlobal('__WEEVIBE_API_TRANSPORT__', 'https'); vi.stubGlobal('__WEEVIBE_API_BASE_URL__', 'https://api.example.invalid');
  vi.stubGlobal('__WEEVIBE_CLOUD_API_FUNCTION__', ''); vi.stubGlobal('__WEEVIBE_LOGIN_MODE__', 'cloud');
  vi.stubGlobal('__WEEVIBE_CLOUD_ENV_ID__', 'fixture-env'); vi.stubGlobal('__WEEVIBE_CLOUD_LOGIN_FUNCTION__', 'fixture-login');
});
afterEach(() => vi.unstubAllGlobals());
it('cold entry establishes a real-adapter session without a button or business writes', async () => {
  const { automaticUser } = await import('../apps/miniprogram/src/platform/automatic-session');
  expect(await automaticUser()).toEqual({ user: issued.user, session: issued.token });
  expect(h.callFunction).toHaveBeenCalledTimes(1); expect(h.request).toHaveBeenCalledTimes(1); expect(h.storage.get(key)).toBe(issued.token);
});
it('reopened valid session is verified and reused without another login', async () => {
  h.storage.set(key, issued.token); h.request.mockResolvedValue({ statusCode: 200, data: issued.user });
  const { automaticUser } = await import('../apps/miniprogram/src/platform/automatic-session');
  await automaticUser(); await automaticUser();
  expect(h.request).toHaveBeenCalledTimes(2); expect(h.callFunction).not.toHaveBeenCalled();
});
it('expired identity is replaced once and concurrent pages share the attempt', async () => {
  h.storage.set(key, 'EXPIRED'); h.request.mockResolvedValueOnce(expired);
  const { automaticUser } = await import('../apps/miniprogram/src/platform/automatic-session');
  const a = automaticUser(), b = automaticUser(); expect(a).toBe(b);
  expect(await a).toEqual({ user: issued.user, session: issued.token });
  expect(h.callFunction).toHaveBeenCalledTimes(1); expect(h.request).toHaveBeenCalledTimes(2);
});
it('network failure retains the current token and allows a later read retry', async () => {
  h.storage.set(key, 'EXISTING'); h.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ statusCode: 200, data: issued.user });
  const { automaticUser } = await import('../apps/miniprogram/src/platform/automatic-session');
  await expect(automaticUser()).rejects.toMatchObject({ code: 'NETWORK_ERROR' }); expect(h.storage.get(key)).toBe('EXISTING');
  await automaticUser(); expect(h.callFunction).not.toHaveBeenCalled();
});
it('failed cloud login stops rather than looping, and a later entry can retry', async () => {
  h.callFunction.mockRejectedValueOnce(new Error('offline'));
  const { automaticUser } = await import('../apps/miniprogram/src/platform/automatic-session');
  await expect(automaticUser()).rejects.toMatchObject({ code: 'NETWORK_ERROR' }); expect(h.callFunction).toHaveBeenCalledTimes(1);
  await automaticUser(); expect(h.callFunction).toHaveBeenCalledTimes(2);
});
it('logout persists across runtime restart and manual success can enable automatic login again', async () => {
  const first = await import('../apps/miniprogram/src/platform/automatic-session'); first.logoutAutomaticSession(); vi.resetModules();
  const next = await import('../apps/miniprogram/src/platform/automatic-session');
  await expect(next.automaticUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); expect(h.callFunction).not.toHaveBeenCalled();
  next.resumeAutomaticLogin(); await next.automaticUser(); expect(h.storage.get(key)).toBe(issued.token);
});
it('logout during native login prevents its late token from being stored', async () => {
  const wait = deferred(); h.callFunction.mockReturnValueOnce(wait.promise);
  const { automaticUser, logoutAutomaticSession } = await import('../apps/miniprogram/src/platform/automatic-session');
  const result = expect(automaticUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); logoutAutomaticSession();
  wait.resolve({ result: issued }); await result; expect(h.storage.has(key)).toBe(false);
});
it('late expired-session result cannot erase or replace a newer account', async () => {
  h.storage.set(key, 'OLD'); const wait = deferred(); h.request.mockReturnValueOnce(wait.promise);
  const { automaticUser } = await import('../apps/miniprogram/src/platform/automatic-session');
  const result = expect(automaticUser()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' }); h.storage.set(key, 'NEW');
  wait.resolve(expired); await result; expect(h.storage.get(key)).toBe('NEW'); expect(h.callFunction).not.toHaveBeenCalled();
});

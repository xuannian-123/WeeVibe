import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn(),
  login: vi.fn(), request: vi.fn(), cloud: { init: vi.fn(), callFunction: vi.fn() }
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js', () => ({ default: platform }));
import { establishSession, api } from '../apps/miniprogram/src/platform/api';

const session = () => ({ token: randomBytes(32).toString('base64url'), expires_at: new Date(Date.now() + 86400000).toISOString(), user: { user_id: randomUUID() } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('__WEEGO_API_TRANSPORT__', 'https'); vi.stubGlobal('__WEEGO_CLOUD_API_FUNCTION__', '');
  vi.stubGlobal('__WEEGO_LOGIN_MODE__', 'cloud'); vi.stubGlobal('__WEEGO_API_BASE_URL__', 'https://api.example.invalid');
  vi.stubGlobal('__WEEGO_CLOUD_ENV_ID__', 'fixture-env'); vi.stubGlobal('__WEEGO_CLOUD_LOGIN_FUNCTION__', 'fixtureLogin');
});
afterEach(() => vi.unstubAllGlobals());

describe('mini-program explicit cloud login adapter (mock platform only)', () => {
  it('stores only the Weego session and uses the same bearer business API', async () => {
    const issued = session();
    platform.cloud.callFunction.mockResolvedValue({ result: issued });
    expect(await establishSession()).toEqual(issued.user);
    expect(platform.cloud.callFunction).toHaveBeenCalledWith({ name: 'fixtureLogin', data: {}, config: { env: 'fixture-env' } });
    expect(platform.setStorageSync).toHaveBeenCalledExactlyOnceWith('weego_session_v1', issued.token);
    expect(platform.login).not.toHaveBeenCalled(); expect(platform.request).not.toHaveBeenCalled();
    platform.getStorageSync.mockReturnValue(issued.token);
    platform.request.mockResolvedValue({ statusCode: 200, data: issued.user });
    expect(await api.me()).toEqual(issued.user);
    expect(platform.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.invalid/api/v1/me', header: expect.objectContaining({ Authorization: `Bearer ${issued.token}` }) }));
  });
  it('does not fall back to another identity path when cloud login fails', async () => {
    platform.cloud.callFunction.mockRejectedValue(new Error('sensitive provider error fixture'));
    await expect(establishSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: '微信云登录未完成，请稍后重试' });
    expect(platform.login).not.toHaveBeenCalled(); expect(platform.request).not.toHaveBeenCalled(); expect(platform.setStorageSync).not.toHaveBeenCalled();
  });
  it('rejects missing configuration before contacting the platform', async () => {
    for (const name of ['__WEEGO_CLOUD_ENV_ID__', '__WEEGO_CLOUD_LOGIN_FUNCTION__', '__WEEGO_API_BASE_URL__']) {
      vi.stubGlobal(name, '');
      await expect(establishSession()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
      vi.stubGlobal('__WEEGO_CLOUD_ENV_ID__', 'fixture-env'); vi.stubGlobal('__WEEGO_CLOUD_LOGIN_FUNCTION__', 'fixtureLogin'); vi.stubGlobal('__WEEGO_API_BASE_URL__', 'https://api.example.invalid');
    }
    expect(platform.cloud.callFunction).not.toHaveBeenCalled(); expect(platform.login).not.toHaveBeenCalled();
  });
  it('rejects expired, malformed and provider-error results without storing them', async () => {
    for (const result of [{ openid: 'forged' }, { ...session(), token: 'forged' }, { ...session(), expires_at: '2020-01-01T00:00:00.000Z' }]) {
      platform.cloud.callFunction.mockResolvedValue({ result });
      await expect(establishSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
    platform.cloud.callFunction.mockResolvedValue({ result: { error: { code: 'NOT_CONFIGURED', message: '尚未配置微信云身份接入' }, request_id: randomUUID() } });
    await expect(establishSession()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(platform.setStorageSync).not.toHaveBeenCalled(); expect(platform.login).not.toHaveBeenCalled();
  });
  it('retains the explicit code route for deployments with the original server-side verifier', async () => {
    vi.stubGlobal('__WEEGO_LOGIN_MODE__', 'code');
    const issued = session(); platform.login.mockResolvedValue({ code: 'fixture-code' });
    platform.request.mockResolvedValue({ statusCode: 200, data: issued });
    expect(await establishSession()).toEqual(issued.user);
    expect(platform.request).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.invalid/api/v1/auth/wechat', data: { code: 'fixture-code' } }));
    expect(platform.cloud.callFunction).not.toHaveBeenCalled(); expect(platform.setStorageSync).toHaveBeenCalledExactlyOnceWith('weego_session_v1', issued.token);
  });
});

import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  getStorageSync: vi.fn(), setStorageSync: vi.fn(), removeStorageSync: vi.fn(),
  login: vi.fn(), request: vi.fn(), cloud: { init: vi.fn(), callFunction: vi.fn(), callHTTPFunction: vi.fn() }
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro/index.js', () => ({ default: platform }));
import { api, establishSession } from '../apps/miniprogram/src/platform/api';
import { callCloudHTTP } from '../apps/miniprogram/src/platform/cloud-http';

const token = randomBytes(32).toString('base64url');
const user = { user_id: randomUUID() };
function respond(statusCode: number, data: unknown) {
  platform.cloud.callHTTPFunction.mockImplementation(options => options.success({ statusCode, data }));
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('wx', { cloud: platform.cloud });
  vi.stubGlobal('__WEEGO_API_TRANSPORT__', 'cloud-http');
  vi.stubGlobal('__WEEGO_API_BASE_URL__', '');
  vi.stubGlobal('__WEEGO_CLOUD_ENV_ID__', 'fixture-env');
  vi.stubGlobal('__WEEGO_CLOUD_API_FUNCTION__', 'fixtureApi');
  vi.stubGlobal('__WEEGO_CLOUD_LOGIN_FUNCTION__', 'fixtureLogin');
  vi.stubGlobal('__WEEGO_LOGIN_MODE__', 'cloud');
  platform.getStorageSync.mockReturnValue(token);
});
afterEach(() => vi.unstubAllGlobals());

describe('explicit native cloud HTTP transport (mock platform only)', () => {
  it('restores a saved session in a fresh cloud runtime without another login', async () => {
    let initialized = false;
    const cloud = { init: vi.fn(() => { initialized = true; }), callHTTPFunction: vi.fn(options => {
      if (!initialized) { options.fail(new Error('cloud runtime is not initialized')); return; }
      options.success({ statusCode: 200, data: user });
    }) };
    vi.stubGlobal('wx', { cloud });
    expect(await api.me()).toEqual(user);
    expect(await api.me()).toEqual(user);
    expect(cloud.init).toHaveBeenCalledExactlyOnceWith({ env: 'fixture-env' });
    expect(platform.login).not.toHaveBeenCalled();
    expect(platform.cloud.callFunction).not.toHaveBeenCalled();
    expect(platform.setStorageSync).not.toHaveBeenCalled();
  });
  it('retries a failed native initialization without sending or switching transports', async () => {
    const cloud = { init: vi.fn().mockImplementationOnce(() => { throw new Error('private init error'); }).mockImplementation(() => {}),
      callHTTPFunction: vi.fn(options => options.success({ statusCode: 200, data: user })) };
    vi.stubGlobal('wx', { cloud });
    await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(cloud.callHTTPFunction).not.toHaveBeenCalled();
    expect(await api.me()).toEqual(user);
    expect(cloud.init).toHaveBeenCalledTimes(2);
    expect(platform.request).not.toHaveBeenCalled();
  });
  it('uses fixed function/environment and forwards the Weego bearer, method and path', async () => {
    respond(200, user);
    expect(await api.me()).toEqual(user);
    expect(platform.cloud.callHTTPFunction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: 'fixtureApi', config: { env: 'fixture-env' }, method: 'get', path: '/api/v1/me',
      header: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, timeout: 10000
    }));
    expect(platform.request).not.toHaveBeenCalled();
  });
  it('preserves request bodies and accepts JSON string responses', async () => {
    const record = { user_id: user.user_id, value: 'fixture-value', updated_at: new Date().toISOString() };
    respond(200, JSON.stringify(record));
    await api.putTestRecord('fixture-value');
    expect(platform.cloud.callHTTPFunction).toHaveBeenCalledWith(expect.objectContaining({ method: 'put', data: { value: 'fixture-value' } }));
  });
  it('allows cloud login without an HTTPS base and stores only the Weego session', async () => {
    platform.cloud.callFunction.mockResolvedValue({ result: { token, user, expires_at: new Date(Date.now() + 60000).toISOString() } });
    expect(await establishSession()).toEqual(user);
    expect(platform.setStorageSync).toHaveBeenCalledExactlyOnceWith('weego_session_v1', token);
    expect(platform.request).not.toHaveBeenCalled(); expect(platform.login).not.toHaveBeenCalled();
  });
  it('propagates shared API errors without switching transport or identity', async () => {
    respond(401, JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: '请先登录' }, request_id: randomUUID() }));
    await expect(api.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(platform.request).not.toHaveBeenCalled(); expect(platform.login).not.toHaveBeenCalled();
  });
  it('hides provider errors and never falls back to HTTPS', async () => {
    platform.cloud.callHTTPFunction.mockImplementation(options => options.fail(new Error('private provider fixture')));
    await expect(api.me()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    expect(platform.request).not.toHaveBeenCalled(); expect(platform.cloud.callFunction).not.toHaveBeenCalled();
  });
  it('fails before contacting login if the selected transport is incomplete or unsupported', async () => {
    for (const name of ['__WEEGO_CLOUD_ENV_ID__', '__WEEGO_CLOUD_API_FUNCTION__']) {
      vi.stubGlobal(name, '');
      await expect(establishSession()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
      vi.stubGlobal('__WEEGO_CLOUD_ENV_ID__', 'fixture-env'); vi.stubGlobal('__WEEGO_CLOUD_API_FUNCTION__', 'fixtureApi');
    }
    vi.stubGlobal('wx', { cloud: {} });
    await expect(establishSession()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(platform.cloud.callFunction).not.toHaveBeenCalled(); expect(platform.request).not.toHaveBeenCalled();
  });
  it('rejects malformed response envelopes and non-JSON bodies', async () => {
    for (const response of [{ data: user }, { statusCode: '200', data: user }, { statusCode: 200.5, data: user }, { statusCode: 200, data: '<html>' }]) {
      platform.cloud.callHTTPFunction.mockImplementation(options => options.success(response));
      await expect(api.me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('rejects arbitrary URLs and traversal before contacting the fixed cloud function', async () => {
    for (const path of ['https://evil.invalid/api/v1/me', '//evil.invalid/api/v1/me', '/api/v1/../me', '/api/v1/me\r\nX: bad']) {
      await expect(callCloudHTTP({ method: 'GET', path, headers: {} }, 'fixture-env', 'fixtureApi')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    }
    expect(platform.cloud.callHTTPFunction).not.toHaveBeenCalled();
  });
});

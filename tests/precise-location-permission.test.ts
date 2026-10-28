import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  privacy: vi.fn(), setting: vi.fn(), authorize: vi.fn(), system: vi.fn(), app: vi.fn(),
  precise: vi.fn(), fuzzy: vi.fn(), open: vi.fn(), preciseEnabled: true,
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: {
  getPrivacySetting: h.privacy, getSetting: h.setting, authorize: h.authorize,
  getSystemSetting: h.system, getAppAuthorizeSetting: h.app, openSetting: h.open,
  get getLocation() { return h.preciseEnabled ? h.precise : undefined; }, getFuzzyLocation: h.fuzzy,
} }));
import { readPreciseLocation, requireLocationPermission } from '../apps/miniprogram/src/platform/location-permission';

beforeEach(() => {
  vi.resetAllMocks();
  h.preciseEnabled = true;
  h.privacy.mockImplementation(({ success }) => success({ needAuthorization: false }));
  h.setting.mockResolvedValue({ authSetting: { 'scope.userLocation': true, 'scope.userFuzzyLocation': true } });
  h.authorize.mockResolvedValue({});
  h.system.mockReturnValue({ locationEnabled: true });
  h.app.mockReturnValue({ locationAuthorized: 'authorized', locationReducedAccuracy: false });
});

describe('one precise permission shared by every location entry', () => {
  it('requests the precise scope once and reuses the actual grant on subsequent entries', async () => {
    const auth: Record<string, boolean> = {};
    h.setting.mockImplementation(async () => ({ authSetting: auth }));
    h.authorize.mockImplementation(async ({ scope }) => { auth[scope] = true; });
    await requireLocationPermission(() => {});
    await requireLocationPermission(() => {});
    expect(h.authorize).toHaveBeenCalledExactlyOnceWith({ scope: 'scope.userLocation' });
    expect(h.precise).not.toHaveBeenCalled();
    expect(h.fuzzy).not.toHaveBeenCalled();
  });

  it('does not repeat a refusal or fall back to fuzzy permission', async () => {
    h.setting.mockResolvedValue({ authSetting: { 'scope.userLocation': false, 'scope.userFuzzyLocation': true } });
    await expect(requireLocationPermission(() => {})).rejects.toMatchObject({ code: 'LOCATION_PERMISSION_DENIED' });
    expect(h.authorize).not.toHaveBeenCalled();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.fuzzy).not.toHaveBeenCalled();
  });

  it('explains the OS approximate-only setting without presenting its coordinates as precise', async () => {
    h.app.mockReturnValue({ locationAuthorized: 'authorized', locationReducedAccuracy: true });
    await expect(requireLocationPermission(() => {})).rejects.toMatchObject({ code: 'LOCATION_PRECISE_SYSTEM_LIMITED' });
    expect(h.open).not.toHaveBeenCalled();
    expect(h.authorize).not.toHaveBeenCalled();
  });

  it('allows first authorization when the OS location grant is still undetermined', async () => {
    h.app.mockReturnValue({ locationAuthorized: 'not determined', locationReducedAccuracy: true });
    h.setting.mockResolvedValue({ authSetting: {} });
    await requireLocationPermission(() => {});
    expect(h.authorize).toHaveBeenCalledExactlyOnceWith({ scope: 'scope.userLocation' });
  });
});

describe('native precise location adapter', () => {
  const point = { latitude: 30, longitude: 120, accuracy: 15, errMsg: 'getLocation:ok' };

  it('supports a callback-only runtime and requests GCJ-02 with bounded high accuracy', async () => {
    h.precise.mockImplementation(({ success }) => { success(point); });
    await expect(readPreciseLocation()).resolves.toEqual(point);
    expect(h.precise).toHaveBeenCalledWith(expect.objectContaining({ type: 'gcj02', isHighAccuracy: true, highAccuracyExpireTime: 5000 }));
    expect(h.fuzzy).not.toHaveBeenCalled();
  });

  it('supports Taro returning a promise', async () => {
    h.precise.mockResolvedValue(point);
    await expect(readPreciseLocation()).resolves.toEqual(point);
  });

  it('handles a promise rejection as well as a native fail callback without falling back', async () => {
    const error = { errMsg: 'getLocation:fail auth deny' };
    h.precise.mockImplementation(({ fail }) => { fail(error); return Promise.reject(error); });
    await expect(readPreciseLocation()).rejects.toBe(error);
    expect(h.fuzzy).not.toHaveBeenCalled();
  });

  it('reports an unavailable API instead of silently acquiring approximate coordinates', async () => {
    h.preciseEnabled = false;
    await expect(readPreciseLocation()).rejects.toMatchObject({ code: 'LOCATION_UNAVAILABLE' });
    expect(h.fuzzy).not.toHaveBeenCalled();
  });
});

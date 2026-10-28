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

describe('precise and approximate consent remain independent', () => {
  it('asks for precise permission even when approximate permission was granted', async () => {
    h.setting.mockResolvedValue({ authSetting: { 'scope.userFuzzyLocation': true } });
    await requireLocationPermission(() => {}, 'precise');
    expect(h.authorize).toHaveBeenCalledExactlyOnceWith({ scope: 'scope.userLocation' });
    expect(h.precise).not.toHaveBeenCalled();
    expect(h.fuzzy).not.toHaveBeenCalled();
  });

  it('does not use precise consent to override a refusal of approximate permission', async () => {
    h.setting.mockResolvedValue({ authSetting: { 'scope.userLocation': true, 'scope.userFuzzyLocation': false } });
    await expect(requireLocationPermission(() => {}, 'approximate')).rejects.toMatchObject({ code: 'LOCATION_PERMISSION_DENIED' });
    expect(h.authorize).not.toHaveBeenCalled();
  });

  it.each([false, undefined])('does not open settings or fall back after precise permission is refused (%s)', async granted => {
    h.setting.mockResolvedValue({ authSetting: { 'scope.userLocation': granted, 'scope.userFuzzyLocation': true } });
    h.authorize.mockRejectedValue({ errMsg: 'authorize:fail auth deny' });
    await expect(requireLocationPermission(() => {}, 'precise')).rejects.toMatchObject({ code: 'LOCATION_PERMISSION_DENIED' });
    expect(h.authorize).toHaveBeenCalledTimes(granted === false ? 0 : 1);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.precise).not.toHaveBeenCalled();
    expect(h.fuzzy).not.toHaveBeenCalled();
  });

  it('explains the OS approximate-only setting while still allowing an explicit approximate action', async () => {
    h.app.mockReturnValue({ locationAuthorized: 'authorized', locationReducedAccuracy: true });
    await expect(requireLocationPermission(() => {}, 'precise')).rejects.toMatchObject({ code: 'LOCATION_PRECISE_SYSTEM_LIMITED' });
    await expect(requireLocationPermission(() => {}, 'approximate')).resolves.toBeUndefined();
    expect(h.open).not.toHaveBeenCalled();
    expect(h.authorize).not.toHaveBeenCalled();
  });

  it('allows first authorization when the OS location grant is still undetermined', async () => {
    h.app.mockReturnValue({ locationAuthorized: 'not determined', locationReducedAccuracy: true });
    h.setting.mockResolvedValue({ authSetting: {} });
    await requireLocationPermission(() => {}, 'precise');
    expect(h.authorize).toHaveBeenCalledExactlyOnceWith({ scope: 'scope.userLocation' });
  });

  it('rejects a stale actor or page after the precise authorization dialog returns', async () => {
    h.setting.mockResolvedValue({ authSetting: {} });
    let active = true;
    h.authorize.mockImplementation(async () => { active = false; });
    await expect(requireLocationPermission(() => { if (!active) throw Error('stale actor'); }, 'precise')).rejects.toThrow('stale actor');
    expect(h.precise).not.toHaveBeenCalled();
    expect(h.fuzzy).not.toHaveBeenCalled();
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ choose: vi.fn(), privacy: vi.fn(), available: true }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: {
  get chooseLocation() { return h.available ? h.choose : undefined; },
} }));
vi.mock('../apps/miniprogram/src/platform/location-permission', () => ({ requirePrivacyPermission: h.privacy }));
import { chooseMapPlace } from '../apps/miniprogram/src/platform/map-picker';

const point = { name: ' 月亮湾 ', address: ' 苏州 ', latitude: 31.23456789, longitude: 120.12345678, errMsg: 'chooseLocation:ok' };
beforeEach(() => {
  h.available = true;
  h.privacy.mockReset().mockResolvedValue(undefined);
  h.choose.mockReset().mockImplementation(({ success }) => { success(point); });
});

describe('native map selection boundary', () => {
  it('accepts callback-only WeChat and rounds coordinates for shared contracts', async () => {
    await expect(chooseMapPlace({ guard() {} })).resolves.toEqual({ source: 'wechat_choose_location', name: '月亮湾', address: '苏州', location: { latitude: 31.234568, longitude: 120.123457, crs: 'GCJ-02' } });
    expect(h.choose.mock.calls[0][0]).not.toHaveProperty('latitude');
  });
  it('also accepts a promise-only platform implementation and preserves the selected center', async () => {
    h.choose.mockResolvedValue(point);
    await chooseMapPlace({ guard() {}, center: { latitude: 31, longitude: 120, crs: 'GCJ-02' } });
    expect(h.choose).toHaveBeenCalledWith(expect.objectContaining({ latitude: 31, longitude: 120 }));
  });
  it('cancels without inventing a selection and permits the next attempt', async () => {
    h.choose.mockImplementation(({ fail }) => fail({ errMsg: 'chooseLocation:fail cancel' }));
    await expect(chooseMapPlace({ guard() {} })).resolves.toBeNull();
    await expect(chooseMapPlace({ guard() {} })).resolves.toBeNull();
  });
  it.each([
    ['chooseLocation:fail auth deny', 'LOCATION_PERMISSION_DENIED'],
    ['chooseLocation:fail api needs to be declared', 'MAP_PICKER_NOT_CONFIGURED'],
    ['chooseLocation:fail SECRET_RAW_RESPONSE', 'MAP_PICKER_FAILED'],
  ])('maps %s to a safe failure', async (errMsg, code) => {
    h.choose.mockRejectedValue({ errMsg });
    await expect(chooseMapPlace({ guard() {} })).rejects.toMatchObject({ code });
  });
  it.each([{ ...point, latitude: NaN }, { ...point, longitude: 200 }, { ...point, name: '' }])('rejects invalid native data', async invalid => {
    h.choose.mockResolvedValue(invalid);
    await expect(chooseMapPlace({ guard() {} })).rejects.toMatchObject({ code: 'MAP_PICKER_INVALID_RESULT' });
  });
  it('does not open the map when privacy was declined', async () => {
    h.privacy.mockRejectedValue(Error('declined'));
    await expect(chooseMapPlace({ guard() {} })).rejects.toThrow('declined');
    expect(h.choose).not.toHaveBeenCalled();
  });
  it('discards a result after the caller becomes invalid', async () => {
    let active = true;
    h.choose.mockImplementation(({ success }) => { active = false; success(point); });
    await expect(chooseMapPlace({ guard() { if (!active) throw Error('stale'); } })).rejects.toThrow('stale');
  });
  it('rechecks the caller after privacy and before opening the map', async () => {
    let active = true;
    h.privacy.mockImplementation(async () => { active = false; });
    await expect(chooseMapPlace({ guard() { if (!active) throw Error('stale'); } })).rejects.toThrow('stale');
    expect(h.choose).not.toHaveBeenCalled();
  });
  it('blocks overlapping native screens until the first finishes', async () => {
    let finish!: () => void;
    h.choose.mockImplementation(({ success }) => { finish = () => success(point); });
    const first = chooseMapPlace({ guard() {} });
    await Promise.resolve();
    await expect(chooseMapPlace({ guard() {} })).rejects.toMatchObject({ code: 'MAP_PICKER_BUSY' });
    finish();
    await first;
  });
  it('reports an unavailable API before requesting privacy', async () => {
    h.available = false;
    await expect(chooseMapPlace({ guard() {} })).rejects.toMatchObject({ code: 'MAP_PICKER_UNAVAILABLE' });
    expect(h.privacy).not.toHaveBeenCalled();
  });
});

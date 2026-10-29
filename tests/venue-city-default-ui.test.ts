// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { SegmentForm } from '../apps/miniprogram/src/features/activity-create/form';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ transport: vi.fn(), storage: vi.fn(), location: vi.fn(), select: vi.fn(), map: vi.fn(), privacy: vi.fn(), token: 'offline-fixture-session', page: {}, pages: [] as object[], hide: [] as (() => void)[], show: [] as (() => void)[], unload: [] as (() => void)[] }));
vi.mock('../apps/miniprogram/src/platform/api', async () => {
  const { createApiClient } = await import('../packages/api-client/src');
  return { api: createApiClient(h.transport, () => h.token), getToken: () => h.token };
});
vi.mock('../apps/miniprogram/src/platform/location-permission', () => ({ requirePrivacyPermission: h.privacy }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({
  default: { getStorageSync: h.storage, getFuzzyLocation: h.location, openLocation: h.location, chooseLocation: h.map, getCurrentPages: () => h.pages },
  useDidHide: (fn: () => void) => h.hide.push(fn),
  useDidShow: (fn: () => void) => h.show.push(fn), useUnload: (fn: () => void) => h.unload.push(fn),
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  Button: (p: any) => createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children),
  View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children),
  Input: (p: any) => createElement('input', { 'aria-label': p.ariaLabel, value: p.value, disabled: p.disabled,
    onInput: (e: any) => p.onInput({ detail: { value: e.currentTarget.value } }) }),
}));
import { VenuePicker } from '../apps/miniprogram/src/features/activity-create/venue-picker';
import { emptySegment } from '../apps/miniprogram/src/features/activity-create/form';
import { COMMON_CITIES } from '../apps/miniprogram/src/features/shell/helpers';
const source = { provider: 'amap' as const, checked_at: '2026-10-26T00:00:00Z', source_api: 'https://restapi.amap.com/v5/place/text' as const };
let root: ReturnType<typeof createRoot> | undefined;
beforeEach(() => {
  h.storage.mockReset().mockReturnValue('杭州'); h.location.mockReset(); h.select.mockReset(); h.hide = [];
  h.show = []; h.unload = []; h.pages = [h.page]; h.token = 'offline-fixture-session';
  h.privacy.mockReset().mockResolvedValue(undefined); h.map.mockReset();
  h.transport.mockReset().mockResolvedValue({ status: 200, body: { source, venues: [], excluded_count: 0, pagination: false } });
});

describe('public form native map selection', () => {
  const nativePlace = { name: '月亮湾', address: '苏州测试地址', latitude: 31.1234567, longitude: 120.1234567 };
  it('opens only after click and passes a typed source without fabricating AMap metadata', async () => {
    h.map.mockImplementation(({ success }) => success(nativePlace));
    await render(); expect(h.map).not.toHaveBeenCalled(); await click('地图选择地点');
    expect(h.select).toHaveBeenCalledExactlyOnceWith({ name: nativePlace.name, address: nativePlace.address,
      location: { latitude: 31.123457, longitude: 120.123457, crs: 'GCJ-02' }, source: { provider: 'wechat', source_api: 'wx.chooseLocation' } });
    expect(h.transport).not.toHaveBeenCalled();
  });
  it('starts from the original selected coordinates and cancellation does not overwrite them', async () => {
    h.map.mockImplementation(({ fail }) => fail({ errMsg: 'chooseLocation:fail cancel' }));
    const segment = emptySegment(); segment.place = '原场地'; segment.address = '原地址';
    segment.venue = { name: segment.place, address: segment.address, location: { latitude: 31, longitude: 120, crs: 'GCJ-02' }, source };
    await render(segment); await click('重新选择地点');
    expect(h.map).toHaveBeenCalledWith(expect.objectContaining({ latitude: 31, longitude: 120 }));
    expect(h.select).not.toHaveBeenCalled(); expect(segment.place).toBe('原场地');
  });
  it('waits for the native map to return before applying a selection', async () => {
    let finish!: (value: typeof nativePlace) => void;
    h.map.mockImplementation(({ success }) => { finish = success; });
    await render(); await click('地图选择地点');
    // The latest two registrations are the map hook and the normal search guard.
    await act(async () => h.hide.slice(-2).forEach(fn => fn()));
    await act(async () => finish(nativePlace)); expect(h.select).not.toHaveBeenCalled();
    await act(async () => h.show.at(-1)!()); expect(h.select).toHaveBeenCalledOnce();
  });
  it.each(['token', 'page', 'disabled', 'unload'])('rejects an obsolete native result after %s changes', async reason => {
    let finish!: (value: typeof nativePlace) => void;
    h.map.mockImplementation(({ success }) => { finish = success; });
    await render(); await click('地图选择地点');
    if (reason === 'token') h.token = 'other-account';
    if (reason === 'page') h.pages = [{}];
    if (reason === 'disabled') await render(emptySegment(), true);
    if (reason === 'unload') await act(async () => h.unload.at(-1)!());
    await act(async () => finish(nativePlace)); expect(h.select).not.toHaveBeenCalled();
  });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
async function render(segment: SegmentForm = emptySegment(), disabled = false, key = 'new-picker') {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(createElement(VenuePicker, { key, segment, disabled, onSelect: h.select })));
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(node => node.textContent === label);
  expect(button).toBeTruthy(); await act(async () => button!.click());
}
function field(label: string): HTMLInputElement { return document.querySelector(`[aria-label="${label}"]`)!; }
async function input(label: string, value: string) {
  await act(async () => { field(label).value = value; field(label).dispatchEvent(new Event('input', { bubbles: true })); });
}
async function open() { await click('从高德搜索地点'); }
function expectNoAutomaticAction() {
  expect(h.location).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled();
}
describe('selected city is only a new venue-search default', () => {
  it.each(COMMON_CITIES)('uses the selected preset %s when a new picker opens', async city => {
    h.storage.mockReturnValue(city); await render(); await open();
    expect(field('在哪个城市找').value).toBe(city); expect(h.storage).toHaveBeenCalledWith('weevibe_selected_city'); expectNoAutomaticAction();
  });
  it('trims a valid searched city without fabricating location coordinates', async () => {
    h.storage.mockReturnValue('  西安  '); await render(); await open();
    expect(field('在哪个城市找').value).toBe('西安'); expectNoAutomaticAction();
  });
  it.each([undefined, null, '', '   ', 42, false, { city: '杭州' }, ['杭州'], '<script>', '杭州\n上海', '城'.repeat(31)])('ignores invalid stored city %#', async value => {
    h.storage.mockReturnValue(value); await render(); await open();
    expect(field('在哪个城市找').value).toBe(''); expectNoAutomaticAction();
  });
  it('survives storage read failures and leaves the field honestly empty', async () => {
    h.storage.mockImplementation(() => { throw new Error('fixture storage unavailable'); }); await render(); await open();
    expect(field('在哪个城市找').value).toBe(''); expect(document.body.textContent).not.toContain('已定位'); expectNoAutomaticAction();
  });
  it('sends the chosen default only on an explicit keyword search using the existing authenticated API', async () => {
    await render(); await open(); await input('地点或场馆关键词', '羽毛球'); await click('搜索地点');
    expect(h.transport).toHaveBeenCalledTimes(1); expect(h.transport.mock.calls[0][0]).toMatchObject({
      method: 'POST', path: '/api/v1/venues/search', headers: { Authorization: 'Bearer offline-fixture-session' },
      body: { region: '杭州', keyword: '羽毛球', page_size: 5 },
    });
    expect(h.location).not.toHaveBeenCalled(); expect(h.select).not.toHaveBeenCalled();
  });
  it('retains an edited city across storage changes, rerenders, hide and reopening', async () => {
    const segment = emptySegment(); await render(segment); await open(); await input('在哪个城市找', '苏州');
    h.storage.mockReturnValue('深圳'); await render({ ...segment, name: '编辑中的环节' });
    await act(async () => h.hide.at(-1)!()); await click('收起地点搜索'); await open();
    expect(field('在哪个城市找').value).toBe('苏州'); expect(h.storage).toHaveBeenCalledTimes(1); expectNoAutomaticAction();
  });
  it('does not refill a city the user deliberately cleared', async () => {
    await render(); await open(); await input('在哪个城市找', ''); h.storage.mockReturnValue('南京'); await render();
    await click('收起地点搜索'); await open(); expect(field('在哪个城市找').value).toBe('');
    await input('地点或场馆关键词', '羽毛球'); await click('搜索地点');
    expect(document.body.textContent).toContain('请填写城市和地点关键词'); expectNoAutomaticAction();
  });
  it('takes a changed city only on a newly mounted picker, never overwriting an existing default', async () => {
    await render(); h.storage.mockReturnValue('深圳'); await open(); expect(field('在哪个城市找').value).toBe('杭州');
    await render(emptySegment(), false, 'another-new-picker'); await open(); expect(field('在哪个城市找').value).toBe('深圳');
    expect(h.storage).toHaveBeenCalledTimes(2); expectNoAutomaticAction();
  });
  it('preserves existing venue, address and manual place when opening or changing the search region', async () => {
    const segment = emptySegment(); segment.place = '原地点'; segment.address = '原地址'; segment.venue = {
      name: '原地点', address: '原地址', location: { longitude: 121, latitude: 31, crs: 'GCJ-02' }, source,
    };
    const before = structuredClone(segment); await render(segment); await open(); await input('在哪个城市找', '上海');
    expect(field('地点或场馆关键词').value).toBe('原地点'); expect(segment).toEqual(before);
    expect(document.body.textContent).toContain('已选高德地点：原地址'); expectNoAutomaticAction();
  });
  it('does not open, search or choose a venue when the existing editor is disabled', async () => {
    await render(emptySegment(), true); await open(); expect(field('在哪个城市找')).toBeNull(); expectNoAutomaticAction();
  });
});

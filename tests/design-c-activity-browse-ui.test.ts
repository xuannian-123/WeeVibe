// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { AccountActivityRecord } from '../packages/contracts/src';
import { emptyAccountFixture } from './account-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act, useRef, useEffect } = req('react'), { createRoot } = req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token: 'A', ticks: [] as (() => void)[], scroll: undefined as undefined | ((event: { scrollTop: number }) => void), scrollTo: vi.fn(), changed: vi.fn(), more: vi.fn(), open: vi.fn(), shows: new Set<() => void>(), hides: new Set<() => void>() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token }));
function nativeHandler(callback: () => void, target: Set<() => void>) { const latest = useRef(callback); latest.current = callback; useEffect(() => { const run = () => latest.current(); target.add(run); return () => target.delete(run); }, []); }
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { nextTick: (fn: () => void) => h.ticks.push(fn), pageScrollTo: h.scrollTo }, usePageScroll: (fn: typeof h.scroll) => { h.scroll = fn; }, useDidShow: (fn: () => void) => nativeHandler(fn, h.shows), useDidHide: (fn: () => void) => nativeHandler(fn, h.hides) }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({ View: (p: any) => createElement('div', { className: p.className }, p.children), Text: (p: any) => createElement('span', { className: p.className }, p.children), Image: () => createElement('img'), Button: (p: any) => createElement('button', { className: p.className, onClick: p.onClick, disabled: p.disabled, 'aria-label': p.ariaLabel }, p.children), ScrollView: (p: any) => createElement('div', { className: p.className, 'data-scroll-x': p.scrollX }, p.children) }));
import { CActivityOverview, type CActivityBrowseState } from '../apps/miniprogram/src/features/design-c/activity-overview';
let host: HTMLDivElement, root: any;
function record(id: number, extra: Partial<AccountActivityRecord> = {}): AccountActivityRecord { return { activity_id: `${String(id).padStart(8, '0')}-3333-4333-8333-333333333333`, title: `活动${id}`, timezone: 'Asia/Shanghai', starts_at: '2030-01-01T10:00:00Z', ends_at: '2030-01-01T12:00:00Z', phase: 'upcoming', time_scope: 'activity', location: '示例场地', cancelled: false, participation_cancelled: false, is_manager: false, joined_segment_count: 0, pending_application_count: 0, exited_segment_count: 0, awaiting_acceptance: false, ...extra }; }
const account = () => ({ ...emptyAccountFixture(), activity_records: [record(1, { is_manager: true }), record(2, { pending_application_count: 1 }), record(3, { joined_segment_count: 1 }), record(4, { is_manager: true, phase: 'ended' })] });
async function render(extra: Record<string, unknown> = {}) { await act(async () => root.render(createElement(CActivityOverview, { session: h.token, account: account(), initialGroup: 'all', preparations: [], busy: false, error: '', refresh: () => {}, openActivity: h.open, openPreparation: h.open, back: () => {}, more: h.more, browseChanged: h.changed, ...extra }))); }
async function ticks() { await act(async () => { for (let i = 0; i < 8; i++) { h.ticks.splice(0).forEach(fn => fn()); await Promise.resolve(); } }); }
async function click(text: string) { const button = Array.from(host.querySelectorAll('button')).find(node => node.textContent === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()); }
async function scroll(value: number) { await act(async () => h.scroll?.({ scrollTop: value })); }
const snapshot = (): CActivityBrowseState => h.changed.mock.calls.at(-1)![0];
const selected = (selector: string) => host.querySelector(`${selector} .c-selected`)?.textContent;
beforeEach(() => { h.token = 'A'; h.ticks = []; h.scroll = undefined; h.shows.clear(); h.hides.clear(); h.scrollTo.mockReset().mockImplementation(async ({ scrollTop }) => { h.scroll?.({ scrollTop: 0 }); h.scroll?.({ scrollTop }); }); h.changed.mockReset(); h.open.mockReset(); h.more.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });

describe('C activity browser: independent groups and owner-bound restoration', () => {
  it('keeps each group filter and offset, ignoring restore-generated scroll events', async () => {
    await render(); await ticks(); await click('未开始'); await ticks(); await scroll(480);
    await click('我参与的'); await scroll(999); await ticks(); await click('待审批'); await ticks(); await scroll(210);
    await click('我组织的'); await ticks();
    expect(selected('.c-activity-tabs')).toBe('我组织的'); expect(selected('.c-activity-filters')).toBe('未开始');
    expect(h.scrollTo).toHaveBeenLastCalledWith({ scrollTop: 480, duration: 0 });
    expect(snapshot().groups).toEqual({ managed: { filter: '未开始', scroll: 480 }, joined: { filter: '待审批', scroll: 210 } });
    await click('我参与的'); await ticks(); expect(selected('.c-activity-filters')).toBe('待审批'); expect(h.scrollTo).toHaveBeenLastCalledWith({ scrollTop: 210, duration: 0 });
  });
  it('publishes before More and restores the same owner snapshot after remount', async () => {
    await render(); await ticks(); await click('我参与的'); await ticks(); await click('待审批'); await ticks(); await scroll(336); await click('更多 ⋯');
    const saved = snapshot(); expect(h.more).toHaveBeenCalledOnce();
    await act(async () => root.render(null)); await render({ initialBrowse: saved }); await ticks();
    expect(selected('.c-activity-tabs')).toBe('我参与的'); expect(selected('.c-activity-filters')).toBe('待审批'); expect(h.scrollTo).toHaveBeenLastCalledWith({ scrollTop: 336, duration: 0 });
  });
  it('resets only the active group offset after changing a filter', async () => {
    await render(); await ticks(); await scroll(120); await click('我参与的'); await ticks(); await scroll(80); await click('待审批'); await ticks();
    expect(snapshot().groups).toEqual({ managed: { filter: '全部', scroll: 120 }, joined: { filter: '待审批', scroll: 0 } });
    expect(h.scrollTo).toHaveBeenLastCalledWith({ scrollTop: 0, duration: 0 });
  });
  it('does not run a queued restore after the token changes and rejects a foreign snapshot', async () => {
    const saved: CActivityBrowseState = { session: 'A', group: 'joined', groups: { managed: { filter: '未开始', scroll: 900 }, joined: { filter: '待审批', scroll: 650 } } };
    await render({ initialBrowse: saved }); h.token = 'B'; h.scrollTo.mockClear(); h.changed.mockClear(); await ticks(); await scroll(1000);
    expect(h.scrollTo).not.toHaveBeenCalled(); expect(h.changed).not.toHaveBeenCalled();
    await render({ initialBrowse: saved }); await ticks(); expect(selected('.c-activity-tabs')).toBe('我组织的'); expect(selected('.c-activity-filters')).toBe('全部'); expect(h.scrollTo).toHaveBeenLastCalledWith({ scrollTop: 0, duration: 0 }); expect(snapshot().session).toBe('B');
  });
  it('cancels a pending restore on hide and restores the saved offset on native return', async () => {
    await render(); await ticks(); await scroll(420); await act(async () => h.hides.forEach(fn => fn())); h.scrollTo.mockClear(); await scroll(0); await ticks(); expect(h.scrollTo).not.toHaveBeenCalled(); expect(snapshot().groups.managed.scroll).toBe(420);
    await act(async () => h.shows.forEach(fn => fn())); await ticks(); expect(h.scrollTo).toHaveBeenLastCalledWith({ scrollTop: 420, duration: 0 });
  });
  it('keeps real status filters, deduplication and activity routes while chips use a horizontal scroller', async () => {
    const data = account(); data.activity_records.push(data.activity_records[0]); await render({ account: data }); await ticks();
    expect(host.querySelectorAll('.c-activity-card')).toHaveLength(2); expect(host.querySelector('.c-activity-filters')?.getAttribute('data-scroll-x')).toBe('true');
    await click('已结束'); await ticks(); expect(host.querySelector('.c-activity-card')?.textContent).toContain('活动4');
    await click('我参与的'); await ticks(); await click('待审批'); await ticks(); expect(host.querySelectorAll('.c-activity-card')).toHaveLength(1); expect(host.textContent).toContain('申请待审批 · 不占席位');
    await act(async () => (host.querySelector('.c-activity-card') as HTMLElement).click()); expect(h.open).toHaveBeenCalledWith(data.activity_records[1].activity_id);
  });
});

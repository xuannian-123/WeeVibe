// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { AccountActivityRecord } from '../packages/contracts/src';
const requireMini = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = requireMini('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ token: 'session-a' as string | undefined, request: vi.fn(), me: vi.fn(), open: vi.fn(), relaunch: vi.fn(), onShow: undefined as (() => void) | undefined }));
// Focus this historical suite on the original account boundary. Actual Home +
// real TodoPanel lifecycle/account isolation is exercised in todos-ui.test.ts.
vi.mock('../apps/miniprogram/src/features/todos/TodoPanel', () => ({ TodoPanel: () => null }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => mocks.token, api: { me: mocks.me }, establishSession: vi.fn(), forgetSession: () => { mocks.token = undefined; } }));
vi.mock('../apps/miniprogram/src/platform/avatar', () => ({ loadAvatar: vi.fn(async () => undefined) }));
vi.mock('../apps/miniprogram/src/platform/extension-api', () => ({ extensionRequest: mocks.request }));
vi.mock('../apps/miniprogram/src/features/team', () => ({ TeamCreate: () => null }));
vi.mock('../apps/miniprogram/src/features/shell/inspiration', () => ({ Inspiration: () => null }));
vi.mock('../apps/miniprogram/src/features/shell/profile', () => ({ ProfileForm: () => null }));
// Native location lifecycle behavior is exercised with all registered handlers in native-location-ui.test.ts.
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { getStorageSync: () => '', setStorageSync: vi.fn(), navigateTo: mocks.open, reLaunch: mocks.relaunch }, useDidShow: (cb: () => void) => { mocks.onShow = cb; }, useDidHide: () => {}, useUnload: () => {} }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  Button: (p: Record<string, unknown>) => createElement('button', { onClick: p.onClick, disabled: p.disabled, className: p.className }, p.children as never),
  Text: (p: Record<string, unknown>) => createElement('span', { className: p.className, onClick: p.onClick }, p.children as never),
  View: (p: Record<string, unknown>) => createElement('div', { onClick: p.onClick, className: p.className }, p.children as never),
  Input: () => createElement('input'), Image: () => createElement('img')
}));
import { AccountActivityList } from '../apps/miniprogram/src/features/shell/activity-list';
import Home from '../apps/miniprogram/src/pages/index';
function record(num: number, extra: Partial<AccountActivityRecord> = {}): AccountActivityRecord {
  return { activity_id: `${String(num).padStart(8, '0')}-3333-4333-8333-333333333333`, title: `活动-${num}`, timezone: 'Asia/Shanghai', starts_at: '2030-01-02T00:00:00.000Z', ends_at: '2030-01-02T02:00:00.000Z', phase: 'upcoming', time_scope: 'activity', location: '公开场地', cancelled: false, participation_cancelled: false, is_manager: false, joined_segment_count: 0, exited_segment_count: 0, pending_application_count: 0, awaiting_acceptance: false, ...extra };
}
let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); mocks.token = 'session-a'; mocks.request.mockReset(); mocks.me.mockReset().mockResolvedValue({ user_id: '11111111-1111-4111-8111-111111111111' }); mocks.open.mockReset(); mocks.relaunch.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
const render = (records: AccountActivityRecord[], initialFilter?: 'joined') => act(async () => root.render(createElement(AccountActivityList, { records, initialFilter, onOpen: mocks.open })));
async function click(text: string) { const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()); }
const cards = () => Array.from(host.querySelectorAll('.activity-card'));
const home = async (data: unknown) => { mocks.request.mockResolvedValue(data); await act(async () => root.render(createElement(Home))); await act(async () => { mocks.onShow?.(); await Promise.resolve(); }); };
describe('account activity role/status UI (React + Taro mocks, not native WeChat)', () => {
  it('finds all four relationships with filters while manager/participant overlap stays one card', async () => {
    const joined = record(1, { is_manager: true, joined_segment_count: 1, time_scope: 'participation' }), pending = record(2, { pending_application_count: 1 }), exited = record(3, { exited_segment_count: 1 });
    await render([joined, joined, pending, exited]); expect(cards()).toHaveLength(3);
    await click('我在管理'); expect(cards()).toHaveLength(1); expect(cards()[0].textContent).toContain('活动-1');
    await click('待审批'); expect(cards()).toHaveLength(1); expect(cards()[0].textContent).toContain('申请待审批 · 不占席位'); expect(cards()[0].textContent).toContain('未开始'); expect(cards()[0].textContent).not.toContain('待参加');
    await click('退出记录'); expect(cards()[0].textContent).toContain('已退出'); expect(cards()[0].textContent).not.toContain('已结束');
    await click('全部'); expect(cards()).toHaveLength(3);
  });
  it('keeps required three calendar labels for actually joined activities', async () => {
    await render([record(1, { joined_segment_count: 1 }), record(2, { joined_segment_count: 1, phase: 'ongoing' }), record(3, { joined_segment_count: 1, phase: 'ended' })]);
    expect(Array.from(host.querySelectorAll('.wv-status')).map(e => e.textContent)).toEqual(['待参加', '活动中', '已结束']);
  });
  it('labels cancellation and partial exit without turning them into ordinary completion or approval', async () => {
    await render([record(1, { cancelled: true, pending_application_count: 1 }), record(2, { joined_segment_count: 1, exited_segment_count: 1 })]);
    expect(cards()[0].textContent).toContain('已取消'); expect(cards()[0].textContent).not.toContain('已结束'); expect(cards()[0].textContent).toContain('申请待审批');
    expect(cards()[1].textContent).toContain('部分环节已退出'); expect(cards()[1].textContent).toContain('已参加 1 个环节');
  });
  it('defaults My Activities to joined and card navigation only opens the actual activity ID', async () => {
    const joined = record(1, { joined_segment_count: 1 }); await render([joined, record(2, { is_manager: true })], 'joined');
    expect(cards()).toHaveLength(1); await act(async () => (cards()[0] as HTMLElement).click()); expect(mocks.open).toHaveBeenCalledWith(joined.activity_id);
    await click('我在管理'); await click('我在管理'); expect(cards()).toHaveLength(1); expect(cards()[0].textContent).toContain('活动-2');
  });
  it('integrates the new account field on GO without promoting pending to legacy participation', async () => {
    await home({ favorites: [], profile: {}, activities: [], activity_records: [record(1, { is_manager: true }), record(2, { pending_application_count: 1 })], invitations: [], messages: [] });
    expect(cards()).toHaveLength(2); expect(host.textContent).toContain('我在管理'); expect(host.textContent).not.toContain('当前后端仅提供');
    await click('待审批'); await act(async () => (cards()[0] as HTMLElement).click()); expect(mocks.open).toHaveBeenCalledWith({ url: '/pages/activity/index?id=00000002-3333-4333-8333-333333333333' });
  });
  it('older backend falls back only to real joined activities with an explicit incomplete-list warning', async () => {
    await home({ favorites: [], profile: {}, activities: [{ activity_id: record(1).activity_id, title: '旧后端已参加', starts_at: record(1).starts_at, ends_at: record(1).ends_at, timezone: 'Asia/Shanghai', status: '待参加', location: '场地' }], invitations: [], messages: [] });
    expect(host.textContent).toContain('旧后端已参加'); expect(host.textContent).toContain('不能视为完整列表'); expect(host.textContent).not.toContain('申请待审批 · 不占席位');
  });
  it('logout clears previous account lists rather than exposing them to the next session', async () => {
    await home({ favorites: [], profile: { nickname: '前账号' }, activities: [], activity_records: [record(1, { is_manager: true })], invitations: [], messages: [] });
    await click('○我的'); await click('⚙ 设置'); await click('退出登录'); await click('↗GO');
    expect(host.textContent).not.toContain('活动-1'); expect(host.textContent).toContain('微信登录'); expect(mocks.relaunch).toHaveBeenCalledWith({ url: '/pages/index/index' });
  });
});

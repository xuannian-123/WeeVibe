// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { AccountActivityRecord } from '../packages/contracts/src';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const React = req('react'), { createElement, act } = React;
const { createRoot } = req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token: 'session-a' as string | undefined, extension: vi.fn(), me: vi.fn(), login: vi.fn(), navigate: vi.fn(), back: vi.fn(), redirect: vi.fn(), permissions: vi.fn(), scroll: vi.fn(), show: new Set<() => void>(), hide: new Set<() => void>(), pageScroll: new Set<(e: { scrollTop: number }) => void>() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token, api: { me: h.me }, establishSession: h.login, forgetSession: () => { h.token = undefined; } }));
vi.mock('../apps/miniprogram/src/platform/extension-api', () => ({ extensionRequest: h.extension }));
vi.mock('../apps/miniprogram/src/platform/avatar', () => ({ loadAvatar: vi.fn(async () => undefined) }));
vi.mock('../apps/miniprogram/src/platform/navigation-api', () => ({ requestInbox: vi.fn(async () => ({ messages: [], unread_count: 0, pending_count: 0, server_time: '2030-01-01T00:00:00Z', limit: 100 })) }));
vi.mock('../apps/miniprogram/src/features/gatherings/client', () => ({ readGatheringList: vi.fn(async () => ({ gatherings: [] })), gatheringMessage: () => '筹备读取失败' }));
vi.mock('../apps/miniprogram/src/features/shell/inspiration', () => ({ Inspiration: () => null }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => {
  const hook = (handlers: Set<(...args: any[]) => void>, callback: (...args: any[]) => void) => { const ref = React.useRef(callback); ref.current = callback; React.useEffect(() => { const run = (...args: any[]) => ref.current(...args); handlers.add(run); return () => handlers.delete(run); }, []); };
  return { default: { getStorageSync: () => '', setStorageSync: vi.fn(), navigateTo: h.navigate, navigateBack: h.back, redirectTo: h.redirect, openSetting: h.permissions, pageScrollTo: h.scroll, nextTick: (callback: () => void) => callback() }, useDidShow: (callback: () => void) => hook(h.show, callback), useDidHide: (callback: () => void) => hook(h.hide, callback), useUnload: () => {}, usePageScroll: (callback: (event: { scrollTop: number }) => void) => hook(h.pageScroll, callback) };
});
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  View: (p: any) => createElement('div', { className: p.className, onClick: p.onClick }, p.children),
  ScrollView: (p: any) => createElement('div', { className: p.className }, p.children),
  Text: (p: any) => createElement('span', { className: p.className, onClick: p.onClick }, p.children),
  Button: (p: any) => createElement('button', { className: p.className, 'aria-label': p.ariaLabel, disabled: p.disabled, onClick: p.onClick }, p.children),
  Input: (p: any) => createElement('input', { value: p.value, disabled: p.disabled, placeholder: p.placeholder, onInput: (e: any) => p.onInput?.({ detail: { value: e.currentTarget.value } }) }),
  Image: () => null,
}));
import Home from '../apps/miniprogram/src/pages/index/index';
import { clearCActivityBrowse } from '../apps/miniprogram/src/features/design-c/account-navigation';
import { resumeAutomaticLogin } from '../apps/miniprogram/src/platform/automatic-session';
import { ApiClientError } from '../packages/api-client/src';
import { accountActor, accountActivity, emptyAccountFixture } from './account-fixtures';

let host: HTMLDivElement, root: ReturnType<typeof createRoot>, serial = 0;
beforeEach(() => {
  h.token = 'session-a'; h.show.clear(); h.hide.clear(); h.pageScroll.clear();
  h.extension.mockReset().mockResolvedValue(emptyAccountFixture()); h.me.mockReset().mockResolvedValue({ user_id: accountActor }); h.login.mockReset();
  for (const mock of [h.navigate, h.back, h.redirect, h.permissions, h.scroll]) mock.mockReset().mockResolvedValue({});
  clearCActivityBrowse(); resumeAutomaticLogin(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function mount(routePage?: string, show = true) {
  await act(async () => root.render(createElement(Home, { key: ++serial, ...(routePage ? { routePage } : {}) })));
  if (show) await act(async () => { h.show.forEach(callback => callback()); await Promise.resolve(); });
}
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text); expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}
async function clickLabel(label: string) { const button = host.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function input(value: string) { const field = host.querySelector('input')!; await act(async () => { field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); }); }
const item = (extra: Partial<AccountActivityRecord> = {}): AccountActivityRecord => ({ activity_id: accountActivity, title: '待审批活动', timezone: 'Asia/Shanghai', starts_at: null, ends_at: null, phase: 'upcoming', time_scope: 'activity', location: '', cancelled: false, participation_cancelled: false, is_manager: false, joined_segment_count: 0, exited_segment_count: 0, pending_application_count: 1, awaiting_acceptance: false, ...extra });

it('uses real subpage navigation and returns to each activity filter and scroll position', async () => {
  const account = { ...emptyAccountFixture(), activity_records: [item(), item({ activity_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: '仅组织活动', is_manager: true, pending_application_count: 0 })] };
  h.extension.mockResolvedValue(account); await mount('activities'); await click('我参与的'); await click('待审批');
  await act(async () => h.pageScroll.forEach(callback => callback({ scrollTop: 246 })));
  await click('更多 ⋯'); expect(host.querySelector('.c-more-menu')).not.toBeNull(); await click('已保存邀请');
  expect(h.navigate).toHaveBeenLastCalledWith({ url: '/pages/account/index?page=invitations' }); expect(host.querySelector('.c-more-menu')).toBeNull();
  await mount('invitations'); expect(host.querySelector('.c-navigation')).toBeNull(); await clickLabel('返回'); expect(h.back).toHaveBeenCalledOnce();
  await mount('activities'); expect(host.querySelector('.c-activity-filters .c-selected')?.textContent).toBe('待审批');
  expect(host.textContent).toContain('待审批活动'); expect(host.textContent).not.toContain('仅组织活动'); expect(h.scroll).toHaveBeenCalledWith({ scrollTop: 246, duration: 0 });
});
it('falls back through the real page stack when a return fails, preserving the route family', async () => {
  await mount('number'); h.back.mockRejectedValueOnce(Error('native back failed')); await clickLabel('返回');
  expect(h.redirect).toHaveBeenCalledWith({ url: '/pages/account/index?page=activities' });
});
it('keeps an empty number disabled and rejects invalid input before navigation', async () => {
  await mount('number'); expect(Array.from(host.querySelectorAll('button')).find(b => b.textContent === '查看活动')?.disabled).toBe(true);
  await input('bad/id'); await click('查看活动'); expect(h.navigate).not.toHaveBeenCalled();
  expect(host.textContent).toContain('仅支持字母、数字'); expect(host.querySelector('input')?.value).toBe('bad/id');
});
it('retains a number on native navigation failure, retries explicitly, and blocks duplicate opens', async () => {
  await mount('number'); await input(accountActivity); let reject!: (error: Error) => void;
  h.navigate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; })); await click('查看活动');
  await click('正在打开…'); expect(h.navigate).toHaveBeenCalledTimes(1); await act(async () => reject(Error('native navigation failed')));
  expect(host.textContent).toContain('编号已保留'); expect(host.querySelector('input')?.value).toBe(accountActivity);
  await click('查看活动'); expect(h.navigate).toHaveBeenCalledTimes(2); expect(h.navigate).toHaveBeenLastCalledWith({ url: `/pages/activity/index?id=${accountActivity}` });
});
it('never mistakes an account read failure for an empty invitation list', async () => {
  h.extension.mockRejectedValue(new ApiClientError('UPSTREAM_UNAVAILABLE', '离线读取失败', 503)); await mount('invitations');
  expect(host.textContent).toContain('邀请暂未更新'); expect(host.textContent).toContain('上游服务暂不可用'); expect(host.textContent).not.toContain('暂无已保存邀请');
  h.extension.mockResolvedValue(emptyAccountFixture()); await click('重试'); expect(host.textContent).toContain('暂无已保存邀请');
});
it('calls native permissions and retains the privacy page with a truthful failure', async () => {
  await mount('privacy'); h.permissions.mockRejectedValueOnce(Error('native permission panel failed')); await click('管理微信权限');
  expect(h.permissions).toHaveBeenCalledOnce(); expect(host.textContent).toContain('微信权限设置暂时无法打开'); expect(host.textContent).toContain('活动内的身份');
  await click('管理微信权限'); expect(h.permissions).toHaveBeenCalledTimes(2);
});
it('opens friend preparations directly from the create menu without a second choice screen', async () => {
  await mount(); await clickLabel('创建活动'); const option = Array.from(host.querySelectorAll('button')).find(b => b.className.includes('c-scene-option') && b.textContent?.includes('朋友出游'))!;
  await act(async () => option.click()); expect(h.navigate).toHaveBeenLastCalledWith({ url: '/pages/gathering/index?new=friend' });
  expect(host.textContent).not.toContain('直接创建安排'); expect(host.querySelector('.c-sheet')).toBeNull();
});
it('locks login while pending and closing the sheet invalidates its source before identity is saved', async () => {
  h.token = undefined; await mount(undefined, false); await clickLabel('创建活动');
  const option = Array.from(host.querySelectorAll('button')).find(b => b.className.includes('c-scene-option') && b.textContent?.includes('朋友出游'))!; await act(async () => option.click());
  let finish!: () => void;
  h.login.mockImplementationOnce((guard: () => void) => new Promise((resolve, reject) => { finish = () => { try { guard(); h.token = 'session-new'; resolve({ user_id: accountActor }); } catch (error) { reject(error); } }; }));
  const login = host.querySelector('.c-sheet-footer button') as HTMLButtonElement; expect(login).toBeTruthy(); await act(async () => login.click()); expect(h.login).toHaveBeenCalledOnce(); await click('正在登录…'); expect(h.login).toHaveBeenCalledOnce();
  await clickLabel('关闭弹层'); await act(async () => finish()); expect(h.token).toBeUndefined(); expect(h.me).not.toHaveBeenCalled(); expect(h.navigate).not.toHaveBeenCalled(); expect(host.querySelector('.c-sheet')).toBeNull();
});
it('rejects a delayed login if the session changed before its guarded identity commit', async () => {
  h.token = undefined; await mount(undefined, false); await click('微信登录'); let finish!: () => void;
  h.login.mockImplementationOnce((guard: () => void) => new Promise((resolve, reject) => { finish = () => { try { guard(); h.token = 'wrong-late-account'; resolve({ user_id: accountActor }); } catch (error) { reject(error); } }; }));
  const login = Array.from(host.querySelectorAll('button')).find(b => b.closest('.c-sheet-footer') && b.textContent === '微信登录')!; await act(async () => login.click());
  h.token = 'session-b'; await act(async () => finish()); expect(h.token).toBe('session-b'); expect(h.navigate).not.toHaveBeenCalled(); expect(h.me).not.toHaveBeenCalled(); expect(host.textContent).toContain('尚未登录或会话失效');
});

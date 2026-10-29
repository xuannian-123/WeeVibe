// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react');
const { createRoot } = req('react-dom/client');
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: {} }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  View: (p: any) => createElement('div', { className: p.className, onClick: p.onClick }, p.children),
  ScrollView: (p: any) => createElement('div', { className: p.className }, p.children),
  Text: (p: any) => createElement('span', { className: p.className }, p.children),
  Image: (p: any) => createElement('img', { src: p.src, className: p.className }),
  Button: (p: any) => createElement('button', { className: p.className, disabled: p.disabled, onClick: p.onClick, 'aria-label': p.ariaLabel }, p.children),
  Input: (p: any) => createElement('input', { value: p.value, placeholder: p.placeholder, disabled: p.disabled, onChange: (e: any) => p.onInput?.({ detail: { value: e.currentTarget.value } }) }),
}));
import { CInvitationsPage, CLoginSheet, CLogoutDialog, CManualActivityPage, CMoreMenu } from '../apps/miniprogram/src/features/design-c/account-tools';
import type { AccountSnapshot } from '../apps/miniprogram/src/platform/account-api';
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
const render = (component: any, props: any) => act(async () => root.render(createElement(component, props)));
const button = (text: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
const click = (element: Element) => act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const noop = () => {};
const invite: AccountSnapshot['invitations'][number] = { invitation_id: '11111111-1111-4111-8111-111111111111', activity_id: '22222222-2222-4222-8222-222222222222', title: '测试邀请', inviter_display_name: null, inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'Asia/Shanghai', cancelled: false, source_only: true, saved_at: '2030-01-01T00:00:00Z', status: '时间待定', location: '' };

it('does not present an unavailable or loading account as zero invitations', async () => {
  const refresh = vi.fn();
  await render(CInvitationsPage, { busy: true, error: '', back: noop, refresh, openActivity: noop });
  expect(host.textContent).toContain('正在读取已保存邀请'); expect(host.textContent).not.toContain('暂无已保存邀请');
  await render(CInvitationsPage, { busy: false, error: '', back: noop, refresh, openActivity: noop });
  expect(host.textContent).toContain('邀请尚未读取'); await click(button('重新读取')); expect(refresh).toHaveBeenCalledOnce();
  await render(CInvitationsPage, { invitations: [], busy: false, error: '', back: noop, refresh, openActivity: noop });
  expect(host.textContent).toContain('暂无已保存邀请');
});
it('retains cached invitations during an error, labels the stale result, and only opens the activity', async () => {
  const openActivity = vi.fn(), refresh = vi.fn();
  await render(CInvitationsPage, { invitations: [invite], busy: false, error: '离线错误', back: noop, refresh, openActivity });
  expect(host.textContent).toContain('以下为上次读取的邀请'); expect(host.textContent).toContain('地点待定'); expect(host.textContent).toContain('时间待定');
  await click(host.querySelector('.c-saved-invitation')!); expect(openActivity).toHaveBeenCalledExactlyOnceWith(invite.activity_id);
  await click(button('重试')); expect(refresh).toHaveBeenCalledOnce();
});
it('keeps an empty manual entry disabled and preserves the value beside an error or busy state', async () => {
  const open = vi.fn(), common = { change: noop, open, back: noop };
  await render(CManualActivityPage, { ...common, value: '   ', error: '', busy: false });
  expect(button('查看活动').disabled).toBe(true);
  await render(CManualActivityPage, { ...common, value: 'invalid-input', error: '编号不正确', busy: false });
  expect(host.querySelector('input')?.value).toBe('invalid-input'); expect(host.textContent).toContain('编号不正确');
  await click(button('查看活动')); expect(open).toHaveBeenCalledOnce();
  await render(CManualActivityPage, { ...common, value: 'invalid-input', error: '', busy: true });
  expect(button('正在打开…').disabled).toBe(true); expect(host.querySelector('input')?.value).toBe('invalid-input');
});
it('closes the short menu via its backdrop without firing close when an item is selected', async () => {
  const close = vi.fn(), invitations = vi.fn(), manual = vi.fn();
  await render(CMoreMenu, { close, invitations, manual });
  await click(button('已保存邀请')); expect(invitations).toHaveBeenCalledOnce(); expect(close).not.toHaveBeenCalled();
  await click(button('通过编号打开')); expect(manual).toHaveBeenCalledOnce();
  await click(host.querySelector('.c-more-menu-overlay')!); expect(close).toHaveBeenCalledOnce();
  expect(host.querySelector('.c-sheet')).toBeNull();
});
it('requires explicit logout confirmation and supports cancelling without changing the account', async () => {
  const close = vi.fn(), confirm = vi.fn();
  await render(CLogoutDialog, { close, confirm });
  await click(button('取消')); expect(close).toHaveBeenCalledOnce(); expect(confirm).not.toHaveBeenCalled();
  await click(button('退出')); expect(confirm).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('已保存记录不会删除');
});
it('does not repeat logout while busy', async () => {
  const confirm = vi.fn(); await render(CLogoutDialog, { close: noop, confirm, busy: true });
  expect(button('正在退出…').disabled).toBe(true); await click(button('正在退出…')); expect(confirm).not.toHaveBeenCalled();
});
it('uses real login messaging, permits failure retry, and keeps close available while busy', async () => {
  const close = vi.fn(), login = vi.fn();
  await render(CLoginSheet, { close, login, busy: false, error: '登录失败，请重试' });
  expect(host.textContent).not.toContain('进入示例账号'); expect(host.textContent).toContain('不会自动读取你的头像与昵称');
  await click(button('重新登录')); expect(login).toHaveBeenCalledOnce();
  await render(CLoginSheet, { close, login, busy: true, error: '' });
  expect(button('正在登录…').disabled).toBe(true); await click(button('正在登录…')); expect(login).toHaveBeenCalledOnce();
  await click(host.querySelector('[aria-label="关闭弹层"]')!); expect(close).toHaveBeenCalledOnce();
});

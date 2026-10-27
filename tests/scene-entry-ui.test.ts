// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act, useEffect } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({
  token: undefined as string | undefined, params: {} as Record<string, unknown>, transport: vi.fn(), redirect: vi.fn(), back: vi.fn(), me: vi.fn(), login: vi.fn(), forget: vi.fn(), detailMount: vi.fn(), detailUnmount: vi.fn(), actions: new Map<string, () => void>(),
  hide: new Set<() => void>(), show: new Set<() => void>(), unload: new Set<() => void>()
}));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token, transport: h.transport, api: { me: h.me }, establishSession: h.login, forgetSession: h.forget }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => {
  const register = (set: Set<() => void>, fn: () => void) => useEffect(() => { set.add(fn); return () => { set.delete(fn); }; }, [set, fn]);
  return { default: { redirectTo: h.redirect, navigateBack: h.back }, useRouter: () => ({ params: h.params }), useDidHide: (fn: () => void) => register(h.hide, fn), useDidShow: (fn: () => void) => register(h.show, fn), useUnload: (fn: () => void) => register(h.unload, fn) };
});
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children),
  Button: (p: any) => { h.actions.set(p.children, p.onClick); return createElement('button', { disabled: p.disabled, onClick: p.onClick }, p.children); }, Input: () => null
}));
// Preserve the original branch rather than rendering a second native-share controller.
vi.mock('../apps/miniprogram/src/features/activity-detail', () => ({ default: () => { useEffect(() => { h.detailMount(); return () => { h.detailUnmount(); }; }, []); return createElement('div', {}, 'ORIGINAL_DETAIL'); } }));
import ActivityEntry from '../apps/miniprogram/src/features/activity-entry/ActivityEntry';
const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', ACTIVITY = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCENE = SOURCE.replaceAll('-', ''), OTHER_SCENE = OTHER.replaceAll('-', '');
function source(id = SOURCE, activity = ACTIVITY) { return { invitation_id: id, activity_id: activity, title: '公开行程', inviter_display_name: '公开昵称', inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'Asia/Shanghai', cancelled: false, source_only: true }; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
let root: ReturnType<typeof createRoot> | undefined, host: HTMLDivElement;
async function render(params: Record<string, unknown> = h.params) { h.params = params; await act(async () => root!.render(createElement(ActivityEntry))); }
async function fire(set: Set<() => void>) { await act(async () => { for (const fn of [...set]) fn(); }); }
async function click(label: string) { const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label); expect(button).toBeDefined(); await act(async () => button!.click()); }
const button = (label: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === label);
const finish = async <T,>(pending: ReturnType<typeof deferred<T>>, value: T) => { await act(async () => { pending.resolve(value); await Promise.resolve(); }); };
beforeEach(() => {
  h.token = undefined; h.params = { scene: SCENE }; h.transport.mockReset().mockResolvedValue({ status: 200, body: source() }); h.redirect.mockReset().mockResolvedValue({ errMsg: 'redirectTo:ok' }); h.back.mockReset().mockResolvedValue({ errMsg: 'navigateBack:ok' });
  h.me.mockReset(); h.login.mockReset(); h.forget.mockReset(); h.detailMount.mockReset(); h.detailUnmount.mockReset(); h.actions.clear(); h.hide.clear(); h.show.clear(); h.unload.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; host.remove(); expect(h.hide.size).toBe(0); expect(h.show.size).toBe(0); expect(h.unload.size).toBe(0); });
describe('activity scene entry wrapper with real scene client (offline GET)', () => {
  it.each([{}, { id: ACTIVITY }, { id: ACTIVITY, invitation_id: SOURCE }, { id: 'legacy-invalid', extra: 'legacy' }])('keeps ordinary route %j on the unchanged single original detail branch', async params => {
    await render(params); await render(params); expect(host.textContent).toContain('ORIGINAL_DETAIL'); expect(h.detailMount).toHaveBeenCalledTimes(1); expect(h.transport).not.toHaveBeenCalled(); expect(h.redirect).not.toHaveBeenCalled();
  });
  it.each([{ scene: 'bad' }, { scene: SCENE, id: ACTIVITY }, { scene: SCENE, invitation_id: SOURCE }, { scene: SCENE, extra: 'x' }, { scene: [SCENE] }, { scene: undefined }])('rejects malformed/mixed scene %j before GET or original detail', async params => {
    await render(params); expect(host.textContent).toContain('格式无效'); expect(h.transport).not.toHaveBeenCalled(); expect(h.redirect).not.toHaveBeenCalled(); expect(h.detailMount).not.toHaveBeenCalled();
  });
  it.each([undefined, 'session-a'])('opens strict canonical activity/source for %s with no automatic login/me/save/join', async token => {
    h.token = token; await render(); expect(h.transport).toHaveBeenCalledTimes(1); expect(h.transport.mock.calls[0][0]).toEqual({ method: 'GET', path: `/api/v1/invitations/${SOURCE}`, headers: { 'Content-Type': 'application/json' } });
    expect(h.redirect).toHaveBeenCalledExactlyOnceWith({ url: `/pages/activity/index?id=${ACTIVITY}&invitation_id=${SOURCE}` }); expect(h.detailMount).not.toHaveBeenCalled(); expect(h.me).not.toHaveBeenCalled(); expect(h.login).not.toHaveBeenCalled(); expect(h.forget).not.toHaveBeenCalled();
  });
  it('allows cancelled provenance to lead to current detail without claiming seats or source revision', async () => {
    h.transport.mockResolvedValueOnce({ status: 200, body: { ...source(), cancelled: true } }); await render(); expect(h.redirect).toHaveBeenCalledTimes(1); expect(h.redirect.mock.calls[0][0].url).not.toMatch(/revision|version|cancelled/); expect(host.textContent).toContain('不授予席位');
  });
  it.each([
    [404, { error: { code: 'NOT_FOUND', message: 'PRIVATE_SQL' }, request_id: 'fixture' }, '未找到这份邀请来源'],
    [404, '<html>PRIVATE_404</html>', '前后端版本'], [405, '<html>PRIVATE_405</html>', '前后端版本'],
    [503, '<html>PRIVATE_503</html>', '服务暂不可用'], [200, '<html>PRIVATE_200</html>', '响应无法验证'],
    [200, { ...source(), invitation_id: OTHER }, '响应无法验证'], [200, { ...source(), phone: 'PRIVATE_PHONE' }, '响应无法验证']
  ])('shows sanitized recoverable error for HTTP %s and never redirects', async (status, body, text) => {
    h.transport.mockResolvedValueOnce({ status, body }); await render(); expect(host.textContent).toContain(text); expect(host.textContent).not.toContain('PRIVATE'); expect(h.redirect).not.toHaveBeenCalled(); expect(button('重新核验')?.disabled).toBe(false); await click('重新核验'); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it.each(['hide', 'unload', 'unmount'])('stops a late source response after %s', async kind => {
    const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); await render();
    if (kind === 'unmount') { await act(async () => root!.unmount()); root = undefined; } else await fire(kind === 'hide' ? h.hide : h.unload);
    await finish(pending, { status: 200, body: source() }); expect(h.redirect).not.toHaveBeenCalled();
  });
  it('hide then show does not revive old read; explicit retry still works', async () => {
    const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); await render(); await fire(h.hide); await fire(h.show);
    await finish(pending, { status: 200, body: source() }); expect(h.redirect).not.toHaveBeenCalled(); expect(h.transport).toHaveBeenCalledTimes(1); await click('重新核验'); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('cancel stops late redirect without backing out automatically, and permits a new request', async () => {
    const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); await render(); await click('取消打开'); expect(h.back).not.toHaveBeenCalled(); await finish(pending, { status: 200, body: source() }); expect(h.redirect).not.toHaveBeenCalled(); await click('重新核验'); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('explicit back invalidates an ongoing GET before native navigation', async () => {
    const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); await render(); await click('返回'); expect(h.back).toHaveBeenCalledTimes(1); await finish(pending, { status: 200, body: source() }); expect(h.redirect).not.toHaveBeenCalled();
  });
  it('back failure is sanitized and never triggers an automatic fallback navigation', async () => {
    h.back.mockRejectedValueOnce(new Error('PRIVATE_NATIVE')); await render({ scene: 'bad' }); await click('返回'); expect(host.textContent).toContain('返回未完成'); expect(host.textContent).not.toContain('PRIVATE'); expect(h.redirect).not.toHaveBeenCalled();
  });
  it('duplicate retry callbacks share one synchronous lock', async () => {
    h.transport.mockRejectedValueOnce(new Error('fixture')); await render(); const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); const retry = h.actions.get('重新核验')!;
    await act(async () => { retry(); retry(); }); expect(h.transport).toHaveBeenCalledTimes(2); await finish(pending, { status: 200, body: source() }); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('an old finally cannot unlock a replacement request', async () => {
    const first = deferred<any>(), second = deferred<any>(); h.transport.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); await render(); await click('取消打开'); await click('重新核验');
    await finish(first, { status: 200, body: source() }); expect(button('重新核验')?.disabled).toBe(true); await act(async () => h.actions.get('重新核验')!()); expect(h.transport).toHaveBeenCalledTimes(2); await finish(second, { status: 200, body: source() }); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('observed scene A→B→A never revives either older request or retained retry/cancel callbacks', async () => {
    const a = deferred<any>(), b = deferred<any>(), next = deferred<any>(); h.transport.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(next.promise); await render(); const oldCancel = h.actions.get('取消打开')!, oldRetry = h.actions.get('重新核验')!;
    await render({ scene: OTHER_SCENE }); await render({ scene: SCENE }); await act(async () => { oldCancel(); oldRetry(); }); expect(button('重新核验')?.disabled).toBe(true);
    await finish(a, { status: 200, body: source() }); await finish(b, { status: 200, body: source(OTHER) }); expect(h.redirect).not.toHaveBeenCalled(); await finish(next, { status: 200, body: source() }); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('observed session A→B→A cannot revive old responses, or clear any token', async () => {
    const a = deferred<any>(), b = deferred<any>(), next = deferred<any>(); h.transport.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(next.promise); h.token = 'session-a'; await render(); h.token = 'session-b'; await render(); await click('重新核验'); h.token = 'session-a'; await render(); await click('重新核验');
    await finish(a, { status: 200, body: source() }); await finish(b, { status: 401, body: {} }); expect(h.redirect).not.toHaveBeenCalled(); expect(h.forget).not.toHaveBeenCalled(); await finish(next, { status: 200, body: source() }); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('a session change without a prior render suppresses the old result and remains usable', async () => {
    const pending = deferred<any>(), newer = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise).mockReturnValueOnce(newer.promise); h.token = 'session-a'; await render(); h.token = 'session-b'; await finish(pending, { status: 200, body: source() }); expect(h.redirect).not.toHaveBeenCalled();
    expect(h.transport).toHaveBeenCalledTimes(1); expect(button('重新核验')?.disabled).toBe(false); await click('重新核验'); await finish(newer, { status: 200, body: source() }); expect(h.redirect).toHaveBeenCalledTimes(1); expect(h.forget).not.toHaveBeenCalled();
  });
  it('switching from scene to standard entry unmounts lookup and keeps only original detail', async () => {
    const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); await render(); await render({ id: ACTIVITY, invitation_id: SOURCE }); await finish(pending, { status: 200, body: source() }); expect(h.redirect).not.toHaveBeenCalled(); expect(h.detailMount).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('ORIGINAL_DETAIL');
  });
  it('does not claim an already-issued native redirect was cancelled or guarantee its recall', async () => {
    const native = deferred<any>(); h.redirect.mockReturnValueOnce(native.promise); const pending = deferred<any>(); h.transport.mockReturnValueOnce(pending.promise); await render(); const oldCancel = h.actions.get('取消打开')!; await finish(pending, { status: 200, body: source() });
    expect(h.redirect).toHaveBeenCalledTimes(1); expect(button('取消打开')?.disabled).toBe(true); await act(async () => oldCancel()); await click('返回'); expect(h.back).not.toHaveBeenCalled(); expect(host.textContent).toContain('无法保证撤回'); expect(host.textContent).not.toContain('已停止本页后续打开'); await finish(native, { errMsg: 'redirectTo:ok' });
  });
  it('native redirect failure or malformed result is sanitized and explicit retry revalidates source', async () => {
    h.redirect.mockRejectedValueOnce(new Error('PRIVATE_NATIVE')).mockResolvedValueOnce({ ok: true }); await render(); expect(host.textContent).toContain('页面打开未确认'); expect(host.textContent).not.toContain('PRIVATE'); await click('重新核验'); expect(host.textContent).toContain('页面打开未确认'); await click('重新核验'); expect(h.redirect).toHaveBeenCalledTimes(3); expect(h.transport).toHaveBeenCalledTimes(3);
  });
  it('native handoff session change cannot leave an unrecoverable loading lock', async () => {
    const newer = deferred<any>(); h.token = 'session-a'; h.transport.mockResolvedValueOnce({ status: 200, body: source() }).mockReturnValueOnce(newer.promise); h.redirect.mockImplementationOnce(async () => { h.token = 'session-b'; return { errMsg: 'redirectTo:ok' }; }); await render();
    expect(h.transport).toHaveBeenCalledTimes(1); expect(button('重新核验')?.disabled).toBe(false); await click('重新核验'); await finish(newer, { status: 200, body: source() }); expect(h.redirect).toHaveBeenCalledTimes(2); expect(h.forget).not.toHaveBeenCalled();
  });
});

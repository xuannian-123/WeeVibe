// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (el: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token: 'a', read: vi.fn(), hide: undefined as undefined | (() => void), show: undefined as undefined | (() => void) }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token }));
vi.mock('../apps/miniprogram/src/features/gatherings/client', () => ({ readGatheringList: h.read, gatheringMessage: () => '读取失败' }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ useDidHide: (fn: () => void) => { h.hide = fn; }, useUnload: () => {}, useDidShow: (fn: () => void) => { h.show = fn; } }));
import { useCPreparations } from '../apps/miniprogram/src/features/design-c/use-preparations';
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
function Probe({ session, enabled }: { session: string; enabled: boolean }) {
  const state = useCPreparations(session, enabled);
  return createElement('div', {}, state.records.map(r => r.title).join(',') + state.error);
}
beforeEach(() => { h.token = 'a'; h.read.mockReset(); h.hide = undefined; h.show = undefined; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
const render = (session = 'a', enabled = true) => act(async () => root.render(createElement(Probe, { session, enabled })));
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
it('does not request preparations on unrelated tabs, then reads the verified source when enabled', async () => {
  h.read.mockResolvedValue({ gatherings: [{ title: '当前账号筹备' }] });
  await render('a', false); expect(h.read).not.toHaveBeenCalled();
  await render(); expect(h.read).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('当前账号筹备');
});
it('rejects an old account response and never renders it under a new account', async () => {
  const old = deferred(); h.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ gatherings: [{ title: 'B筹备' }] });
  await render(); h.token = 'b'; await render('b');
  await act(async () => old.resolve({ gatherings: [{ title: 'A私人筹备' }] }));
  expect(host.textContent).toBe('B筹备');
});
it('does not adopt a request completed after leaving, and refreshes through the active source on return', async () => {
  const old = deferred(); h.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ gatherings: [{ title: '返回后的新筹备' }] });
  await render(); await act(async () => h.hide?.());
  await act(async () => old.resolve({ gatherings: [{ title: '离开前旧结果' }] })); expect(host.textContent).toBe('');
  await act(async () => h.show?.()); expect(host.textContent).toBe('返回后的新筹备');
});

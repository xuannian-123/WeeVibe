// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applicantA, applicantB, applicationActivity, applicationDetail, applicationSegment } from './application-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token: 'session-a', modal: vi.fn(), me: vi.fn(), transport: vi.fn(), refresh: vi.fn(), remember: vi.fn(), hide: [] as (() => void)[], unload: [] as (() => void)[], store: new Map<string, unknown>() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token, api: { me: h.me }, transport: h.transport }));
vi.mock('../apps/miniprogram/src/platform/activities', () => ({ formatTime: (value: string) => value, rememberActivity: h.remember }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { showModal: h.modal, getStorageSync: (key: string) => h.store.get(key), setStorageSync: (key: string, value: unknown) => h.store.set(key, value), removeStorageSync: (key: string) => h.store.delete(key) }, useDidShow: () => {}, useDidHide: (fn: () => void) => h.hide.push(fn), useUnload: (fn: () => void) => h.unload.push(fn) }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({ Button: (p: any) => createElement('button', { disabled: p.disabled, onClick: p.onClick }, p.children), View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children), Label: (p: any) => createElement('label', {}, p.children), Checkbox: () => null, CheckboxGroup: (p: any) => createElement('button', { onClick: () => p.onChange({ detail: { value: [applicationSegment] } }) }, '选择环节'), Picker: () => null }));
import { ParticipationActions } from '../apps/miniprogram/src/features/participation/ParticipationActions';
let root: ReturnType<typeof createRoot> | undefined;
function detail() {
  const value = applicationDetail();
  value.viewer.participations = [{ segment_id: applicationSegment, status: 'joined', accepted_plan_revision: 1 }];
  return value;
}
beforeEach(() => {
  h.token = 'session-a'; h.modal.mockReset().mockResolvedValue({ confirm: true }); h.me.mockReset(); h.transport.mockReset(); h.refresh.mockReset().mockResolvedValue(undefined); h.remember.mockReset(); h.hide = []; h.unload = []; h.store.clear();
  const updated = detail(); updated.revision = 2;
  h.transport.mockResolvedValue({ status: 200, body: { activity: updated, fee_recheck_required: true, notice: '参加状态已更新' } });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
async function render(value = detail(), fresh = true) {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(createElement(ParticipationActions, { detail: value, session: 'session-a', fresh, refresh: h.refresh })));
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(value => value.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => { button.click(); await Promise.resolve(); });
}
async function waitingForIdentity() {
  await render(); await click('选择环节');
  let finish!: (actor: { user_id: string }) => void;
  h.me.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await click('退出所选环节'); expect(h.me).toHaveBeenCalledTimes(1); expect(h.transport).not.toHaveBeenCalled();
  return () => act(async () => { finish({ user_id: applicantA }); await Promise.resolve(); });
}
describe('actual participation component and client pre-POST lifecycle (offline transport)', () => {
  it.each(['hide', 'unload', 'unmount', 'session', 'actor', 'revision', 'participation', 'unfresh'])('does not start POST after %s during identity verification', async change => {
    const finish = await waitingForIdentity();
    if (change === 'hide') await act(async () => h.hide.forEach(fn => fn()));
    if (change === 'unload') await act(async () => h.unload.forEach(fn => fn()));
    if (change === 'unmount') { await act(async () => root!.unmount()); root = undefined; }
    if (change === 'session') h.token = 'session-b';
    if (['actor', 'revision', 'participation', 'unfresh'].includes(change)) {
      const updated = detail();
      if (change === 'actor') updated.viewer.user_id = applicantB;
      if (change === 'revision') updated.revision++;
      if (change === 'participation') updated.viewer.participations[0].status = 'exited';
      await render(updated, change !== 'unfresh');
    }
    await finish(); expect(h.transport).not.toHaveBeenCalled(); expect(h.refresh).not.toHaveBeenCalled(); expect(h.remember).not.toHaveBeenCalled();
    expect(h.store.has(`weevibe-participation-v1:${applicationActivity}:${applicantA}`)).toBe(true);
  });
  it('permits an unchanged visible page and sends the original actor bearer exactly once', async () => {
    const finish = await waitingForIdentity(); await finish();
    expect(h.transport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ method: 'POST', path: `/api/v1/activities/${applicationActivity}/participation`, headers: expect.objectContaining({ Authorization: 'Bearer session-a' }), body: expect.objectContaining({ action: 'exit', expected_revision: 1, segment_ids: [applicationSegment] }) }));
    expect(h.refresh).toHaveBeenCalledTimes(1); expect(h.remember).toHaveBeenCalledTimes(1);
    expect(h.store.has(`weevibe-participation-v1:${applicationActivity}:${applicantA}`)).toBe(false);
  });
});

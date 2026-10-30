// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applicationDetail, applicantA } from './application-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (v: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ request: vi.fn(), modal: vi.fn(), refresh: vi.fn(), token: 'session', store: new Map<string, unknown>() }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { showModal: h.modal, getStorageSync: (k: string) => h.store.get(k), setStorageSync: (k: string, v: unknown) => h.store.set(k, v), removeStorageSync: (k: string) => h.store.delete(k) }, useDidHide: () => {}, useDidShow: () => {}, useUnload: () => {} }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({ View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children), Button: (p: any) => createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children) }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token }));
vi.mock('../apps/miniprogram/src/features/arrangement-change/edit-api', () => ({ requestArrangementEdit: h.request }));
vi.mock('../apps/miniprogram/src/features/activity-create/activity-editor', () => ({ ActivityEditor: (p: any) => createElement('div', {},
  createElement('button', { disabled: p.disabled, onClick: () => p.onChange({ ...p.value, segments: p.value.segments.map((s: any) => ({ ...s, place: 'New venue' })) }) }, '修改地点'),
  createElement('button', { disabled: p.disabled, onClick: () => p.onChange({ ...p.value, segments: p.value.segments.map((s: any) => ({ ...s, minimum: '0' })) }) }, '填写无效人数'),
  createElement('button', { disabled: p.disabled, onClick: () => p.onChange({ ...p.value, segments: p.value.segments.map((s: any) => ({ ...s, minimum: '1' })) }) }, '修正人数')) }));
import { ArrangementEditor } from '../apps/miniprogram/src/features/arrangement-change/ArrangementEditor';
let root: ReturnType<typeof createRoot>;
const detail = () => applicationDetail();
beforeEach(() => {
  h.token = 'session'; h.store.clear(); h.modal.mockReset().mockResolvedValue({ confirm: true }); h.refresh.mockReset().mockResolvedValue(undefined);
  h.request.mockReset().mockImplementation(async (_id, _actor, _session, input, preview) => {
    if (preview) return { activity_id: detail().activity_id, viewer_user_id: applicantA, revision: 1, main_changed: false, warnings: [], changes: [] };
    const next = detail(); next.revision = 2; next.segments[0].location.name = input.segments[0].location.name; return next;
  });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(value = detail()) { await act(async () => root.render(createElement(ArrangementEditor, { detail: value, session: 'session', fresh: true, anyBusy: false, refresh: h.refresh }))); }
async function click(label: string) { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent === label); expect(b).toBeTruthy(); await act(async () => { b!.click(); await Promise.resolve(); }); }
async function preview() { await render(); await click('编辑当前安排'); await click('修改地点'); await click('检查修改并预览影响'); }
describe('published edit preview and explicit confirmation', () => {
  it('opening and editing a draft never applies; preview and apply use the same exact command', async () => {
    await render(); await click('编辑当前安排'); await click('修改地点'); expect(h.request).not.toHaveBeenCalled();
    await click('检查修改并预览影响'); expect(h.request).toHaveBeenCalledTimes(1); expect(h.request.mock.calls[0][4]).toBe(true);
    await click('确认应用修改'); expect(h.request).toHaveBeenCalledTimes(2); expect(h.request.mock.calls[1][4]).toBe(false);
    expect(h.request.mock.calls[1][3]).toEqual(h.request.mock.calls[0][3]); expect(h.refresh).toHaveBeenCalledTimes(1);
  });
  it('explains local invalid fields without sending or storing a request, then permits correction', async () => {
    await render(); await click('编辑当前安排'); await click('填写无效人数'); await click('检查修改并预览影响');
    expect(document.body.textContent).toContain('最低人数与上限必须为正整数');
    expect(document.body.textContent).not.toContain('请求结果无法确认');
    expect(h.request).not.toHaveBeenCalled(); expect(h.store.size).toBe(0); expect(h.modal).not.toHaveBeenCalled();
    await click('修正人数'); await click('修改地点'); await click('检查修改并预览影响');
    expect(h.request).toHaveBeenCalledTimes(1); expect(document.body.textContent).not.toContain('最低人数与上限必须为正整数');
    expect(document.body.textContent).toContain('确认应用修改');
  });
  it('keeps transport failures on the fixed error mapper instead of displaying raw messages', async () => {
    h.request.mockRejectedValueOnce(new Error('PRIVATE_TRANSPORT_DETAIL'));
    await preview();
    expect(document.body.textContent).not.toContain('PRIVATE_TRANSPORT_DETAIL');
    expect(document.body.textContent).toContain('请求结果无法确认');
  });
  it('cancelled confirmation keeps the draft and makes no write request', async () => {
    await preview(); h.modal.mockResolvedValueOnce({ confirm: false }); await click('确认应用修改');
    expect(h.request).toHaveBeenCalledTimes(1); expect(document.body.textContent).toContain('修改地点');
  });
  it('account change while modal is open prevents dispatch', async () => {
    await preview(); h.modal.mockImplementationOnce(async () => { h.token = 'different'; return { confirm: true }; });
    await click('确认应用修改'); expect(h.request).toHaveBeenCalledTimes(1); expect(h.refresh).not.toHaveBeenCalled();
  });
  it('a newer snapshot retains the draft but blocks applying its stale preview', async () => {
    await preview(); const changed = detail(); changed.revision = 2; await render(changed);
    expect(document.body.textContent).toContain('草稿保留但不能提交'); await click('确认应用修改');
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});

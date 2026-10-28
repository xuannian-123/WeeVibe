// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { RequirementSnapshot } from '../packages/contracts/src/requirements-api';
import { applicantA, applicantB, applicationActivity, applicationDetail } from './application-fixtures';
import { emptyForm, type ActivityForm } from '../apps/miniprogram/src/features/activity-create/form';

const requireMini = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act, useState } = requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = requireMini('react-dom/client') as {
  createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void };
};
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Native navigation and HTTP are replaced: these tests never contact the shared demo.
const h = vi.hoisted(() => ({
  token: 'session-a', actor: '', transport: vi.fn(), redirect: vi.fn(), clipboard: vi.fn(),
  store: new Map<string, unknown>(), show: [] as (() => void)[], hide: [] as (() => void)[], unload: [] as (() => void)[],
  form: {} as ActivityForm,
}));
vi.mock('../apps/miniprogram/src/platform/api', async () => {
  const { createApiClient } = await import('../packages/api-client/src');
  return { getToken: () => h.token, api: createApiClient(h.transport, () => h.token), transport: h.transport, forgetSession: vi.fn(), establishSession: vi.fn() };
});
vi.mock('../apps/miniprogram/src/platform/activities', () => ({ formatTime: (value: string) => value, feeText: () => '费用待核实', rememberActivity: vi.fn() }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({
  default: {
    getStorageSync: (key: string) => h.store.get(key), setStorageSync: (key: string, value: unknown) => h.store.set(key, value),
    removeStorageSync: (key: string) => h.store.delete(key), pageScrollTo: vi.fn().mockResolvedValue(undefined),
    redirectTo: h.redirect, setClipboardData: h.clipboard, showModal: vi.fn(),
  },
  useDidShow: (fn: () => void) => h.show.push(fn), useDidHide: (fn: () => void) => h.hide.push(fn), useUnload: (fn: () => void) => h.unload.push(fn),
}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  Button: (p: Record<string, unknown>) => createElement('button', { disabled: p.disabled, onClick: p.onClick }, p.children as never),
  View: (p: Record<string, unknown>) => createElement('div', { onClick: p.onClick }, p.children as never),
  Text: (p: Record<string, unknown>) => createElement('span', {}, p.children as never),
  Input: (p: Record<string, unknown>) => createElement('input', {
    value: p.value, disabled: p.disabled, placeholder: p.placeholder,
    onInput: (e: { currentTarget: { value: string } }) => (p.onInput as (event: unknown) => void)?.({ detail: { value: e.currentTarget.value } }),
  }),
  Textarea: (p: Record<string, unknown>) => createElement('textarea', {
    value: p.value, disabled: p.disabled, placeholder: p.placeholder,
    onInput: (e: { currentTarget: { value: string } }) => (p.onInput as (event: unknown) => void)?.({ detail: { value: e.currentTarget.value } }),
  }),
}));
vi.mock('../apps/miniprogram/src/features/activity-create/activity-editor', () => ({
  ActivityEditor: (p: { disabled: boolean; onChange: (value: ActivityForm) => void }) => createElement('button', { disabled: p.disabled, onClick: () => p.onChange(h.form) }, '填写活动草稿'),
}));

import Editor from '../apps/miniprogram/src/features/activity-create';
import { ResponseForm } from '../apps/miniprogram/src/features/requirements/response-form';

const collectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const nextStepLabel = '返回活动，查看安排与报名状态';
function snapshot(version = 1): RequirementSnapshot {
  return {
    collection: {
      id: collectionId, kind: 'friend', activity_id: applicationActivity, title: '朋友聚会', status: 'open',
      deadline_at: '2030-01-30T00:00:00Z', revision: 1, is_manager: false, has_responded: true, updated_at: '2030-01-01T00:00:00Z',
      draft: { title: '朋友聚会', description: '', starts_at: '2030-02-01T00:00:00Z', deadline_at: '2030-01-30T00:00:00Z', timezone: 'Asia/Shanghai', locations: [], questions: [] },
      closed_at: null, final_selection: null, organizer_nickname: '发起人',
    },
    viewer: { is_manager: false, can_respond: true, can_edit: false, can_publish: false, can_close: false, can_finalize: false, blocked_reason: null },
    segments: [], manager: null, server_time: '2030-01-02T00:00:00Z',
    own_response: {
      user_id: applicantA, revision: 1, response_version: version, updated_at: `2030-01-0${version}T01:00:00Z`, nickname: '我',
      selected_segment_ids: [], answers: [], location_ids: [], location_other: null,
      time_preferences: '', budget_note: '已保存的预算', preferences: '', private_origin: null,
    },
  };
}
function ConnectedResponse({ initial }: { initial: RequirementSnapshot }) {
  const [current, setCurrent] = useState(initial);
  return createElement(ResponseForm, { snapshot: current, updated: setCurrent });
}
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  h.token = 'session-a'; h.actor = applicantA; h.store.clear(); h.show = []; h.hide = []; h.unload = [];
  h.redirect.mockReset().mockResolvedValue(undefined); h.clipboard.mockReset().mockResolvedValue(undefined);
  h.transport.mockReset().mockImplementation(async request => {
    if (request.path === '/api/v1/me') return { status: 200, body: { user_id: h.actor } };
    if (request.path === '/api/v1/activities') return { status: 200, body: applicationDetail() };
    throw new Error('Unexpected test request');
  });
  h.form = emptyForm(); h.form.name = '导航测试活动';
  Object.assign(h.form.segments[0], { startDate: '2030-01-02', startTime: '09:00', endTime: '12:00', place: '测试地点', minimum: '2', capacity: '4' });
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
function findButton(label: string) { return Array.from(host.querySelectorAll('button')).find(button => button.textContent === label); }
async function click(label: string) {
  const button = findButton(label); expect(button, label).toBeTruthy();
  await act(async () => { button!.click(); await Promise.resolve(); });
}
const writes = () => h.transport.mock.calls.filter(call => call[0].method === 'POST');
async function previewActivity() {
  await act(async () => root.render(createElement(Editor)));
  await act(async () => h.show.slice().forEach(fn => fn()));
  await click('填写活动草稿'); await click('预览活动');
}
async function completedActivity() { await previewActivity(); await click('确认发起'); }
async function renderResponse(value: RequirementSnapshot, connected = true) {
  await act(async () => root.render(connected ? createElement(ConnectedResponse, { initial: value }) : createElement(ResponseForm, { snapshot: value, updated: () => {} })));
}
async function editBudget(value: string) {
  const input = host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="只是意向"]')!;
  await act(async () => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('created activity next-step navigation', () => {
  it('opens demand collection for the confirmed real id without another business write', async () => {
    await completedActivity(); const count = writes().length;
    await click('收集参与需求');
    expect(h.redirect).toHaveBeenCalledExactlyOnceWith({ url: `/pages/requirements/index?activity_id=${applicationActivity}` });
    expect(writes()).toHaveLength(count);
    expect(h.transport.mock.calls.some(call => call[0].path.includes('/requirements'))).toBe(false);
  });
  it('keeps the existing view-activity action', async () => {
    await completedActivity(); await click('查看活动');
    expect(h.redirect).toHaveBeenCalledExactlyOnceWith({ url: `/pages/activity/index?id=${applicationActivity}` });
    expect(writes()).toHaveLength(1);
  });
  it('does not offer the next step before creation is confirmed or while its result is unknown', async () => {
    await previewActivity(); expect(findButton('收集参与需求')).toBeUndefined();
    h.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 503, body: {} });
    await click('确认发起');
    expect(findButton('收集参与需求')).toBeUndefined(); expect(h.redirect).not.toHaveBeenCalled();
    expect(h.store.has(`weego-create-pending-v1:${applicantA}`)).toBe(true);
  });
  it('does not navigate an old completion under a changed account', async () => {
    await completedActivity(); h.token = 'session-b'; h.actor = applicantB;
    await click('收集参与需求');
    expect(h.redirect).not.toHaveBeenCalled(); expect(writes()).toHaveLength(1);
    expect(h.store.has(`weego-created-v1:${applicantA}`)).toBe(true);
  });
  it('starts one navigation for a double click and retains the saved activity on failure', async () => {
    await completedActivity(); h.redirect.mockRejectedValueOnce(new Error('native navigation failed'));
    await act(async () => { findButton('收集参与需求')!.click(); findButton('收集参与需求')!.click(); });
    expect(h.redirect).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('活动已保存，不需要重新发布');
    await click('收集参与需求'); expect(h.redirect).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(1);
  });
  it('does not start navigation from a hidden creation page', async () => {
    await completedActivity(); await act(async () => h.hide.slice().forEach(fn => fn()));
    await click('收集参与需求'); expect(h.redirect).not.toHaveBeenCalled();
  });
});

describe('saved requirement next-step navigation', () => {
  it('opens the linked activity without sending an application or another save', async () => {
    await renderResponse(snapshot()); await click(nextStepLabel);
    expect(h.redirect).toHaveBeenCalledExactlyOnceWith({ url: `/pages/activity/index?id=${applicationActivity}` });
    expect(h.transport).not.toHaveBeenCalled(); expect(host.textContent).toContain('不等于已报名或已加入');
  });
  it('offers the next step only after a validated first save', async () => {
    const initial = snapshot(); initial.own_response = null; initial.collection.has_responded = false;
    await renderResponse(initial); expect(findButton(nextStepLabel)).toBeUndefined();
    h.transport.mockResolvedValueOnce({ status: 200, body: snapshot() }); await click('保存我的需求');
    expect(writes()).toHaveLength(1); expect(writes()[0][0].body.expected_response_version).toBe(0);
    await click(nextStepLabel); expect(writes()).toHaveLength(1); expect(h.redirect).toHaveBeenCalledTimes(1);
  });
  it('does not treat copied dirty input as a saved response', async () => {
    await renderResponse(snapshot()); await editBudget('尚未保存的新预算'); await click('复制当前输入（不含私有地点）');
    expect(h.clipboard).toHaveBeenCalledTimes(1); expect(findButton(nextStepLabel)).toBeUndefined();
    expect(h.transport).not.toHaveBeenCalled(); expect(h.redirect).not.toHaveBeenCalled();
  });
  it.each([503, 409])('hides the next step after an unsuccessful or conflicting update (%s)', async status => {
    await renderResponse(snapshot());
    h.transport.mockResolvedValueOnce({ status, body: { error: { code: status === 409 ? 'VERSION_CONFLICT' : 'UPSTREAM_UNAVAILABLE', message: '需要核对保存结果' } } });
    await click('更新我的需求'); expect(findButton(nextStepLabel)).toBeUndefined();
    expect(host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="只是意向"]')!.value).toBe('已保存的预算');
    expect(h.redirect).not.toHaveBeenCalled();
  });
  it('does not offer success navigation for a malformed successful save', async () => {
    await renderResponse(snapshot()); h.transport.mockResolvedValueOnce({ status: 200, body: { ok: true } });
    await click('更新我的需求'); expect(findButton(nextStepLabel)).toBeUndefined(); expect(h.redirect).not.toHaveBeenCalled();
    expect(host.textContent).toContain('响应与当前版本不匹配');
  });
  it('waits while a save is pending', async () => {
    await renderResponse(snapshot()); let finish!: (value: unknown) => void;
    h.transport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await click('更新我的需求'); expect(findButton(nextStepLabel)).toBeUndefined();
    await act(async () => finish({ status: 200, body: snapshot(2) })); expect(findButton(nextStepLabel)).toBeTruthy();
  });
  it('does not present newer server answers as the saved local form', async () => {
    await renderResponse(snapshot(), false); await renderResponse(snapshot(2), false);
    expect(findButton(nextStepLabel)).toBeUndefined(); expect(host.textContent).toContain('服务器中的本人答卷已更新');
  });
  it('shows a wait-for-organizer message for standalone preparation without inventing a destination', async () => {
    const value = snapshot(); value.collection.activity_id = null;
    await renderResponse(value); expect(host.textContent).toContain('等待组织者发布正式活动');
    expect(findButton(nextStepLabel)).toBeUndefined(); expect(h.redirect).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('still allows viewing the formal activity after demand collection closes', async () => {
    const value = snapshot(); value.collection.status = 'closed'; value.viewer.can_respond = false;
    await renderResponse(value); await click(nextStepLabel);
    expect(h.redirect).toHaveBeenCalledTimes(1); expect(h.transport).not.toHaveBeenCalled();
  });
  it('blocks a stale navigation callback after account changes', async () => {
    await renderResponse(snapshot()); h.token = 'session-b'; await click(nextStepLabel);
    expect(h.redirect).not.toHaveBeenCalled(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('prevents duplicate navigation and allows retry without resubmitting saved answers', async () => {
    await renderResponse(snapshot()); h.redirect.mockRejectedValueOnce(new Error('native navigation failed'));
    await act(async () => { findButton(nextStepLabel)!.click(); findButton(nextStepLabel)!.click(); });
    expect(h.redirect).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('已保存的需求不需要重新提交');
    await click(nextStepLabel); expect(h.redirect).toHaveBeenCalledTimes(2); expect(h.transport).not.toHaveBeenCalled();
  });
});

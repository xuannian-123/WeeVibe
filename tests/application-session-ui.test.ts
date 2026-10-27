// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applicantA, applicantB, applicationActivity, applicationDetail, applicationId, applicationSegment } from './application-fixtures';
import { ApiClientError } from '../packages/api-client/src';
const requireMini = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = requireMini('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ token: 'session-a', actor: '', transport: vi.fn(), refresh: vi.fn(), storage: new Map<string, unknown>() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => mocks.token, transport: mocks.transport }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { getStorageSync: (key: string) => mocks.storage.get(key), setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value), removeStorageSync: (key: string) => mocks.storage.delete(key) }, useDidShow: () => {}, useDidHide: () => {}, useUnload: () => {} }));
import { useApplications } from '../apps/miniprogram/src/features/applications/use-applications';
let state: ReturnType<typeof useApplications>, root: ReturnType<typeof createRoot> | undefined;
function Harness({ actor = applicantA, session = 'session-a', revision = 1, fresh = true }: { actor?: string; session?: string; revision?: number; fresh?: boolean }) {
  const detail = applicationDetail(actor); detail.revision = revision;
  state = useApplications({ id: applicationActivity, detail, session, fresh, refresh: mocks.refresh });
  return createElement('div', {}, state.nickname + ' ' + state.apply.message);
}
beforeEach(() => { mocks.token = 'session-a'; mocks.actor = applicantA; mocks.storage.clear(); mocks.refresh.mockReset().mockResolvedValue(undefined); mocks.transport.mockReset().mockImplementation(async request => { if (request.path === '/api/v1/me') return { status: 200, body: { user_id: mocks.actor } }; throw new ApiClientError('NETWORK_ERROR', 'offline response lost', 0); }); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; });
async function render(props: Parameters<typeof Harness>[0] = {}) { if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); } await act(async () => root!.render(createElement(Harness, props))); }
async function fill() { await act(async () => { state.setSelected([applicationSegment]); state.setNickname('PRIVATE_A_NAME'); }); await act(async () => state.setAccepted(state.confirmation)); }
const writes = () => mocks.transport.mock.calls.filter(call => call[0].method === 'POST');
const keyA = `weego-apply-pending-v1:${applicationActivity}:${applicantA}`;
describe('actual application hooks, storage and bound client with offline transport', () => {
  it('cannot submit A choice/name with newly current B credentials even before another render', async () => {
    await render(); await fill(); mocks.token = 'session-b'; await act(async () => { state.submit(); await Promise.resolve(); });
    expect(writes()).toHaveLength(0); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('cannot submit stale A approval under B', async () => {
    await render(); mocks.token = 'session-b'; await act(async () => { state.decide(applicationId, 'approve'); await Promise.resolve(); }); expect(writes()).toHaveLength(0);
  });
  it('clears A unsent fields when the displayed authenticated actor changes to B', async () => {
    await render(); await fill(); mocks.token = 'session-b'; mocks.actor = applicantB; await render({ actor: applicantB, session: 'session-b' });
    expect(state.nickname).toBe(''); expect(state.selected).toEqual([]); expect(state.accepted).toBe(''); expect(document.body.textContent).not.toContain('PRIVATE_A_NAME');
  });
  it('keeps same-actor unsaved fields on refresh but requires renewed consent to a changed plan revision', async () => {
    await render(); await fill(); await render({ revision: 2 }); expect(state.nickname).toBe('PRIVATE_A_NAME'); expect(state.selected).toEqual([applicationSegment]);
    await act(async () => state.submit()); expect(writes()).toHaveLength(0);
    await act(async () => state.setAccepted(state.confirmation)); await act(async () => { state.submit(); await Promise.resolve(); });
    expect(writes()[0][0].body).toMatchObject({ expected_revision: 2, display_name: 'PRIVATE_A_NAME' });
  });
  it('keeps one original pending key after repeated clicks and an unknown result', async () => {
    await render(); await fill(); await act(async () => { state.submit(); state.submit(); await Promise.resolve(); });
    expect(writes()).toHaveLength(1); expect(state.apply.pending?.input).toEqual(writes()[0][0].body); expect(mocks.storage.has(keyA)).toBe(true);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('restores the original key only after the same user is verified again, never in between as B', async () => {
    await render(); await fill(); await act(async () => { state.submit(); await Promise.resolve(); }); const original = writes()[0][0].body;
    mocks.token = 'session-b'; mocks.actor = applicantB; await render({ actor: applicantB, session: 'session-b' });
    expect(state.apply.pending).toBeUndefined(); await act(async () => state.apply.send()); expect(writes()).toHaveLength(1); expect(mocks.storage.has(keyA)).toBe(true);
    mocks.token = 'session-a-renewed'; mocks.actor = applicantA; await render({ actor: applicantA, session: 'session-a-renewed' }); expect(state.apply.pending?.input).toEqual(original);
    mocks.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 200, body: applicationDetail() });
    await act(async () => state.apply.send()); expect(writes()).toHaveLength(2); expect(writes()[1][0]).toMatchObject({ headers: { Authorization: 'Bearer session-a-renewed' }, body: original });
    expect(mocks.storage.has(keyA)).toBe(false); expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it('retains the old request without acknowledgment on a malformed success payload', async () => {
    await render(); await fill(); mocks.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : { status: 200, body: { ok: true, secret: 'PRIVATE_ERROR' } });
    await act(async () => { state.submit(); await Promise.resolve(); }); expect(state.apply.result).toBeUndefined(); expect(state.apply.pending).toBeDefined(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(document.body.textContent).not.toContain('PRIVATE_ERROR');
  });
  it('does not acknowledge a pending result or refresh another actor after a session change', async () => {
    await render(); await fill(); let finish!: (value: unknown) => void; mocks.transport.mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: applicantA } } : new Promise(resolve => { finish = resolve; }));
    await act(async () => { state.submit(); await Promise.resolve(); }); mocks.token = 'session-b'; await act(async () => finish({ status: 200, body: applicationDetail() }));
    expect(state.apply.result).toBeUndefined(); expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.storage.has(keyA)).toBe(true);
  });
  it('does not submit when the detail read is unavailable, stale or unconfirmed', async () => {
    await render(); await fill(); await render({ fresh: false }); await act(async () => { state.submit(); state.decide(applicationId, 'approve'); }); expect(mocks.transport).not.toHaveBeenCalled();
  });
});

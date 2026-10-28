// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { RequirementSnapshot, CoordinationContext } from '../packages/contracts/src';
const requireMini = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = requireMini('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocks = vi.hoisted(() => ({ read: vi.fn(), token: 'session-a' }));
vi.mock('../apps/miniprogram/src/features/requirements/coordination-read', () => ({ readCoordination: mocks.read }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => mocks.token }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  Button: (p: any) => createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children),
  View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children),
}));
import { CoordinationPanel } from '../apps/miniprogram/src/features/requirements/coordination-panel';
const snapshot = { collection: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', activity_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', kind: 'friend', status: 'open' }, viewer: { is_manager: true }, manager: { respondent_count: 2 } } as RequirementSnapshot;
const context = { server_time: '2030-01-01T10:00:00Z', aggregate: { respondent_count: 2, joined_people_count: 1, joined_seat_count: 2, respondents_without_active_seats: 1, joined_people_without_response: 0, segments: [{ segment_ref: 's1', state: 'planned', intent_respondent_count: 2, occupied_count: 1, accepted_count: 0, pending_acceptance_count: 1 }] }, limitations: ['自由文本尚未校验为硬约束'] } as CoordinationContext;
let root: ReturnType<typeof createRoot> | undefined;
async function render(value = snapshot) {
  if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
  await act(async () => root!.render(createElement(CoordinationPanel, { snapshot: value })));
}
async function click() { await act(async () => { document.querySelector('button')!.click(); await Promise.resolve(); }); }
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; mocks.read.mockReset(); mocks.token = 'session-a'; });
describe('coordination preparation on the manager flow', () => {
  it('reads only after a deliberate action and separates intentions, seats and acceptance', async () => {
    await render(); expect(mocks.read).not.toHaveBeenCalled(); mocks.read.mockResolvedValue(context); await click();
    expect(mocks.read).toHaveBeenCalledWith(snapshot.collection.id, snapshot.collection.activity_id);
    expect(document.body.textContent).toContain('已填写 2 人'); expect(document.body.textContent).toContain('实际占位 1 人');
    expect(document.body.textContent).toContain('待接受 1 人'); expect(document.body.textContent).toContain(context.limitations[0]);
    expect(Array.from(document.querySelectorAll('button')).map(b => b.textContent)).toEqual(['核对协调资料']);
  });
  it.each(['team', 'standalone'])('keeps %s preparation usable without calling an unsupported source', async kind => {
    await render({ ...snapshot, collection: { ...snapshot.collection, kind: kind === 'team' ? 'team' : 'friend', activity_id: kind === 'standalone' ? null : snapshot.collection.activity_id } });
    expect(document.body.textContent).toContain('AI'); expect(document.querySelector('button')).toBeNull(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it('does not expose a management entry to participants', async () => { await render({ ...snapshot, viewer: { ...snapshot.viewer, is_manager: false } }); expect(document.body.textContent).toBe(''); });
  it('clears previous results on failed refresh and preserves a retry action', async () => {
    mocks.read.mockResolvedValueOnce(context).mockRejectedValueOnce(new Error('offline')); await render(); await click(); await click();
    expect(document.body.textContent).not.toContain('实际占位 1 人'); expect(document.body.textContent).toContain('暂时无法读取'); expect(document.querySelector('button')!.disabled).toBe(false);
  });
  it('discards a late result after another account signs in', async () => {
    let finish!: (v: CoordinationContext) => void; mocks.read.mockReturnValue(new Promise(resolve => { finish = resolve; })); await render(); await click();
    mocks.token = 'session-b'; await render(); await act(async () => finish(context)); expect(document.body.textContent).not.toContain('实际占位 1 人');
  });
  it('invalidates a read when answers refresh without a collection revision change', async () => {
    let finish!: (v: CoordinationContext) => void; mocks.read.mockReturnValue(new Promise(resolve => { finish = resolve; })); await render(); await click();
    await render({ ...snapshot, manager: { ...snapshot.manager!, respondent_count: 3 } }); await act(async () => finish(context)); expect(document.body.textContent).not.toContain('实际占位 1 人');
  });
  it('does not start duplicate reads while one is pending', async () => {
    mocks.read.mockReturnValue(new Promise(() => {})); await render(); await click(); await click(); expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});

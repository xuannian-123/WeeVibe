/// <reference path="../apps/miniprogram/src/assets.d.ts" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ArrangementPlan, ArrangementReview } from '../packages/contracts/src/arrangement';
import { applicantA, applicationActivity, applicationDetail, applicationSegment } from './application-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ controller: {} as any, review: {} as any, next: {} as any, modal: vi.fn(), transport: vi.fn(), refresh: vi.fn(), store: new Map<string, unknown>() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => 'session-a', transport: h.transport }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { showModal: h.modal, getStorageSync: (key: string) => h.store.get(key), setStorageSync: (key: string, value: unknown) => h.store.set(key, value), removeStorageSync: (key: string) => h.store.delete(key) }, useDidHide: () => {}, useDidShow: () => {}, useUnload: () => {} }));
// Keep the real sibling MainSegmentPanel mounted; extend only the native primitive fixture.
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({ Radio:()=>null,RadioGroup:(p:any)=>createElement('div',{},p.children),Label:(p:any)=>createElement('label',{},p.children),Button: (p: any) => createElement('button', { disabled: p.disabled, onClick: p.onClick }, p.children), View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children) }));
vi.mock('../apps/miniprogram/src/features/activity-detail/use-activity-detail', () => ({ useActivityDetail: () => h.controller }));
vi.mock('../apps/miniprogram/src/features/activity-detail/itinerary', () => ({ Itinerary: () => null }));
vi.mock('../apps/miniprogram/src/features/activity-detail/more', () => ({ ActivityMore: () => null }));
vi.mock('../apps/miniprogram/src/features/applications/panels', () => ({ ApprovalPanel: ({ state }: any) => createElement('button', { disabled: state.anyBusy || !state.fresh }, '审批同伴操作'), ApplicationForm: ({ state }: any) => createElement('button', { disabled: state.anyBusy || !state.fresh }, '申请同伴操作'), MyParticipationPanel: () => null }));
vi.mock('../apps/miniprogram/src/features/participation/ParticipationActions', () => ({ ParticipationActions: (p: any) => createElement('button', { disabled: !p.fresh }, '退出同伴操作') }));
vi.mock('../apps/miniprogram/src/features/invitations', () => ({ InvitationPanel: (p: any) => createElement('button', { disabled: p.anyBusy || !p.fresh }, '邀请同伴操作') }));
vi.mock('../apps/miniprogram/src/features/formation/FormationPanel', () => ({ FormationPanel: (p: any) => createElement('button', { disabled: p.anyBusy || !p.fresh }, '成局同伴操作') }));
// This suite isolates its own writer; the real handover GET/lifecycle is covered in handover-ui and independent Screen tests.
vi.mock('../apps/miniprogram/src/features/handover/HandoverPanel',()=>({HandoverPanel:(p:any)=>createElement('button',{disabled:p.anyBusy||!p.fresh},'交接同伴操作')}));
import ActivityDetailScreen from '../apps/miniprogram/src/features/activity-detail/screen';
let root: ReturnType<typeof createRoot> | undefined;
function ready() {
  const detail = applicationDetail(); detail.revision = 7;
  detail.viewer.participations = [{ segment_id: applicationSegment, status: 'awaiting_acceptance', accepted_plan_revision: 1 }];
  Object.assign(detail.segments[0], { plan_revision: 3, minimum_participants: 4, capacity: 6, deadline_at: '2029-12-31T00:00:00Z', is_join_open: false, counts: { occupied_count: 4, accepted_count: 3, pending_acceptance_count: 1, remaining_capacity: 2, meets_minimum: true, is_full: false } });
  return detail;
}
function reviewFixture(): ArrangementReview {
  const s = ready().segments[0];
  const plan: ArrangementPlan = { segment_id: s.segment_id, client_ref: s.client_ref, position: s.position, type: s.type, name: s.name, starts_at: s.starts_at, ends_at: s.ends_at, deadline_at: s.deadline_at, minimum_participants: s.minimum_participants, capacity: s.capacity, location: s.location, fee: s.fee, requirements: s.requirements };
  const one = { ...plan, minimum_participants: 2 }, two = { ...plan, minimum_participants: 3 };
  return { activity_id: applicationActivity, segment_id: applicationSegment, viewer_user_id: applicantA, revision: 7, current_plan_revision: 3, accepted_plan_revision: 1, server_time: '2030-01-01T00:00:00Z', state: 'ready', can_reaccept: true, reason: null, current_plan: plan, accepted_plan: one, history_digest: 'a'.repeat(64), changes: [{ from_plan_revision: 1, to_plan_revision: 2, changed_at: '2029-12-30T00:00:00Z', before: one, after: two }, { from_plan_revision: 2, to_plan_revision: 3, changed_at: '2029-12-31T00:00:00Z', before: two, after: plan }] };
}
beforeEach(() => {
  const detail = ready(); h.controller = { id: applicationActivity, detail, userId: applicantA, read: { data: { detail, session: 'session-a' }, loading: false, error: '', refresh: h.refresh }, login: { busy: false, error: '' }, applications: { fresh: true, anyBusy: false, apply: { send: vi.fn() }, decision: { send: vi.fn() }, submit: vi.fn(), decide: vi.fn() }, setOutgoingInvitationId: vi.fn() };
  h.review = reviewFixture(); h.next = ready(); h.next.revision = 8; h.next.viewer.participations[0] = { segment_id: applicationSegment, status: 'joined', accepted_plan_revision: 3 }; Object.assign(h.next.segments[0].counts, { accepted_count: 4, pending_acceptance_count: 0 });
  h.store.clear(); h.modal.mockReset().mockResolvedValue({ confirm: true }); h.refresh.mockReset().mockResolvedValue(undefined);
  h.transport.mockReset().mockImplementation(async request => ({ status: 200, body: request.path === '/api/v1/me' ? { user_id: applicantA } : request.method === 'GET' ? h.review : h.next }));
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
async function render() { if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); } await act(async () => root!.render(createElement(ActivityDetailScreen))); }
function button(label: string) { const found = Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!; expect(found).toBeTruthy(); return found; }
async function click(label: string) { await act(async () => { button(label).click(); await Promise.resolve(); }); }
const writes = () => h.transport.mock.calls.filter(call => call[0].method === 'POST');
const peers = ['审批同伴操作', '申请同伴操作', '退出同伴操作', '邀请同伴操作', '成局同伴操作', '交接同伴操作'];
describe('actual screen + arrangement panel + client through offline transport', () => {
  it('reads two-version history and accepts after application deadline, excluding its own busy state from final preflight', async () => {
    await render(); expect(h.transport).not.toHaveBeenCalled(); await click('查看本人版本差异'); expect(button('确认接受当前安排').disabled).toBe(false);
    let resolveMe!: (value: unknown) => void; h.transport.mockImplementationOnce(() => new Promise(resolve => { resolveMe = resolve; }));
    await click('确认接受当前安排'); expect(writes()).toHaveLength(0); for (const name of peers) expect(button(name).disabled).toBe(true);
    await act(async () => resolveMe({ status: 200, body: { user_id: applicantA } }));
    expect(writes()).toHaveLength(1); expect(writes()[0][0]).toMatchObject({ headers: { Authorization: 'Bearer session-a' }, path: `/api/v1/activities/${applicationActivity}/arrangements/${applicationSegment}`, body: { action: 'reaccept', expected_revision: 7, expected_plan_revision: 3, from_accepted_plan_revision: 1, history_digest: 'a'.repeat(64) } });
    expect(writes()[0][0].body).not.toHaveProperty('user_id'); expect(writes()[0][0].body).not.toHaveProperty('events'); expect(h.refresh).toHaveBeenCalledTimes(1);
    for (const name of peers) expect(button(name).disabled).toBe(false); expect(h.next.formation_status).toBe('not_confirmed');
  });
  it('cancel releases peers and never dispatches the acceptance request', async () => { await render(); await click('查看本人版本差异'); h.modal.mockResolvedValueOnce({ confirm: false }); const calls = h.transport.mock.calls.length; await click('确认接受当前安排'); expect(h.transport).toHaveBeenCalledTimes(calls); expect(writes()).toHaveLength(0); for (const name of peers) expect(button(name).disabled).toBe(false); });
  it('missing history is not replaced by invented current-only changes', async () => { h.review = { ...h.review, state: 'unavailable', can_reaccept: false, reason: 'HISTORY_UNAVAILABLE', history_digest: null, accepted_plan: null, changes: [] }; await render(); await click('查看本人版本差异'); expect(button('确认接受当前安排').disabled).toBe(true); expect(document.body.textContent).toMatch(/历史|可信|核验/); expect(writes()).toHaveLength(0); });
  it('another write prevents a new history/acceptance interaction', async () => { h.controller.applications.anyBusy = true; await render(); expect(button('查看本人版本差异').disabled).toBe(true); await click('查看本人版本差异'); expect(h.transport).not.toHaveBeenCalled(); });
  it('does not create a personal review entry for a manager without a seat', async () => { h.controller.detail.viewer.participations = []; await render(); expect(document.body.textContent).not.toContain('查看本人版本差异'); expect(h.transport).not.toHaveBeenCalled(); });
});

// This suite isolates its existing feature; cycle31 capacity Screen probes cover the new peer.
vi.mock('../apps/miniprogram/src/features/capacity/CapacityPanel', () => ({ CapacityPanel: () => null }));

// This suite isolates its original feature; cycle32 tests exercise the actual share-card Screen composition.
vi.mock('../apps/miniprogram/src/features/share-card/ActivityShareCard', () => ({ ActivityShareCard: () => null }));

// This pre-existing feature suite isolates the new deadline sibling. Actual composed deadline/peer behavior is covered by deadline-screen-ui and independent full-Screen probes.
vi.mock('../apps/miniprogram/src/features/deadline/DeadlinePanel', () => ({ DeadlinePanel: () => null }));

// This existing feature suite isolates the booking sibling; booking-screen-ui and independent complete-Screen probes verify the new declaration/history composition.
vi.mock('../apps/miniprogram/src/features/booking/BookingPanel', () => ({ BookingPanel: () => null }));

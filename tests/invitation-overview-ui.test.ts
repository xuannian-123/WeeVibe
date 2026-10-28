/// <reference path="../apps/miniprogram/src/assets.d.ts" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { ActivityDetail } from '../packages/contracts/src';
import { applicantA, applicantB, applicationActivity as ID, applicationSegment as S, applicationId as SOURCE, applicationDetail } from './application-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act, useEffect } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token: 'session-a' as string | undefined, actor: '', transport: vi.fn(), navigate: vi.fn(), scroll: vi.fn(), login: vi.fn(), refresh: vi.fn(), store: new Map<string, unknown>(), hide: new Set<() => void>(), show: new Set<() => void>(), unload: new Set<() => void>() }));
vi.mock('../apps/miniprogram/src/platform/api', async () => { const { createApiClient } = await import('../packages/api-client/src'); return { getToken: () => h.token, api: createApiClient(h.transport, () => h.token), transport: h.transport, establishSession: h.login, forgetSession: vi.fn() }; });
vi.mock('../apps/miniprogram/src/features/gatherings/profile-boundary', () => ({ GatheringProfileBoundary: (p: { children: unknown }) => p.children }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => {
  const register = (set: Set<() => void>, fn: () => void) => useEffect(() => { set.add(fn); return () => { set.delete(fn); }; }, [fn]);
  return { default: { navigateTo: h.navigate, pageScrollTo: h.scroll, getStorageSync: (key: string) => h.store.get(key), setStorageSync: (key: string, value: unknown) => h.store.set(key, value), removeStorageSync: (key: string) => h.store.delete(key) }, useDidHide: (fn: () => void) => register(h.hide, fn), useDidShow: (fn: () => void) => register(h.show, fn), useUnload: (fn: () => void) => register(h.unload, fn) };
});
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({
  View: (p: Record<string, unknown>) => createElement('div', { className: p.className, id: p.id }, p.children as never),
  Text: (p: Record<string, unknown>) => createElement('span', { className: p.className }, p.children as never),
  Button: (p: Record<string, unknown>) => createElement('button', { onClick: p.onClick, disabled: p.disabled }, p.children as never),
  Label: (p: Record<string, unknown>) => createElement('label', {}, p.children as never),
  Checkbox: (p: Record<string, unknown>) => createElement('input', { type: 'checkbox', value: p.value, checked: p.checked, disabled: p.disabled, onChange: () => {} }),
  CheckboxGroup: (p: Record<string, unknown>) => createElement('div', {}, p.children as never),
  Input: (p: Record<string, unknown>) => createElement('input', { value: p.value, disabled: p.disabled, placeholder: p.placeholder, onInput: (e: { currentTarget: { value: string } }) => (p.onInput as (event: unknown) => void)?.({ detail: { value: e.currentTarget.value } }) }),
  Image: (p: Record<string, unknown>) => createElement('img', { src: p.src, className: p.className }),
}));
import { InvitationOverview } from '../apps/miniprogram/src/features/activity-entry/InvitationOverview';
import { useApplications } from '../apps/miniprogram/src/features/applications/use-applications';
let controller: ReturnType<typeof useApplications>;
function Harness({ detail, source, fresh = true }: { detail: ActivityDetail; source?: string; fresh?: boolean }) {
  controller = useApplications({ id: detail.activity_id, detail, session: h.token, fresh, refresh: h.refresh, incomingInvitationId: source, attributionAvailable: true });
  return createElement(InvitationOverview, { detail, state: controller, incomingInvitationId: source, session: h.token, login: { busy: false, login: h.login }, fresh, anyBusy: controller.anyBusy, refresh: h.refresh });
}
function sourceBody(name = '分享者小李') { return { invitation_id: SOURCE, activity_id: ID, title: '分享来源标题', inviter_display_name: name, inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'Asia/Shanghai', cancelled: false, source_only: true }; }
function detail() { const value = applicationDetail(); value.viewer.is_manager = false; return value; }
let root: ReturnType<typeof createRoot>, host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  h.token = 'session-a'; h.actor = applicantA; h.store.clear(); h.hide.clear(); h.show.clear(); h.unload.clear();
  h.login.mockReset().mockResolvedValue(undefined); h.refresh.mockReset().mockResolvedValue(undefined); h.navigate.mockReset().mockResolvedValue(undefined); h.scroll.mockReset().mockResolvedValue(undefined);
  h.transport.mockReset().mockImplementation(async request => request.path === '/api/v1/me' ? { status: 200, body: { user_id: h.actor } } : request.path.includes('/invitations/') ? { status: 200, body: sourceBody() } : { status: 200, body: detail() });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(value = detail(), source?: string, fresh = true) { await act(async () => root.render(createElement(Harness, { detail: value, source, fresh }))); }
function find(label: string) { return Array.from(host.querySelectorAll('button')).find(button => button.textContent === label); }
async function click(label: string) { expect(find(label), label).toBeTruthy(); await act(async () => { find(label)!.click(); await Promise.resolve(); }); }
const writes = () => h.transport.mock.calls.filter(call => call[0].method === 'POST');
async function chooseAndAccept() { await act(async () => { controller.setSelected([S]); controller.setNickname('本次活动小名'); }); await act(async () => controller.setAccepted(controller.confirmation)); }

describe('integrated invitation overview using the existing application controller and form', () => {
  it('allows guest reading and explicit login without fetching members or automatically applying', async () => {
    h.token = undefined; const value = detail(); value.viewer.user_id = null;
    value.applications = [{ application_id: SOURCE, applicant_user_id: applicantA, display_name: 'PRIVATE_MEMBER_SENTINEL', status: 'pending', segments: [], created_at: value.server_time, decided_at: null }];
    await render(value); expect(host.textContent).toContain(value.name); expect(host.textContent).not.toContain('PRIVATE_MEMBER_SENTINEL');
    expect(find('查看当前分段名单')).toBeUndefined(); expect(h.transport).not.toHaveBeenCalled();
    await click('登录并选择参加环节'); expect(h.login).toHaveBeenCalledTimes(1); expect(writes()).toHaveLength(0);
  });
  it('verifies provenance and never relabels the inviter as the organizer', async () => {
    await render(detail(), SOURCE); expect(host.textContent).toContain('邀请来源已核验'); expect(host.textContent).toContain('分享者小李');
    expect(host.textContent).toContain('发起人公开资料暂未提供');
    expect(host.textContent).toContain('分享者不一定是发起人'); expect(h.transport.mock.calls[0][0]).toMatchObject({ method: 'GET', path: `/api/v1/invitations/${SOURCE}` }); expect(writes()).toHaveLength(0);
  });
  it('rejects an invalid invitation before transport and does not enable submission', async () => {
    await render(detail(), 'bad'); await chooseAndAccept(); expect(h.transport).not.toHaveBeenCalled();
    expect(host.textContent).toContain('格式无效'); expect(find('申请参加所选环节')?.disabled).toBe(true); expect(writes()).toHaveLength(0);
  });
  it('rejects a source that points to a different canonical activity', async () => {
    h.transport.mockResolvedValueOnce({ status: 200, body: { ...sourceBody(), activity_id: applicantB } }); await render(detail(), SOURCE); await chooseAndAccept();
    expect(host.textContent).not.toContain('分享者小李'); expect(host.textContent).toContain('响应无法验证'); expect(find('申请参加所选环节')?.disabled).toBe(true);
  });
  it('keeps cancelled provenance read-only without claiming a seat', async () => {
    h.transport.mockResolvedValueOnce({ status: 200, body: { ...sourceBody(), cancelled: true } }); await render(detail(), SOURCE); await chooseAndAccept();
    expect(host.textContent).toContain('邀请对应活动已取消'); expect(find('申请参加所选环节')?.disabled).toBe(true); expect(writes()).toHaveLength(0);
  });
  it.each([404, 503])('reports unavailable source verification (%s) without claiming success', async status => {
    h.transport.mockResolvedValueOnce({ status, body: '<html>unavailable</html>' }); await render(detail(), SOURCE);
    expect(host.textContent).not.toContain('邀请来源已核验'); expect(host.textContent).not.toContain('分享者小李');
    expect(find('重新核验邀请来源')).toBeTruthy(); expect(writes()).toHaveLength(0);
  });
  it('shows every segment, highlights the primary and does not invent a unique joined total', async () => {
    const value = detail(); value.segments.push({ ...value.segments[0], segment_id: applicantB, client_ref: 'second', position: 1, name: '第二环节聚餐' });
    await render(value); expect(host.textContent).toContain('第二环节聚餐'); expect(host.textContent).toContain('主环节'); expect(host.textContent).toContain('分段人数不相加'); expect(host.textContent).toContain('费用待确认');
  });
  it.each(['pending', 'exited'])('does not fetch or expose member names for %s viewers', async kind => {
    const value = detail(); if (kind === 'exited') value.viewer.participations = [{ segment_id: S, status: 'exited', accepted_plan_revision: 1 }];
    else value.viewer.applications = [{ application_id: SOURCE, applicant_user_id: applicantA, display_name: '本人昵称', status: 'pending', segments: [{ segment_id: S, plan_revision: 1 }], created_at: value.server_time, decided_at: null }];
    await render(value); expect(find('查看当前分段名单')).toBeUndefined(); expect(h.transport.mock.calls.some(call => call[0].path.includes('/roster'))).toBe(false);
  });
  it('keeps the permission-protected real roster entry for a current joined member', async () => {
    const value = detail(); value.viewer.participations = [{ segment_id: S, status: 'joined', accepted_plan_revision: 1 }]; await render(value);
    expect(find('查看当前分段名单')).toBeTruthy(); expect(h.transport).not.toHaveBeenCalled();
  });
  it('opens existing requirements independently without saving, applying or inventing public text delivery', async () => {
    await render(); await click('填写需求与建议'); expect(h.navigate).toHaveBeenCalledExactlyOnceWith({ url: `/pages/requirements/index?activity_id=${ID}` });
    expect(writes()).toHaveLength(0); expect(controller.selected).toEqual([]);
    await click('哪些建议能被组织者看到？'); expect(host.textContent).toContain('自由内容暂不作为可送达组织者的建议'); expect(host.textContent).toContain('私人备注仅本人可见');
  });
  it('reports native navigation failure without claiming suggestions were submitted', async () => {
    await render(); h.navigate.mockRejectedValueOnce(new Error('navigation failed')); await click('填写需求与建议');
    expect(host.textContent).toContain('没有提交建议或报名'); expect(writes()).toHaveLength(0);
  });
  it('requires existing acceptance and keeps one real application request for repeated submit clicks', async () => {
    await render(); expect(find('申请参加所选环节')?.disabled).toBe(true); await chooseAndAccept();
    await act(async () => { find('申请参加所选环节')!.click(); find('申请参加所选环节')!.click(); });
    expect(writes()).toHaveLength(1); expect(writes()[0][0].body).toMatchObject({ display_name: '本次活动小名', segments: [{ segment_id: S, plan_revision: 1 }] });
    expect(writes()[0][0].path).toBe(`/api/v1/activities/${ID}/applications`);
  });
  it.each(['pending', 'approved', 'rejected', 'withdrawn'] as const)('preserves the real own application state %s independently of suggestions', async status => {
    const value = detail(); value.viewer.applications = [{ application_id: SOURCE, applicant_user_id: applicantA, display_name: '我的小名', status, segments: [{ segment_id: S, plan_revision: 1 }], created_at: value.server_time, decided_at: null }];
    await render(value); expect(host.querySelector('#invitation-my-status')?.textContent).toContain({ pending: '待审批', approved: '已批准', rejected: '未通过', withdrawn: '已撤回' }[status]); expect(writes()).toHaveLength(0);
  });
  it('keeps held seats distinct and does not collect unsupported private contacts or animal choices', async () => {
    const value = detail(); value.viewer.participations = [{ segment_id: S, status: 'awaiting_acceptance', accepted_plan_revision: 1 }]; await render(value);
    expect(host.textContent).toContain('保留席位'); expect(host.textContent).toContain('待重新接受'); expect(host.textContent).toContain('不会收集微信号'); expect(host.querySelector('input[type="tel"]')).toBeNull();
  });
  it('ignores an old provenance response after account/source changes', async () => {
    let finish!: (value: unknown) => void; h.transport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(detail(), SOURCE);
    h.token = 'session-b'; h.actor = applicantB; const value = detail(); value.viewer.user_id = applicantB; await render(value, SOURCE);
    await act(async () => finish({ status: 200, body: sourceBody('OLD_ACCOUNT_NAME_SENTINEL') }));
    expect(host.textContent).not.toContain('OLD_ACCOUNT_NAME_SENTINEL'); expect(writes()).toHaveLength(0);
  });
  it('does not adopt a late source response after hiding the page', async () => {
    let finish!: (value: unknown) => void; h.transport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await render(detail(), SOURCE);
    await act(async () => { for (const hide of [...h.hide]) hide(); }); await act(async () => finish({ status: 200, body: sourceBody('HIDDEN_SOURCE_SENTINEL') }));
    expect(host.textContent).not.toContain('HIDDEN_SOURCE_SENTINEL'); expect(writes()).toHaveLength(0);
  });
  it.each(['cancelled', 'closed', 'full'])('keeps %s activities read-only for new participation', async kind => {
    const value = detail();
    if (kind === 'cancelled') value.cancelled_at = value.server_time;
    if (kind === 'closed') value.segments[0].is_join_open = false;
    if (kind === 'full') { value.segments[0].counts.remaining_capacity = 0; value.segments[0].counts.is_full = true; }
    await render(value);
    expect(host.textContent).toContain({ cancelled: '活动已取消', closed: '报名已结束', full: '已满员' }[kind]);
    if (kind === 'full') { await chooseAndAccept(); await click('申请参加所选环节'); }
    expect(writes()).toHaveLength(0);
  });

  it('ignores old native navigation failure after hide and return', async () => {
    await render(); let reject!: (reason: unknown) => void;
    h.navigate.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await click('填写需求与建议');
    await act(async () => { for (const hide of [...h.hide]) hide(); });
    await act(async () => { for (const show of [...h.show]) show(); });
    await act(async () => reject(new Error('old navigation failed')));
    expect(host.textContent).not.toContain('需求页面暂时无法打开');
    expect(writes()).toHaveLength(0);
  });

  it('restores the server-owned signup nickname without replacing the current draft or changing the account', async () => {
    const value = detail(); value.viewer.applications = [{ application_id: SOURCE, applicant_user_id: applicantA, display_name: '已保存的小名', status: 'pending', segments: [{ segment_id: S, plan_revision: 1 }], created_at: value.server_time, decided_at: null }];
    await render(value); expect(host.textContent).toContain('报名记录昵称：已保存的小名');
    await click('查看本人报名状态'); expect(h.scroll).toHaveBeenCalledWith({ selector: '#invitation-my-status', duration: 250 });
    expect(controller.nickname).toBe(''); expect(writes()).toHaveLength(0);
  });

  it('renders all 12 bundled animal PNGs, allows explicit selection and never persists the preview', async () => {
    await render(); expect(host.querySelectorAll('img.iv-animal-image')).toHaveLength(12);
    for (const image of Array.from(host.querySelectorAll('img.iv-animal-image'))) expect(image.getAttribute('src')).toMatch(/gathering-animals\/.*\.png/);
    expect(host.textContent).not.toContain('已预览'); await click('水豚');
    expect(host.textContent).toContain('已预览水豚 · 尚未保存，不随报名提交');
    await chooseAndAccept(); await click('申请参加所选环节');
    expect(writes()).toHaveLength(1); expect(writes()[0][0].body).not.toHaveProperty('animal_id');
    expect([...h.store.keys()].some(key => /animal|avatar/.test(key))).toBe(false);
  });

  it('randomizes only on explicit clicks, changes the current animal and clears on leaving', async () => {
    await render(); vi.spyOn(Math, 'random').mockReturnValue(0);
    await click('随机换一个'); expect(host.textContent).toContain('已预览小猫');
    await click('随机换一个'); expect(host.textContent).toContain('已预览小狗');
    await act(async () => { for (const hide of [...h.hide]) hide(); for (const show of [...h.show]) show(); });
    expect(host.textContent).not.toContain('已预览'); expect(writes()).toHaveLength(0);
  });

  it('blocks animal preview changes from a retained handler when the native session changed', async () => {
    await render(); h.token = 'another-session'; await click('小猫');
    expect(host.textContent).not.toContain('已预览'); expect(writes()).toHaveLength(0);
  });

  it('shows an empty itinerary without inventing an event or enabling an application', async () => {
    const value = detail(); value.segments = []; await render(value);
    expect(host.textContent).toContain('暂未取得可展示的行程'); expect(find('申请参加所选环节')).toBeUndefined();
    expect(host.querySelector('img.iv-animal-image')).toBeNull(); expect(writes()).toHaveLength(0);
  });

  it('labels all originally planned segments and the main teaser as history after cancellation', async () => {
    const value = detail(); value.cancelled_at = value.server_time; value.segments[0].cancelled_at = value.server_time;
    await render(value); expect(host.querySelector('.iv-summary')?.textContent).toContain('1原定环节');
    expect(host.textContent).toContain('原主环节'); expect(writes()).toHaveLength(0);
  });

  it('shows the newest saved application nickname even when history arrives in a different order', async () => {
    const value = detail(); const base = { applicant_user_id: applicantA, status: 'rejected' as const, segments: [{ segment_id: S, plan_revision: 1 }], decided_at: null };
    value.viewer.applications = [{ ...base, application_id: applicantB, display_name: '旧昵称', created_at: '2029-01-01T00:00:00Z' }, { ...base, application_id: SOURCE, display_name: '新的活动小名', created_at: value.server_time }];
    await render(value); expect(host.querySelector('.iv-saved-name')?.textContent).toBe('报名记录昵称：新的活动小名'); expect(writes()).toHaveLength(0);
  });

  it('keeps a valid application draft and original key when a verified source read fails on refresh', async () => {
    await render(detail(), SOURCE); await chooseAndAccept();
    h.transport.mockRejectedValueOnce(new Error('offline')); await render(detail(), SOURCE, false); await render(detail(), SOURCE);
    expect(controller.selected).toEqual([S]); expect(controller.nickname).toBe('本次活动小名');
    expect(find('申请参加所选环节')?.disabled).toBe(true); expect(writes()).toHaveLength(0);
    await click('重新核验邀请来源'); expect(find('申请参加所选环节')?.disabled).toBe(false);
  });

});

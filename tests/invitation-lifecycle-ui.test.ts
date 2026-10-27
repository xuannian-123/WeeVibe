// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applicantA, applicantB, applicationActivity, applicationDetail, applicationId } from './application-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const { createRoot } = req('react-dom/client') as { createRoot: (host: Element) => { render: (element: ReturnType<typeof createElement>) => void; unmount: () => void } };
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token: 'session-a', modal: vi.fn(), me: vi.fn(), transport: vi.fn(), created: vi.fn(), busy: vi.fn(), hide: [] as (() => void)[], unload: [] as (() => void)[], show: [] as (() => void)[] }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => h.token, api: { me: h.me }, transport: h.transport }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { showModal: h.modal }, useDidShow: (fn: () => void) => h.show.push(fn), useDidHide: (fn: () => void) => h.hide.push(fn), useUnload: (fn: () => void) => h.unload.push(fn) }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components', () => ({ Button: (p: any) => createElement('button', { disabled: p.disabled, onClick: p.onClick }, p.children), View: (p: any) => createElement('div', {}, p.children), Text: (p: any) => createElement('span', {}, p.children) }));
import { InvitationPanel } from '../apps/miniprogram/src/features/invitations';
let root: ReturnType<typeof createRoot> | undefined;
function source() { return { invitation_id: applicationId, activity_id: applicationActivity, title: '活动邀请', inviter_display_name: 'A', inviter_avatar_url: null, starts_at: null, ends_at: null, timezone: 'Asia/Shanghai', cancelled: false, source_only: true }; }
beforeEach(() => { h.token = 'session-a'; h.modal.mockReset().mockResolvedValue({ confirm: true }); h.me.mockReset().mockResolvedValue({ user_id: applicantA }); h.transport.mockReset().mockResolvedValue({ status: 200, body: source() }); h.created.mockReset(); h.busy.mockReset(); h.hide = []; h.unload = []; h.show = []; });
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ''; });
async function render(value = applicationDetail(), incomingId?: string, fresh = true) { if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); } await act(async () => root!.render(createElement(InvitationPanel, { id: applicationActivity, detail: value, session: 'session-a', fresh, incomingId, anyBusy: false, onSourceCreated: h.created, onBusyChange: h.busy }))); }
async function click(label = '准备带来源的邀请入口') { const button = Array.from(document.querySelectorAll('button')).find(value => value.textContent === label)!; expect(button).toBeTruthy(); await act(async () => { button.click(); await Promise.resolve(); }); }
async function leave(kind: string) { if (kind === 'unmount') { await act(async () => root!.unmount()); root = undefined; } else await act(async () => (kind==='unload'?h.unload:h.hide).forEach(fn => fn())); }
describe('invitation lifecycle with actual component and API (offline transport)', () => {
  it.each(['hide', 'unload', 'unmount'])('does not start mutation after %s during confirmation', async kind => {
    await render(); let finish!: (value: { confirm: boolean }) => void; h.modal.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await click(); expect(h.me).not.toHaveBeenCalled(); await leave(kind); await act(async () => { finish({ confirm: true }); await Promise.resolve(); }); expect(h.transport).not.toHaveBeenCalled(); expect(h.created).not.toHaveBeenCalled();
  });
  it.each(['hide', 'unload', 'unmount'])('does not start mutation after %s during identity read', async kind => {
    await render(); let finish!: (value: { user_id: string }) => void; h.me.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await click(); expect(h.me).toHaveBeenCalledTimes(1); expect(h.transport).not.toHaveBeenCalled(); await leave(kind); await act(async () => { finish({ user_id: applicantA }); await Promise.resolve(); }); expect(h.transport).not.toHaveBeenCalled(); expect(h.created).not.toHaveBeenCalled();
  });
  it('does not publish a late source result into a page that has unmounted', async () => {
    await render(); let finish!: (value: unknown) => void; h.transport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await click(); expect(h.transport).toHaveBeenCalledTimes(1); await leave('unmount'); await act(async () => { finish({ status: 200, body: source() }); await Promise.resolve(); }); expect(h.created).not.toHaveBeenCalled();
  });
});

describe('invitation positive, cancellation, state and uncertainty boundaries', () => {
  it('locks before confirmation and releases after cancellation or native failure', async () => {
    await render();let finish!:(value:{confirm:boolean})=>void;h.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const button=Array.from(document.querySelectorAll('button')).find(value=>value.textContent==='准备带来源的邀请入口')!;
    await act(async()=>{button.click();button.click();});expect(h.modal).toHaveBeenCalledTimes(1);expect(h.me).not.toHaveBeenCalled();
    await act(async()=>finish({confirm:false}));expect(h.transport).not.toHaveBeenCalled();
    h.modal.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_FAILURE'));await click();expect(h.transport).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('PRIVATE_NATIVE_FAILURE');
    await click();expect(h.transport).toHaveBeenCalledTimes(1);expect(h.created).toHaveBeenCalledExactlyOnceWith(applicationId);
  });
  it.each(['session','actor','revision','cancelled','unfresh'])('rejects a changed %s while confirmation is open',async change=>{
    await render();let finish!:(value:{confirm:boolean})=>void;h.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click();
    const next=applicationDetail();if(change==='session')h.token='session-b';if(change==='actor')next.viewer.user_id=applicantB;if(change==='revision')next.revision++;if(change==='cancelled')next.cancelled_at='2030-01-01T00:00:00Z';await render(next,undefined,change!=='unfresh');
    await act(async()=>finish({confirm:true}));expect(h.transport).not.toHaveBeenCalled();expect(h.created).not.toHaveBeenCalled();
  });
  it('does not revive an older confirmation after hide then show',async()=>{
    await render();let finish!:(value:{confirm:boolean})=>void;h.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click();await leave('hide');await act(async()=>h.show.forEach(fn=>fn()));await act(async()=>finish({confirm:true}));expect(h.transport).not.toHaveBeenCalled();
  });
  it('leaves an unknown creation unconfirmed and repeats only the existing create operation on explicit retry',async()=>{
    await render();h.transport.mockRejectedValueOnce(new Error('NETWORK_PRIVATE'));await click();expect(h.created).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('邀请入口已准备好');expect(document.body.textContent).not.toContain('NETWORK_PRIVATE');
    await click();expect(h.created).toHaveBeenCalledExactlyOnceWith(applicationId);expect(h.transport.mock.calls[1][0]).toEqual(h.transport.mock.calls[0][0]);
  });
  it('does not expose a valid but wrong target as a successful created source',async()=>{
    await render();h.transport.mockResolvedValueOnce({status:200,body:{...source(),activity_id:applicantB}});await click();expect(h.created).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('邀请入口已准备好');
  });
});
describe('saving a public invitation uses the same actor and lifecycle boundary',()=>{
  async function incoming(){await render(applicationDetail(),applicationId);expect(h.transport).toHaveBeenCalledTimes(1);h.transport.mockClear();}
  it.each(['hide','unload','unmount'])('blocks save POST after %s during identity lookup',async kind=>{
    await incoming();let finish!:(value:{user_id:string})=>void;h.me.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('保存这份邀请到 GO');await leave(kind);await act(async()=>finish({user_id:applicantA}));expect(h.transport).not.toHaveBeenCalled();
  });
  it('saves only the known activity/source and shows saved only after a valid response',async()=>{
    await incoming();h.transport.mockResolvedValueOnce({status:200,body:{invitation:source(),saved:true,saved_at:'2030-01-01T00:00:00Z'}});await click('保存这份邀请到 GO');
    expect(h.transport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({method:'POST',path:`/api/v1/invitations/${applicationId}`,headers:expect.objectContaining({Authorization:'Bearer session-a'}),body:{action:'save',activity_id:applicationActivity}}));expect(document.body.textContent).toContain('已保存这份可转发入口');
  });
  it('keeps save recoverable on a valid-shaped response for a different invitation',async()=>{
    await incoming();h.transport.mockResolvedValueOnce({status:200,body:{invitation:{...source(),invitation_id:applicantB},saved:true,saved_at:'2030-01-01T00:00:00Z'}});await click('保存这份邀请到 GO');expect(document.body.textContent).not.toContain('已保存这份可转发入口');expect(document.body.textContent).toContain('保存这份邀请到 GO');
  });
  it('does not mark saved on a late success after hide/show invalidates the operation',async()=>{
    await incoming();let finish!:(value:unknown)=>void;h.transport.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('保存这份邀请到 GO');await leave('hide');await act(async()=>h.show.forEach(fn=>fn()));await act(async()=>finish({status:200,body:{invitation:source(),saved:true,saved_at:'2030-01-01T00:00:00Z'}}));expect(document.body.textContent).not.toContain('已保存这份可转发入口');expect(document.body.textContent).toContain('保存这份邀请到 GO');
  });
});

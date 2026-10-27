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
const mocks = vi.hoisted(() => ({ token: 'session-a', actor: '', transport: vi.fn(), refresh: vi.fn(), storage: new Map<string, unknown>(), hide: [] as Array<() => void>, show: [] as Array<() => void> }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => mocks.token, transport: mocks.transport }));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro', () => ({ default: { getStorageSync: (key: string) => mocks.storage.get(key), setStorageSync: (key: string, value: unknown) => mocks.storage.set(key, value), removeStorageSync: (key: string) => mocks.storage.delete(key) }, useDidShow: (fn: () => void) => { mocks.show.push(fn); }, useDidHide: (fn: () => void) => { mocks.hide.push(fn); }, useUnload: () => {} }));
import { useApplications } from '../apps/miniprogram/src/features/applications/use-applications';
let state: ReturnType<typeof useApplications>, root: ReturnType<typeof createRoot> | undefined;
function Harness({ actor = applicantA, session = 'session-a', revision = 1, fresh = true, sourceId, sourceReady = true }: { actor?: string; session?: string; revision?: number; fresh?: boolean; sourceId?: string; sourceReady?: boolean }) {
  const detail = applicationDetail(actor); detail.revision = revision;
  state = useApplications({ id: applicationActivity, detail, session, fresh, refresh: mocks.refresh, incomingInvitationId: sourceId, attributionAvailable: sourceReady } as Parameters<typeof useApplications>[0]);
  return createElement('div', {}, state.nickname + ' ' + state.apply.message);
}
beforeEach(() => { mocks.hide = []; mocks.show = []; mocks.token = 'session-a'; mocks.actor = applicantA; mocks.storage.clear(); mocks.refresh.mockReset().mockResolvedValue(undefined); mocks.transport.mockReset().mockImplementation(async request => { if (request.path === '/api/v1/me') return { status: 200, body: { user_id: mocks.actor } }; throw new ApiClientError('NETWORK_ERROR', 'offline response lost', 0); }); });
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ''; });
async function render(props: Parameters<typeof Harness>[0] = {}) { if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); } await act(async () => root!.render(createElement(Harness, props))); }
async function fill() { await act(async () => { state.setSelected([applicationSegment]); state.setNickname('PRIVATE_A_NAME'); }); await act(async () => state.setAccepted(state.confirmation)); }
const writes = () => mocks.transport.mock.calls.filter(call => call[0].method === 'POST');
const keyA = `weego-apply-pending-v1:${applicationActivity}:${applicantA}`;
const sourceId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
describe('invitation attribution captured by the actual application hook', () => {
  it('captures the incoming public source on the original application body', async () => {
    await render({ sourceId }); await fill(); await act(async () => { state.submit(); await Promise.resolve(); });
    expect(writes()).toHaveLength(1); expect(writes()[0][0].body.invitation_source_id).toBe(sourceId);
  });
  it('keeps ordinary no-source application body unchanged', async () => {
    await render(); await fill(); await act(async () => { state.submit(); await Promise.resolve(); });
    expect(writes()).toHaveLength(1); expect(writes()[0][0].body).not.toHaveProperty('invitation_source_id');
  });
});

it('blocks new source-bearing applications until server capability is confirmed, without losing inputs', async () => {
 await render({sourceId,sourceReady:false});await fill();await act(async()=>state.submit());
 expect(writes()).toHaveLength(0);expect(state.nickname).toBe('PRIVATE_A_NAME');expect(state.selected).toEqual([applicationSegment]);
 await render({sourceId,sourceReady:true});await act(async()=>state.submit());expect(writes()).toHaveLength(1);
});
it('changing incoming source preserves inputs but invalidates former confirmation', async()=>{
 await render({sourceId});await fill();await render({sourceId:applicationId});await act(async()=>state.submit());expect(writes()).toHaveLength(0);
 expect(state.nickname).toBe('PRIVATE_A_NAME');await act(async()=>state.setAccepted(state.confirmation));await act(async()=>state.submit());expect(writes()[0][0].body.invitation_source_id).toBe(applicationId);
});
it('unknown retry keeps the original source, body and key even when arriving through another entry or capability is unavailable',async()=>{
 await render({sourceId});await fill();await act(async()=>state.submit());const original=writes()[0][0].body;
 await render({sourceId:applicationId,sourceReady:false});await act(async()=>state.apply.send());
 expect(writes()).toHaveLength(2);expect(writes()[1][0].body).toEqual(original);expect(mocks.storage.get(keyA)).toMatchObject({input:original});
});
it('old pending without source is never retroactively attributed to the current incoming entry',async()=>{
 await render();await fill();await act(async()=>state.submit());const original=writes()[0][0].body;
 await render({sourceId});await act(async()=>state.apply.send());expect(writes()[1][0].body).toEqual(original);expect(writes()[1][0].body).not.toHaveProperty('invitation_source_id');
});
it.each(['source','source-aba','session','hide','unmount','revision'] as const)('blocks source write at final dispatch after %s while me awaits',async(kind)=>{
 await render({sourceId});await fill();let finish!:(v:unknown)=>void;
 mocks.transport.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>state.submit());
 if(kind==='source'||kind==='source-aba'){await render({sourceId:applicationId});if(kind==='source-aba')await render({sourceId});}
 if(kind==='session')mocks.token='session-b';
 if(kind==='hide')await act(async()=>mocks.hide.forEach(fn=>fn()));
 if(kind==='unmount'){await act(async()=>root!.unmount());root=undefined;}
 if(kind==='revision')await render({sourceId,revision:2});
 await act(async()=>finish({status:200,body:{user_id:applicantA}}));expect(writes()).toHaveLength(0);expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.storage.has(keyA)).toBe(true);
});
it('does not acknowledge late source write after unmount; already dispatched write cannot be undone',async()=>{
 await render({sourceId});await fill();let finish!:(v:unknown)=>void;
 mocks.transport.mockImplementation(async request=>request.path==='/api/v1/me'?{status:200,body:{user_id:applicantA}}:new Promise(resolve=>{finish=resolve;}));
 await act(async()=>state.submit());expect(writes()).toHaveLength(1);await act(async()=>root!.unmount());root=undefined;await act(async()=>finish({status:200,body:applicationDetail()}));expect(mocks.refresh).not.toHaveBeenCalled();expect(mocks.storage.has(keyA)).toBe(true);
});
it('old server rejection never strips source and retries as a new direct application',async()=>{
 await render({sourceId});await fill();mocks.transport.mockImplementation(async request=>request.path==='/api/v1/me'?{status:200,body:{user_id:applicantA}}:{status:400,body:{error:{code:'INVALID_INPUT',message:'输入不兼容'},request_id:'fixture'}});
 await act(async()=>state.submit());expect(writes()).toHaveLength(1);expect(writes()[0][0].body.invitation_source_id).toBe(sourceId);expect(state.nickname).toBe('PRIVATE_A_NAME');expect(state.apply.result).toBeUndefined();expect(mocks.storage.has(keyA)).toBe(true);
});
it('only same actor restores source-bearing pending under a renewed session',async()=>{
 await render({sourceId});await fill();await act(async()=>state.submit());const original=writes()[0][0].body;
 mocks.actor=applicantB;mocks.token='session-b';await render({actor:applicantB,session:'session-b',sourceId});expect(state.nickname).toBe('');expect(state.apply.pending).toBeUndefined();await act(async()=>state.apply.send());expect(writes()).toHaveLength(1);
 mocks.actor=applicantA;mocks.token='renewed-a';await render({session:'renewed-a',sourceId});await act(async()=>state.apply.send());expect(writes()[1][0].body).toEqual(original);expect(writes()[1][0].headers.Authorization).toBe('Bearer renewed-a');
});
it('same source normal render or clock-only refresh does not block valid dispatch',async()=>{
 await render({sourceId});await fill();let finish!:(v:unknown)=>void;mocks.transport.mockImplementationOnce(()=>new Promise(resolve=>finish=resolve));await act(async()=>state.submit());await render({sourceId});await act(async()=>finish({status:200,body:{user_id:applicantA}}));expect(writes()).toHaveLength(1);
});

it('definitive new-server source rejection preserves draft but not a known-unexecuted pending operation',async()=>{
 await render({sourceId});await fill();mocks.transport.mockImplementation(async request=>request.path==='/api/v1/me'?{status:200,body:{user_id:applicantA}}:{status:409,body:{error:{code:'INVALID_INPUT',message:'该入口不能用于本次申请'},request_id:'fixture'}});
 await act(async()=>state.submit());expect(writes()).toHaveLength(1);expect(state.nickname).toBe('PRIVATE_A_NAME');expect(mocks.storage.has(keyA)).toBe(false);
});

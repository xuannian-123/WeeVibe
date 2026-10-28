// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
import type { RequirementSnapshot } from '../packages/contracts/src/requirements-api';
import { ApiClientError } from '../packages/api-client/src';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT=true;
const mocks=vi.hoisted(()=>({ request:vi.fn(),modal:vi.fn(),token:'session-a',saved:vi.fn() }));
// Business regressions start after profile completion; the real boundary has separate UI coverage.
vi.mock('../apps/miniprogram/src/features/gatherings/profile-boundary',()=>({GatheringProfileBoundary:({children}:any)=>children}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>mocks.token}));
vi.mock('../apps/miniprogram/src/platform/extension-api',()=>({extensionRequest:mocks.request}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:mocks.modal,setClipboardData:vi.fn()}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Button:(props:Record<string,unknown>)=>createElement('button',{onClick:props.onClick,disabled:props.disabled},props.children as never),Text:(props:Record<string,unknown>)=>createElement('span',{},props.children as never),View:(props:Record<string,unknown>)=>createElement('div',{},props.children as never)}));
vi.mock('../apps/miniprogram/src/features/requirements/draft-editor',()=>({DraftEditor:(props:{disabled:boolean})=>createElement('div',{},props.disabled?'draft locked':'draft editable')}));
import { CollectionEditor } from '../apps/miniprogram/src/features/requirements/collection-editor';
const draft={title:'一起吃饭',description:'',starts_at:'2030-01-10T10:00:00Z',deadline_at:'2030-01-09T10:00:00Z',timezone:'Asia/Shanghai' as const,locations:[{id:'a',label:'公园'}],questions:[]};
function snapshot(revision:number):RequirementSnapshot {return {collection:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'friend',activity_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:draft.title,status:'draft',deadline_at:draft.deadline_at,revision,is_manager:true,has_responded:false,updated_at:'2030-01-01T00:00:00Z',draft,closed_at:null,final_selection:null,organizer_nickname:'朋友'},viewer:{is_manager:true,can_respond:false,can_edit:true,can_publish:true,can_close:false,can_finalize:false,blocked_reason:null},segments:[],own_response:null,manager:null,server_time:'2030-01-01T00:00:00Z'};}
let root:ReturnType<typeof createRoot>|undefined;
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=undefined;document.body.innerHTML='';mocks.request.mockReset();mocks.modal.mockReset();mocks.saved.mockReset();mocks.token='session-a';});
async function click(text:string){const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent?.includes(text));expect(button).toBeTruthy();await act(async()=>{button!.click();await Promise.resolve();});}
describe('uncertain collection creation retry identity audit',()=>{
 it.each([401,403,429,404,405,503])('keeps original creation key after uncertain result then HTTP %s before idempotency lookup',async status=>{
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
  await act(async()=>root!.render(createElement(CollectionEditor,{kind:'team',initial:draft,saved:()=>{}})));
  mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','response lost after commit',0));await click('保存服务器草稿');
  const original=mocks.request.mock.calls[0][2];
  mocks.request.mockRejectedValueOnce(new ApiClientError(status===401?'UNAUTHENTICATED':[404,405].includes(status)?'INVALID_RESPONSE':status===503?'DATABASE_UNAVAILABLE':'FORBIDDEN','retry rejected before idempotency lookup',status));await click('重试原保存请求');
  expect(host.textContent).toContain('draft locked');expect(host.textContent).toContain('重试原保存请求');
  mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','still uncertain',0));
  const button=Array.from(host.querySelectorAll('button')).find(item=>item.textContent==='重试原保存请求'||item.textContent==='保存服务器草稿')!;
  await act(async()=>{button.click();await Promise.resolve();});
  expect(mocks.request.mock.calls[2][2].idempotency_key).toBe(original.idempotency_key);
 });
});

async function renderNew(){const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(createElement(CollectionEditor,{kind:'team',initial:draft,saved:mocks.saved})));return host;}
describe('uncertain create recovery remains bound to its original editor session',()=>{
 it.each(['session-b',''])('never replays A creation under a changed or logged-out session %s',async token=>{
  const host=await renderNew();mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','response lost',0));await click('保存服务器草稿');
  mocks.request.mockRejectedValueOnce(new ApiClientError('UNAUTHENTICATED','expired',401));await click('重试原保存请求');
  mocks.token=token;await click('重试原保存请求');expect(mocks.request).toHaveBeenCalledTimes(2);expect(mocks.saved).not.toHaveBeenCalled();expect(host.textContent).toContain('登录账号已变化');expect(host.textContent).not.toContain('draft locked');
 });
 it('does not publish a late creation result into a different session',async()=>{
  const host=await renderNew();let finish!:(value:RequirementSnapshot)=>void;mocks.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('保存服务器草稿');
  mocks.token='session-b';await act(async()=>finish(snapshot(1)));expect(mocks.saved).not.toHaveBeenCalled();expect(host.textContent).toContain('登录账号已变化');
 });
 it('does not invoke the old page callback after the editor is unmounted',async()=>{
  await renderNew();let finish!:(value:RequirementSnapshot)=>void;mocks.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('保存服务器草稿');
  await act(async()=>root!.unmount());root=undefined;await act(async()=>finish(snapshot(1)));expect(mocks.saved).not.toHaveBeenCalled();
 });
 it('keeps an unconfigured request and never auto-retries just because the form rerenders',async()=>{
  const host=await renderNew();mocks.request.mockRejectedValueOnce(new ApiClientError('NOT_CONFIGURED','not configured',503));await click('保存服务器草稿');
  expect(host.textContent).toContain('draft locked');await act(async()=>root!.render(createElement(CollectionEditor,{kind:'team',initial:draft,saved:mocks.saved})));expect(mocks.request).toHaveBeenCalledTimes(1);expect(mocks.saved).not.toHaveBeenCalled();
 });
 it('unlocks only after a recognized definitive business rejection, then permits a new request',async()=>{
  const host=await renderNew();mocks.request.mockRejectedValueOnce(new ApiClientError('INVALID_INPUT','invalid input',400));await click('保存服务器草稿');const first=mocks.request.mock.calls[0][2].idempotency_key;
  expect(host.textContent).toContain('draft editable');expect(host.textContent).not.toContain('创建结果待核对');mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','uncertain',0));await click('保存服务器草稿');
  expect(mocks.request.mock.calls[1][2].idempotency_key).not.toBe(first);
 });
 it('uses the same original request after rate limit and only becomes saved on an actual success response',async()=>{
  const host=await renderNew();mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','response lost',0));await click('保存服务器草稿');const first=mocks.request.mock.calls[0][2];
  mocks.request.mockRejectedValueOnce(new ApiClientError('FORBIDDEN','rate limited',429));await click('重试原保存请求');expect(mocks.saved).not.toHaveBeenCalled();
  const next=snapshot(1);next.collection.kind='team';next.collection.activity_id=null;next.viewer.can_publish=false;mocks.request.mockResolvedValueOnce(next);await click('重试原保存请求');
  expect(mocks.request.mock.calls[2][2]).toEqual(first);expect(mocks.saved).toHaveBeenCalledExactlyOnceWith(next);expect(host.textContent).toContain('草稿已保存到服务器');expect(host.textContent).not.toContain('创建结果待核对');
 });
});

describe('malformed requirement success preserves the original create request',()=>{
 it('keeps the mounted editor, never calls saved, and retries the identical original key/body',async()=>{
  const host=await renderNew();mocks.request.mockResolvedValueOnce({ok:true,private_info:'PRIVATE_SENTINEL'});await click('保存服务器草稿');
  const first=mocks.request.mock.calls[0][2];expect(mocks.saved).not.toHaveBeenCalled();expect(host.textContent).toContain('draft locked');expect(host.textContent).toContain('响应与当前版本不匹配');expect(host.textContent).not.toContain('PRIVATE_SENTINEL');
  mocks.request.mockResolvedValueOnce({collection:{id:'wrong'}});await click('重试原保存请求');expect(mocks.request.mock.calls[1][2]).toEqual(first);expect(mocks.saved).not.toHaveBeenCalled();
  const next=snapshot(1);next.collection.kind='team';next.collection.activity_id=null;next.viewer.can_publish=false;mocks.request.mockResolvedValueOnce(next);await click('重试原保存请求');
  expect(mocks.request.mock.calls[2][2]).toEqual(first);expect(mocks.saved).toHaveBeenCalledExactlyOnceWith(next);expect(host.textContent).toContain('草稿已保存到服务器');
 });
 it('does not replay an unknown-success draft under a new account',async()=>{
  const host=await renderNew();mocks.request.mockResolvedValueOnce({ok:true});await click('保存服务器草稿');mocks.token='session-b';await click('重试原保存请求');
  expect(mocks.request).toHaveBeenCalledTimes(1);expect(mocks.saved).not.toHaveBeenCalled();expect(host.textContent).toContain('登录账号已变化');expect(host.textContent).not.toContain('draft locked');
 });
});

it('keeps an otherwise valid but wrong-kind create result unknown instead of switching into that activity',async()=>{
 const host=await renderNew();mocks.request.mockResolvedValueOnce(snapshot(1));await click('保存服务器草稿');const first=mocks.request.mock.calls[0][2];
 expect(mocks.saved).not.toHaveBeenCalled();expect(host.textContent).toContain('draft locked');expect(host.textContent).not.toContain('草稿已保存到服务器');
 const next=snapshot(3);next.collection.kind='team';next.collection.activity_id=null;next.viewer.can_publish=false;mocks.request.mockResolvedValueOnce(next);await click('重试原保存请求');
 expect(mocks.request.mock.calls[1][2]).toEqual(first);expect(mocks.saved).toHaveBeenCalledExactlyOnceWith(next);
});

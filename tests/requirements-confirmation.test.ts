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
const mocks=vi.hoisted(()=>({ request:vi.fn(),modal:vi.fn(),token:'session-a',updated:vi.fn() }));
// Business regressions start after profile completion; the real boundary has separate UI coverage.
vi.mock('../apps/miniprogram/src/features/gatherings/profile-boundary',()=>({GatheringProfileBoundary:({children}:any)=>children}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>mocks.token}));
vi.mock('../apps/miniprogram/src/platform/extension-api',()=>({extensionRequest:mocks.request}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:mocks.modal,setClipboardData:vi.fn()}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Button:(props:Record<string,unknown>)=>createElement('button',{onClick:props.onClick,disabled:props.disabled},props.children as never),Text:(props:Record<string,unknown>)=>createElement('span',{},props.children as never),View:(props:Record<string,unknown>)=>createElement('div',{onClick:props.onClick,className:props.className},props.children as never),Input:(props:Record<string,unknown>)=>createElement('input',{value:props.value,disabled:props.disabled}),Textarea:(props:Record<string,unknown>)=>createElement('textarea',{value:props.value,disabled:props.disabled,onInput:(event:{currentTarget:{value:string}})=>(props.onInput as (event:unknown)=>void)?.({detail:{value:event.currentTarget.value}})})}));
vi.mock('../apps/miniprogram/src/features/requirements/draft-editor',()=>({DraftEditor:()=>createElement('div',{},'draft editor')}));
import { ManagerPanel } from '../apps/miniprogram/src/features/requirements/manager-panel';
import { CollectionEditor } from '../apps/miniprogram/src/features/requirements/collection-editor';
const draft={title:'一起吃饭',description:'',starts_at:'2030-01-10T10:00:00Z',deadline_at:'2030-01-09T10:00:00Z',timezone:'Asia/Shanghai' as const,locations:[{id:'a',label:'公园'}],questions:[]};
function snapshot(revision:number):RequirementSnapshot {return {collection:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'friend',activity_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:draft.title,status:'draft',deadline_at:draft.deadline_at,revision,is_manager:true,has_responded:false,updated_at:'2030-01-01T00:00:00Z',draft,closed_at:null,final_selection:null,organizer_nickname:'朋友'},viewer:{is_manager:true,can_respond:false,can_edit:true,can_publish:true,can_close:false,can_finalize:false,blocked_reason:null},segments:[],own_response:null,manager:null,server_time:'2030-01-01T00:00:00Z'};}
let root:ReturnType<typeof createRoot>|undefined;
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=undefined;document.body.innerHTML='';mocks.request.mockReset();mocks.modal.mockReset();mocks.updated.mockReset();mocks.token='session-a';});
async function click(text:string){const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent?.includes(text));expect(button).toBeTruthy();await act(async()=>{button!.click();await Promise.resolve();});}
describe('core confirmation duplicate-click audit (React mocks, no backend/network)',()=>{
 it('publish opens exactly one confirmation while the first dialog is pending',async()=>{
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.modal.mockImplementation(()=>new Promise(()=>{}));
  await act(async()=>root!.render(createElement(CollectionEditor,{kind:'friend',initial:draft,initialSnapshot:snapshot(1),saved:()=>{}})));
  const button=Array.from(host.querySelectorAll('button')).find(item=>item.textContent==='发布需求收集')!;
  await act(async()=>{button.click();button.click();await Promise.resolve();});
  expect(mocks.modal).toHaveBeenCalledTimes(1);expect(mocks.request).not.toHaveBeenCalled();
 });
 it('manual close opens exactly one confirmation while the first dialog is pending',async()=>{
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.modal.mockImplementation(()=>new Promise(()=>{}));
  const current=snapshot(2);current.collection.status='open';current.viewer.can_close=true;current.manager={responses:[],respondent_count:0,questions:[],locations:[],location_other_count:0};
  await act(async()=>root!.render(createElement(ManagerPanel,{snapshot:current,updated:()=>{}})));
  const button=Array.from(host.querySelectorAll('button')).find(item=>item.textContent==='提前截止需求收集')!;
  await act(async()=>{button.click();button.click();await Promise.resolve();});
  expect(mocks.modal).toHaveBeenCalledTimes(1);expect(mocks.request).not.toHaveBeenCalled();
 });
});

type Operation='publish'|'close'|'finalize';
const names={publish:'发布需求收集',close:'提前截止需求收集',finalize:'记录最终选择'};
function operationSnapshot(action:Operation, revision=2){
 const value=snapshot(revision);value.collection.status=action==='publish'?'draft':action==='close'?'open':'closed';
 value.viewer.can_publish=action==='publish';value.viewer.can_close=action==='close';value.viewer.can_finalize=action==='finalize';
 if(action!=='publish')value.manager={responses:[],respondent_count:0,questions:[],locations:[],location_other_count:0};
 return value;
}
async function renderOperation(action:Operation,value=operationSnapshot(action)){
 if(!root){const host=document.createElement('div');document.body.append(host);root=createRoot(host);}
 await act(async()=>root!.render(action==='publish'?createElement(CollectionEditor,{kind:'friend',initial:draft,initialSnapshot:value,saved:mocks.updated}):createElement(ManagerPanel,{snapshot:value,updated:mocks.updated})));
}
function operationButton(action:Operation){const value=Array.from(document.querySelectorAll('button')).find(item=>item.textContent===names[action]);expect(value).toBeTruthy();return value!;}
async function choosePlace(){await act(async()=>{(document.querySelector('.req-option') as HTMLElement).click();});}
async function prepare(action:Operation){await renderOperation(action);if(action==='finalize')await choosePlace();}
function pendingModal(){let finish!:(v:{confirm:boolean})=>void;mocks.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));return (confirm:boolean)=>act(async()=>finish({confirm}));}
describe('publish/close/finalize confirmation lifecycle and latest-state boundary',()=>{
 it('finalization also locks before its confirmation, freezing selected values',async()=>{
  await prepare('finalize');const finish=pendingModal();await act(async()=>{operationButton('finalize').click();operationButton('finalize').click();});
  expect(mocks.modal).toHaveBeenCalledTimes(1);expect((document.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
  await finish(false);expect(operationButton('finalize').disabled).toBe(false);
 });
 it.each(['publish','close','finalize'] as const)('%s: cancellation releases lock and a fresh confirmation can submit once',async action=>{
  await prepare(action);mocks.modal.mockResolvedValueOnce({confirm:false});await click(names[action]);expect(mocks.request).not.toHaveBeenCalled();expect(operationButton(action).disabled).toBe(false);
  mocks.modal.mockResolvedValueOnce({confirm:true});mocks.request.mockResolvedValueOnce(operationSnapshot(action,3));await click(names[action]);
  expect(mocks.request).toHaveBeenCalledTimes(1);expect(mocks.request.mock.calls[0][2]).toMatchObject({action,expected_revision:2});expect(mocks.updated).toHaveBeenCalledTimes(1);
 });
 it.each(['publish','close','finalize'] as const)('%s: modal API failure is caught and leaves no request or stuck lock',async action=>{
  await prepare(action);mocks.modal.mockRejectedValueOnce(new Error('native dialog unavailable'));await click(names[action]);
  expect(mocks.request).not.toHaveBeenCalled();expect(document.body.textContent).toContain('确认未完成');expect(operationButton(action).disabled).toBe(false);
  mocks.modal.mockResolvedValueOnce({confirm:false});await click(names[action]);expect(mocks.modal).toHaveBeenCalledTimes(2);
 });
 it.each(['publish','close','finalize'] as const)('%s: session change during confirmation cannot submit under the new actor',async action=>{
  await prepare(action);const finish=pendingModal();await click(names[action]);mocks.token='session-b';await finish(true);
  expect(mocks.request).not.toHaveBeenCalled();expect(document.body.textContent).toContain('登录账号已变化');expect(mocks.updated).not.toHaveBeenCalled();
 });
 it.each(['publish','close','finalize'] as const)('%s: newer snapshot revision invalidates the old confirmation',async action=>{
  await prepare(action);const finish=pendingModal();await click(names[action]);await renderOperation(action,operationSnapshot(action,3));await finish(true);
  expect(mocks.request).not.toHaveBeenCalled();expect(document.body.textContent).toContain('确认期间');expect(mocks.updated).not.toHaveBeenCalled();
 });
 it.each(['publish','close','finalize'] as const)('%s: changed action permission also invalidates confirmation without a revision increment',async action=>{
  await prepare(action);const finish=pendingModal();await click(names[action]);const changed=operationSnapshot(action);changed.viewer[action==='publish'?'can_publish':action==='close'?'can_close':'can_finalize']=false;await renderOperation(action,changed);await finish(true);
  expect(mocks.request).not.toHaveBeenCalled();expect(mocks.updated).not.toHaveBeenCalled();
 });
 it.each(['publish','close','finalize'] as const)('%s: navigating away while confirming cancels the pending local action',async action=>{
  await prepare(action);const finish=pendingModal();await click(names[action]);await act(async()=>root!.unmount());root=undefined;await finish(true);
  expect(mocks.request).not.toHaveBeenCalled();expect(mocks.updated).not.toHaveBeenCalled();
 });
 it.each(['publish','close','finalize'] as const)('%s: a late response must not overwrite a newer screen snapshot',async action=>{
  await prepare(action);mocks.modal.mockResolvedValueOnce({confirm:true});let finish!:(v:RequirementSnapshot)=>void;mocks.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click(names[action]);
  await renderOperation(action,operationSnapshot(action,4));await act(async()=>finish(operationSnapshot(action,3)));
  expect(mocks.updated).not.toHaveBeenCalled();expect(document.body.textContent).toContain('未覆盖较新的');
 });
 it('keeps the manual decision note and selection after a network failure without claiming success',async()=>{
  await prepare('finalize');await act(async()=>{const textarea=document.querySelector('textarea')!;textarea.value='保留人工说明';textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  mocks.modal.mockResolvedValueOnce({confirm:true});mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','结果未确认',0));await click(names.finalize);
  expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('保留人工说明');expect(document.body.textContent).not.toContain('最终选择已记录');expect(operationButton('finalize').disabled).toBe(false);
  expect(mocks.request.mock.calls[0][2].final_selection).toEqual({location_id:'a',location_other:null,note:'保留人工说明'});
 });
});

describe('manager commands reject malformed success payloads before callbacks',()=>{
 it.each(['publish','close','finalize'] as const)('%s keeps the form and does not announce success for HTTP 200 incompatible JSON',async action=>{
  await prepare(action);mocks.modal.mockResolvedValueOnce({confirm:true});mocks.request.mockResolvedValueOnce({ok:true,private_info:'PRIVATE_SENTINEL'});await click(names[action]);
  expect(mocks.updated).not.toHaveBeenCalled();expect(document.body.textContent).toContain('响应与当前版本不匹配');expect(document.body.textContent).not.toContain('PRIVATE_SENTINEL');expect(operationButton(action).disabled).toBe(false);
  mocks.modal.mockResolvedValueOnce({confirm:true});mocks.request.mockResolvedValueOnce(operationSnapshot(action,3));await click(names[action]);expect(mocks.updated).toHaveBeenCalledTimes(1);
 });
});

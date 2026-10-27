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
const mocks=vi.hoisted(()=>({ request:vi.fn(),modal:vi.fn(),token:'session-a' }));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>mocks.token}));
vi.mock('../apps/miniprogram/src/platform/extension-api',()=>({extensionRequest:mocks.request}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:mocks.modal,setClipboardData:vi.fn()}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Button:(props:Record<string,unknown>)=>createElement('button',{onClick:props.onClick,disabled:props.disabled},props.children as never),Text:(props:Record<string,unknown>)=>createElement('span',{},props.children as never),View:(props:Record<string,unknown>)=>createElement('div',{},props.children as never)}));
vi.mock('../apps/miniprogram/src/features/requirements/draft-editor',()=>({DraftEditor:()=>createElement('div',{},'draft editor')}));
import { CollectionEditor } from '../apps/miniprogram/src/features/requirements/collection-editor';
const draft={title:'一起吃饭',description:'',starts_at:'2030-01-10T10:00:00Z',deadline_at:'2030-01-09T10:00:00Z',timezone:'Asia/Shanghai' as const,locations:[{id:'a',label:'公园'}],questions:[]};
function snapshot(revision:number):RequirementSnapshot {return {collection:{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',kind:'friend',activity_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:draft.title,status:'draft',deadline_at:draft.deadline_at,revision,is_manager:true,has_responded:false,updated_at:'2030-01-01T00:00:00Z',draft,closed_at:null,final_selection:null,organizer_nickname:'朋友'},viewer:{is_manager:true,can_respond:false,can_edit:true,can_publish:true,can_close:false,can_finalize:false,blocked_reason:null},segments:[],own_response:null,manager:null,server_time:'2030-01-01T00:00:00Z'};}
let root:ReturnType<typeof createRoot>|undefined;
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=undefined;document.body.innerHTML='';mocks.request.mockReset();mocks.modal.mockReset();mocks.token='session-a';});
async function click(text:string){const button=Array.from(document.querySelectorAll('button')).find(item=>item.textContent?.includes(text));expect(button).toBeTruthy();await act(async()=>{button!.click();await Promise.resolve();});}
describe('requirement editor recovery and actor binding',()=>{
 it('recovers committed-save/lost-response after explicit server-version confirmation',async()=>{
   const host=document.createElement('div');document.body.append(host);root=createRoot(host);
   const render=async(value:RequirementSnapshot)=>act(async()=>root!.render(createElement(CollectionEditor,{kind:'friend',initial:draft,initialSnapshot:value,saved:()=>{}})));
   await render(snapshot(1));mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','response lost',0));await click('再次保存');expect(mocks.request.mock.calls[0]?.[2]).toMatchObject({expected_revision:1});
   await render(snapshot(2));expect(host.textContent).toContain('当前输入不会被自动覆盖');mocks.modal.mockResolvedValueOnce({confirm:true});await click('加载服务器版本并恢复编辑');mocks.request.mockResolvedValueOnce(snapshot(3));await click('再次保存');expect(mocks.request.mock.calls[1]?.[2]).toMatchObject({expected_revision:2});
 });
 it('rejects an old editor write before transport after session changes',async()=>{
   const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root!.render(createElement(CollectionEditor,{kind:'friend',initial:draft,initialSnapshot:snapshot(1),saved:()=>{}})));mocks.token='session-b';await click('再次保存');expect(mocks.request).not.toHaveBeenCalled();expect(host.textContent).toContain('登录账号已变化');
 });
});

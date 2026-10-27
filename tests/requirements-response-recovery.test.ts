// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act,useState}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
import {ApiClientError} from '../packages/api-client/src';
import type {RequirementSnapshot} from '../packages/contracts/src/requirements-api';
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const mocks=vi.hoisted(()=>({token:'session-a',request:vi.fn(),modal:vi.fn(),clipboard:vi.fn()}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>mocks.token}));
vi.mock('../apps/miniprogram/src/platform/extension-api',()=>({extensionRequest:mocks.request}));
vi.mock('../apps/miniprogram/src/platform/page-state',()=>({errorText:(e:unknown)=>e instanceof Error?e.message:'error'}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:mocks.modal,setClipboardData:mocks.clipboard}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({
 Button:(p:Record<string,unknown>)=>createElement('button',{onClick:p.onClick,disabled:p.disabled},p.children as never),
 Text:(p:Record<string,unknown>)=>createElement('span',{},p.children as never),
 View:(p:Record<string,unknown>)=>createElement('div',{onClick:p.onClick},p.children as never),
 Input:(p:Record<string,unknown>)=>createElement('input',{value:p.value,disabled:p.disabled,placeholder:p.placeholder,onInput:(e:{currentTarget:{value:string}})=>(p.onInput as (event:unknown)=>void)?.({detail:{value:e.currentTarget.value}})}),
 Textarea:(p:Record<string,unknown>)=>createElement('textarea',{value:p.value,disabled:p.disabled,placeholder:p.placeholder,onInput:(e:{currentTarget:{value:string}})=>(p.onInput as (event:unknown)=>void)?.({detail:{value:e.currentTarget.value}})})
}));
import {ResponseForm} from '../apps/miniprogram/src/features/requirements/response-form';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function snapshot(version=1):RequirementSnapshot{return {
 collection:{id,kind:'friend',activity_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'朋友聚会',status:'open',deadline_at:'2030-01-30T00:00:00Z',revision:1,is_manager:false,has_responded:true,updated_at:'2030-01-01T00:00:00Z',draft:{title:'朋友聚会',description:'',starts_at:'2030-02-01T00:00:00Z',deadline_at:'2030-01-30T00:00:00Z',timezone:'Asia/Shanghai',locations:[{id:'park',label:'公园'}],questions:[]},closed_at:null,final_selection:null,organizer_nickname:'发起人'},
 viewer:{is_manager:false,can_respond:true,can_edit:false,can_publish:false,can_close:false,can_finalize:false,blocked_reason:null},segments:[],manager:null,server_time:'2030-01-02T00:00:00Z',
 own_response:{user_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',revision:1,response_version:version,updated_at:`2030-01-0${version}T01:00:00Z`,nickname:'我',selected_segment_ids:[],answers:[],location_ids:['park'],location_other:null,time_preferences:'周末',budget_note:version===1?'旧预算':'服务器新预算',preferences:'轻松',private_origin:{label:'私人地址'}}
};}
let root:ReturnType<typeof createRoot>|undefined;let host:HTMLDivElement;
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);mocks.token='session-a';mocks.request.mockReset();mocks.modal.mockReset();mocks.clipboard.mockReset().mockResolvedValue({});});
afterEach(async()=>{await act(async()=>root?.unmount());document.body.innerHTML='';});
const render=(s:RequirementSnapshot)=>act(async()=>root!.render(createElement(ResponseForm,{snapshot:s,updated:()=>{}})));
function ConnectedForm({initial}:{initial:RequirementSnapshot}){const [current,setCurrent]=useState(initial);return createElement(ResponseForm,{snapshot:current,updated:setCurrent});}
const connected=(s:RequirementSnapshot)=>act(async()=>root!.render(createElement(ConnectedForm,{initial:s})));
function button(part:string){const b=Array.from(host.querySelectorAll('button')).find(e=>e.textContent?.includes(part));expect(b).toBeTruthy();return b!;}
async function click(part:string){await act(async()=>{button(part).click();await Promise.resolve();});}
const budget=()=>host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="只是意向"]')!;
async function editBudget(value:string){await act(async()=>{budget().value=value;budget().dispatchEvent(new Event('input',{bubbles:true}));});}
describe('own requirement response server-version recovery',()=>{
 it('does not label refreshed server data as the unchanged older form or silently submit it',async()=>{await render(snapshot());await render(snapshot(2));expect(budget().value).toBe('旧预算');expect(host.textContent).toContain('服务器中的本人答卷已更新');expect(button('更新我的需求').disabled).toBe(true);await click('更新我的需求');expect(mocks.request).not.toHaveBeenCalled();});
 it('preserves dirty local input if recovery is cancelled',async()=>{await render(snapshot());await editBudget('本机尚未保存预算');await render(snapshot(2));mocks.modal.mockResolvedValueOnce({confirm:false});await click('加载服务器答卷');expect(budget().value).toBe('本机尚未保存预算');expect(mocks.request).not.toHaveBeenCalled();});
 it('loads a confirmed server version and only then permits an updated submission',async()=>{await render(snapshot());await editBudget('本机旧修改');await render(snapshot(2));mocks.modal.mockResolvedValueOnce({confirm:true});await click('加载服务器答卷');expect(budget().value).toBe('服务器新预算');mocks.request.mockResolvedValueOnce(snapshot(3));await click('更新我的需求');expect(mocks.request).toHaveBeenCalledWith(`/api/v1/requirements/${id}`,'POST',expect.objectContaining({expected_response_version:2,response:expect.objectContaining({budget_note:'服务器新预算'})}));});
 it('locks the recovery dialog before awaiting it, so repeated clicks do not duplicate confirmation',async()=>{await render(snapshot());await render(snapshot(2));let finish!:(value:{confirm:boolean})=>void;mocks.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await act(async()=>{button('加载服务器答卷').click();button('加载服务器答卷').click();await Promise.resolve();});expect(mocks.modal).toHaveBeenCalledTimes(1);await act(async()=>finish({confirm:false}));expect(budget().value).toBe('旧预算');expect(mocks.request).not.toHaveBeenCalled();});
 it('keeps input if another newer server response arrives during confirmation',async()=>{await render(snapshot());await editBudget('保留本机稿');await render(snapshot(2));let finish!:(value:{confirm:boolean})=>void;mocks.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('加载服务器答卷');await render(snapshot(3));await act(async()=>finish({confirm:true}));expect(budget().value).toBe('保留本机稿');expect(host.textContent).toContain('确认期间服务器答卷再次更新');expect(mocks.request).not.toHaveBeenCalled();});
 it('still refuses writes after recovering an answer from a closed collection',async()=>{await render(snapshot());const closed=snapshot(2);closed.collection.status='closed';closed.viewer.can_respond=false;closed.viewer.blocked_reason='需求已截止';await render(closed);mocks.modal.mockResolvedValueOnce({confirm:true});await click('加载服务器答卷');expect(budget().value).toBe('服务器新预算');expect(button('更新我的需求').disabled).toBe(true);await click('更新我的需求');expect(mocks.request).not.toHaveBeenCalled();});
 it('copies an incomplete public draft without requiring a valid submission or copying private origin',async()=>{const current=snapshot();current.collection.draft.questions=[{id:'q1',title:'尚未回答的必答题',multiple:false,required:true,segment_id:null,options:[{id:'o1',label:'选项'}]}];await render(current);await click('复制当前输入');expect(mocks.clipboard).toHaveBeenCalledTimes(1);const copied=JSON.parse(mocks.clipboard.mock.calls[0][0].data);expect(copied.budget_note).toBe('旧预算');expect(copied).not.toHaveProperty('private_origin');expect(JSON.stringify(copied)).not.toContain('私人地址');});
 it('preserves saved private coordinates when only a public budget field is edited',async()=>{const current=snapshot();current.own_response!.private_origin={longitude:121.4,latitude:31.2,crs:'GCJ-02'};await render(current);await editBudget('修改预算');mocks.request.mockResolvedValueOnce({...current,own_response:{...current.own_response!,response_version:2}});await click('保存我的需求');expect(mocks.request.mock.calls[0][2].response.private_origin).toEqual(current.own_response!.private_origin);});
 it('does not load old account data if the session changes while confirming',async()=>{await render(snapshot());await render(snapshot(2));let finish!:(value:{confirm:boolean})=>void;mocks.modal.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('加载服务器答卷');mocks.token='session-b';await act(async()=>finish({confirm:true}));expect(host.textContent).toContain('登录账号已变化');expect(mocks.request).not.toHaveBeenCalled();});

 it('only removes an existing private location after an explicit clear action',async()=>{const current=snapshot();current.own_response!.private_origin={longitude:121.4,latitude:31.2,crs:'GCJ-02'};await render(current);await click('清空私人出发地点');mocks.request.mockResolvedValueOnce({...current,own_response:{...current.own_response!,response_version:2}});await click('保存我的需求');expect(mocks.request.mock.calls[0][2].response.private_origin).toBeNull();});

 it('sends version zero only for the first answer and accepts a confirmed version-one save',async()=>{
  const current=snapshot();current.own_response=null;await connected(current);await editBudget('首次预算');mocks.request.mockResolvedValueOnce(snapshot());await click('保存我的需求');
  expect(mocks.request.mock.calls[0][2].expected_response_version).toBe(0);expect(host.textContent).toContain('需求已保存');expect(host.textContent).not.toContain('服务器中的本人答卷已更新');
 });
 it('keeps dirty input and blocks further saves on server CAS conflict until explicitly refreshed and recovered',async()=>{
  await connected(snapshot());await editBudget('本机未保存');mocks.request.mockRejectedValueOnce(new ApiClientError('VERSION_CONFLICT','请刷新核对',409));await click('保存我的需求');
  expect(mocks.request.mock.calls[0][2].expected_response_version).toBe(1);expect(budget().value).toBe('本机未保存');expect(button('保存我的需求').disabled).toBe(true);await click('保存我的需求');expect(mocks.request).toHaveBeenCalledTimes(1);
  mocks.request.mockResolvedValueOnce(snapshot(2));await click('刷新服务器答卷');expect(budget().value).toBe('本机未保存');expect(button('保存我的需求').disabled).toBe(true);
  mocks.modal.mockResolvedValueOnce({confirm:false});await click('加载服务器答卷');expect(budget().value).toBe('本机未保存');
  mocks.modal.mockResolvedValueOnce({confirm:true});await click('加载服务器答卷');mocks.request.mockResolvedValueOnce(snapshot(3));await click('更新我的需求');
  expect(mocks.request.mock.calls[2][2].expected_response_version).toBe(2);expect(host.textContent).toContain('需求已保存');expect(host.textContent).not.toContain('服务器中的本人答卷已更新');
 });
 it('does not treat a retry after a lost success as an idempotent successful write',async()=>{
  await connected(snapshot());await editBudget('发送稿');mocks.request.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','保存响应丢失',0));await click('保存我的需求');
  expect(host.textContent).not.toContain('需求已保存。');mocks.request.mockRejectedValueOnce(new ApiClientError('VERSION_CONFLICT','答卷已保存过',409));await click('保存我的需求');
  expect(mocks.request.mock.calls.map(call=>call[2].expected_response_version)).toEqual([1,1]);expect(host.textContent).toContain('重复原请求不会被当作保存成功');expect(budget().value).toBe('发送稿');
  mocks.request.mockResolvedValueOnce(snapshot(2));await click('刷新服务器答卷');expect(mocks.request.mock.calls[2][1]).toBeUndefined();expect(budget().value).toBe('发送稿');
 });
 it('retains input and conflict block if refreshing fails; double refresh clicks start one GET',async()=>{
  await connected(snapshot());await editBudget('保留稿');mocks.request.mockRejectedValueOnce(new ApiClientError('VERSION_CONFLICT','冲突',409));await click('保存我的需求');
  let fail!:(e:unknown)=>void;mocks.request.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));await act(async()=>{button('刷新服务器答卷').click();button('刷新服务器答卷').click();await Promise.resolve();});
  expect(mocks.request).toHaveBeenCalledTimes(2);await act(async()=>fail(new ApiClientError('NETWORK_ERROR','刷新失败',0)));expect(budget().value).toBe('保留稿');expect(button('保存我的需求').disabled).toBe(true);expect(host.textContent).toContain('刷新失败');
 });
 it('does not submit an old backend snapshot with missing answer version',async()=>{
  const old=snapshot();delete (old.own_response as Partial<NonNullable<RequirementSnapshot['own_response']>>).response_version;await connected(old);await click('更新我的需求');
  expect(mocks.request).not.toHaveBeenCalled();expect(host.textContent).toContain('后端未提供答卷版本');expect(host.textContent).not.toContain('需求已保存。');
 });
 it('hides old account inputs when session changes while conflict refresh is pending',async()=>{
  await connected(snapshot());mocks.request.mockRejectedValueOnce(new ApiClientError('VERSION_CONFLICT','冲突',409));await click('更新我的需求');
  let finish!:(s:RequirementSnapshot)=>void;mocks.request.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('刷新服务器答卷');mocks.token='session-b';await act(async()=>finish(snapshot(2)));
  expect(host.textContent).toContain('登录账号已变化');expect(host.textContent).not.toContain('服务器新预算');expect(host.querySelector('textarea')).toBeNull();
 });

});

it('retains local answers when an apparent save has an own answer version but lacks the rest of the contract',async()=>{
 await connected(snapshot());await editBudget('仍需保留的预算');mocks.request.mockResolvedValueOnce({own_response:{response_version:2,updated_at:'2030-01-02T01:00:00Z'},private_info:'PRIVATE_SENTINEL'});await click('保存我的需求');
 expect(budget().value).toBe('仍需保留的预算');expect(host.textContent).toContain('响应与当前版本不匹配');expect(host.textContent).not.toContain('需求已保存。');expect(host.textContent).not.toContain('PRIVATE_SENTINEL');
 mocks.request.mockResolvedValueOnce(snapshot(2));await click('保存我的需求');expect(mocks.request.mock.calls[1][2].expected_response_version).toBe(1);expect(host.textContent).toContain('需求已保存。');
});

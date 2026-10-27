// @vitest-environment jsdom
import { Messages } from '../apps/miniprogram/src/features/shell/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const ReactBase=requireMini('react');
const {createElement,act}=ReactBase;
const {createRoot}=requireMini('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const mocks=vi.hoisted(()=>({navigate:vi.fn(),toast:vi.fn(),search:vi.fn(),token:'session-a',transport:vi.fn(),me:vi.fn(),login:vi.fn(),show:undefined as undefined|(()=>void),saved:vi.fn(),close:vi.fn()}));
// Focus this historical suite on the original account boundary. Actual Home +
// real TodoPanel lifecycle/account isolation is exercised in todos-ui.test.ts.
vi.mock('../apps/miniprogram/src/features/todos/TodoPanel', () => ({ TodoPanel: () => null }));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>mocks.token,transport:mocks.transport,api:{me:mocks.me,searchVenues:mocks.search},establishSession:mocks.login,forgetSession:()=>{mocks.token='';}}));
vi.mock('../apps/miniprogram/src/platform/avatar',()=>({loadAvatar:vi.fn().mockResolvedValue(undefined),uploadAvatar:vi.fn()}));
vi.mock('../apps/miniprogram/src/features/team',()=>({TeamCreate:()=>createElement('div',{},'team editor')}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{getStorageSync:()=>'',setStorageSync:vi.fn(),reLaunch:vi.fn(),navigateTo:mocks.navigate,showToast:mocks.toast},useDidShow:(fn:()=>void)=>{mocks.show=fn;},useDidHide:()=>{},useUnload:()=>{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({
 Switch:(p:any)=>createElement('input',{type:'checkbox',checked:p.checked,disabled:p.disabled,onChange:(e:any)=>p.onChange?.({detail:{value:e.currentTarget.checked}})}),
 ScrollView:(p:any)=>createElement('div',{className:p.className},p.children),Button:(p:any)=>createElement('button',{onClick:p.onClick,disabled:p.disabled},p.children),Text:(p:any)=>createElement('span',{onClick:p.onClick},p.children),View:(p:any)=>createElement('div',{onClick:p.onClick},p.children),Input:(p:any)=>createElement('input',{value:p.value,placeholder:p.placeholder,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})}),Textarea:(p:any)=>createElement('textarea',{value:p.value,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})}),Picker:(p:any)=>createElement('div',{},p.children),Image:()=>null}));
import { accountActor, accountActivity, accountVenue, emptyAccountFixture } from './account-fixtures';
import Home from '../apps/miniprogram/src/pages/index/index';
import {ProfileForm} from '../apps/miniprogram/src/features/shell/profile';
import {Inspiration} from '../apps/miniprogram/src/features/shell/inspiration';
import {ApiClientError} from '../packages/api-client/src';
class Boundary extends ReactBase.Component {state={failed:false};static getDerivedStateFromError(){return {failed:true};}render(){return this.state.failed?createElement('div',{},'SCREEN_CRASH'):this.props.children;}}
let root:any;
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=undefined;document.body.innerHTML='';vi.restoreAllMocks();mocks.token='session-a';mocks.transport.mockReset();mocks.me.mockReset();mocks.login.mockReset();mocks.saved.mockReset();mocks.close.mockReset();mocks.navigate.mockReset();mocks.toast.mockReset();mocks.search.mockReset();});
async function render(element:any){vi.spyOn(console,'error').mockImplementation(()=>{});const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(Boundary,null,element)));return host;}
async function click(text:string){const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);expect(button).toBeTruthy();await act(async()=>{button!.click();await Promise.resolve();});}
describe('account UI recovery: actual components and extension client, fake transport only',()=>{
 it('keeps four tabs and shows explicit unavailable login without inventing account success',async()=>{
  mocks.token='';mocks.login.mockRejectedValueOnce(new ApiClientError('NOT_CONFIGURED','no config',503));const host=await render(createElement(Home));await click('微信登录');
  expect(host.textContent).toContain('尚未配置正式 API 或数据库');expect(host.textContent).not.toContain('SCREEN_CRASH');expect(mocks.me).not.toHaveBeenCalled();expect(mocks.transport).not.toHaveBeenCalled();
  for(const tab of ['GO','灵感','消息','我的'])expect(host.textContent).toContain(tab);
 });
 it('does not crash GO when account endpoint returns incompatible HTTP 200 JSON',async()=>{
  mocks.me.mockResolvedValueOnce({user_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'});mocks.transport.mockResolvedValueOnce({status:200,body:{ok:true}});const host=await render(createElement(Home));await act(async()=>{mocks.show!();await Promise.resolve();});
  expect(host.textContent).not.toContain('SCREEN_CRASH');expect(host.textContent).toMatch(/响应|版本|无法验证/);
 });
 it('does not close or falsely save profile on incompatible HTTP 200 and keeps the typed nickname',async()=>{
  const host=await render(createElement(ProfileForm,{ownerSession:mocks.token,initial:{nickname:'原昵称'},saved:mocks.saved,close:mocks.close}));const input=host.querySelector('input')!;await act(async()=>{input.value='尚未确认昵称';input.dispatchEvent(new Event('input',{bubbles:true}));});mocks.transport.mockResolvedValueOnce({status:200,body:{ok:true}});await click('保存资料');
  expect({saved:mocks.saved.mock.calls.length,closed:mocks.close.mock.calls.length,nickname:input.value}).toEqual({saved:0,closed:0,nickname:'尚未确认昵称'});
 });
 it('keeps profile input for unrecognized HTML404 and explicitly leaves the result uncertain',async()=>{
  const host=await render(createElement(ProfileForm,{ownerSession:mocks.token,initial:{nickname:'保留昵称'},saved:mocks.saved,close:mocks.close}));mocks.transport.mockResolvedValueOnce({status:404,body:'<html>PRIVATE_SENTINEL</html>'});await click('保存资料');expect(mocks.saved).not.toHaveBeenCalled();expect(mocks.close).not.toHaveBeenCalled();expect(host.querySelector('input')?.value).toBe('保留昵称');expect(host.textContent).toContain('写入结果未确认');expect(host.textContent).not.toContain('PRIVATE_SENTINEL');
 });
 it('keeps the inspiration page recoverable when favorites GET returns incompatible HTTP 200',async()=>{
  const host=await render(createElement(Inspiration,{city:'北京',authenticated:true,login:()=>{}}));mocks.transport.mockResolvedValueOnce({status:200,body:{ok:true}});await click('我的收藏');expect(host.textContent).not.toContain('SCREEN_CRASH');expect(host.textContent).toMatch(/响应|版本|无法验证/);
 });
});

async function showSavedVenue(){const host=await render(createElement(Inspiration,{city:'北京',authenticated:true,login:()=>{}}));const account=emptyAccountFixture();account.favorites=[accountVenue()];mocks.transport.mockResolvedValueOnce({status:200,body:account});await click('我的收藏');return host;}
describe('account mutations do not manufacture success or lose current local state',()=>{
 it('keeps a displayed favorite after an unknown removal result and allows a verified retry',async()=>{
  const host=await showSavedVenue();mocks.transport.mockResolvedValueOnce({status:200,body:{ok:true}});await click('取消收藏');expect(host.textContent).toContain('离线测试公园');expect(host.textContent).toContain('响应无法验证');expect(mocks.toast).not.toHaveBeenCalled();
  mocks.transport.mockResolvedValueOnce({status:200,body:emptyAccountFixture()});await click('取消收藏');expect(host.textContent).not.toContain('离线测试公园');
 });
 it('does not toast a new favorite as saved after a malformed response',async()=>{
  const host=await render(createElement(Inspiration,{city:'北京',authenticated:true,login:()=>{}}));// Search now uses the real fixed-session client; retain the original favorite assertion with a valid transport projection.
  mocks.transport.mockResolvedValueOnce({status:200,body:{source:accountVenue().source,venues:[accountVenue()],excluded_count:0,pagination:false}});await click('搜索地点');mocks.transport.mockResolvedValueOnce({status:200,body:{ok:true}});await click('收藏地点');expect(mocks.toast).not.toHaveBeenCalled();expect(host.textContent).toContain('离线测试公园');
 });
 it('cannot act on A favorites after the session changes to B',async()=>{
  const host=await showSavedVenue();mocks.token='session-b';await click('取消收藏');expect(mocks.transport).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('登录账号已变化');expect(host.textContent).not.toContain('离线测试公园');
 });
 it('does not close A profile or publish a late success under B',async()=>{
  await render(createElement(ProfileForm,{ownerSession:mocks.token,initial:{nickname:'A私人昵称'},saved:mocks.saved,close:mocks.close}));let finish!:(value:unknown)=>void;mocks.transport.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('保存资料');mocks.token='session-b';await act(async()=>finish({status:200,body:emptyAccountFixture()}));expect(mocks.saved).not.toHaveBeenCalled();expect(mocks.close).not.toHaveBeenCalled();
 });
 it('leaves a message unread and does not navigate when its read-mark success is incompatible',async()=>{
  const value={messages:[{id:`application:${accountActor}:approved`,activity_id:accountActivity,title:'审批测试通知',summary:'报名已通过',created_at:'2030-01-01T00:00:00Z',read:false,pending:false,status:'已加入',section:'activity' as const}],unread_count:1,pending_count:0,server_time:'2030-01-01T00:00:00Z',limit:100 as const};
  const changed=vi.fn();const host=await render(createElement(Messages,{value,session:mocks.token,error:'',refresh:()=>{},changed}));mocks.transport.mockResolvedValueOnce({status:200,body:{ok:true}});
  const notice=Array.from(host.querySelectorAll('button')).find(s=>s.textContent?.includes('审批测试通知'))!;await act(async()=>{notice.click();await Promise.resolve();});
  expect(host.textContent).toContain('审批测试通知');expect(host.textContent).toContain('响应无法验证');expect(mocks.navigate).not.toHaveBeenCalled();expect(changed).not.toHaveBeenCalled();
 });
});

describe('unknown account state and actor switch presentation',()=>{
 it('does not label a failed account read as an empty messages list',async()=>{
  mocks.me.mockResolvedValueOnce({user_id:accountActor});mocks.transport.mockResolvedValueOnce({status:404,body:'<html>missing</html>'});const host=await render(createElement(Home));await act(async()=>{mocks.show!();await Promise.resolve();});
  const tab=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('消息'))!;await act(async()=>tab.click());expect(host.textContent).not.toContain('暂时没有新消息');expect(host.textContent).toMatch(/无法确认|尚未读取/);
 });
 it('hides A activity data immediately while reading a different B session',async()=>{
  const value={...emptyAccountFixture(),activities:[{activity_id:accountActivity,title:'A的私有活动',starts_at:null,ends_at:null,timezone:'UTC',status:'待参加',location:''}]};delete (value as any).activity_records;
  mocks.me.mockResolvedValueOnce({user_id:accountActor});mocks.transport.mockResolvedValueOnce({status:200,body:value});const host=await render(createElement(Home));await act(async()=>{mocks.show!();await Promise.resolve();});expect(host.textContent).toContain('A的私有活动');
  mocks.token='session-b';mocks.me.mockImplementationOnce(()=>new Promise(()=>{}));await act(async()=>{mocks.show!();await Promise.resolve();});expect(host.textContent).not.toContain('A的私有活动');
 });
 it('hides old private profile inputs after an account change is observed',async()=>{
  const host=await render(createElement(ProfileForm,{ownerSession:mocks.token,initial:{nickname:'A私人昵称'},saved:mocks.saved,close:mocks.close}));mocks.token='session-b';await click('保存资料');expect(mocks.transport).not.toHaveBeenCalled();expect(host.querySelector('input')).toBeNull();expect(host.textContent).toContain('账号已');
 });
});

it('binds profile initial data to its source session rather than the currently mounted token',async()=>{
 mocks.token='session-b';const host=await render(createElement(ProfileForm,{ownerSession:'session-a',initial:{nickname:'PRIVATE_A_NICKNAME'},saved:mocks.saved,close:mocks.close}));expect(host.querySelector('input')).toBeNull();expect(host.textContent).toContain('原账号的私人资料已隐藏');expect(mocks.transport).not.toHaveBeenCalled();
});

it('keeps unsaved profile input during a same-account background refresh failure',async()=>{
 const value=emptyAccountFixture();value.profile.nickname='服务器昵称';mocks.me.mockResolvedValueOnce({user_id:accountActor});mocks.transport.mockResolvedValueOnce({status:200,body:value});const host=await render(createElement(Home));await act(async()=>{mocks.show!();await Promise.resolve();});
 const tab=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='○我的')!;await act(async()=>tab.click());const entry=Array.from(host.querySelectorAll('button')).find(s=>s.textContent==='编辑资料')!;await act(async()=>entry.click());const input=host.querySelector('input')!;await act(async()=>{input.value='本机未保存昵称';input.dispatchEvent(new Event('input',{bubbles:true}));});
 mocks.me.mockResolvedValueOnce({user_id:accountActor});mocks.transport.mockResolvedValueOnce({status:404,body:'<html>missing</html>'});await act(async()=>{mocks.show!();await Promise.resolve();});
 expect(host.querySelector('input')?.value).toBe('本机未保存昵称');expect(host.textContent).toContain('HTTP 404');expect(mocks.token).toBe('session-a');
});

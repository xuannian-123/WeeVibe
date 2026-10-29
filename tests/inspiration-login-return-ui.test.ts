// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { accountActor, accountVenue, emptyAccountFixture } from '../tests/account-fixtures';
const req = createRequire(resolve(process.cwd(), 'apps/miniprogram/package.json'));
const { createElement, act } = req('react'); const { createRoot } = req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const h = vi.hoisted(() => ({ token:'audit-location-a', navigate:vi.fn(), avatar:vi.fn(), transport:vi.fn(), native:vi.fn(), map:vi.fn(), toast:vi.fn(), login:vi.fn(), storage:new Map<string,unknown>(), writes:vi.fn(), hooks:{show:new Set<()=>void>(),hide:new Set<()=>void>(),unload:new Set<()=>void>()} }));
vi.mock('../apps/miniprogram/src/platform/api', async () => {
  const { createApiClient } = await import('../packages/api-client/src/index');
  return { getToken:()=>h.token||undefined, transport:h.transport, api:createApiClient(h.transport,()=>h.token), establishSession:h.login, forgetSession:()=>{h.token='';} };
});
vi.mock('../apps/miniprogram/src/platform/avatar',()=>({loadAvatar:h.avatar}));
vi.mock('../apps/miniprogram/src/features/todos/TodoPanel',()=>({TodoPanel:()=>null}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',async()=>{
  const {createRequire}=await import('node:module');const {resolve}=await import('node:path');const {useRef,useEffect}=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'))('react');
  const hook=(kind:'show'|'hide'|'unload',cb:()=>void)=>{const ref=useRef(cb);ref.current=cb;useEffect(()=>{const fn=()=>ref.current();h.hooks[kind].add(fn);return()=>{h.hooks[kind].delete(fn);};},[]);};
  return {default:{getLocation:h.native,openLocation:h.map,showToast:h.toast,getStorageSync:(k:string)=>h.storage.get(k)??'',setStorageSync:(k:string,v:unknown)=>{h.writes(k,v);h.storage.set(k,v);},navigateTo:h.navigate,reLaunch:vi.fn()},usePageScroll:()=>{},useDidShow:(f:()=>void)=>hook('show',f),useDidHide:(f:()=>void)=>hook('hide',f),useUnload:(f:()=>void)=>hook('unload',f)};
});
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({
 Switch:(p:any)=>createElement('input',{type:'checkbox',checked:p.checked,disabled:p.disabled,onChange:(e:any)=>p.onChange?.({detail:{value:e.currentTarget.checked}})}),
 ScrollView:(p:any)=>createElement('div',{className:p.className},p.children),View:(p:any)=>createElement('div',{onClick:p.onClick,className:p.className},p.children),Text:(p:any)=>createElement('span',{onClick:p.onClick},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children),Input:(p:any)=>createElement('input',{value:p.value,placeholder:p.placeholder,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})}),Image:()=>null,Picker:(p:any)=>createElement('div',{},p.children),Textarea:(p:any)=>createElement('textarea',{value:p.value,onChange:()=>{}})}));
vi.mock('../apps/miniprogram/src/features/team',()=>({TeamCreate:()=>createElement('div',{},'ACTUAL_TEAM_TARGET')}));
import Home from '../apps/miniprogram/src/pages/index/index';
const coords={latitude:30.1234567,longitude:120.2345678};
const cityResult={city:'杭州市',region:'浙江省',district:'西湖区',source:{provider:'amap',source_api:'https://restapi.amap.com/v3/geocode/regeo',checked_at:'2030-01-01T00:00:00Z'}};
const venue=(name='AUDIT_PUBLIC_PARK')=>({...accountVenue(),name,address:'PUBLIC_REFERENCE_ADDRESS'});
const list=(name='AUDIT_PUBLIC_PARK')=>({source:accountVenue().source,venues:[venue(name)],excluded_count:0,pagination:false});
const good=(r:any)=>Promise.resolve({status:200,body:r.path==='/api/v1/me'?{user_id:accountActor}:r.path==='/api/v1/account'?emptyAccountFixture():r.path.endsWith('/city')?cityResult:list()});
let root:any;
beforeEach(()=>{h.token='audit-location-a';h.storage.clear();h.writes.mockClear();Object.values(h.hooks).forEach(s=>s.clear());h.transport.mockReset().mockImplementation(good);h.native.mockReset().mockResolvedValue(coords);h.map.mockReset().mockResolvedValue(undefined);h.toast.mockReset();h.login.mockReset();h.navigate.mockReset();h.avatar.mockReset().mockResolvedValue(undefined);});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=undefined;document.body.innerHTML='';vi.restoreAllMocks();});
function deferred(){let resolve!:(v:any)=>void,reject!:(v:any)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function button(label:string){const n=Array.from(document.querySelectorAll('button')).find(x=>x.textContent===label);expect(n,`button ${label}`).toBeTruthy();return n!;}
async function click(label:string){await act(async()=>button(label).click());}
async function lifecycle(kind:'show'|'hide'|'unload'){await act(async()=>Array.from(h.hooks[kind]).forEach(f=>f()));}
async function input(placeholder:string,value:string){const n=document.querySelector(`input[placeholder="${placeholder}"]`) as HTMLInputElement;expect(n).toBeTruthy();await act(async()=>{n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));});}
async function mount(kind:'city'|'nearby',guest=false){const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(Home)));if(kind==='nearby'){if(!guest)await lifecycle('show');await click('灵感');}else await click('北京');h.transport.mockClear();}
const lookup=(kind:'city'|'nearby')=>click(kind==='city'?'获取当前位置':'搜索');
const posts=()=>h.transport.mock.calls.map(([r])=>r).filter(r=>/\/venues\/(city|nearby)$/.test(r.path));
const text=()=>document.body.textContent||'';
async function invalidate(change:string){if(change==='session')h.token='audit-location-b';else if(change==='unmount'){await act(async()=>root.unmount());root=undefined;}else await lifecycle(change as 'hide'|'unload');}


// Actual Home + Inspiration + original clients. Only native/auth establishment/transport are offline fixtures.
async function guestIntent(){
 h.token='';h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});
 await mount('nearby',true);
 await input('搜索地点、商圈或关键词','GUEST_TYPED_PUBLIC_QUERY');
 await click('搜索地点');
 expect(text()).toContain('请先登录');
 expect(h.native).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();
 await click('微信登录');expect(h.login).toHaveBeenCalledTimes(1);
 expect(h.transport.mock.calls.map(([r])=>r.path)).toEqual(['/api/v1/me','/api/v1/account','/api/v1/messages']);
}
it('approved spec-0: login returns to the original Inspiration target without triggering a search',async()=>{
 await guestIntent();
 expect(document.querySelector('input[placeholder="搜索地点、商圈或关键词"]')).not.toBeNull();
 expect(text()).toContain('Find your next');
 expect(h.native).not.toHaveBeenCalled();
 expect(h.transport.mock.calls.filter(([r])=>r.path.startsWith('/api/v1/venues/'))).toHaveLength(0);
});
it('approved spec-0: Inspiration after login retains the pre-login keyword',async()=>{
 await guestIntent();
 const field=document.querySelector('input[placeholder="搜索地点、商圈或关键词"]') as HTMLInputElement;
 expect(field.value).toBe('GUEST_TYPED_PUBLIC_QUERY');
});
it('control: login itself neither locates nor searches, and subsequent explicit search still works',async()=>{
 await guestIntent();expect(h.native).not.toHaveBeenCalled();
 expect(h.transport.mock.calls.filter(([r])=>r.path.startsWith('/api/v1/venues/'))).toHaveLength(0);
 await input('搜索地点、商圈或关键词','EXPLICIT_AFTER_LOGIN');await click('搜索地点');
 expect(h.transport.mock.calls.filter(([r])=>r.path==='/api/v1/venues/search')).toHaveLength(1);
 expect(h.transport.mock.calls.at(-1)?.[0]).toMatchObject({headers:{Authorization:'Bearer audit-location-a'},body:{keyword:'EXPLICIT_AFTER_LOGIN'}});
 expect(h.native).not.toHaveBeenCalled();
});

async function draftIntent(){
 h.token='';h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});
 await mount('nearby',true);await input('搜索地点、商圈或关键词','GUEST_TYPED_PUBLIC_QUERY');await click('搜索地点');
}
const keyword=()=>document.querySelector('input[placeholder="搜索地点、商圈或关键词"]') as HTMLInputElement|null;
const writesOrSearches=()=>h.transport.mock.calls.map(([r])=>r).filter(r=>r.method!=='GET');
async function textClick(label:string){const n=Array.from(document.querySelectorAll('span')).find(x=>x.textContent===label);expect(n).toBeTruthy();await act(async()=>n!.click());}

it('cancel returns the same guest keyword without authenticating or searching',async()=>{await draftIntent();await click('取消并返回灵感');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');expect(h.login).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();expect(h.native).not.toHaveBeenCalled();});
it('native login failure keeps the target and input for an explicit retry',async()=>{await draftIntent();h.login.mockRejectedValueOnce(new Error('SENSITIVE_NATIVE_LOGIN_ERROR'));await click('微信登录');expect(text()).not.toContain('SENSITIVE_NATIVE_LOGIN_ERROR');expect(h.transport).not.toHaveBeenCalled();await click('微信登录');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');expect(h.login).toHaveBeenCalledTimes(2);expect(writesOrSearches()).toHaveLength(0);});
it('failure may be cancelled back to the guest input and then explicitly retried',async()=>{await draftIntent();h.login.mockRejectedValueOnce(new Error('cancel'));await click('微信登录');await click('取消并返回灵感');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');await click('搜索地点');await click('微信登录');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');expect(h.native).not.toHaveBeenCalled();});
it('restores the selected city and original keyword, without persisting input or coordinates',async()=>{h.token='';h.storage.set('weevibe_selected_city','上海');h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});await mount('nearby',true);await input('搜索地点、商圈或关键词','上海 公共关键词');await click('我的收藏');await click('微信登录');expect(text()).toContain('上海');expect(keyword()?.value).toBe('上海 公共关键词');expect(h.writes).not.toHaveBeenCalled();expect(writesOrSearches()).toHaveLength(0);});
it.each(['搜索地点','搜索','我的收藏'])('%s guest intent only restores the page; no action replay',async label=>{h.token='';h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});await mount('nearby',true);await input('搜索地点、商圈或关键词','原关键词');await click(label);await click('微信登录');expect(keyword()?.value).toBe('原关键词');expect(h.native).not.toHaveBeenCalled();expect(h.map).not.toHaveBeenCalled();expect(writesOrSearches()).toHaveLength(0);});
it('synchronous repeated login clicks use one login attempt',async()=>{await draftIntent();const wait=deferred();h.login.mockReturnValueOnce(wait.promise);const b=button('微信登录');await act(async()=>{b.click();b.click();});expect(h.login).toHaveBeenCalledTimes(1);h.token='audit-location-a';await act(async()=>wait.resolve({user_id:accountActor}));expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');});
for(const change of ['hide','unload','unmount','tab','cancel'] as const)it(`pending native login after ${change} does not restore or perform an old action`,async()=>{
 await draftIntent();const wait=deferred();h.login.mockReturnValueOnce(wait.promise);await click('微信登录');
 if(change==='unmount'){await act(async()=>root.unmount());root=undefined;}else if(change==='tab')await click('GO');else if(change==='cancel')await click('取消并返回灵感');else await lifecycle(change);
 h.token='audit-location-a';await act(async()=>wait.resolve({user_id:accountActor}));
 expect(h.transport).not.toHaveBeenCalled();expect(h.navigate).not.toHaveBeenCalled();expect(h.native).not.toHaveBeenCalled();
 if(change!=='cancel')expect(keyword()).toBeNull();
});
for(const change of ['hide','unload','unmount','tab','cancel'] as const)it(`pending identity verification after ${change} does not continue to account or restore old target`,async()=>{
 await draftIntent();const wait=deferred();h.transport.mockImplementation(r=>r.path==='/api/v1/me'?wait.promise:good(r));await click('微信登录');
 if(change==='unmount'){await act(async()=>root.unmount());root=undefined;}else if(change==='tab')await click('GO');else if(change==='cancel')await click('取消并返回灵感');else await lifecycle(change);
 await act(async()=>wait.resolve({status:200,body:{user_id:accountActor}}));
 // Explicit navigation invalidates target continuation even if same-account refresh itself completes.
 expect(h.navigate).not.toHaveBeenCalled();expect(h.native).not.toHaveBeenCalled();expect(writesOrSearches()).toHaveLength(0);
 if(change==='hide'||change==='unload'||change==='unmount')expect(h.transport.mock.calls.map(([r])=>r.path)).toEqual(['/api/v1/me']);
 if(change!=='cancel')expect(keyword()).toBeNull();
});
it('external account token before clicking login discards the old guest intent without authenticating it',async()=>{await draftIntent();h.token='audit-location-b';await click('微信登录');expect(h.login).not.toHaveBeenCalled();expect(text()).toContain('旧输入未转交其他账号');await click('灵感');expect(keyword()?.value).toBe('');expect(h.transport).not.toHaveBeenCalled();});
it('different /me identity after established login cannot receive the guest return intent',async()=>{await draftIntent();h.transport.mockImplementation(r=>Promise.resolve({status:200,body:r.path==='/api/v1/me'?{user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}:emptyAccountFixture()}));await click('微信登录');expect(keyword()).toBeNull();await click('灵感');expect(keyword()?.value).toBe('');expect(writesOrSearches()).toHaveLength(0);});
it('same actor uppercase UUID in login or /me is canonicalized',async()=>{await draftIntent();h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor.toUpperCase()};});await click('微信登录');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');});
it('identity verification temporary failure keeps same-source intent but never restores unverified input',async()=>{await draftIntent();h.transport.mockRejectedValueOnce(new Error('temporary'));await click('微信登录');expect(keyword()).toBeNull();await click('微信登录');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');expect(writesOrSearches()).toHaveLength(0);});
it('account 503 after a verified identity does not block returning to public input or fake account contents',async()=>{await draftIntent();h.transport.mockImplementation(r=>r.path==='/api/v1/account'?Promise.resolve({status:503,body:{error:{code:'NOT_CONFIGURED',message:'SECRET'},request_id:'fixture'}}):good(r));await click('微信登录');expect(keyword()?.value).toBe('GUEST_TYPED_PUBLIC_QUERY');expect(text()).not.toContain('SECRET');expect(writesOrSearches()).toHaveLength(0);});
it('switching token while account refresh waits never restores input into the other identity',async()=>{await draftIntent();const wait=deferred();h.transport.mockImplementation(r=>r.path==='/api/v1/account'?wait.promise:good(r));await click('微信登录');h.token='audit-location-b';await act(async()=>wait.resolve({status:200,body:emptyAccountFixture()}));expect(keyword()).toBeNull();await click('灵感');expect(keyword()?.value).toBe('');expect(writesOrSearches()).toHaveLength(0);});
it('newer login after hide/show owns its lock; old finally cannot release it or restore the old target',async()=>{await draftIntent();const old=deferred(),fresh=deferred();h.login.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);await click('微信登录');await lifecycle('hide');await lifecycle('show');await act(async()=>old.reject(new Error('old')));expect(button('正在恢复登录…').disabled).toBe(true);expect(h.login).toHaveBeenCalledTimes(2);h.token='audit-location-a';await act(async()=>fresh.resolve({user_id:accountActor}));expect(keyword()).toBeNull();expect(h.transport.mock.calls.map(([r])=>r.path)).toEqual(['/api/v1/me','/api/v1/account','/api/v1/messages','/api/v1/gatherings']);});
it('logout and later different-account login do not revive restored keywords',async()=>{await guestIntent();await click('我的');await click('设置');await click('退出登录');h.login.mockImplementation(async()=>{h.token='audit-location-b';return{user_id:accountActor};});await click('微信登录');await click('灵感');expect(keyword()?.value).toBe('');expect(h.native).not.toHaveBeenCalled();});
for(const kind of ['朋友出游','一起团建'] as const)it(`${kind} becomes the latest explicit destination instead of an older Inspiration return`,async()=>{await draftIntent();await click('＋');await textClick(kind);await click('微信登录');expect(keyword()).toBeNull();expect(h.navigate).toHaveBeenCalledWith({url:`/pages/gathering/index?new=${kind==='朋友出游'?'friend':'team'}`});expect(writesOrSearches()).toHaveLength(0);});
it('a failed friend-create login retains the original create target for retry',async()=>{h.token='';h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});await mount('nearby',true);await click('＋');await textClick('朋友出游');h.login.mockRejectedValueOnce(new Error('cancel'));await click('微信登录');await click('微信登录');expect(h.navigate).toHaveBeenCalledTimes(1);expect(h.navigate).toHaveBeenCalledWith({url:'/pages/gathering/index?new=friend'});});
it('choosing Inspiration after a create request supersedes creation and never auto-navigates to editor',async()=>{h.token='';h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});await mount('nearby',true);await click('＋');await textClick('朋友出游');await click('灵感');await input('搜索地点、商圈或关键词','新目标');await click('搜索地点');await click('微信登录');expect(keyword()?.value).toBe('新目标');expect(h.navigate).not.toHaveBeenCalled();});
it('changing city while login is pending supersedes the old city and keyword destination',async()=>{await draftIntent();const wait=deferred();h.login.mockReturnValueOnce(wait.promise);await click('微信登录');await click('北京');await click('上海');h.token='audit-location-a';await act(async()=>wait.resolve({user_id:accountActor}));await click('灵感');expect(text()).toContain('上海');expect(keyword()?.value).toBe('');expect(h.transport).not.toHaveBeenCalled();});

it('same React batch final typed keyword is the one retained for login, not the old callback value',async()=>{h.token='';h.login.mockImplementation(async()=>{h.token='audit-location-a';return{user_id:accountActor};});await mount('nearby',true);const field=keyword()!,search=button('搜索地点');await act(async()=>{field.value='LATEST_SAME_BATCH';field.dispatchEvent(new Event('input',{bubbles:true}));search.click();});await click('微信登录');expect(keyword()?.value).toBe('LATEST_SAME_BATCH');});
for(const choice of ['设置头像昵称（选填）','我参与的','设置','＋'] as const)it(`user choosing ${choice} during optional avatar loading supersedes the old login return`,async()=>{await draftIntent();const wait=deferred();h.avatar.mockReturnValueOnce(wait.promise);await click('微信登录');if(choice==='我参与的'){const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.startsWith('我参与的'));expect(b).toBeTruthy();await act(async()=>b!.click());}else await click(choice);await act(async()=>wait.resolve(undefined));expect(keyword()).toBeNull();expect(h.native).not.toHaveBeenCalled();expect(writesOrSearches()).toHaveLength(0);});
it('new authenticated page does not import another source keyword on ordinary tab navigation',async()=>{await guestIntent();await input('搜索地点、商圈或关键词','PRIVATE_A_EDIT');h.token='audit-location-b';await lifecycle('show');await click('我的');await click('灵感');expect(keyword()?.value).toBe('');expect(text()).not.toContain('PRIVATE_A_EDIT');expect(h.writes).not.toHaveBeenCalled();});
it('an explicitly retried guest intent bound to A is cleared if fresh login establishes B',async()=>{await draftIntent();h.transport.mockRejectedValueOnce(new Error('verify temporarily unavailable'));await click('微信登录');h.login.mockImplementation(async()=>{h.token='audit-location-b';return{user_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};});await click('微信登录');expect(keyword()).toBeNull();await click('灵感');expect(keyword()?.value).toBe('');expect(h.native).not.toHaveBeenCalled();});
it('returning as guest starts a fresh automatic identity recovery and releases busy after verification',async()=>{await draftIntent();const wait=deferred();h.transport.mockImplementation(r=>r.path==='/api/v1/me'?wait.promise:good(r));await click('微信登录');await lifecycle('hide');h.token='';await lifecycle('show');expect(h.login).toHaveBeenCalledTimes(2);await act(async()=>wait.resolve({status:200,body:{user_id:accountActor}}));expect(Array.from(document.querySelectorAll('button')).some(b=>b.disabled&&b.textContent==='正在恢复登录…')).toBe(false);expect(keyword()).toBeNull();});

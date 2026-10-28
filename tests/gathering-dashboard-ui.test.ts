// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {GatheringSummary} from '../packages/contracts/src';
import {gatheringId} from './gathering-ui-fixtures';

const requireMini=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=requireMini('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=requireMini('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',transport:vi.fn(),navigate:vi.fn(),show:undefined as (()=>void)|undefined,hide:undefined as (()=>void)|undefined,unload:undefined as (()=>void)|undefined}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,transport:h.transport}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{navigateTo:h.navigate},useDidShow:(f:()=>void)=>{h.show=f;},useDidHide:(f:()=>void)=>{h.hide=f;},useUnload:(f:()=>void)=>{h.unload=f;}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{className:p.className,disabled:p.disabled,onClick:p.onClick},p.children)}));
import {GatheringDashboardList} from '../apps/miniprogram/src/features/gatherings/dashboard-list';

let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
beforeEach(()=>{h.token='session-a';h.transport.mockReset();h.navigate.mockReset().mockResolvedValue({});h.show=undefined;h.hide=undefined;h.unload=undefined;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
function summary(title:string,id=gatheringId):GatheringSummary{return {id,kind:'friend',title,date:'2030-11-08',stage:'collecting',is_owner:true,has_responded:true,member_count:2,updated_at:'2030-11-01T00:00:00Z'};}
function response(title:string){return {status:200,body:{gatherings:[summary(title)]}};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
const text=()=>host.textContent||'';
async function render(session:string|undefined,variant:'home'|'profile'='home'){await act(async()=>root.render(createElement(GatheringDashboardList,{session,variant})));}
async function click(label:string){const button=Array.from(host.querySelectorAll('button')).find(node=>node.textContent===label);expect(button,label).toBeTruthy();await act(async()=>button!.click());}

it('starts the new session list while the old request is pending, ignores the old result, and remains refreshable',async()=>{
  const old=deferred<ReturnType<typeof response>>(),next=deferred<ReturnType<typeof response>>();h.transport.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise).mockResolvedValueOnce(response('CURRENT_REFRESH'));
  await render('session-a');expect(h.transport).toHaveBeenCalledOnce();
  h.token='session-b';await render('session-b');expect(h.transport).toHaveBeenCalledTimes(2);expect(h.transport.mock.calls[1][0]).toMatchObject({path:'/api/v1/gatherings',method:'GET',headers:{Authorization:'Bearer session-b'}});
  await act(async()=>old.resolve(response('OLD_ACCOUNT_LIST')));expect(text()).not.toContain('OLD_ACCOUNT_LIST');
  await act(async()=>next.resolve(response('CURRENT_ACCOUNT_LIST')));expect(text()).toContain('CURRENT_ACCOUNT_LIST');
  await click('刷新');expect(h.transport).toHaveBeenCalledTimes(3);expect(h.transport.mock.calls[2][0].headers.Authorization).toBe('Bearer session-b');expect(text()).toContain('CURRENT_REFRESH');expect(text()).not.toContain('OLD_ACCOUNT_LIST');
});

it.each(['home','profile'] as const)('opens the %s record as a management entry with its actual id without writing',async variant=>{
  const actual='44444444-4444-4444-8444-444444444444';h.transport.mockResolvedValue({status:200,body:{gatherings:[summary('可继续管理的真实筹备',actual)]}});await render('session-a',variant);
  const card=host.querySelector<HTMLButtonElement>('.gg-preparation-card');expect(card).toBeTruthy();await act(async()=>card!.click());
  expect(h.navigate).toHaveBeenCalledExactlyOnceWith({url:`/pages/gathering/index?id=${actual}`});expect(h.transport).toHaveBeenCalledOnce();expect(h.transport.mock.calls[0][0].method).toBe('GET');
});

it('shows no previous account records after logout and performs no anonymous list read',async()=>{
  h.transport.mockResolvedValue(response('OLD_PERSONAL_PREPARATION'));await render('session-a');expect(text()).toContain('OLD_PERSONAL_PREPARATION');
  h.token='';await render(undefined);expect(text()).not.toContain('OLD_PERSONAL_PREPARATION');expect(text()).toContain('登录后查看');expect(h.transport).toHaveBeenCalledOnce();expect(host.querySelector('.gg-preparation-card')).toBeNull();expect(h.navigate).not.toHaveBeenCalled();
});

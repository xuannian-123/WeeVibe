// @vitest-environment jsdom
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
import {accountActor as A,emptyAccountFixture} from './account-fixtures';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act,useEffect,useRef}=req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=req('react-dom/client') as {createRoot:(host:Element)=>{render:(el:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a' as string|undefined,scan:vi.fn(),navigate:vi.fn(),login:vi.fn(),show:new Set<()=>void>(),hide:new Set<()=>void>(),unload:new Set<()=>void>()}));
function lifecycle(set:Set<()=>void>,fn:()=>void){const current=useRef(fn);current.current=fn;useEffect(()=>{const invoke=()=>current.current();set.add(invoke);return()=>{set.delete(invoke);};},[set]);}
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,api:{me:async()=>({user_id:A})},establishSession:h.login,forgetSession:()=>{h.token=undefined;}}));
vi.mock('../apps/miniprogram/src/platform/account-api',()=>({requestAccount:async()=>emptyAccountFixture()}));
vi.mock('../apps/miniprogram/src/platform/avatar',()=>({loadAvatar:async()=>undefined}));
vi.mock('../apps/miniprogram/src/features/todos/TodoPanel',()=>({TodoPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/shell/inspiration',()=>({Inspiration:()=>createElement('div',{},'灵感页面')}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{getStorageSync:()=>'',setStorageSync:vi.fn(),scanCode:h.scan,navigateTo:h.navigate,reLaunch:vi.fn()},usePageScroll:()=>{},useDidShow:(f:()=>void)=>lifecycle(h.show,f),useDidHide:(f:()=>void)=>lifecycle(h.hide,f),useUnload:(f:()=>void)=>lifecycle(h.unload,f)}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{onClick:p.onClick},p.children),Text:(p:any)=>createElement('span',{onClick:p.onClick},p.children),Button:(p:any)=>createElement('button',{onClick:p.onClick,disabled:p.disabled,'aria-label':p.ariaLabel},p.children),Input:(p:any)=>createElement('input',{value:p.value,onChange:()=>{}}),Image:()=>null,Picker:(p:any)=>createElement('div',{},p.children),Textarea:()=>null}));
import Home from '../apps/miniprogram/src/pages/index/index';
const ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',PATH=`pages/activity/index?id=${ID}`;
let root:ReturnType<typeof createRoot>|undefined;
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function render(){if(!root){const host=document.createElement('div');document.body.append(host);root=createRoot(host);}await act(async()=>root!.render(createElement(Home)));}
function scanner(){const b=document.querySelector('button[aria-label="扫码打开活动"]') as HTMLButtonElement;expect(b).not.toBeNull();return b;}
async function scan(){await act(async()=>scanner().click());}
async function leave(event:'hide'|'unload'|'unmount'){await act(async()=>{if(event==='unmount'){root!.unmount();root=undefined;}else h[event].forEach(fn=>fn());});}
beforeEach(()=>{h.token='session-a';h.show.clear();h.hide.clear();h.unload.clear();h.scan.mockReset().mockResolvedValue({path:PATH});h.navigate.mockReset().mockResolvedValue({errMsg:'navigateTo:ok'});h.login.mockReset();});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';});
describe('Home no longer exposes an in-app scanner',()=>{
 it.each([true,false])('keeps all four tabs available without requesting camera or scanning, signedIn=%s',async signedIn=>{
  h.token=signedIn?'session-a':undefined;await render();
  expect(document.querySelector('[aria-label="扫码打开活动"]')).toBeNull();
  for(const label of ['灵感','消息','我的','GO']){
   const tab=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.endsWith(label));expect(tab).toBeTruthy();await act(async()=>tab!.click());
   expect(document.querySelector('[aria-label="扫码打开活动"]')).toBeNull();
  }
  expect(h.scan).not.toHaveBeenCalled();expect(h.navigate).not.toHaveBeenCalled();
 });
});

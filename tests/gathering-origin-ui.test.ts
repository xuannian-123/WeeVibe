// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';import {resolve} from 'node:path';
import type {GatheringIntake} from '../packages/contracts/src';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act,useState}=req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=req('react-dom/client') as {createRoot:(host:Element)=>{render:(v:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',permission:vi.fn(),locate:vi.fn(),search:vi.fn(),change:vi.fn(),hide:[] as (()=>void)[],show:[] as (()=>void)[],unload:[] as (()=>void)[]}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token}));
vi.mock('../apps/miniprogram/src/platform/location-permission',()=>({requireLocationPermission:h.permission,readPreciseLocation:h.locate,needsLocationSettings:()=>false}));
vi.mock('../apps/miniprogram/src/features/shell/location-api',()=>({searchForSession:h.search,locationError:()=> '系统位置权限暂不可用，可手动填写'}));
vi.mock('../apps/miniprogram/src/components/location-settings',()=>({LocationSettings:()=>null}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{getStorageSync:()=> '杭州'},useDidShow:(fn:()=>void)=>h.show.push(fn),useDidHide:(fn:()=>void)=>h.hide.push(fn),useUnload:(fn:()=>void)=>h.unload.push(fn)}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{className:p.className},p.children),Button:(p:any)=>createElement('button',{className:p.className,disabled:p.disabled,onClick:p.onClick},p.children),Input:(p:any)=>createElement('input',{className:p.className,disabled:p.disabled,value:p.value,placeholder:p.placeholder,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})}),Picker:()=>null,Textarea:()=>null}));
import {GatheringOrigin} from '../apps/miniprogram/src/features/gatherings/origin-search';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
const coords={latitude:30.1234567,longitude:120.1234567};
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);h.token='session-a';h.hide=[];h.show=[];h.unload=[];h.permission.mockReset().mockImplementation(async(guard:()=>void)=>guard());h.locate.mockReset().mockResolvedValue(coords);h.search.mockReset().mockResolvedValue({venues:[]});h.change.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
async function render(props:Record<string,unknown>={}){await act(async()=>root.render(createElement(GatheringOrigin,{session:'session-a',value:{label:'保留的私人地址'},change:h.change,...props})));}
function button(label:string){const b=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===label);expect(b,label).toBeTruthy();return b!;}
async function click(label:string){await act(async()=>button(label).click());}
function deferred<T>(){let resolve!:(v:T)=>void;return{promise:new Promise<T>(r=>{resolve=r;}),resolve:(v:T)=>resolve(v)};}
describe('private departure location remains explicit and source-bound',()=>{
  it('does not request permission or GPS on entry and reads precise location only after click',async()=>{await render();expect(h.permission).not.toHaveBeenCalled();expect(h.locate).not.toHaveBeenCalled();await click('获取定位');expect(h.permission).toHaveBeenCalledOnce();expect(h.locate).toHaveBeenCalledOnce();expect(h.change).toHaveBeenCalledExactlyOnceWith({label:'保留的私人地址',latitude:30.123457,longitude:120.123457,crs:'GCJ-02'});expect(h.search).not.toHaveBeenCalled();});
  it.each(['session','hide','unload','disabled'] as const)('discards a native response after %s',async reason=>{const wait=deferred<unknown>();h.locate.mockReturnValueOnce(wait.promise);await render();await click('获取定位');if(reason==='session')h.token='session-b';else if(reason==='disabled')await render({disabled:true});else await act(async()=>h[reason].slice().forEach(fn=>fn()));await act(async()=>wait.resolve(coords));expect(h.change).not.toHaveBeenCalled();expect(host.textContent).not.toContain('已填入私人栏位');});
  it('does not revive a native result after leaving and returning',async()=>{const wait=deferred<unknown>();h.locate.mockReturnValueOnce(wait.promise);await render();await click('获取定位');await act(async()=>{h.hide.slice().forEach(fn=>fn());h.show.slice().forEach(fn=>fn());});await act(async()=>wait.resolve(coords));expect(h.change).not.toHaveBeenCalled();expect(button('获取定位').disabled).toBe(false);});
  it.each([{latitude:91,longitude:120},{latitude:30,longitude:181},{latitude:NaN,longitude:120}])('does not present malformed coordinates as a saved departure %#',async p=>{h.locate.mockResolvedValueOnce(p);await render();await click('获取定位');expect(h.change).not.toHaveBeenCalled();expect(host.textContent).toContain('未能获取当前位置');});
  it('explains native cancellation without exposing the raw response and retains manual input',async()=>{h.locate.mockRejectedValueOnce({errMsg:'getLocation:fail cancel PRIVATE_RAW_DETAIL'});await render();await click('获取定位');expect(host.textContent).toContain('已取消定位');expect(host.textContent).not.toContain('PRIVATE_RAW_DETAIL');expect(host.querySelector('input')!.value).toBe('保留的私人地址');});
  it('disables native location and editing in a read-only personal view',async()=>{await render({disabled:true});expect(button('获取定位').disabled).toBe(true);expect(button('搜索地址').disabled).toBe(true);expect(host.querySelector('input')!.disabled).toBe(true);await click('获取定位');expect(h.permission).not.toHaveBeenCalled();expect(h.change).not.toHaveBeenCalled();});
  it('clears coordinates while retaining the manually editable departure description',async()=>{function Connected(){const[value,change]=useState<GatheringIntake['private']['origin']>({label:'我选的出发区域',...coords,crs:'GCJ-02'});return createElement(GatheringOrigin,{session:'session-a',value,change});}await act(async()=>root.render(createElement(Connected)));await click('清除定位');expect(host.querySelector('input')!.value).toBe('我选的出发区域');expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='清除定位')).toBe(false);});
});

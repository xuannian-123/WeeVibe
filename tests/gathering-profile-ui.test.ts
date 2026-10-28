// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')),{createElement,act}=req('react') as typeof import('../apps/miniprogram/node_modules/@types/react'),{createRoot}=req('react-dom/client') as {createRoot:(host:Element)=>{render:(v:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',account:vi.fn(),avatar:vi.fn(),completed:vi.fn(),cancel:vi.fn(),editor:undefined as any,hide:[] as (()=>void)[],show:[] as (()=>void)[],unload:[] as (()=>void)[]}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token}));
vi.mock('../apps/miniprogram/src/platform/account-api',()=>({requestAccount:h.account}));
vi.mock('../apps/miniprogram/src/platform/avatar',()=>({loadAvatar:h.avatar}));
vi.mock('../apps/miniprogram/src/platform/page-state',()=>({errorText:()=> '资料暂时无法核对，请重试'}));
vi.mock('../apps/miniprogram/src/features/shell/profile',()=>({ProfileForm:(props:any)=>{h.editor=props;return createElement('div',{'data-testid':'real-profile-form-slot'},createElement('span',{},'复用个人资料表单'),createElement('button',{onClick:props.close},'完成资料并重新核对'));}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{},useDidHide:(fn:()=>void)=>h.hide.push(fn),useDidShow:(fn:()=>void)=>h.show.push(fn),useUnload:(fn:()=>void)=>h.unload.push(fn)}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{className:p.className},p.children),Button:(p:any)=>createElement('button',{className:p.className,disabled:p.disabled,onClick:p.onClick},p.children),Image:(p:any)=>createElement('img',{className:p.className,src:p.src})}));
import {GatheringProfileGate} from '../apps/miniprogram/src/features/gatherings/profile-gate';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',G='33333333-3333-4333-8333-333333333333';
let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{h.token='session-a';h.account.mockReset().mockResolvedValue({profile:{nickname:''}});h.avatar.mockReset().mockResolvedValue('');h.completed.mockReset().mockResolvedValue(undefined);h.cancel.mockReset();h.editor=undefined;h.hide=[];h.show=[];h.unload=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
async function render(v:ReturnType<typeof createElement>){await act(async()=>root.render(v));}
async function click(label:string){const b=Array.from(host.querySelectorAll('button')).find(v=>v.textContent===label);expect(b,label).toBeTruthy();await act(async()=>{b!.click();await Promise.resolve();});}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
const gate=(extra:Record<string,unknown>={})=>createElement(GatheringProfileGate,{actor:A,session:'session-a',completed:h.completed,cancel:h.cancel,...extra});
describe('gathering profile completion gate',()=>{
  it('opens the existing profile form and stays closed when required saved identity is absent',async()=>{await render(gate());expect(host.textContent).toContain('复用个人资料表单');expect(h.editor.ownerSession).toBe('session-a');expect(h.completed).not.toHaveBeenCalled();await click('暂时返回首页');expect(h.cancel).toHaveBeenCalledOnce();expect(h.completed).not.toHaveBeenCalled();});
  it('requires nonblank persisted nickname even when a real stored avatar exists',async()=>{h.account.mockResolvedValue({profile:{nickname:'   '}});h.avatar.mockResolvedValue('/native-cache/saved.jpg');await render(gate());expect(h.completed).not.toHaveBeenCalled();});
  it('ignores local avatar and nickname callbacks until a new server check succeeds',async()=>{await render(gate());await act(async()=>{h.editor.saved({nickname:'本机草稿昵称',avatar_url:'wxfile://temporary'});h.editor.avatarSaved('wxfile://temporary');});await click('完成资料并重新核对');expect(h.completed).not.toHaveBeenCalled();expect(h.account).toHaveBeenCalledTimes(2);expect(h.avatar).toHaveBeenCalledTimes(2);h.account.mockResolvedValue({profile:{nickname:'已保存的微信昵称'}});h.avatar.mockResolvedValue('/native-cache/saved-verified.jpg');await click('完成资料并重新核对');expect(h.completed).toHaveBeenCalledOnce();});
  it('automatically continues when the server verified nickname and avatar already exist',async()=>{h.account.mockResolvedValue({profile:{nickname:'朋友'}});h.avatar.mockResolvedValue('/native-cache/server-avatar.jpg');await render(gate());expect(h.account).toHaveBeenCalledWith('session-a');expect(h.avatar).toHaveBeenCalledWith(A);expect(h.completed).toHaveBeenCalledOnce();});
  it.each(['session','hide','unmount'] as const)('discards a late ready result after %s',async reason=>{const pending=deferred<string>();h.account.mockResolvedValue({profile:{nickname:'朋友'}});h.avatar.mockReturnValueOnce(pending.promise);await render(gate());if(reason==='session')h.token='session-b';if(reason==='hide')await act(async()=>h.hide.slice().forEach(f=>f()));if(reason==='unmount'){await act(async()=>root.unmount());root=createRoot(host);}await act(async()=>pending.resolve('/native-cache/original-account.jpg'));expect(h.completed).not.toHaveBeenCalled();});
  it('keeps failures actionable without exposing native storage or service details',async()=>{h.avatar.mockRejectedValueOnce(Error('PRIVATE_LOCAL_PATH'));await render(gate());expect(host.textContent).toContain('资料暂时无法核对');expect(host.textContent).not.toContain('PRIVATE_LOCAL_PATH');expect(h.completed).not.toHaveBeenCalled();expect(host.querySelector('[data-testid]')).toBeNull();});
});

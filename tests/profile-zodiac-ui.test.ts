// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { emptyAccountFixture } from './account-fixtures';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=req('react');const {createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a',transport:vi.fn(),saved:vi.fn(),close:vi.fn(),actions:new Map<string,()=>void>(),dateChange:undefined as undefined|((e:any)=>void)}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,transport:h.transport}));
vi.mock('../apps/miniprogram/src/platform/avatar',()=>({uploadAvatar:vi.fn()}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{},useDidShow:()=>{},useDidHide:()=>{},useUnload:()=>{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({
 ScrollView:(p:any)=>createElement('div',{},p.children),
 Switch:(p:any)=>createElement('input',{type:'checkbox',checked:p.checked,disabled:p.disabled,onChange:(e:any)=>p.onChange?.({detail:{value:e.currentTarget.checked}})}),
 View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),
 Button:(p:any)=>{if(typeof p.children==='string')h.actions.set(p.children,p.onClick);return createElement('button',{onClick:p.onClick,disabled:p.disabled},p.children);},
 Input:(p:any)=>createElement('input',{'aria-label':p.ariaLabel,value:p.value,disabled:p.disabled,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})}),
 Picker:(p:any)=>{if(p.mode==='date'){h.dateChange=p.onChange;return createElement('input',{'data-date':true,value:p.value,disabled:p.disabled,onInput:(e:any)=>p.onChange?.({detail:{value:e.currentTarget.value}})});}return createElement('div',{},p.children);},
 Image:()=>null,Textarea:(p:any)=>createElement('textarea',{value:p.value,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})})
}));
import {ProfileForm} from '../apps/miniprogram/src/features/shell/profile';
let root:any,host:HTMLDivElement;
beforeEach(()=>{h.token='session-a';h.transport.mockReset();h.saved.mockReset();h.close.mockReset();h.actions.clear();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2030-06-01T12:00:00Z'));host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';vi.useRealTimers();});
async function render(profile:Record<string,string>={},owner='session-a'){await act(async()=>root.render(createElement(ProfileForm,{initial:{nickname:'本人的昵称',...profile},ownerSession:owner,saved:h.saved,close:h.close})));}
function zodiac(){return host.querySelector('input[aria-label="星座（选填）"]') as HTMLInputElement;}
async function input(node:HTMLInputElement,value:string){await act(async()=>{node.value=value;node.dispatchEvent(new Event('input',{bubbles:true}));});}
async function birthday(value:string){await input(host.querySelector('[data-date]') as HTMLInputElement,value);}
function button(label:string){return Array.from(host.querySelectorAll('button')).find(x=>x.textContent===label);}
async function click(label:string){const b=button(label);expect(b,`button ${label}`).toBeTruthy();await act(async()=>b!.click());}
function success(profile:Record<string,string>){return {status:200,body:{...emptyAccountFixture(),profile:{...emptyAccountFixture().profile,...profile}}};}
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}

describe('identity-only editor preserves historical private data',()=>{
 it('shows only avatar and nickname and keeps historical fields unchanged on save',async()=>{await render({birthday:'2000-03-21',zodiac:'水瓶座',bio:'PRIVATE_BIO',signature:'PRIVATE_SIGNATURE'});expect(host.querySelectorAll('input')).toHaveLength(1);expect(host.querySelector('[data-date]')).toBeNull();expect(zodiac()).toBeNull();expect(host.textContent).not.toMatch(/PRIVATE_|生日|星座|MBTI|兴趣|封面/);h.transport.mockResolvedValueOnce(success({}));await click('保存资料');expect(h.transport.mock.calls[0][0].body.profile).toMatchObject({birthday:'2000-03-21',zodiac:'水瓶座',bio:'PRIVATE_BIO',signature:'PRIVATE_SIGNATURE'});});
 it.each([200,404,503])('retains local nickname after an unverified %s response and permits an explicit retry',async status=>{await render();await input(host.querySelector('input')!,'本次修改');h.transport.mockResolvedValueOnce({status,body:{ok:true,private:'RAW_PRIVATE_MARKER'}});await click('保存资料');expect(host.querySelector('input')?.value).toBe('本次修改');expect(h.saved).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled();expect(host.textContent).not.toContain('RAW_PRIVATE_MARKER');h.transport.mockResolvedValueOnce(success({nickname:'本次修改'}));await click('保存资料');expect(h.saved).toHaveBeenCalledOnce();});
 it('ignores a successful save after identity changes',async()=>{await render();const pending=deferred<any>();h.transport.mockReturnValueOnce(pending.promise);await click('保存资料');h.token='session-b';await act(async()=>pending.resolve(success({nickname:'旧账户'})));expect(h.saved).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled();expect(host.querySelector('input')).toBeNull();});
 it('rejects an editor mounted under another actor session',async()=>{h.token='session-b';await render({},'session-a');expect(host.querySelector('input')).toBeNull();expect(h.transport).not.toHaveBeenCalled();});
 it('does not notify after unmount while the same-session save resolves',async()=>{await render();const pending=deferred<any>();h.transport.mockReturnValueOnce(pending.promise);await click('保存资料');await act(async()=>root.unmount());root=createRoot(host);await act(async()=>pending.resolve(success({nickname:'旧编辑'})));expect(h.saved).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled();});
 it.each([false,true])('rejects late save after source owner changes, restored=%s',async restore=>{await render();const pending=deferred<any>();h.transport.mockReturnValueOnce(pending.promise);await click('保存资料');await render({},'session-b');if(restore)await render({},'session-a');await act(async()=>pending.resolve(success({nickname:'旧编辑'})));expect(h.saved).not.toHaveBeenCalled();expect(h.close).not.toHaveBeenCalled();});
 it('locks duplicate saves and does not let an older editor unlock a new write',async()=>{await render();const first=deferred<any>();h.transport.mockReturnValueOnce(first.promise);const save=h.actions.get('保存资料')!;await act(async()=>{save();save();});expect(h.transport).toHaveBeenCalledOnce();await act(async()=>root.unmount());root=createRoot(host);await render({});const second=deferred<any>();h.transport.mockReturnValueOnce(second.promise);await click('保存资料');await act(async()=>first.resolve(success({})));expect(h.saved).not.toHaveBeenCalled();expect(button('保存中…')?.disabled).toBe(true);await act(async()=>second.resolve(success({})));expect(h.saved).toHaveBeenCalledOnce();});
 it('does not close an old sheet after the saved callback changes identity',async()=>{await render();h.saved.mockImplementationOnce(()=>{h.token='session-b';});h.transport.mockResolvedValueOnce(success({}));await click('保存资料');expect(h.saved).toHaveBeenCalledOnce();expect(h.close).not.toHaveBeenCalled();});
});

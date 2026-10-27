// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';import { resolve } from 'node:path';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')),{createElement,act}=req('react'),{createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'A',listener:undefined as any,agree:undefined as any,hide:[] as (()=>void)[]}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{onNeedPrivacyAuthorization:(fn:any)=>{h.listener=fn;},getPrivacySetting:({success}:any)=>success({privacyContractName:'WeeVibe 用户隐私保护指引'}),openPrivacyContract:vi.fn()},useDidHide:(fn:any)=>h.hide.push(fn),useDidShow:()=>{},useUnload:()=>{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Image:()=>null,ScrollView:(p:any)=>createElement('div',{},p.children),View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>{if(p.openType==='agreePrivacyAuthorization')h.agree=p.onAgreePrivacyAuthorization;return createElement('button',{onClick:p.onClick},p.children);}}));
import { PrivacyConsent } from '../apps/miniprogram/src/components/privacy-consent';
let root:any,host:HTMLDivElement;
beforeEach(async()=>{h.token='A';h.hide=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(PrivacyConsent)));});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
async function request(){const resolve=vi.fn();await act(async()=>h.listener(resolve));return resolve;}
describe('privacy authorization requires the actual native agree event',()=>{
 it('never resolves agreement just by rendering or clicking a generic button',async()=>{const resolve=await request();expect(resolve).toHaveBeenCalledWith({event:'exposureAuthorization'});const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='同意并继续')!;await act(async()=>button.click());expect(resolve).not.toHaveBeenCalledWith(expect.objectContaining({event:'agree'}));await act(async()=>h.agree());expect(resolve).toHaveBeenLastCalledWith({event:'agree',buttonId:'weevibe-privacy-agree'});});
 it('declines the pending native operation when the owner selects not now',async()=>{const resolve=await request();await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='暂不同意')!.click());expect(resolve).toHaveBeenLastCalledWith({event:'disagree'});expect(host.textContent).toBe('');});
 it('does not grant a previous account permission through a late button callback',async()=>{const resolve=await request();h.token='B';await act(async()=>h.agree());expect(resolve).toHaveBeenLastCalledWith({event:'disagree'});});
 it('rejects all waiting native actions when the page is hidden',async()=>{const first=await request(),second=await request();await act(async()=>h.hide.forEach(fn=>fn()));for(const resolve of [first,second])expect(resolve).toHaveBeenLastCalledWith({event:'disagree'});});
});

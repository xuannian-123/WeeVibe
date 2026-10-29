// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';import { resolve } from 'node:path';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')),{createElement,act,StrictMode}=req('react'),{createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'A',listener:undefined as any,agree:undefined as any,hide:[] as (()=>void)[],show:[] as (()=>void)[],unload:[] as (()=>void)[]}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{onNeedPrivacyAuthorization:(fn:any)=>{h.listener=fn;},getPrivacySetting:({success}:any)=>success({privacyContractName:'WeeVibe 用户隐私保护指引'}),openPrivacyContract:vi.fn()},useDidHide:(fn:any)=>h.hide.push(fn),useDidShow:(fn:any)=>h.show.push(fn),useUnload:(fn:any)=>h.unload.push(fn)}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Image:()=>null,ScrollView:(p:any)=>createElement('div',{},p.children),View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>{if(p.openType==='agreePrivacyAuthorization')h.agree=p.onAgreePrivacyAuthorization;return createElement('button',{onClick:p.onClick},p.children);}}));
import { PrivacyConsent } from '../apps/miniprogram/src/components/privacy-consent';
let root:any,host:HTMLDivElement;
beforeEach(async()=>{h.token='A';h.hide=[];h.show=[];h.unload=[];host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(PrivacyConsent)));});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
async function request(){const resolve=vi.fn();await act(async()=>h.listener(resolve));return resolve;}
describe('privacy authorization requires the actual native agree event',()=>{
 it('never resolves agreement just by rendering or clicking a generic button',async()=>{const resolve=await request();expect(resolve).toHaveBeenCalledWith({event:'exposureAuthorization'});const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='同意并继续')!;await act(async()=>button.click());expect(resolve).not.toHaveBeenCalledWith(expect.objectContaining({event:'agree'}));await act(async()=>h.agree());expect(resolve).toHaveBeenLastCalledWith({event:'agree',buttonId:'weevibe-privacy-agree'});});
 it('declines the pending native operation when the owner selects not now',async()=>{const resolve=await request();await act(async()=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='暂不同意')!.click());expect(resolve).toHaveBeenLastCalledWith({event:'disagree'});expect(host.textContent).toBe('');});
 it('does not grant a previous account permission through a late button callback',async()=>{const resolve=await request();h.token='B';await act(async()=>h.agree());expect(resolve).toHaveBeenLastCalledWith({event:'disagree'});});
 it('rejects all waiting native actions when the page is hidden',async()=>{const first=await request(),second=await request();await act(async()=>h.hide.forEach(fn=>fn()));for(const resolve of [first,second])expect(resolve).toHaveBeenLastCalledWith({event:'disagree'});});
 it('restores the parent native receiver after a child page is unmounted, without reviving old requests',async()=>{
   const parentShow=h.show[0],parentHide=h.hide[0],oldParent=await request();await act(async()=>parentHide());expect(oldParent).toHaveBeenLastCalledWith({event:'disagree'});
   const childHost=document.createElement('div');document.body.append(childHost);const childRoot=createRoot(childHost);let childMounted=true;
   try{
     await act(async()=>childRoot.render(createElement(PrivacyConsent)));const childShow=h.show.at(-1)!,childUnload=h.unload.at(-1)!,childRequest=await request(),oldChildAgree=h.agree;
     expect(childHost.textContent).toContain('先了解信息如何使用');expect(host.textContent).toBe('');await act(async()=>childUnload());expect(childRequest).toHaveBeenLastCalledWith({event:'disagree'});await act(async()=>childRoot.unmount());childMounted=false;
     const betweenPages=await request();expect(betweenPages).toHaveBeenCalledExactlyOnceWith({event:'disagree'});await act(async()=>parentShow());const resumed=await request();expect(host.textContent).toContain('先了解信息如何使用');expect(resumed).toHaveBeenCalledExactlyOnceWith({event:'exposureAuthorization'});
     await act(async()=>{childShow();oldChildAgree();});expect(resumed).toHaveBeenCalledTimes(1);await act(async()=>h.agree());expect(resumed).toHaveBeenLastCalledWith({event:'agree',buttonId:'weevibe-privacy-agree'});expect(oldParent).not.toHaveBeenCalledWith(expect.objectContaining({event:'agree'}));expect(childRequest).not.toHaveBeenCalledWith(expect.objectContaining({event:'agree'}));
   }finally{if(childMounted)await act(async()=>childRoot.unmount());childHost.remove();}
 });
 it('keeps a resumed parent receiver when child cleanup arrives after parent show',async()=>{
   const parentShow=h.show[0],parentHide=h.hide[0];await act(async()=>parentHide());const childHost=document.createElement('div');document.body.append(childHost);const childRoot=createRoot(childHost);
   try{await act(async()=>childRoot.render(createElement(PrivacyConsent)));await act(async()=>parentShow());await act(async()=>childRoot.unmount());const resumed=await request();expect(resumed).toHaveBeenCalledExactlyOnceWith({event:'exposureAuthorization'});expect(host.textContent).toContain('先了解信息如何使用');await act(async()=>h.agree());expect(resumed).toHaveBeenLastCalledWith({event:'agree',buttonId:'weevibe-privacy-agree'});}finally{childHost.remove();}
 });
 it('survives StrictMode effect cleanup and still requires a real native agree event',async()=>{
   await act(async()=>root.unmount());root=createRoot(host);await act(async()=>root.render(createElement(StrictMode,null,createElement(PrivacyConsent))));const resolver=await request();expect(resolver).toHaveBeenCalledExactlyOnceWith({event:'exposureAuthorization'});await act(async()=>h.agree());expect(resolver).toHaveBeenLastCalledWith({event:'agree',buttonId:'weevibe-privacy-agree'});
 });
 it('declines new native requests while hidden and accepts them again only after show',async()=>{
   const hide=h.hide[0],show=h.show[0];await act(async()=>hide());const hidden=await request();expect(hidden).toHaveBeenCalledExactlyOnceWith({event:'disagree'});await act(async()=>show());const visible=await request();expect(visible).toHaveBeenCalledExactlyOnceWith({event:'exposureAuthorization'});await act(async()=>h.unload[0]());expect(visible).toHaveBeenLastCalledWith({event:'disagree'});
 });
});

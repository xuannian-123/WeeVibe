// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';import { resolve } from 'node:path';
import { emptyAccountFixture } from './account-fixtures';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')), {createElement,act}=req('react'),{createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'A',transport:vi.fn(),upload:vi.fn(),choose:vi.fn(),avatarChanged:vi.fn(),saved:vi.fn(),close:vi.fn(),avatarEvent:undefined as any,nickname:undefined as any}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,transport:h.transport}));
vi.mock('../apps/miniprogram/src/platform/avatar',()=>({uploadAvatar:h.upload}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{chooseMedia:h.choose,getPrivacySetting:({success}:any)=>success({needAuthorization:false})},usePageScroll:()=>{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({ScrollView:(p:any)=>createElement('div',{className:p.className},p.children),
 View:(p:any)=>createElement('div',{className:p.className},p.children),Text:(p:any)=>createElement('span',{},p.children),Image:(p:any)=>createElement('img',{src:p.src}),
 Button:(p:any)=>{if(p.openType==='chooseAvatar')h.avatarEvent=p.onChooseAvatar;return createElement('button',{onClick:p.onClick,disabled:p.disabled},p.children);},
 Input:(p:any)=>{if(p.type==='nickname')h.nickname=p;return createElement('input',{'aria-label':p.type==='nickname'?'昵称':p.ariaLabel,value:p.value,disabled:p.disabled,onInput:(e:any)=>p.onInput?.({detail:{value:e.currentTarget.value}})});},
 Picker:(p:any)=>createElement('div',{},p.children),Switch:(p:any)=>createElement('input',{type:'checkbox',checked:p.checked,onChange:()=>{}})
}));
import { ProfileForm } from '../apps/miniprogram/src/features/shell/profile';
import { ProfileHome } from '../apps/miniprogram/src/features/shell/profile-home';
let host:HTMLDivElement,root:any;
beforeEach(()=>{h.token='A';h.transport.mockReset().mockResolvedValue({status:200,body:emptyAccountFixture()});h.upload.mockReset().mockResolvedValue('/cache/avatar.jpg');h.choose.mockReset().mockResolvedValue({tempFiles:[{tempFilePath:'/temporary/custom.jpg'}]});h.avatarChanged.mockReset();h.saved.mockReset();h.close.mockReset();host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());document.body.innerHTML='';});
async function render(profile:any={}){await act(async()=>root.render(createElement(ProfileForm,{initial:{nickname:'原昵称',...profile},ownerSession:'A',close:h.close,saved:h.saved,avatarSaved:h.avatarChanged})));}
async function click(label:string){const b=Array.from(host.querySelectorAll('button')).find(e=>e.textContent===label);expect(b,label).toBeTruthy();await act(async()=>b!.click());}
function deferred(){let resolve!:(v:any)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}

describe('native avatar shortcut on My',()=>{
 const main=()=>createElement(ProfileHome,{account:emptyAccountFixture(),session:'A',edit:()=>{},settings:()=>{},activities:()=>{},changed:h.saved,plan:()=>{},avatarSaved:h.avatarChanged});
 it('uploads the explicitly selected avatar using its owner session and publishes the verified path',async()=>{
  await act(async()=>root.render(main()));await act(async()=>h.avatarEvent({detail:{avatarUrl:'/temporary/chosen.jpg'}}));
  expect(h.upload).toHaveBeenCalledExactlyOnceWith('/temporary/chosen.jpg','A');expect(h.avatarChanged).toHaveBeenCalledExactlyOnceWith('/cache/avatar.jpg');
 });
 it('discards a late avatar result after the account changes',async()=>{
  const wait=deferred();h.upload.mockReturnValueOnce(wait.promise);await act(async()=>root.render(main()));await act(async()=>h.avatarEvent({detail:{avatarUrl:'/temporary/chosen.jpg'}}));h.token='B';await act(async()=>wait.resolve('/cache/a-only.jpg'));expect(h.avatarChanged).not.toHaveBeenCalled();
 });
});
describe('simplified profile and native/manual identity editing',()=>{
 it('removes cover and private fields from the editor without erasing existing historical values on save',async()=>{await render({signature:'OLD_PRIVATE_SIGNATURE',introduction:'OLD_PRIVATE_DESCRIPTION',cover_style:'lilac'});for(const s of ['个人封面','私人签名','私人补充介绍','OLD_PRIVATE_SIGNATURE','OLD_PRIVATE_DESCRIPTION'])expect(host.textContent).not.toContain(s);await click('保存资料');expect(h.transport.mock.calls[0][0].body.profile).toMatchObject({signature:'OLD_PRIVATE_SIGNATURE',introduction:'OLD_PRIVATE_DESCRIPTION',cover_style:'lilac'});});
 it('keeps past interests stored without providing public profile controls',async()=>{await render({interests:['摄影'],bio:'PRIVATE_BIO'});expect(host.textContent).not.toMatch(/PRIVATE_BIO|我的兴趣|主动公开给/);await click('保存资料');expect(h.transport.mock.calls[0][0].body.profile.interests).toEqual(['摄影']);});
 it('uses the platform avatar result as a preview and uploads only after explicit save',async()=>{await render();await act(async()=>h.avatarEvent({detail:{avatarUrl:'/temporary/wechat.jpg'}}));expect(h.upload).not.toHaveBeenCalled();await click('保存头像');expect(h.upload).toHaveBeenCalledWith('/temporary/wechat.jpg','A');expect(h.avatarChanged).toHaveBeenCalledWith('/cache/avatar.jpg');});
 it('offers custom album selection without changing the profile or automatically uploading',async()=>{await render();await click('从相册自定义');expect(h.choose).toHaveBeenCalledWith({count:1,mediaType:['image'],sourceType:['album']});expect(h.upload).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();await click('保存头像');expect(h.upload).toHaveBeenCalledWith('/temporary/custom.jpg','A');});
 it('focuses the native nickname input and saves its confirmed quick-fill value',async()=>{await render();await click('使用微信昵称');expect(h.nickname.type).toBe('nickname');expect(h.nickname.focus).toBe(true);await act(async()=>h.nickname.onBlur({detail:{value:'微信快捷昵称'}}));await click('保存资料');expect(h.transport.mock.calls[0][0].body.profile.nickname).toBe('微信快捷昵称');});
 it('also accepts a manually typed nickname',async()=>{await render();await act(async()=>h.nickname.onInput({detail:{value:'自定义昵称'}}));await click('保存资料');expect(h.transport.mock.calls[0][0].body.profile.nickname).toBe('自定义昵称');});
 it('keeps the original avatar and draft after selection cancellation or upload failure',async()=>{await render({avatar_url:'/cache/old.jpg'});h.choose.mockRejectedValueOnce({errMsg:'chooseMedia:fail cancel'});await click('从相册自定义');expect(h.upload).not.toHaveBeenCalled();await act(async()=>h.avatarEvent({detail:{avatarUrl:'/temporary/new.jpg'}}));h.upload.mockRejectedValueOnce(Error('PRIVATE_UPLOAD_DETAIL'));await click('保存头像');expect(h.avatarChanged).not.toHaveBeenCalled();expect(h.saved).not.toHaveBeenCalled();expect(host.textContent).not.toContain('PRIVATE_UPLOAD_DETAIL');expect(host.querySelector('.c-identity-avatar img')?.getAttribute('src')).toBe('/temporary/new.jpg');});
 it('discards a late album selection after changing accounts',async()=>{await render();const pending=deferred();h.choose.mockReturnValueOnce(pending.promise);await click('从相册自定义');h.token='B';await act(async()=>pending.resolve({tempFiles:[{tempFilePath:'/temporary/A.jpg'}]}));expect(h.upload).not.toHaveBeenCalled();expect(h.avatarChanged).not.toHaveBeenCalled();expect(host.querySelector('img')).toBeNull();});
 it('does not publish a late avatar success into another account',async()=>{await render();await act(async()=>h.avatarEvent({detail:{avatarUrl:'/temporary/A.jpg'}}));const pending=deferred();h.upload.mockReturnValueOnce(pending.promise);await click('保存头像');h.token='B';await act(async()=>pending.resolve('/cache/A.jpg'));expect(h.avatarChanged).not.toHaveBeenCalled();expect(host.textContent).not.toContain('头像已保存到服务器');});
});

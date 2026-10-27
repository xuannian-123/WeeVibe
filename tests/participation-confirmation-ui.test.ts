/// <reference path="../apps/miniprogram/src/assets.d.ts" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';import { resolve } from 'node:path';
import { applicantA, applicantB, applicationActivity, applicationDetail, applicationSegment } from './application-fixtures';
import type { ActivityDetail } from '../packages/contracts/src';
import { ApiClientError } from '../packages/api-client/src';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=req('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const m=vi.hoisted(()=>({token:'session-a',modal:vi.fn(),send:vi.fn(),busy:vi.fn(),refresh:vi.fn(),remember:vi.fn(),store:new Map<string,unknown>(),hide:[] as (()=>void)[],show:[] as (()=>void)[],controller:{} as any,apply:vi.fn(),decide:vi.fn()}));
vi.mock('../apps/miniprogram/src/features/participation/api',()=>({submitParticipation:m.send}));
vi.mock('../apps/miniprogram/src/platform/activities',()=>({formatTime:(v:string)=>v,rememberActivity:m.remember}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>m.token}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:m.modal,getStorageSync:(k:string)=>m.store.get(k),setStorageSync:(k:string,v:unknown)=>m.store.set(k,v),removeStorageSync:(k:string)=>m.store.delete(k)},useDidShow:(fn:()=>void)=>m.show.push(fn),useDidHide:(fn:()=>void)=>m.hide.push(fn),useUnload:()=>{}}));
// Keep the real sibling MainSegmentPanel mounted; extend only the native primitive fixture.
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Radio:()=>null,RadioGroup:(p:any)=>createElement('div',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children),View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),Label:(p:any)=>createElement('label',{},p.children),Checkbox:(p:any)=>createElement('input',{type:'checkbox',disabled:p.disabled,checked:p.checked,readOnly:true}),CheckboxGroup:(p:any)=>createElement('button',{onClick:()=>p.onChange({detail:{value:[applicationSegment]}})},'选择环节'),Picker:(p:any)=>createElement('button',{disabled:p.disabled,onClick:()=>p.onChange({detail:{value:p.mode==='date'?'2030-01-02':'09:30'}})},p.mode==='date'?'选择日期':'选择时间')}));
vi.mock('../apps/miniprogram/src/features/activity-detail/use-activity-detail',()=>({useActivityDetail:()=>m.controller}));
vi.mock('../apps/miniprogram/src/features/activity-detail/itinerary',()=>({Itinerary:()=>null}));
vi.mock('../apps/miniprogram/src/features/activity-detail/more',()=>({ActivityMore:()=>null}));
vi.mock('../apps/miniprogram/src/features/applications/panels',()=>({ApprovalPanel:({state}:any)=>createElement('button',{disabled:!state.fresh||state.anyBusy,onClick:()=>state.decide('application','approve')},'审批同伴操作'),ApplicationForm:({state}:any)=>createElement('button',{disabled:!state.fresh||state.anyBusy,onClick:state.submit},'申请同伴操作'),MyParticipationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/invitations',()=>({InvitationPanel:(p:any)=>createElement('button',{disabled:p.anyBusy,onClick:()=>p.onBusyChange(true)},'邀请同伴操作')}));
import { ParticipationActions } from '../apps/miniprogram/src/features/participation/ParticipationActions';
import ActivityDetailScreen from '../apps/miniprogram/src/features/activity-detail/screen';
let root:ReturnType<typeof createRoot>|undefined;
function detail():ActivityDetail{const value=applicationDetail();value.viewer.participations=[{segment_id:applicationSegment,status:'joined',accepted_plan_revision:1}];return value;}
function result(){const value=detail();value.revision=2;return {activity:value,notice:'CONFIRMED_CHANGE',fee_recheck_required:true};}
beforeEach(()=>{m.token='session-a';m.modal.mockReset();m.send.mockReset();m.busy.mockReset();m.refresh.mockReset().mockResolvedValue(undefined);m.remember.mockReset();m.store.clear();m.hide=[];m.show=[];m.apply.mockReset();m.decide.mockReset();});
afterEach(async()=>{if(root)await act(async()=>root?.unmount());root=undefined;document.body.innerHTML='';});
async function render(value=detail(),fresh=true,session='session-a'){if(!root){const h=document.createElement('div');document.body.append(h);root=createRoot(h);}await act(async()=>root!.render(createElement(ParticipationActions,{detail:value,session,fresh,refresh:m.refresh,onBusyChange:m.busy})));}
function button(s:string){const found=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===s);expect(found).toBeTruthy();return found!;}
async function click(s:string){await act(async()=>{button(s).click();await Promise.resolve();});}
async function prepare(){await render();await click('选择环节');await click('选择日期');await click('选择时间');}
function dialog(){let finish!:(v:{confirm:boolean})=>void;m.modal.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));return (confirm:boolean)=>act(async()=>finish({confirm}));}
const key=`weevibe-participation-v1:${applicationActivity}:${applicantA}`;
describe('participation confirmations with actual stored-write hook (offline native/HTTP doubles)',()=>{
 it.each(['退出所选环节','记录晚到'])('%s locks synchronously before its dialog, including repeated clicks',async name=>{await prepare();const finish=dialog();await act(async()=>{button(name).click();button(name).click();});expect(m.modal).toHaveBeenCalledTimes(1);expect(m.send).not.toHaveBeenCalled();expect(m.busy).toHaveBeenLastCalledWith(true);expect(button('选择日期').disabled).toBe(true);await finish(false);expect(button(name).disabled).toBe(false);});
 it.each(['退出所选环节','记录晚到'])('%s: cancellation releases the lock and a later confirmation can succeed once',async name=>{await prepare();m.modal.mockResolvedValueOnce({confirm:false});await click(name);expect(m.send).not.toHaveBeenCalled();m.modal.mockResolvedValueOnce({confirm:true});m.send.mockResolvedValueOnce(result());await click(name);expect(m.send).toHaveBeenCalledTimes(1);expect(m.refresh).toHaveBeenCalledTimes(1);expect(document.body.textContent).toContain('CONFIRMED_CHANGE');});
 it.each(['退出所选环节','记录晚到'])('%s: modal rejection stays recoverable and never leaks raw platform errors',async name=>{await prepare();m.modal.mockRejectedValueOnce(new Error('PRIVATE_NATIVE_ERROR'));await click(name);expect(m.send).not.toHaveBeenCalled();expect(document.body.textContent).toContain('确认未完成');expect(document.body.textContent).not.toContain('PRIVATE_NATIVE_ERROR');expect(button(name).disabled).toBe(false);m.modal.mockResolvedValueOnce({confirm:false});await click(name);expect(m.modal).toHaveBeenCalledTimes(2);});
 it('cancels confirmation after a session switch',async()=>{await prepare();const finish=dialog();await click('退出所选环节');m.token='session-b';await finish(true);expect(m.send).not.toHaveBeenCalled();});
 it.each(['revision','actor','participation','cancelled','segment-cancelled','ended','unfresh'])('does not send after %s changes during confirmation',async change=>{await prepare();const finish=dialog();await click('退出所选环节');const next=detail();if(change==='revision')next.revision++;if(change==='actor')next.viewer.user_id=applicantB;if(change==='participation')next.viewer.participations[0].status='exited';if(change==='cancelled')next.cancelled_at='2030-01-01T00:00:00Z';if(change==='segment-cancelled')next.segments[0].cancelled_at='2030-01-01T00:00:00Z';if(change==='ended')next.server_time='2030-01-03T00:00:00Z';await render(next,change!=='unfresh');await finish(true);expect(m.send).not.toHaveBeenCalled();});
 it('unmounts while confirming without starting any operation or storing a new key',async()=>{await prepare();const finish=dialog();await click('退出所选环节');await act(async()=>root!.unmount());root=undefined;await finish(true);expect(m.send).not.toHaveBeenCalled();expect(m.store.has(key)).toBe(false);});
 it('hide followed by show never revives an older confirmation',async()=>{await prepare();const finish=dialog();await click('退出所选环节');await act(async()=>m.hide.slice(-2).forEach(fn=>fn()));await act(async()=>m.show.slice(-2).forEach(fn=>fn()));await finish(true);expect(m.send).not.toHaveBeenCalled();expect(button('退出所选环节').disabled).toBe(false);});
 it.each(['hide','unmount','session','newer-read','new-activity'])('does not acknowledge an already sent result after %s, and retains its original retry key',async change=>{await prepare();m.modal.mockResolvedValueOnce({confirm:true});let finish!:(value:ReturnType<typeof result>)=>void;m.send.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click('退出所选环节');expect(m.send).toHaveBeenCalledTimes(1);if(change==='hide')await act(async()=>m.hide.slice(-2).forEach(fn=>fn()));if(change==='unmount'){await act(async()=>root!.unmount());root=undefined;}if(change==='session')m.token='session-b';if(change==='newer-read'){const next=detail();next.revision=3;await render(next);}if(change==='new-activity'){const next=detail();next.activity_id=applicantB;await render(next);}await act(async()=>finish(result()));expect(m.refresh).not.toHaveBeenCalled();expect(m.remember).not.toHaveBeenCalled();expect(document.body.textContent).not.toContain('CONFIRMED_CHANGE');expect(m.store.has(key)).toBe(true);});
 it('keeps the same original exit body/key on an unknown result and explicit retry',async()=>{await prepare();m.modal.mockResolvedValueOnce({confirm:true});m.send.mockRejectedValueOnce(new ApiClientError('NETWORK_ERROR','lost response',0));await click('退出所选环节');const first=m.send.mock.calls[0][1];expect(m.store.has(key)).toBe(true);expect(document.body.textContent).not.toContain('CONFIRMED_CHANGE');m.send.mockResolvedValueOnce(result());await click('重试原请求');expect(m.send.mock.calls[1][1]).toEqual(first);expect(m.store.has(key)).toBe(false);expect(m.refresh).toHaveBeenCalledTimes(1);});
});
async function screen(){if(!root){const h=document.createElement('div');document.body.append(h);root=createRoot(h);}await act(async()=>root!.render(createElement(ActivityDetailScreen)));}
function controller(){const value=detail();return {id:applicationActivity,detail:value,userId:applicantA,read:{data:{session:'session-a',detail:value},error:'',loading:false,refresh:m.refresh},login:{busy:false,error:'',login:vi.fn()},applications:{anyBusy:false,fresh:true,submit:m.apply,decide:m.decide,apply:{send:vi.fn()},decision:{send:vi.fn()}},setOutgoingInvitationId:vi.fn(),showMore:false,setShowMore:vi.fn()};}
describe('actual detail screen coordinates confirmation busy without self-blocking',()=>{
 it('permits its own confirmed exit but blocks application/approval/invitation until it settles',async()=>{m.controller=controller();await screen();await click('选择环节');const finish=dialog();await click('退出所选环节');for(const name of ['申请同伴操作','审批同伴操作','邀请同伴操作'])expect(button(name).disabled).toBe(true);m.send.mockResolvedValueOnce(result());await finish(true);expect(m.send).toHaveBeenCalledTimes(1);expect(m.refresh).toHaveBeenCalledTimes(1);for(const name of ['申请同伴操作','审批同伴操作','邀请同伴操作'])expect(button(name).disabled).toBe(false);});
 it('refuses a new exit while another application/approval write is busy',async()=>{m.controller=controller();await screen();await click('选择环节');m.controller={...m.controller,applications:{...m.controller.applications,anyBusy:true}};await screen();expect(button('退出所选环节').disabled).toBe(true);await click('退出所选环节');expect(m.modal).not.toHaveBeenCalled();});
 it('releases peer operations after cancelling instead of leaving the entire page locked',async()=>{m.controller=controller();await screen();await click('选择环节');m.modal.mockResolvedValueOnce({confirm:false});await click('退出所选环节');await click('申请同伴操作');await click('审批同伴操作');expect(m.apply).toHaveBeenCalledTimes(1);expect(m.decide).toHaveBeenCalledTimes(1);expect(m.send).not.toHaveBeenCalled();});
});

// This suite isolates its existing feature; cycle31 capacity Screen probes cover the new peer.
vi.mock('../apps/miniprogram/src/features/capacity/CapacityPanel', () => ({ CapacityPanel: () => null }));

// This suite isolates its original feature; cycle32 tests exercise the actual share-card Screen composition.
vi.mock('../apps/miniprogram/src/features/share-card/ActivityShareCard', () => ({ ActivityShareCard: () => null }));

// This pre-existing feature suite isolates the new deadline sibling. Actual composed deadline/peer behavior is covered by deadline-screen-ui and independent full-Screen probes.
vi.mock('../apps/miniprogram/src/features/deadline/DeadlinePanel', () => ({ DeadlinePanel: () => null }));

// This existing feature suite isolates the booking sibling; booking-screen-ui and independent complete-Screen probes verify the new declaration/history composition.
vi.mock('../apps/miniprogram/src/features/booking/BookingPanel', () => ({ BookingPanel: () => null }));

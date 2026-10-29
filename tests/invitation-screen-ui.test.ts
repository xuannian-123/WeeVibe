/// <reference path="../apps/miniprogram/src/assets.d.ts" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applicantA, applicationActivity, applicationDetail, applicationId } from './application-fixtures';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=req('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({controller:{} as any,editor:{} as any,applicationState:{} as any,modal:vi.fn(),me:vi.fn(),transport:vi.fn(),created:vi.fn()}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=> 'session-a',api:{me:h.me},transport:h.transport}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:h.modal},useDidHide:()=>{},useDidShow:()=>{},useUnload:()=>{}}));
// Keep the real sibling MainSegmentPanel mounted; extend only the native primitive fixture.
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Image:(p:any)=>createElement('img',{src:p.src}),Radio:()=>null,RadioGroup:(p:any)=>createElement('div',{},p.children),Label:(p:any)=>createElement('label',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children),View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children)}));
vi.mock('../apps/miniprogram/src/features/activity-detail/use-activity-detail',()=>({useActivityDetail:()=>h.controller}));
vi.mock('../apps/miniprogram/src/features/activity-detail/itinerary',()=>({Itinerary:()=>createElement('span',{},'行程挂载')}));
vi.mock('../apps/miniprogram/src/features/activity-detail/more',()=>({ActivityMore:()=>null}));
vi.mock('../apps/miniprogram/src/features/applications/panels',()=>({ApprovalPanel:({state}:any)=>createElement('button',{disabled:state.anyBusy||!state.fresh},'审批同伴操作'),ApplicationForm:({state}:any)=>{h.applicationState=state;return createElement('button',{disabled:state.anyBusy||!state.fresh},'申请同伴操作');},MyParticipationPanel:()=>createElement('span',{},'本人状态挂载')}));
// Exercise the real Screen's editor/peer locks; the editor's actual lifecycle is covered by arrangement-editor-ui.
vi.mock('../apps/miniprogram/src/features/arrangement-change/ArrangementEditor',()=>({ArrangementEditor:(p:any)=>{h.editor=p;return createElement('button',{disabled:!p.fresh||p.anyBusy},'安排编辑同伴操作');}}));
vi.mock('../apps/miniprogram/src/features/participation/ParticipationActions',()=>({ParticipationActions:(p:any)=>createElement('button',{disabled:!p.fresh},'退出同伴操作')}));
// This suite isolates its own writer; the real handover GET/lifecycle is covered in handover-ui and independent Screen tests.
vi.mock('../apps/miniprogram/src/features/handover/HandoverPanel',()=>({HandoverPanel:(p:any)=>createElement('button',{disabled:p.anyBusy||!p.fresh},'交接同伴操作')}));
import ActivityDetailScreen from '../apps/miniprogram/src/features/activity-detail/screen';
let root:ReturnType<typeof createRoot>|undefined;
beforeEach(()=>{const detail=applicationDetail();h.controller={id:applicationActivity,detail,userId:applicantA,read:{data:{detail,session:'session-a'},loading:false,error:'',refresh:vi.fn()},login:{busy:false,error:''},applications:{fresh:true,anyBusy:false,apply:{send:vi.fn()},decision:{send:vi.fn()},submit:vi.fn(),decide:vi.fn()},setOutgoingInvitationId:h.created};h.created.mockReset();h.modal.mockReset().mockResolvedValue({confirm:true});h.me.mockReset().mockResolvedValue({user_id:applicantA});h.transport.mockReset().mockResolvedValue({status:200,body:{invitation_id:applicationId,activity_id:applicationActivity,title:'source',inviter_display_name:null,inviter_avatar_url:null,starts_at:null,ends_at:null,timezone:'UTC',cancelled:false,source_only:true}});});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';});
async function render(){if(!root){const host=document.createElement('div');document.body.append(host);root=createRoot(host);}await act(async()=>root!.render(createElement(ActivityDetailScreen)));}
function button(name:string){const value=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===name)!;expect(value).toBeTruthy();return value;}
async function click(){await act(async()=>{button('准备带来源的邀请入口').click();await Promise.resolve();});}
describe('actual detail screen + invitation component + client',()=>{
 it('disables peer writes while me waits without making its own final preflight stale',async()=>{await render();let finish!:(v:{user_id:string})=>void;h.me.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await click();expect(h.transport).not.toHaveBeenCalled();for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','交接同伴操作'])expect(button(name).disabled).toBe(true);await act(async()=>finish({user_id:applicantA}));expect(h.transport).toHaveBeenCalledTimes(1);expect(h.created).toHaveBeenCalledExactlyOnceWith(applicationId);for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','交接同伴操作'])expect(button(name).disabled).toBe(false);});
 it('cancellation releases peers without identity lookup or mutation',async()=>{await render();h.modal.mockResolvedValueOnce({confirm:false});await click();expect(h.me).not.toHaveBeenCalled();expect(h.transport).not.toHaveBeenCalled();for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','交接同伴操作'])expect(button(name).disabled).toBe(false);});
 it('does not open invitation confirmation while another application is busy',async()=>{h.controller.applications.anyBusy=true;await render();expect(button('准备带来源的邀请入口').disabled).toBe(true);await click();expect(h.modal).not.toHaveBeenCalled();});
});

// This suite isolates its existing feature; cycle31 capacity Screen probes cover the new peer.
vi.mock('../apps/miniprogram/src/features/capacity/CapacityPanel', () => ({ CapacityPanel: () => null }));

// This suite isolates its original feature; cycle32 tests exercise the actual share-card Screen composition.
vi.mock('../apps/miniprogram/src/features/share-card/ActivityShareCard', () => ({ ActivityShareCard: () => null }));

// This pre-existing feature suite isolates the new deadline sibling. Actual composed deadline/peer behavior is covered by deadline-screen-ui and independent full-Screen probes.
vi.mock('../apps/miniprogram/src/features/deadline/DeadlinePanel', () => ({ DeadlinePanel: () => null }));

// This existing feature suite isolates the booking sibling; booking-screen-ui and independent complete-Screen probes verify the new declaration/history composition.
vi.mock('../apps/miniprogram/src/features/booking/BookingPanel', () => ({ BookingPanel: () => null }));
it('places the participation entry before management panels and mounts the existing form once', async () => {
  await render();
  const text = document.body.textContent || '';
  expect(text.indexOf('选择参加环节')).toBeGreaterThanOrEqual(0);
  expect(text.indexOf('选择参加环节')).toBeLessThan(text.indexOf('交接同伴操作'));
  expect(Array.from(document.querySelectorAll('button')).filter(button => button.textContent === '申请同伴操作')).toHaveLength(1);
  expect(text.match(/行程挂载/g)).toHaveLength(1);
  expect(text.match(/本人状态挂载/g)).toHaveLength(1);
  expect(Array.from(document.querySelectorAll('button')).filter(button => button.textContent === '安排编辑同伴操作')).toHaveLength(1);
});

it('blocks invitation and original application handlers during arrangement editing without self-blocking the editor', async () => {
  await render(); const originalSubmit=h.applicationState.submit, originalRetry=h.applicationState.apply.send;
  await act(async()=>h.editor.onBusyChange(true));
  for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','交接同伴操作','准备带来源的邀请入口','选择参加环节'])expect(button(name).disabled).toBe(true);
  expect(button('安排编辑同伴操作').disabled).toBe(false);
  await act(async()=>{originalSubmit();await originalRetry();});
  expect(h.controller.applications.submit).not.toHaveBeenCalled();expect(h.controller.applications.apply.send).not.toHaveBeenCalled();
  await act(async()=>h.editor.onBusyChange(false));
  for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','交接同伴操作','准备带来源的邀请入口'])expect(button(name).disabled).toBe(false);
  expect(h.transport).not.toHaveBeenCalled();
});

it('blocks the editor during invitation identity preflight and releases it after source creation', async () => {
  await render(); let finish!:(value:{user_id:string})=>void;
  h.me.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})); await click();
  expect(button('安排编辑同伴操作').disabled).toBe(true);
  await act(async()=>finish({user_id:applicantA})); expect(button('安排编辑同伴操作').disabled).toBe(false);
  expect(h.created).toHaveBeenCalledExactlyOnceWith(applicationId);
});

it('preserves the new main formation guidance while keeping the invitation overview and source entry', async () => {
  await render(); expect(document.body.textContent).toContain('主环节待补位');
  expect(document.body.textContent).toContain('补齐后由发起人确认恢复，原成员不用重报');
  expect(button('准备带来源的邀请入口')).toBeTruthy(); expect(button('选择参加环节')).toBeTruthy();
});

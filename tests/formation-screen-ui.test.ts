/// <reference path="../apps/miniprogram/src/assets.d.ts" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { applicantA, applicationActivity, applicationDetail, applicationSegment } from './application-fixtures';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'));
const {createElement,act}=req('react') as typeof import('../apps/miniprogram/node_modules/@types/react');
const {createRoot}=req('react-dom/client') as {createRoot:(host:Element)=>{render:(element:ReturnType<typeof createElement>)=>void;unmount:()=>void}};
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({controller:{} as any,modal:vi.fn(),transport:vi.fn(),refresh:vi.fn(),remember:vi.fn(),store:new Map<string,unknown>(),next:{} as any}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=> 'session-a',transport:h.transport}));
vi.mock('../apps/miniprogram/src/platform/activities',async importOriginal=>({...await importOriginal<typeof import('../apps/miniprogram/src/platform/activities')>(),rememberActivity:h.remember}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:h.modal,getStorageSync:(key:string)=>h.store.get(key),setStorageSync:(key:string,value:unknown)=>h.store.set(key,value),removeStorageSync:(key:string)=>h.store.delete(key)},useDidHide:()=>{},useDidShow:()=>{},useUnload:()=>{}}));
// Keep the real sibling MainSegmentPanel mounted; extend only the native primitive fixture.
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({ Image:(p:any)=>createElement('img',{src:p.src,className:p.className}),Radio:()=>null,RadioGroup:(p:any)=>createElement('div',{},p.children),Label:(p:any)=>createElement('label',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children),View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children)}));
vi.mock('../apps/miniprogram/src/features/activity-detail/use-activity-detail',()=>({useActivityDetail:()=>h.controller}));
vi.mock('../apps/miniprogram/src/features/activity-detail/itinerary',()=>({Itinerary:()=>null}));
vi.mock('../apps/miniprogram/src/features/activity-detail/more',()=>({ActivityMore:()=>null}));
vi.mock('../apps/miniprogram/src/features/applications/panels',()=>({ApprovalPanel:({state}:any)=>createElement('button',{disabled:state.anyBusy||!state.fresh},'审批同伴操作'),ApplicationForm:({state}:any)=>createElement('button',{disabled:state.anyBusy||!state.fresh},'申请同伴操作'),MyParticipationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/participation/ParticipationActions',()=>({ParticipationActions:(p:any)=>createElement('button',{disabled:!p.fresh},'退出同伴操作')}));
vi.mock('../apps/miniprogram/src/features/invitations',()=>({InvitationPanel:(p:any)=>createElement('button',{disabled:p.anyBusy||!p.fresh},'邀请同伴操作')}));
// This suite isolates its own writer; the real handover GET/lifecycle is covered in handover-ui and independent Screen tests.
vi.mock('../apps/miniprogram/src/features/handover/HandoverPanel',()=>({HandoverPanel:(p:any)=>createElement('button',{disabled:p.anyBusy||!p.fresh},'交接同伴操作')}));
import ActivityDetailScreen from '../apps/miniprogram/src/features/activity-detail/screen';
let root:ReturnType<typeof createRoot>|undefined;
function ready(){const detail=applicationDetail();Object.assign(detail.segments[0],{minimum_participants:4,capacity:6,counts:{occupied_count:4,accepted_count:4,pending_acceptance_count:0,remaining_capacity:2,meets_minimum:true,is_full:false}});return detail;}
beforeEach(()=>{const detail=ready();h.controller={id:applicationActivity,detail,userId:applicantA,read:{data:{detail,session:'session-a'},loading:false,error:'',refresh:h.refresh},login:{busy:false,error:''},applications:{fresh:true,anyBusy:false,apply:{send:vi.fn()},decision:{send:vi.fn()},submit:vi.fn(),decide:vi.fn()},setOutgoingInvitationId:vi.fn()};h.modal.mockReset().mockResolvedValue({confirm:true});h.remember.mockReset();h.store.clear();h.refresh.mockReset().mockResolvedValue(undefined);h.next=ready();h.transport.mockReset().mockImplementation(async request=>request.path==='/api/v1/me'?{status:200,body:{user_id:applicantA}}:{status:200,body:h.next});});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';});
async function render(){if(!root){const host=document.createElement('div');document.body.append(host);root=createRoot(host);}await act(async()=>root!.render(createElement(ActivityDetailScreen)));}
async function displayNext(){h.controller={...h.controller,detail:h.next,read:{...h.controller.read,data:{detail:h.next,session:'session-a'}}};await render();}
function button(label:string){const found=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label)!;expect(found).toBeTruthy();return found;}
async function click(label:string){await act(async()=>{button(label).click();await Promise.resolve();});}
const writes=()=>h.transport.mock.calls.filter(call=>call[0].method==='POST');
describe('actual screen + formation component + client, offline transport',()=>{
 it('allows the nonparticipating manager to verify then explicitly form, with peer writes locked but no self-block',async()=>{
  await render();expect(h.controller.detail.viewer.participations).toEqual([]);expect(button('确认／恢复主环节成局').disabled).toBe(true);
  let finish!:(value:unknown)=>void;h.transport.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));h.next=ready();h.next.revision=2;h.next.segments[0].verification_status='manual_checked';
  await click('标记已人工核实');expect(writes()).toHaveLength(0);for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','邀请同伴操作','交接同伴操作'])expect(button(name).disabled).toBe(true);
  await act(async()=>finish({status:200,body:{user_id:applicantA}}));expect(writes()).toHaveLength(1);expect(h.refresh).toHaveBeenCalledTimes(1);expect(writes()[0][0].body).toMatchObject({action:'set-verification',verified:true,expected_revision:1,segment_id:applicationSegment});
  await displayNext();for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','邀请同伴操作','交接同伴操作'])expect(button(name).disabled).toBe(false);expect(button('确认／恢复主环节成局').disabled).toBe(false);
  h.next=structuredClone(h.next);h.next.revision=3;h.next.formation_status='confirmed';await click('确认／恢复主环节成局');expect(writes()).toHaveLength(2);expect(writes()[1][0].body).toMatchObject({action:'confirm-formation',expected_revision:2,expected_plan_revision:1});expect(h.refresh).toHaveBeenCalledTimes(2);await displayNext();expect(button('确认／恢复主环节成局').disabled).toBe(true);expect(document.body.textContent).toContain('主环节已成局');
 });
 it('cancellation releases all peers without any identity lookup or mutation',async()=>{await render();h.modal.mockResolvedValueOnce({confirm:false});await click('标记已人工核实');expect(h.transport).not.toHaveBeenCalled();for(const name of ['审批同伴操作','申请同伴操作','退出同伴操作','邀请同伴操作','交接同伴操作'])expect(button(name).disabled).toBe(false);});
 it('cannot open formation while another approval is in flight',async()=>{h.controller.applications.anyBusy=true;await render();expect(button('标记已人工核实').disabled).toBe(true);await click('标记已人工核实');expect(h.modal).not.toHaveBeenCalled();});
 it('shows the after-start capability boundary instead of claiming a new user prohibition',async()=>{h.controller.detail.segments[0].has_started=true;h.controller.detail.server_time='2030-01-02T01:00:00Z';await render();expect(button('标记已人工核实').disabled).toBe(true);expect(button('确认／恢复主环节成局').disabled).toBe(true);expect(document.body.textContent).toContain('规则待确认');expect(h.transport).not.toHaveBeenCalled();});
});

// This suite isolates its existing feature; cycle31 capacity Screen probes cover the new peer.
vi.mock('../apps/miniprogram/src/features/capacity/CapacityPanel', () => ({ CapacityPanel: () => null }));

// This suite isolates its original feature; cycle32 tests exercise the actual share-card Screen composition.
vi.mock('../apps/miniprogram/src/features/share-card/ActivityShareCard', () => ({ ActivityShareCard: () => null }));

// This pre-existing feature suite isolates the new deadline sibling. Actual composed deadline/peer behavior is covered by deadline-screen-ui and independent full-Screen probes.
vi.mock('../apps/miniprogram/src/features/deadline/DeadlinePanel', () => ({ DeadlinePanel: () => null }));

// This existing feature suite isolates the booking sibling; booking-screen-ui and independent complete-Screen probes verify the new declaration/history composition.
vi.mock('../apps/miniprogram/src/features/booking/BookingPanel', () => ({ BookingPanel: () => null }));

it('shows replacement deficit after exit and waits for manual recovery when a new snapshot reaches minimum', async () => {
  const value = ready();
  Object.assign(value.segments[0].counts, { occupied_count: 3, accepted_count: 3, remaining_capacity: 3, meets_minimum: false });
  value.segments[0].is_join_open = true;
  h.controller.detail = value;
  await render();
  expect(document.body.textContent).toContain('主环节待补位');
  expect(document.body.textContent).toContain('还差 1 人');
  h.next = ready(); h.next.revision = 2; h.next.segments[0].verification_status = 'manual_checked';
  await displayNext();
  expect(document.body.textContent).toContain('主环节待确认成局');
  expect(document.body.textContent).toContain('不因补齐人数自动成局');
  expect(h.transport).not.toHaveBeenCalled();
});

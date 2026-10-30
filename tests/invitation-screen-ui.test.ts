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
const h=vi.hoisted(()=>({controller:{} as any,modal:vi.fn(),me:vi.fn(),transport:vi.fn(),created:vi.fn(),navigate:vi.fn(),back:vi.fn(),relaunch:vi.fn(),pages:1,section:undefined as string|undefined}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=> 'session-a',api:{me:h.me},transport:h.transport}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{showModal:h.modal,navigateTo:h.navigate,navigateBack:h.back,reLaunch:h.relaunch,getCurrentPages:()=>Array.from({length:h.pages},()=>({})),getCurrentInstance:()=>({router:{params:{section:h.section}}})},useDidHide:()=>{},useDidShow:()=>{},useUnload:()=>{}}));
// Keep the real sibling MainSegmentPanel mounted; extend only the native primitive fixture.
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({Radio:()=>null,RadioGroup:(p:any)=>createElement('div',{},p.children),Label:(p:any)=>createElement('label',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children),View:(p:any)=>createElement('div',{hidden:p.hidden,style:p.style,id:p.id,className:p.className},p.children),Text:(p:any)=>createElement('span',{className:p.className},p.children)}));
vi.mock('../apps/miniprogram/src/features/activity-detail/use-activity-detail',()=>({useActivityDetail:()=>h.controller}));
vi.mock('../apps/miniprogram/src/features/activity-detail/itinerary',()=>({Itinerary:()=>null}));
vi.mock('../apps/miniprogram/src/features/activity-detail/more',()=>({ActivityMore:()=>null}));
vi.mock('../apps/miniprogram/src/features/applications/panels',()=>({ApprovalPanel:({state}:any)=>createElement('button',{disabled:state.anyBusy||!state.fresh},'审批同伴操作'),ApplicationForm:({state}:any)=>createElement('button',{onClick:state.submit,disabled:state.anyBusy||!state.fresh},'申请同伴操作'),MyParticipationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/participation/ParticipationActions',()=>({ParticipationActions:(p:any)=>createElement('button',{disabled:!p.fresh},'退出同伴操作')}));
// This suite isolates its own writer; the real handover GET/lifecycle is covered in handover-ui and independent Screen tests.
vi.mock('../apps/miniprogram/src/features/handover/HandoverPanel',()=>({HandoverPanel:(p:any)=>createElement('button',{disabled:p.anyBusy||!p.fresh},'交接同伴操作')}));
import ActivityDetailScreen from '../apps/miniprogram/src/features/activity-detail/screen';
let root:ReturnType<typeof createRoot>|undefined;
beforeEach(()=>{h.pages=1;h.section=undefined;h.back.mockReset();h.relaunch.mockReset();const detail=applicationDetail();h.controller={id:applicationActivity,detail,userId:applicantA,read:{data:{detail,session:'session-a'},loading:false,error:'',refresh:vi.fn()},login:{busy:false,error:''},applications:{fresh:true,anyBusy:false,apply:{send:vi.fn()},decision:{send:vi.fn()},submit:vi.fn(),decide:vi.fn()},setOutgoingInvitationId:h.created};h.navigate.mockReset().mockResolvedValue({});h.created.mockReset();h.modal.mockReset().mockResolvedValue({confirm:true});h.me.mockReset().mockResolvedValue({user_id:applicantA});h.transport.mockReset().mockResolvedValue({status:200,body:{invitation_id:applicationId,activity_id:applicationActivity,title:'source',inviter_display_name:null,inviter_avatar_url:null,starts_at:null,ends_at:null,timezone:'UTC',cancelled:false,source_only:true}});});
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


describe('integrated invitation overview and existing activity sections',()=>{
 it('shows the real activity name and keeps one application form in its own section',async()=>{
  h.controller.detail.name='真实活动标题'; await render();
  expect(document.querySelector('.iv-title')?.textContent).toBe('真实活动标题');
  expect(document.body.textContent).not.toContain('挑一个动物形象');
  expect(document.querySelector('.iv-host-copy')?.textContent).toContain('昵称暂未公开');
  expect(button('申请同伴操作').closest('[hidden]')).not.toBeNull();
  await act(async()=>button('选择参加环节 →').click());
  expect(button('申请同伴操作').closest('[hidden]')).toBeNull();
  expect(Array.from(document.querySelectorAll('button')).filter(b=>b.textContent==='申请同伴操作')).toHaveLength(1);
 });
 it('blocks only new applications when source verification fails, leaving manager approvals usable',async()=>{
  h.controller.incomingInvitationId=applicationId;
  h.transport.mockResolvedValue({status:404,body:{error:{code:'NOT_FOUND',message:'missing'}}});
  await render();
  expect(button('申请同伴操作').disabled).toBe(true);
  expect(button('审批同伴操作').disabled).toBe(false);
  expect(h.controller.applications.submit).not.toHaveBeenCalled();
 });
 it('releases an application after the source is verified for this activity',async()=>{
  h.controller.incomingInvitationId=applicationId; await render();
  expect(button('申请同伴操作').disabled).toBe(false);
  await act(async()=>button('申请同伴操作').click());
  expect(h.controller.applications.submit).toHaveBeenCalledOnce();
 });
 it('rejects a source for another activity without changing the original application draft',async()=>{
  h.controller.incomingInvitationId=applicationId;
  h.controller.applications.nickname='保留的活动昵称';
  h.transport.mockResolvedValue({status:200,body:{invitation_id:applicationId,activity_id:applicantA,title:'wrong',inviter_display_name:null,inviter_avatar_url:null,starts_at:null,ends_at:null,timezone:'UTC',cancelled:false,source_only:true}});
  await render(); expect(button('申请同伴操作').disabled).toBe(true);
  expect(h.controller.applications.nickname).toBe('保留的活动昵称');
 });
});

it('opens the real requirements route from a suggestion without submitting an application',async()=>{
 await render(); await act(async()=>button('◷改时间').click());
 expect(h.navigate).toHaveBeenCalledExactlyOnceWith({url:`/pages/requirements/index?activity_id=${applicationActivity}`});
 expect(h.controller.applications.submit).not.toHaveBeenCalled();
});
it('keeps original creator and current manager separate in the full arrangement disclosure',async()=>{
 await render(); expect(document.querySelector('.iv-people')).toBeNull();
 await act(async()=>button('查看完整安排 ＋').click());
 expect(document.querySelector('.iv-people')?.textContent).toContain('原发起人公开昵称暂未提供');
 expect(document.querySelector('.iv-people')?.textContent).toContain('你正在负责此活动');
});

it('renders the new full-arrangement cards without mounting the original itinerary layout',async()=>{
 await render(); await act(async()=>button('查看完整安排 ＋').click());
 const expanded=document.querySelector('.iv-expanded')!;
 expect(expanded.querySelector('.ia-arrangement')).not.toBeNull();
 expect(expanded.querySelectorAll('.ia-card')).toHaveLength(h.controller.detail.segments.length);
 expect(expanded.querySelector('.activity-itinerary')).toBeNull();
 expect(expanded.querySelector('.activity-facts')).toBeNull();
 expect(expanded.textContent).toContain('尚未确认费用，不代表免费');
});
it('separates the fee amount from notes and preserves zero-cost and cancelled history',async()=>{
 const d=h.controller.detail;d.segments[0].fee={kind:'per_person',amount_cents:0,currency:'CNY',note:'现场核对'};
 d.cancelled_at=d.server_time;
 await render(); await act(async()=>button('查看完整安排 ＋').click());
 expect(document.querySelector('.ia-cost')?.textContent).toBe('¥0.00 / 人');
 expect(document.querySelector('.ia-arrangement')?.textContent).toContain('参考费用，非已付款；现场核对');
 expect(document.querySelector('.ia-arrangement')?.textContent).toContain('原安排记录，未自动退订或退款');
});

it('returns to the actual source page instead of replacing the source navigation stack',async()=>{
 h.pages=2;await render();await act(async()=>button('返回上一页／首页').click());
 expect(h.back).toHaveBeenCalledExactlyOnceWith({delta:1});expect(h.relaunch).not.toHaveBeenCalled();
});
it('falls back to home for a standalone invitation and opens message-targeted approvals directly',async()=>{
 h.section='applications';await render();expect(button('审批同伴操作').closest('[hidden]')).toBeNull();
 await act(async()=>button('返回活动').click());expect(document.querySelector('.iv-title')).not.toBeNull();
 await act(async()=>button('返回上一页／首页').click());expect(h.relaunch).toHaveBeenCalledExactlyOnceWith({url:'/pages/index/index'});
});

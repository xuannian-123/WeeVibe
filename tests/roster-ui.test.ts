// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module'; import { resolve } from 'node:path';
import { applicationDetail, applicantB } from './application-fixtures';
const req=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json')); const {createElement,act}=req('react');const {createRoot}=req('react-dom/client');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
const h=vi.hoisted(()=>({token:'session-a' as string|undefined,transport:vi.fn(),refresh:vi.fn(),controller:{} as any,hooks:{show:new Set<()=>void>(),hide:new Set<()=>void>(),unload:new Set<()=>void>()}}));
vi.mock('../apps/miniprogram/src/platform/api',()=>({getToken:()=>h.token,transport:h.transport}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',async()=>{const{createRequire}=await import('node:module');const{resolve}=await import('node:path');const{useRef,useEffect}=createRequire(resolve(process.cwd(),'apps/miniprogram/package.json'))('react');const hook=(kind:'show'|'hide'|'unload',cb:()=>void)=>{const r=useRef(cb);r.current=cb;useEffect(()=>{const f=()=>r.current();h.hooks[kind].add(f);return()=>h.hooks[kind].delete(f);},[]);};return{default:{},useDidShow:(f:()=>void)=>hook('show',f),useDidHide:(f:()=>void)=>hook('hide',f),useUnload:(f:()=>void)=>hook('unload',f)};});
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{disabled:p.disabled,onClick:p.onClick},p.children)}));
vi.mock('../apps/miniprogram/src/features/activity-detail/use-activity-detail',()=>({useActivityDetail:()=>h.controller}));
vi.mock('../apps/miniprogram/src/features/activity-detail/itinerary',()=>({Itinerary:()=>null}));
vi.mock('../apps/miniprogram/src/features/activity-detail/more',()=>({ActivityMore:()=>null}));
vi.mock('../apps/miniprogram/src/features/applications/panels',()=>({ApplicationForm:()=>null,ApprovalPanel:()=>null,MyParticipationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/invitations',()=>({InvitationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/formation/FormationPanel',()=>({FormationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/arrangement-change/ArrangementPanel',()=>({ArrangementPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/applications/WithdrawalPanel',()=>({WithdrawalPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/participation/ParticipationActions',()=>({ParticipationActions:()=>null}));
vi.mock('../apps/miniprogram/src/features/cancellation/CancellationPanel',()=>({CancellationPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/handover/HandoverPanel',()=>({HandoverPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/rebook/RebookPanel',()=>({RebookPanel:()=>null}));
vi.mock('../apps/miniprogram/src/features/main-segment/MainSegmentPanel',()=>({MainSegmentPanel:()=>null}));
import { RosterPanel } from '../apps/miniprogram/src/features/roster/RosterPanel';
import Screen from '../apps/miniprogram/src/features/activity-detail/screen';
let root:any,detail:ReturnType<typeof applicationDetail>,fresh:boolean,session:string|undefined;
function body(){return{activity_id:detail.activity_id,activity_revision:detail.revision,server_time:detail.server_time,cancelled:Boolean(detail.cancelled_at),complete:true,limit:2000,segments:detail.segments.map(s=>({segment_id:s.segment_id,name:s.name,position:s.position,plan_revision:s.plan_revision,cancelled:Boolean(s.cancelled_at),availability:detail.cancelled_at||s.cancelled_at?'cancelled_history_not_exposed':'available',members:detail.cancelled_at||s.cancelled_at?null:[],counts:detail.cancelled_at||s.cancelled_at?null:{occupied_count:0,accepted_count:0,pending_acceptance_count:0}}))};}
function wait(){let resolve!:(v:any)=>void;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};}
async function render(){await act(async()=>root.render(createElement(RosterPanel,{detail,session,fresh,refresh:h.refresh})));}
async function mount(){const host=document.createElement('div');document.body.append(host);root=createRoot(host);await render();}
const text=()=>document.body.textContent||'';
function button(label='查看当前分段名单'){const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent===label);expect(b).toBeTruthy();return b!;}
async function click(){await act(async()=>button().click());}
async function lifecycle(kind:'hide'|'show'|'unload'){await act(async()=>Array.from(h.hooks[kind]).forEach(f=>f()));}
beforeEach(()=>{detail=applicationDetail();session=h.token='session-a';fresh=true;h.transport.mockReset().mockImplementation(async()=>({status:200,body:body()}));h.refresh.mockReset();Object.values(h.hooks).forEach(x=>x.clear());});
afterEach(async()=>{if(root)await act(async()=>root.unmount());root=undefined;document.body.innerHTML='';});
it('no automatic request; explicit valid empty response alone may say no occupied members',async()=>{await mount();expect(h.transport).not.toHaveBeenCalled();expect(text()).not.toContain('当前没有占位成员');await click();expect(text()).toContain('此环节当前没有占位成员');expect(h.transport).toHaveBeenCalledOnce();});
it('duplicates and null names remain real separate occupied entries; statuses are not merged',async()=>{detail.segments[0].counts={...detail.segments[0].counts,occupied_count:3,accepted_count:2,pending_acceptance_count:1};h.transport.mockImplementation(async()=>{const b:any=body();b.segments[0].members=[{display_name:'同名',status:'joined'},{display_name:'同名',status:'awaiting_acceptance'},{display_name:null,status:'joined'}];b.segments[0].counts={occupied_count:3,accepted_count:2,pending_acceptance_count:1};return{status:200,body:b};});await mount();await click();expect(text().match(/同名/g)?.length).toBe(3);expect(text()).toContain('未填写报名名');expect(text()).toContain('保位待接受当前安排');});
it('markup in a public signup name is only text',async()=>{detail.segments[0].counts={...detail.segments[0].counts,occupied_count:1,accepted_count:1};h.transport.mockImplementation(async()=>{const b:any=body();b.segments[0].members=[{display_name:'<img src=x onerror=alert(1)>',status:'joined'}];b.segments[0].counts={occupied_count:1,accepted_count:1,pending_acceptance_count:0};return{status:200,body:b};});await mount();await click();expect(text()).toContain('<img src=x');expect(document.querySelector('img')).toBeNull();});
it.each(['activity','segment'])('cancelled %s is explicitly unavailable history, not zero members',async kind=>{if(kind==='activity')detail.cancelled_at=detail.server_time;else detail.segments[0].cancelled_at=detail.server_time;await mount();await click();expect(text()).toContain('不表示没有历史成员');expect(text()).not.toContain('当前没有占位成员');});
it.each([404,405,503])('backend %s reports unknown/unavailable, not a full empty list',async status=>{h.transport.mockResolvedValue({status,body:'PRIVATE_RAW'});await mount();await click();expect(text()).not.toContain('当前没有占位成员');expect(text()).not.toContain('PRIVATE_RAW');expect(text()).toContain('这不代表没有参加者');});
it('malformed success does not invent members or leak body',async()=>{h.transport.mockResolvedValue({status:200,body:{secret:'PRIVATE_RAW'}});await mount();await click();expect(text()).toContain('响应无法验证');expect(text()).not.toContain('PRIVATE_RAW');});
it('sync double clicks only send one request',async()=>{const p=wait();h.transport.mockReturnValue(p.promise);await mount();const b=button();await act(async()=>{b.click();b.click();});expect(h.transport).toHaveBeenCalledOnce();await act(async()=>p.resolve({status:200,body:body()}));});
for(const change of ['session','source','fresh','hide','unload','unmount'] as const)it(`late success after ${change} cannot adopt old roster`,async()=>{const p=wait();h.transport.mockReturnValue(p.promise);await mount();await click();const old=body();if(change==='session'){h.token=session='session-b';detail={...detail,viewer:{...detail.viewer,user_id:applicantB}};await render();}else if(change==='source'){detail={...detail,revision:2};await render();}else if(change==='fresh'){fresh=false;await render();}else if(change==='unmount'){await act(async()=>root.unmount());root=undefined;}else await lifecycle(change);await act(async()=>p.resolve({status:200,body:old}));expect(text()).not.toContain('当前没有占位成员');});
it('old operation finally cannot unlock new read after hide/show',async()=>{const a=wait(),b=wait();h.transport.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);await mount();await click();await lifecycle('hide');await lifecycle('show');await click();await act(async()=>a.resolve({status:200,body:body()}));expect(button('读取名单中…').disabled).toBe(true);expect(text()).not.toContain('当前没有占位成员');await act(async()=>b.resolve({status:200,body:body()}));expect(text()).toContain('当前没有占位成员');});
it('same-version clock polling keeps verified names; revision changes remove them without requery',async()=>{await mount();await click();detail={...detail,server_time:'2030-01-01T00:00:20Z'};await render();expect(text()).toContain('当前没有占位成员');detail={...detail,revision:2};await render();expect(text()).not.toContain('当前没有占位成员');expect(h.transport).toHaveBeenCalledOnce();});
it('A→B→A observed source changes do not revive an old response',async()=>{const p=wait();h.transport.mockReturnValue(p.promise);await mount();await click();const original=detail;detail={...detail,revision:2};await render();detail=original;await render();await act(async()=>p.resolve({status:200,body:body()}));expect(text()).not.toContain('当前没有占位成员');});
it('guest explicit request works, with no automatic login or bearer',async()=>{session=h.token=undefined;await mount();await click();expect(h.transport.mock.calls[0][0].headers.Authorization).toBeUndefined();expect(text()).toContain('当前没有占位成员');});
it('an already changed token blocks request even before a rerender',async()=>{await mount();h.token='session-b';await click();expect(h.transport).not.toHaveBeenCalled();});
it('peer write makes read disabled; once fresh it works normally',async()=>{fresh=false;await mount();expect(button().disabled).toBe(true);fresh=true;await render();await click();expect(text()).toContain('当前没有占位成员');});
it('later backend revision asks explicit parent refresh; refreshing itself never writes',async()=>{h.transport.mockImplementation(async()=>({status:200,body:{...body(),activity_revision:2}}));await mount();await click();expect(text()).toContain('活动已更新');await act(async()=>button('先刷新活动安排').click());expect(h.refresh).toHaveBeenCalledOnce();expect(h.transport.mock.calls.every(([r])=>r.method==='GET')).toBe(true);});

async function screen(){h.controller={id:detail.activity_id,detail,userId:detail.viewer.user_id,read:{data:{session},loading:!fresh,error:'',refresh:h.refresh},login:{busy:false},applications:{anyBusy:false,fresh:true,apply:{},decision:{}}};const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(Screen)));}
it('actual Screen wires the public roster with its loaded source session and does not fetch on mount',async()=>{await screen();expect(h.transport).not.toHaveBeenCalled();await click();expect(text()).toContain('当前没有占位成员');expect(h.transport.mock.calls[0][0].headers.Authorization).toBe('Bearer session-a');});
it('actual Screen pending parent refresh disables reading and does not issue an automatic roster request',async()=>{fresh=false;await screen();expect(button().disabled).toBe(true);expect(h.transport).not.toHaveBeenCalled();});
it('actual Screen rejects late roster when its displayed actor and source session change',async()=>{const p=wait();h.transport.mockReturnValue(p.promise);await screen();await click();const old=body();h.token=session='session-b';detail={...detail,viewer:{...detail.viewer,user_id:applicantB}};h.controller={...h.controller,detail,userId:applicantB,read:{...h.controller.read,data:{session}}};await act(async()=>root.render(createElement(Screen)));await act(async()=>p.resolve({status:200,body:old}));expect(text()).not.toContain('当前没有占位成员');});

it('actual More explains current roster scope without falsely claiming no roster exists',async()=>{const {ActivityMore}=await vi.importActual<typeof import('../apps/miniprogram/src/features/activity-detail/more')>('../apps/miniprogram/src/features/activity-detail/more');const host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(createElement(ActivityMore,{detail,showMore:true,setShowMore:vi.fn(),login:{busy:false,login:vi.fn()},anyBusy:false})));expect(text()).toContain('公开报名名');expect(text()).toContain('取消历史本片暂不展示');expect(text()).not.toContain('并非完整成员名册');});

// This suite isolates its existing feature; cycle31 capacity Screen probes cover the new peer.
vi.mock('../apps/miniprogram/src/features/capacity/CapacityPanel', () => ({ CapacityPanel: () => null }));

// This suite isolates its original feature; cycle32 tests exercise the actual share-card Screen composition.
vi.mock('../apps/miniprogram/src/features/share-card/ActivityShareCard', () => ({ ActivityShareCard: () => null }));

// This pre-existing feature suite isolates the new deadline sibling. Actual composed deadline/peer behavior is covered by deadline-screen-ui and independent full-Screen probes.
vi.mock('../apps/miniprogram/src/features/deadline/DeadlinePanel', () => ({ DeadlinePanel: () => null }));

// This existing feature suite isolates the booking sibling; booking-screen-ui and independent complete-Screen probes verify the new declaration/history composition.
vi.mock('../apps/miniprogram/src/features/booking/BookingPanel', () => ({ BookingPanel: () => null }));

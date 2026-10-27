import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const h=vi.hoisted(()=>({activity:{} as any,tx:{} as any,db:{} as any}));
const P=process.cwd();
const req=createRequire(P+'/apps/miniprogram/package.json');
const {createElement}=req('react'); const {renderToStaticMarkup}=req('react-dom/server');
vi.mock('../apps/web/src/server/db',()=>({withDb:async(fn:any)=>fn(h.db)}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/taro',()=>({default:{}}));
vi.mock('../apps/miniprogram/node_modules/@tarojs/components',()=>({View:(p:any)=>createElement('div',{},p.children),Text:(p:any)=>createElement('span',{},p.children),Button:(p:any)=>createElement('button',{},p.children),Input:()=>null,Checkbox:()=>null,CheckboxGroup:(p:any)=>createElement('div',{},p.children),Label:(p:any)=>createElement('label',{},p.children)}));
import { activitySnapshot } from '../apps/web/src/server/activities/snapshot';
import { getArrangementReview, reacceptArrangement } from '../apps/web/src/server/activities/arrangement';
import { checkSelectedSegments } from '../apps/web/src/server/activities/rules';
import { assertSegmentOwnership } from '../apps/web/src/server/requirements/rules';
import { ApplicationForm, MyParticipationPanel } from '../apps/miniprogram/src/features/applications/panels';
import { ActivityMore } from '../apps/miniprogram/src/features/activity-detail/more';
import { Itinerary } from '../apps/miniprogram/src/features/activity-detail/itinerary';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const activityId=id(1),mainId=id(2),otherId=id(3),actor=id(20),manager=id(9);
const now=new Date('2030-01-01T10:00:00Z');
function segment(n:number,cancelled=false){return{id:id(n),activityId,clientRef:`s${n}`,position:n-2,type:'custom',name:n===2?'仍有效主段':'聚餐',startsAt:new Date('2030-01-01T11:00:00Z'),endsAt:new Date('2030-01-01T12:00:00Z'),deadlineAt:new Date('2030-01-01T10:30:00Z'),minimumParticipants:1,capacity:4,planRevision:1,verificationStatus:'manual_checked',bookingStatus:'manual_booked',cancelledAt:cancelled?now:null,location:{name:'公开场馆',address:null,source_url:null},fee:{kind:'per_person',amount_cents:6000,currency:'CNY',note:'原报价'},requirements:'',participations:[{userId:actor,status:'joined',acceptedPlanRevision:1,lateArrivalAt:null,lateNoticeAt:null}]};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);h.activity={id:activityId,name:'fixture多段活动',timezone:'UTC',revision:2,membershipRevision:1,managementRevision:1,mainRevision:1,mainSegmentId:mainId,currentManagerId:manager,cancelledAt:null,confirmedAt:now,confirmedMainRevision:1,confirmedPlanRevision:1,segments:[segment(2),segment(3,true)]};h.tx={$queryRaw:vi.fn(async()=>[{id:activityId}]),activity:{findUnique:vi.fn(async()=>structuredClone(h.activity))},activityApplication:{findMany:vi.fn(async()=>[])},activityEvent:{findMany:vi.fn(async()=>[])},activityMutationKey:{findUnique:vi.fn(async()=>null)}};h.db={$transaction:vi.fn(async(fn:any)=>fn(h.tx))};});
afterEach(()=>vi.useRealTimers());
describe('cancelled history display: actual snapshots and components with offline DB/native adapters; no new writer',()=>{
 it('observes preserved historical participation/counts while unchanged main stays confirmed',async()=>{const before=structuredClone(h.activity);const r=await activitySnapshot(h.tx,activityId,actor);expect(r.formation_status).toBe('confirmed');expect(r.segments[1]).toMatchObject({cancelled_at:now.toISOString(),is_join_open:false,counts:{occupied_count:1,accepted_count:1,remaining_capacity:3}});expect(r.viewer.participations[1]).toMatchObject({status:'joined',accepted_plan_revision:1});expect(h.activity).toEqual(before);});
 it('desired history label: cancelled own record should not be presented solely as joined',async()=>{const detail=await activitySnapshot(h.tx,activityId,actor);detail.viewer.participations=detail.viewer.participations.filter(p=>p.segment_id===otherId);const html=renderToStaticMarkup(createElement(MyParticipationPanel,{detail,state:{userId:actor}}));expect(html).toContain('已取消');expect(html).toContain('历史');});
 it('desired cancelled itinerary should not advertise remaining joinable seats',async()=>{const detail=await activitySnapshot(h.tx,activityId,actor);detail.segments=detail.segments.filter(s=>s.segment_id===otherId);const html=renderToStaticMarkup(createElement(Itinerary,{detail}));expect(html).toContain('本环节已取消');expect(html).not.toMatch(/余[0-9]+位/);});
 it('observes equal-version B1 reads UP_TO_DATE, but reaccept is already blocked for cancelled segment',async()=>{const r=await getArrangementReview(activityId,otherId,actor);expect(r).toMatchObject({state:'up_to_date',reason:'UP_TO_DATE',can_reaccept:false,accepted_plan_revision:1,current_plan_revision:1});await expect(reacceptArrangement(activityId,otherId,actor,{action:'reaccept',idempotency_key:'cancelled-read-probe',expected_revision:2,expected_plan_revision:1,from_accepted_plan_revision:1,history_digest:'a'.repeat(64)})).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});});
 it('blindly advancing cancellation planRevision without supported immutable history makes B1 unavailable',async()=>{h.activity.segments[1].planRevision=2;const r=await getArrangementReview(activityId,otherId,actor);expect(r).toMatchObject({state:'unavailable',reason:'HISTORY_UNAVAILABLE',can_reaccept:false,accepted_plan:null});});
 it('a published question attached to cancelled segment blocks the shared whole-draft validation',()=>{const draft={questions:[{segment_id:otherId}]} as any;expect(()=>assertSegmentOwnership(draft,h.activity.segments,'friend')).toThrow('题目关联的环节不属于当前有效活动');h.activity.segments[1].cancelledAt=null;expect(()=>assertSegmentOwnership(draft,h.activity.segments,'friend')).not.toThrow();});
 it('existing mixed-target join checks reject whole selection while unaffected main remains open',()=>{expect(()=>checkSelectedSegments(h.activity.segments,[{segment_id:mainId,plan_revision:1},{segment_id:otherId,plan_revision:1}],id(100),now)).toThrow('所选环节已关闭报名或已开始');expect(()=>checkSelectedSegments(h.activity.segments,[{segment_id:mainId,plan_revision:1}],id(100),now)).not.toThrow();});
});

const markup=(component:any,props:any)=>renderToStaticMarkup(createElement(component,props));
describe('terminal cancellation display never reinterprets retained rows as current participation',()=>{
 it.each(['activity','segment'] as const)('shows historical labels for every %s cancellation participation state',async kind=>{
  for(const status of ['joined','awaiting_acceptance','exited'] as const){
   const detail=await activitySnapshot(h.tx,activityId,actor);if(kind==='activity'){detail.cancelled_at=now.toISOString();detail.segments[1].cancelled_at=null;}
   detail.viewer.participations=[{segment_id:otherId,status,accepted_plan_revision:status==='exited'?null:1}];
   const html=markup(MyParticipationPanel,{detail,state:{userId:actor}});
   expect(html).toContain('已取消');expect(html).toContain('历史');expect(html).not.toContain('保留席位 · 待重新接受');expect(html).not.toContain('请查看安排版本审阅状态');
   expect(html).toContain('未自动退出、退订或退款');
  }
 });
 it('active main keeps ordinary joined/awaiting labels while cancelled secondary remains historical',async()=>{
  h.activity.segments[0].planRevision=2;const detail=await activitySnapshot(h.tx,activityId,actor);const html=markup(MyParticipationPanel,{detail,state:{userId:actor}});
  expect(html).toContain('保留席位 · 待重新接受');expect(html).toContain('历史已加入记录');expect(html).toContain('请查看安排版本审阅状态');
 });
 it.each(['activity','segment'] as const)('history itinerary for %s suppresses occupancy promises without dropping source data',async kind=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);detail.segments=[detail.segments[1]];detail.segments[0].counts.pending_acceptance_count=1;
  if(kind==='activity'){detail.cancelled_at=now.toISOString();detail.segments[0].cancelled_at=null;}
  const before=structuredClone(detail),html=markup(Itinerary,{detail});
  expect(html).toContain('历史参加记录');expect(html).toContain('原参考费用（历史）');expect(html).toContain('原安排记录：');expect(html).toContain('原核实、预订与费用仅说明取消前记录');
  expect(html).not.toMatch(/余[0-9]+位|已满员|已达最低人数|人待接受新安排/);expect(html).toContain('公开场馆');expect(html).toContain('60.00');expect(detail).toEqual(before);
 });
 it('ordinary itinerary remains current including pending acceptance and remaining capacity',async()=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);detail.segments=[detail.segments[0]];detail.segments[0].counts.pending_acceptance_count=1;
  const html=markup(Itinerary,{detail});expect(html).toContain('参加人数');expect(html).toContain('余3位');expect(html).toContain('1人待接受新安排，席位保留');expect(html).not.toContain('历史参加记录');
 });
 it.each(['activity','segment'] as const)('More labels only the cancelled %s acceptance records as history',async kind=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);if(kind==='activity'){detail.cancelled_at=now.toISOString();detail.segments[1].cancelled_at=null;}else detail.segments=[detail.segments[1]];
  const html=markup(ActivityMore,{detail,showMore:true,setShowMore:()=>{},login:{busy:false,login:()=>Promise.resolve()},anyBusy:false});
  expect(html).toContain('已取消 · 历史安排版本 1');expect(html).toContain('原同版接受记录 1人');expect(html).toContain('不表示当前有效同意');expect(html).not.toContain('已接受新安排');expect(html).not.toMatch(/待接受 [0-9]+人/);
 });
 it('ordinary More retains ordinary count wording',async()=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);detail.segments=[detail.segments[0]];
  const html=markup(ActivityMore,{detail,showMore:true,setShowMore:()=>{},login:{busy:false,login:()=>Promise.resolve()},anyBusy:false});expect(html).toContain('已接受新安排 1人，待接受 0人');
 });
 it('cancelled application row stays original status but explicitly is not a current seat',async()=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);detail.viewer.applications=[{application_id:id(70),applicant_user_id:actor,display_name:'公开名',status:'approved',segments:[{segment_id:otherId,plan_revision:1}],created_at:now.toISOString(),decided_at:now.toISOString()}];
  const html=markup(MyParticipationPanel,{detail,state:{userId:actor}});expect(html).toContain('含已取消安排');expect(html).toContain('保留原申请记录');expect(detail.viewer.applications[0].status).toBe('approved');
 });
 it.each(['activity','segment'] as const)('join form %s cancellation caption does not promise existing seats',async kind=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);detail.segments=[detail.segments[1]];if(kind==='activity'){detail.cancelled_at=now.toISOString();detail.segments[0].cancelled_at=null;}
  const noop=()=>{},state={selected:[],setSelected:noop,nickname:'',setNickname:noop,accepted:'',setAccepted:noop,validation:'',apply:{busy:false,message:''},anyBusy:false,applicationBlocked:false,myOccupied:new Set([otherId]),myPending:new Set(),available:()=>false,confirmation:'',fresh:true,userId:actor,submit:noop};
  const html=markup(ApplicationForm,{detail,state,login:{busy:false,login:async()=>{}}});expect(html).toContain('已取消 · 不开放加入');expect(html).not.toContain('已有席位');
 });
 it('cancelled content remains text, does not render original names as markup',async()=>{
  const detail=await activitySnapshot(h.tx,activityId,actor);detail.segments[1].name='<b>原安排</b>';const html=markup(MyParticipationPanel,{detail,state:{userId:actor}});expect(html).toContain('&lt;b&gt;原安排&lt;/b&gt;');expect(html).not.toContain('<b>原安排</b>');
 });
});

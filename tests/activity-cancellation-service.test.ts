import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { cancelActivity } from '../apps/web/src/server/activities/cancellation';
import { changeFormation } from '../apps/web/src/server/activities/formation';
import { reacceptArrangement, getArrangementReview } from '../apps/web/src/server/activities/arrangement';
import { createInvitationSource, saveReceivedInvitation } from '../apps/web/src/server/activities/invitations';
import { createRequirement, commandRequirementTx, requirementSnapshotTx } from '../apps/web/src/server/requirements/service';
import { readCoordinationSourceTx } from '../apps/web/src/server/requirements/coordination-source';
import { withdrawApplication } from '../apps/web/src/server/activities/withdrawal';
import { changeParticipation } from '../apps/web/src/server/activities/participation';
import { applyToActivity, decideApplication } from '../apps/web/src/server/activities/applications';
import type { WithdrawApplicationInput } from '../packages/contracts/src/activities';
const h=vi.hoisted(()=>({survey:{} as any,answers:new Map<string,any>(),received:[] as any[],db:{} as any,tx:{} as any,activity:{} as any,apps:[] as any[],keys:new Map<string,any>(),events:[] as any[],order:[] as string[],lockTime:undefined as Date|undefined}));
// Actual services, lock/load helpers, rules, replay and ActivityDetail projector are used.
// Actual mutation wrapper requests Serializable and retries; this in-memory adapter
// records calls and restores fixture state. It is NOT real PostgreSQL concurrency.
vi.mock('../apps/web/src/server/db',()=>({withDb:async(action:(db:any)=>Promise<unknown>)=>action(h.db)}));
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const activityId=uuid(1),mainId=uuid(2),otherId=uuid(3),manager=uuid(9),members=Array.from({length:7},(_,i)=>uuid(20+i));
function segment(id:string,position:number,count:number){return{id,activityId,clientRef:`segment-${position}`,position,type:'custom',name:`segment ${position}`,startsAt:new Date('2030-01-01T11:00:00Z'),endsAt:new Date('2030-01-01T13:00:00Z'),deadlineAt:new Date('2030-01-01T10:30:00Z'),minimumParticipants:4,capacity:6,planRevision:3,verificationStatus:'unknown',bookingStatus:'unknown',cancelledAt:null,location:{name:'custom place',address:null,source_url:null},fee:{kind:'total',amount_cents:24000,currency:'CNY',note:'fixed quote'},requirements:'existing requirements',participations:members.slice(0,count).map(userId=>({userId,status:'joined',acceptedPlanRevision:3,acceptedAt:new Date('2030-01-01T09:00:00Z'),lateArrivalAt:null,lateNoticeAt:null}))};}
function update(row:any,data:any){for(const[k,v]of Object.entries(data)){if(v&&typeof v==='object'&&'increment'in v)row[k]+=Number(v.increment);else row[k]=structuredClone(v);}return structuredClone(row);}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));h.order=[];h.lockTime=undefined;h.apps=[];h.keys=new Map();h.events=[];
 h.activity={id:activityId,name:'formation fixture',timezone:'UTC',revision:1,membershipRevision:1,managementRevision:1,mainRevision:1,mainSegmentId:mainId,currentManagerId:manager,cancelledAt:null,confirmedAt:null,confirmedMainRevision:null,confirmedPlanRevision:null,segments:[segment(mainId,0,5),segment(otherId,1,5)]};
 h.db={$transaction:vi.fn(async(action:(tx:any)=>Promise<unknown>,_options:any)=>{const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events,survey:h.survey,answers:h.answers,received:h.received});try{return await action(h.tx);}catch(error){h.activity=before.activity;h.apps=before.apps;h.keys=before.keys;h.events=before.events;h.survey=before.survey;h.answers=before.answers;h.received=before.received;throw error;}})};
 h.answers=new Map();h.received=[];h.survey={id:uuid(800),kind:'friend',ownerUserId:manager,activityId,revision:2,status:'open',deadlineAt:new Date('2030-01-01T10:45:00Z'),closedAt:null,finalSelection:null,updatedAt:new Date(),draft:{title:'requirement fixture',description:'',timezone:'Asia/Shanghai',starts_at:'2030-01-01T11:00:00Z',deadline_at:'2030-01-01T10:45:00Z',locations:[{id:'place',label:'manual place'}],questions:[]}};
 h.tx={
  managementHandover:{updateMany:vi.fn(async()=>({count:0}))},
  $queryRaw:vi.fn(async()=>{h.order.push('parent-lock');if(h.lockTime)vi.setSystemTime(h.lockTime);return[{id:activityId}];}),
  activity:{findUnique:vi.fn(async({where})=>where.id===activityId?structuredClone(h.activity):null),update:vi.fn(async({data})=>{h.order.push('activity-write');return update(h.activity,data);})},
  segment:{update:vi.fn(async({where,data})=>{h.order.push('segment-write');return update(h.activity.segments.find((s:any)=>s.id===where.id),data);})},
  activityEvent:{create:vi.fn(async({data})=>{h.order.push('event');h.events.push(structuredClone(data));return data;})},
  activityMutationKey:{findUnique:vi.fn(async({where})=>h.keys.get(where.actorUserId_key.actorUserId+':'+where.actorUserId_key.key)??null),create:vi.fn(async({data})=>{h.keys.set(data.actorUserId+':'+data.key,structuredClone(data));h.order.push('key');return data;})},
  activityApplication:{
   findMany:vi.fn(async({where})=>structuredClone(h.apps.filter(a=>a.activityId===where.activityId&&(!where.applicantUserId||a.applicantUserId===where.applicantUserId)))),
   findFirst:vi.fn(async({where})=>structuredClone(h.apps.find(a=>a.activityId===where.activityId&&(!where.id||a.id===where.id)&&(!where.applicantUserId||a.applicantUserId===where.applicantUserId)&&(!where.status||a.status===where.status)&&(!where.targets||a.targets.some((t:any)=>where.targets.some.segmentId.in.includes(t.segmentId))))??null)),
   create:vi.fn(async({data})=>{const app={...data,id:uuid(100+h.apps.length),status:'pending',createdAt:new Date(),decidedAt:null,targets:[]};h.apps.push(app);return structuredClone(app);}),
   update:vi.fn(async({where,data})=>update(h.apps.find(a=>a.id===where.id),data)),
   updateMany:vi.fn(async({where,data})=>{let count=0;for(const a of h.apps)if(a.id===where.id&&a.activityId===where.activityId&&a.applicantUserId===where.applicantUserId&&a.status===where.status){update(a,data);count++;}return{count};})},
  applicationTarget:{createMany:vi.fn(async({data})=>{for(const target of data)h.apps.find(a=>a.id===target.applicationId).targets.push(structuredClone(target));return{count:data.length};})},
  participation:{updateMany:vi.fn(async({where,data})=>{let count=0;for(const s of h.activity.segments)if(where.segmentId.in.includes(s.id))for(const p of s.participations)if(p.userId===where.userId&&p.status===where.status){update(p,data);count++;}return{count};}),upsert:vi.fn(async({where,create,update:data})=>{const s=h.activity.segments.find((x:any)=>x.id===where.segmentId_userId.segmentId);const old=s.participations.find((p:any)=>p.userId===where.segmentId_userId.userId);if(old)return update(old,data);s.participations.push(structuredClone(create));return create;})},
  requirementWriteBudget:{findUnique:vi.fn(async()=>null),upsert:vi.fn(async({create})=>create)},
  requirementSurvey:{findUnique:vi.fn(async()=>structuredClone(h.survey)),findUniqueOrThrow:vi.fn(async()=>structuredClone(h.survey)),update:vi.fn(async({data})=>update(h.survey,data))},
  requirementSubmission:{findUnique:vi.fn(async({where})=>structuredClone(h.answers.get(where.collectionId_userId.userId)??null)),findMany:vi.fn(async()=>[]),create:vi.fn(async({data})=>{h.answers.set(data.userId,{...structuredClone(data),privateOrigin:data.privateOrigin===Prisma.DbNull?null:structuredClone(data.privateOrigin),updatedAt:new Date()});return data;}),updateMany:vi.fn()},
  userAvatar:{findUnique:vi.fn(async()=>null)},privateProfile:{findMany:vi.fn(async()=>[]),findUnique:vi.fn(async()=>null)},
  invitationSource:{findUnique:vi.fn(async()=>({id:uuid(801),activityId,inviterUserId:manager,inviterDisplayName:'public name',inviterAvatarUrl:null,activity:structuredClone(h.activity)})),upsert:vi.fn()},
  receivedInvitation:{findUnique:vi.fn(async({where})=>h.received.find(r=>r.userId===where.userId_invitationId.userId&&r.invitationId===where.userId_invitationId.invitationId)??null),count:vi.fn(async()=>h.received.length),upsert:vi.fn(async({create})=>{const r={...create,savedAt:new Date()};h.received.push(r);return r;})},
 };
});
afterEach(()=>vi.useRealTimers());
const applicant=members[5];
async function apply(actor=applicant, segmentIds=[mainId,otherId], key='original-application-key') {
 const input={idempotency_key:key,expected_revision:h.activity.revision,segments:segmentIds.map(segment_id=>({segment_id,plan_revision:3}))};
 await applyToActivity(activityId,actor,input);
 return {id:h.apps[h.apps.length-1].id as string,input};
}
function input(key='own-withdraw-key'):WithdrawApplicationInput{return{idempotency_key:key,expected_revision:h.activity.revision};}
const withdraw=(id:string,body=input(),actor=applicant)=>withdrawApplication(activityId,id,actor,body);
const decide=(id:string,decision:'approve'|'reject'='approve')=>decideApplication(activityId,id,manager,{idempotency_key:`decision-${id}-${h.activity.revision}`,expected_revision:h.activity.revision,decision});
const cancel=(body=input('cancel-original-key'),actor=manager)=>cancelActivity(activityId,actor,body);
const response={selected_segment_ids:[mainId],answers:[],location_ids:['place'],location_other:null,time_preferences:'before cancellation',budget_note:'budget',preferences:'',private_origin:null};
const respond=()=>commandRequirementTx(h.tx,h.survey.id,applicant,{action:'respond',expected_revision:h.survey.revision,expected_response_version:0,response});
describe('whole activity cancellation actual services and original Serializable wrapper (DB rollback double)',()=>{
 it('only marks the activity cancelled/revision, preserving all original arrangements/seats/acceptance/fees/booking/formation history',async()=>{
  await apply();await respond();h.activity.confirmedAt=new Date();h.activity.confirmedMainRevision=1;h.activity.confirmedPlanRevision=3;h.activity.segments[0].verificationStatus='manual_checked';h.activity.segments[0].bookingStatus='manual_booked';
  const before=structuredClone({activity:h.activity,apps:h.apps,survey:h.survey,answers:h.answers});
  const result=await cancel();expect(result.cancelled_at).toBe(new Date().toISOString());expect(result.formation_status).toBe('not_confirmed');expect(result.segments.every(s=>!s.is_join_open)).toBe(true);
  expect(h.activity).toEqual({...before.activity,cancelledAt:new Date(),revision:before.activity.revision+1});expect(h.apps).toEqual(before.apps);expect(h.survey).toEqual(before.survey);expect(h.answers).toEqual(before.answers);
  expect(h.events.at(-1)).toMatchObject({type:'activity_cancelled',actorUserId:manager});expect(h.tx.participation.upsert).not.toHaveBeenCalled();expect(h.tx.participation.updateMany).not.toHaveBeenCalled();expect(h.tx.segment.update).not.toHaveBeenCalled();expect(h.tx.requirementSurvey.update).not.toHaveBeenCalled();
  expect(h.db.$transaction.mock.calls.at(-1)[1].isolationLevel).toBe('Serializable');
 });
 it('requires current manager, even before looking up successful old keys',async()=>{
  const body=input();await cancel(body);h.activity.currentManagerId=applicant;h.tx.activityMutationKey.findUnique.mockClear();await expect(cancel(body)).rejects.toMatchObject({code:'FORBIDDEN'});expect(h.tx.activityMutationKey.findUnique).not.toHaveBeenCalled();
 });
 it('does not grant cancellation to a joined member or a stranger',async()=>{for(const actor of [members[0],applicant])await expect(cancel(input(),actor)).rejects.toMatchObject({code:'FORBIDDEN'});expect(h.events).toHaveLength(0);});
 it('rejects stale revision and does not hide an intervening approval from manager confirmation',async()=>{const app=await apply();const body=input();await decide(app.id);await expect(cancel(body)).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(h.activity.cancelledAt).toBeNull();expect(h.apps[0].status).toBe('approved');expect((await cancel()).cancelled_at).not.toBeNull();});
 it('rejects malformed direct input before any transaction',()=>{for(const raw of [{...input(),user_id:manager},{...input(),refund:true},{...input(),segment_ids:[mainId]},{...input(),expected_revision:0}])expect(()=>cancelActivity(activityId,manager,raw as any)).toThrow();expect(()=>cancelActivity('invalid',manager,input())).toThrow();expect(h.db.$transaction).not.toHaveBeenCalled();});
 it('samples cutoff after parent lock and does not reopen started segments by cancellation',async()=>{h.lockTime=new Date('2030-01-01T11:00:00Z');await expect(cancel()).rejects.toMatchObject({code:'CANCELLATION_RULE_UNCONFIRMED'});expect(h.activity.cancelledAt).toBeNull();});
 it('samples cutoff after the awaited replay lookup too',async()=>{h.tx.activityMutationKey.findUnique.mockImplementationOnce(async()=>{vi.setSystemTime(new Date('2030-01-01T11:00:00Z'));return null;});await expect(cancel()).rejects.toMatchObject({code:'CANCELLATION_RULE_UNCONFIRMED'});expect(h.events).toHaveLength(0);});
 it('does not use application deadlines to block an otherwise before-start cancellation',async()=>{h.activity.segments.forEach((s:any)=>{s.deadlineAt=new Date('2030-01-01T09:00:00Z');});expect((await cancel()).cancelled_at).not.toBeNull();});
 it.each(['no-segments','no-main','main-cancelled','all-cancelled','bad-start','bad-end','end-before-start','bad-deadline','deadline-after-start','started-cancelled-history','duplicate-segment'] as const)('fails closed without writes for %s',async kind=>{
  const segments=h.activity.segments;
  if(kind==='no-segments')h.activity.segments=[];
  if(kind==='no-main')h.activity.mainSegmentId=uuid(555);
  if(kind==='main-cancelled'||kind==='all-cancelled')segments[0].cancelledAt=new Date();
  if(kind==='all-cancelled')segments[1].cancelledAt=new Date();
  if(kind==='bad-start')segments[1].startsAt=new Date('invalid');
  if(kind==='bad-end')segments[1].endsAt=new Date('invalid');
  if(kind==='end-before-start')segments[1].endsAt=new Date('2030-01-01T10:00:00Z');
  if(kind==='bad-deadline')segments[1].deadlineAt=new Date('invalid');
  if(kind==='deadline-after-start')segments[1].deadlineAt=new Date('2030-01-01T12:00:00Z');
  if(kind==='started-cancelled-history'){segments[1].startsAt=new Date('2030-01-01T09:00:00Z');segments[1].deadlineAt=new Date('2030-01-01T08:00:00Z');segments[1].cancelledAt=new Date();}
  if(kind==='duplicate-segment')segments[1].id=segments[0].id;
  await expect(cancel()).rejects.toMatchObject({code:'CANCELLATION_RULE_UNCONFIRMED'});expect(h.events).toHaveLength(0);expect(h.keys.size).toBe(0);expect(h.tx.activity.update).not.toHaveBeenCalled();
 });
 it('successful original key replays current state after start without changing cancellation time, event or keys',async()=>{const body=input();await cancel(body);const before=structuredClone({activity:h.activity,events:h.events,keys:h.keys});vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));expect((await cancel(body)).cancelled_at).toBe(before.activity.cancelledAt.toISOString());expect({activity:h.activity,events:h.events,keys:h.keys}).toEqual(before);await expect(cancel(input('new-cancel-key'))).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});});
 it('same key different semantic revision conflicts, never repeats a cancellation',async()=>{const body=input();await cancel(body);await expect(cancel({...body,expected_revision:99})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});expect(h.events).toHaveLength(1);});
 it.each(['activity','event','key','projection'] as const)('rolls back cancelledAt/revision/event/key on %s failure; original key can retry',async phase=>{
  const body=input();const before=structuredClone({activity:h.activity,events:h.events,keys:h.keys});
  if(phase==='activity')h.tx.activity.update.mockRejectedValueOnce(new Error('fixture failure'));if(phase==='event')h.tx.activityEvent.create.mockRejectedValueOnce(new Error('fixture failure'));if(phase==='key')h.tx.activityMutationKey.create.mockRejectedValueOnce(new Error('fixture failure'));if(phase==='projection')h.tx.activityApplication.findMany.mockRejectedValueOnce(new Error('fixture failure'));
  await expect(cancel(body)).rejects.toThrow('fixture failure');expect({activity:h.activity,events:h.events,keys:h.keys}).toEqual(before);await cancel(body);expect(h.events).toHaveLength(1);
 });
 it('actual mutation wrapper rolls back and retries a Serializable conflict as a complete operation',async()=>{h.tx.activityEvent.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('fixture conflict',{code:'P2034',clientVersion:'test'}));await cancel();expect(h.db.$transaction).toHaveBeenCalledTimes(2);expect(h.events).toHaveLength(1);expect(h.activity.revision).toBe(2);});
 it('cancellation before approval rejects approval and new applications, while existing pending/history stays intact',async()=>{
  const app=await apply();await cancel();const before=structuredClone(h.activity);await expect(decide(app.id)).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});await expect(apply(members[6],[mainId],'new-after-cancel')).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});expect(h.apps[0].status).toBe('pending');expect(h.activity).toEqual(before);
 });
 it('old application and successful approval keys only restore current cancelled snapshots, not new seats',async()=>{
  const app=await apply();const decision={idempotency_key:'approved-before-cancel',expected_revision:h.activity.revision,decision:'approve' as const};await decideApplication(activityId,app.id,manager,decision);await cancel();const before=structuredClone(h.activity);
  expect((await applyToActivity(activityId,applicant,app.input)).cancelled_at).not.toBeNull();expect((await decideApplication(activityId,app.id,manager,decision)).cancelled_at).not.toBeNull();expect(h.activity).toEqual(before);
 });
 it('blocks new exit/late/formation/withdrawal/reaccept without rewriting existing participation or arrangements',async()=>{
  const app=await apply();await cancel();const before=structuredClone(h.activity);
  await expect(changeParticipation(activityId,members[0],{action:'exit',segment_ids:[mainId],expected_revision:h.activity.revision,idempotency_key:'exit-after-cancel'})).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});
  await expect(changeParticipation(activityId,members[0],{action:'late',segment_ids:[mainId],estimated_arrival_at:'2030-01-01T11:30:00Z',expected_revision:h.activity.revision,idempotency_key:'late-after-cancel'})).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});
  await expect(changeFormation(activityId,manager,{action:'set-verification',segment_id:mainId,expected_plan_revision:3,verified:true,expected_revision:h.activity.revision,idempotency_key:'verify-after-cancel'})).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});
  await expect(withdraw(app.id)).rejects.toMatchObject({code:'WITHDRAWAL_RULE_UNCONFIRMED'});
  await expect(reacceptArrangement(activityId,mainId,members[0],{action:'reaccept',expected_revision:h.activity.revision,expected_plan_revision:3,from_accepted_plan_revision:2,history_digest:'a'.repeat(64),idempotency_key:'accept-after-cancel'})).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});
  expect(h.activity).toEqual(before);
 });
 it('before-cancel exit and formation keys remain read-only afterwards and do not regain seats or confirmation',async()=>{
  const formation={action:'set-verification' as const,segment_id:mainId,expected_plan_revision:3,verified:true,expected_revision:h.activity.revision,idempotency_key:'verify-before-cancel'};await changeFormation(activityId,manager,formation);
  const participation={action:'exit' as const,segment_ids:[otherId],expected_revision:h.activity.revision,idempotency_key:'exit-before-cancel'};await changeParticipation(activityId,members[0],participation);await cancel();const before=structuredClone(h.activity);
  expect((await changeFormation(activityId,manager,formation)).cancelled_at).not.toBeNull();expect((await changeParticipation(activityId,members[0],participation)).activity.cancelled_at).not.toBeNull();expect(h.activity).toEqual(before);
 });
 it('blocks new requirement commands after cancellation but keeps old answers and readable historical summary',async()=>{
  await respond();const before=structuredClone({survey:h.survey,answers:h.answers});await cancel();
  for(const command of [{action:'respond',expected_response_version:1,response},{action:'close'},{action:'save-draft',draft:h.survey.draft},{action:'publish'},{action:'finalize',final_selection:{location_id:'place',location_other:null,note:''}}])await expect(commandRequirementTx(h.tx,h.survey.id,manager,{...command,expected_revision:2} as any)).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});
  const snapshot=await requirementSnapshotTx(h.tx,h.survey.id,manager);expect(snapshot.viewer).toMatchObject({can_edit:false,can_close:false,can_respond:false,can_publish:false,can_finalize:false,blocked_reason:'关联活动已取消'});expect({survey:h.survey,answers:h.answers}).toEqual(before);
 });
 it('cancellation first prevents an answer; an already saved earlier answer is not deleted by cancellation',async()=>{await cancel();await expect(respond()).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});expect(h.answers.size).toBe(0);});
 it('new invitations and C1 source preparation reject cancelled activity, while saving truthful historical invitation grants no seat',async()=>{
  await cancel();const before=structuredClone(h.activity);await expect(createInvitationSource(activityId,manager)).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});await expect(readCoordinationSourceTx(h.tx,h.survey.id,manager)).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});
  const saved=await saveReceivedInvitation(uuid(801),activityId,applicant);expect(saved.invitation.cancelled).toBe(true);expect(saved.saved).toBe(true);expect(h.activity).toEqual(before);expect(h.tx.invitationSource.upsert).not.toHaveBeenCalled();expect(h.tx.participation.upsert).not.toHaveBeenCalled();
 });
 it('does not create a new friend survey on a cancelled activity (existing rate budget remains independent)',async()=>{await cancel();await expect(createRequirement(manager,{action:'create',kind:'friend',activity_id:activityId,idempotency_key:'new-survey-after-cancel',draft:h.survey.draft})).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});expect(h.tx.requirementSurvey.update).not.toHaveBeenCalled();expect(h.answers.size).toBe(0);});
 it('original B1 current-arrangement read remains available as non-actionable own history',async()=>{await cancel();const result=await getArrangementReview(activityId,mainId,members[0]);expect(result.can_reaccept).toBe(false);expect(result.current_plan.minimum_participants).toBe(4);});
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { withdrawApplication } from '../apps/web/src/server/activities/withdrawal';
import { changeParticipation } from '../apps/web/src/server/activities/participation';
import { applyToActivity, decideApplication } from '../apps/web/src/server/activities/applications';
import type { WithdrawApplicationInput } from '../packages/contracts/src/activities';
const h=vi.hoisted(()=>({db:{} as any,tx:{} as any,activity:{} as any,apps:[] as any[],keys:new Map<string,any>(),events:[] as any[],order:[] as string[],lockTime:undefined as Date|undefined}));
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
 h.db={$transaction:vi.fn(async(action:(tx:any)=>Promise<unknown>,_options:any)=>{const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events});try{return await action(h.tx);}catch(error){h.activity=before.activity;h.apps=before.apps;h.keys=before.keys;h.events=before.events;throw error;}})};
 h.tx={
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
  requirementSubmission:{update:vi.fn()},
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
describe('withdrawal actual service + original applications + Serializable transaction double',()=>{
 it('withdraws the whole own pending application, retaining targets and all seat/arrangement/fee/formation fields',async()=>{
  h.activity.confirmedAt=new Date();h.activity.confirmedMainRevision=1;h.activity.confirmedPlanRevision=3;h.activity.segments[0].verificationStatus='manual_checked';h.activity.segments[0].bookingStatus='manual_booked';
  const app=await apply();const before=structuredClone(h.activity);const targets=structuredClone(h.apps[0].targets);
  const result=await withdraw(app.id);
  expect(result.viewer.applications[0].status).toBe('withdrawn');expect(result.formation_status).toBe('confirmed');expect(result.applications).toBeUndefined();expect(result.viewer.participations).toEqual([]);
  expect(h.apps[0].targets).toEqual(targets);expect(h.apps[0].decidedAt).toEqual(new Date('2030-01-01T10:00:00Z'));expect(h.activity).toEqual({...before,revision:before.revision+1});
  expect(h.tx.participation.upsert).not.toHaveBeenCalled();expect(h.tx.participation.updateMany).not.toHaveBeenCalled();expect(h.tx.segment.update).not.toHaveBeenCalled();
  expect(h.events.at(-1)).toMatchObject({actorUserId:applicant,type:'application_withdrawn',detail:{application_id:app.id}});
  expect(h.db.$transaction.mock.calls.at(-1)[1].isolationLevel).toBe('Serializable');expect(h.order[0]).toBe('parent-lock');
 });
 it('withdrawing only newly requested segments preserves an existing joined or awaiting-acceptance seat',async()=>{
  const actor=members[0];h.activity.segments[1].participations=h.activity.segments[1].participations.filter((p:any)=>p.userId!==actor);h.activity.segments[0].participations[0].acceptedPlanRevision=2;
  const app=await apply(actor,[otherId]);const seat=structuredClone(h.activity.segments[0].participations[0]);const response=await withdraw(app.id,input(),actor);
  expect(h.activity.segments[0].participations[0]).toEqual(seat);expect(response.viewer.participations).toEqual([expect.objectContaining({segment_id:mainId,status:'awaiting_acceptance',accepted_plan_revision:2})]);expect(response.viewer.applications[0].status).toBe('withdrawn');
 });
 it('does not require a pending request to have current plan acceptance or available capacity to withdraw it',async()=>{
  const app=await apply();h.activity.segments[0].planRevision=4;h.activity.segments[0].capacity=5;
  expect((await withdraw(app.id)).viewer.applications[0].status).toBe('withdrawn');expect(h.activity.segments[0].planRevision).toBe(4);expect(h.activity.segments[0].participations).toHaveLength(5);
 });
 it.each(['foreign-applicant','manager','wrong-activity','missing'] as const)('hides another actor/target and writes nothing: %s',async mode=>{
  const app=await apply();const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events});
  const call=mode==='wrong-activity'?()=>withdrawApplication(uuid(555),app.id,applicant,input()):mode==='missing'?()=>withdraw(uuid(556)):()=>withdraw(app.id,input(),mode==='manager'?manager:members[6]);
  await expect(call()).rejects.toMatchObject({code:'NOT_FOUND'});expect({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events}).toEqual(before);
 });
 it('checks ownership before even reading a supposedly successful key',async()=>{
  const app=await apply();h.tx.activityMutationKey.findUnique.mockClear();await expect(withdraw(app.id,input(),members[6])).rejects.toMatchObject({code:'NOT_FOUND'});expect(h.tx.activityMutationKey.findUnique).not.toHaveBeenCalled();
 });
 it('checks current activity revision without partially withdrawing targets',async()=>{
  const app=await apply();await expect(withdraw(app.id,{...input(),expected_revision:1})).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(h.apps[0].status).toBe('pending');expect(h.tx.activityApplication.updateMany).not.toHaveBeenCalled();
 });
 it.each(['approved','rejected','withdrawn'] as const)('does not turn a terminal %s application into withdrawal under a new key',async status=>{
  const app=await apply();if(status==='withdrawn')await withdraw(app.id);else await decide(app.id,status==='approved'?'approve':'reject');const before=structuredClone(h.activity);
  await expect(withdraw(app.id,input('different-withdraw-key'))).rejects.toMatchObject({code:'APPLICATION_ALREADY_DECIDED'});expect(h.apps[0].status).toBe(status);expect(h.activity).toEqual(before);
 });
 it('orders approval first: old pending withdrawal fails and no approved seats are released',async()=>{
  const app=await apply();const stale=input();await decide(app.id);const before=structuredClone(h.activity);
  await expect(withdraw(app.id,stale)).rejects.toMatchObject({code:'APPLICATION_ALREADY_DECIDED'});expect(h.activity).toEqual(before);expect(h.activity.segments.every((s:any)=>s.participations.some((p:any)=>p.userId===applicant&&p.status==='joined'))).toBe(true);
 });
 it('orders withdrawal first: later approval fails and cannot acquire any of the requested seats',async()=>{
  const app=await apply();await withdraw(app.id);await expect(decide(app.id)).rejects.toMatchObject({code:'APPLICATION_ALREADY_DECIDED'});expect(h.activity.segments.every((s:any)=>!s.participations.some((p:any)=>p.userId===applicant))).toBe(true);
 });
 it('replays an old create key as withdrawn, then permits only a new ordinary application and approval to obtain seats',async()=>{
  const app=await apply();await withdraw(app.id);const revision=h.activity.revision;
  expect((await applyToActivity(activityId,applicant,app.input)).viewer.applications[0].status).toBe('withdrawn');expect(h.activity.revision).toBe(revision);expect(h.apps).toHaveLength(1);
  const next=await apply(applicant,[mainId,otherId],'new-application-key');expect(h.apps).toHaveLength(2);await decide(next.id);expect(h.apps.map(a=>a.status)).toEqual(['withdrawn','approved']);
  expect(h.activity.segments.every((s:any)=>s.participations.filter((p:any)=>p.userId===applicant).length===1)).toBe(true);
 });
 it('does not duplicate event/revision/key writes when replaying a successful withdrawal',async()=>{
  const app=await apply();const body=input();await withdraw(app.id,body);const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events});
  expect((await withdraw(app.id,body)).viewer.applications[0].status).toBe('withdrawn');expect({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events}).toEqual(before);
 });
 it('rejects same key with changed expected revision, target or actor semantics',async()=>{
  const app=await apply();const body=input();await withdraw(app.id,body);
  await expect(withdraw(app.id,{...body,expected_revision:99})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  const another=await apply(applicant,[otherId],'another-application');await expect(withdraw(another.id,body)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  await expect(withdraw(app.id,body,members[6])).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it.each(['deadline','start','segment-cancel','activity-cancel'] as const)('holds new withdrawals unconfigured in later %s phase but allows already committed keys read-only',async phase=>{
  const first=await apply(applicant,[mainId],'early-application');const body=input();await withdraw(first.id,body);const pending=await apply(applicant,[otherId],'still-pending-application');
  if(phase==='deadline')h.activity.segments[1].deadlineAt=new Date();
  if(phase==='start'){h.activity.segments[1].startsAt=new Date();h.activity.segments[1].deadlineAt=new Date('2030-01-01T10:30:00Z');}
  if(phase==='segment-cancel')h.activity.segments[1].cancelledAt=new Date();
  if(phase==='activity-cancel')h.activity.cancelledAt=new Date();
  const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events});
  await expect(withdraw(pending.id,input('late-new-withdraw-key'))).rejects.toMatchObject({code:'WITHDRAWAL_RULE_UNCONFIRMED'});
  expect((await withdraw(first.id,body)).viewer.applications.find(a=>a.application_id===first.id)?.status).toBe('withdrawn');
  expect({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events}).toEqual(before);
 });
 it('checks every target rather than withdrawing only the still-open subset',async()=>{
  const app=await apply();h.activity.segments[1].deadlineAt=new Date();await expect(withdraw(app.id)).rejects.toMatchObject({code:'WITHDRAWAL_RULE_UNCONFIRMED'});expect(h.apps[0].status).toBe('pending');expect(h.apps[0].targets).toHaveLength(2);
 });
 it('samples time after waiting for the parent lock',async()=>{
  const app=await apply();h.lockTime=new Date('2030-01-01T10:30:00Z');await expect(withdraw(app.id)).rejects.toMatchObject({code:'WITHDRAWAL_RULE_UNCONFIRMED'});expect(h.apps[0].status).toBe('pending');
 });
 it('samples time after the key read too, not only immediately after acquiring the lock',async()=>{
  const app=await apply();h.tx.activityMutationKey.findUnique.mockImplementationOnce(async()=>{vi.setSystemTime(new Date('2030-01-01T10:30:00Z'));return null;});
  await expect(withdraw(app.id)).rejects.toMatchObject({code:'WITHDRAWAL_RULE_UNCONFIRMED'});expect(h.apps[0].status).toBe('pending');
 });
 it.each(['empty','missing'] as const)('refuses unverifiable target set: %s',async mode=>{
  const app=await apply();if(mode==='empty')h.apps[0].targets=[];else h.apps[0].targets[0].segmentId=uuid(666);
  await expect(withdraw(app.id)).rejects.toMatchObject({code:'WITHDRAWAL_RULE_UNCONFIRMED'});expect(h.apps[0].status).toBe('pending');
 });
 it('handles a conditional update losing the race as a conflict, never success',async()=>{
  const app=await apply();h.tx.activityApplication.updateMany.mockResolvedValueOnce({count:0});await expect(withdraw(app.id)).rejects.toMatchObject({code:'APPLICATION_ALREADY_DECIDED'});expect(h.apps[0].status).toBe('pending');expect(h.events).toHaveLength(1);
 });
 it.each(['activity','event','key','snapshot'] as const)('rolls back the whole withdrawal when %s write/projection fails, then safely retries original key',async failure=>{
  const app=await apply();const body=input();const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events});
  if(failure==='activity')h.tx.activity.update.mockRejectedValueOnce(new Error('fixture failure'));
  if(failure==='event')h.tx.activityEvent.create.mockRejectedValueOnce(new Error('fixture failure'));
  if(failure==='key')h.tx.activityMutationKey.create.mockRejectedValueOnce(new Error('fixture failure'));
  if(failure==='snapshot')h.tx.activityApplication.findMany.mockRejectedValueOnce(new Error('fixture failure'));
  await expect(withdraw(app.id,body)).rejects.toThrow('fixture failure');expect({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events}).toEqual(before);
  expect((await withdraw(app.id,body)).viewer.applications[0].status).toBe('withdrawn');expect(h.events.filter(e=>e.type==='application_withdrawn')).toHaveLength(1);
 });
 it.each(['P2034','P2002'])('actual mutation wrapper retries a rolled-back %s error as a whole transaction',async code=>{
  const app=await apply();const beforeCalls=h.db.$transaction.mock.calls.length;h.tx.activityEvent.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('offline retry',{code,clientVersion:'fixture'}));
  expect((await withdraw(app.id)).viewer.applications[0].status).toBe('withdrawn');expect(h.db.$transaction.mock.calls.length-beforeCalls).toBe(2);expect(h.events.filter(e=>e.type==='application_withdrawn')).toHaveLength(1);expect(h.activity.revision).toBe(3);
 });
 it('canonicalizes valid uppercase UUIDs and validates direct-call body before starting any transaction',async()=>{
  const app=await apply();const bad={...input(),user_id:manager} as unknown as WithdrawApplicationInput;
  expect(()=>withdraw(app.id,bad)).toThrow();const beforeCalls=h.db.$transaction.mock.calls.length;
  expect(()=>withdrawApplication('bad',app.id,applicant,input())).toThrow();expect(h.db.$transaction.mock.calls).toHaveLength(beforeCalls);
  expect((await withdrawApplication(activityId.toUpperCase(),app.id.toUpperCase(),applicant.toUpperCase(),input())).viewer.applications[0].status).toBe('withdrawn');
 });
 it('a valid own pending application can also be withdrawn by a manager acting only as its applicant',async()=>{
  const app=await apply(manager);expect((await withdraw(app.id,input(),manager)).viewer.applications[0].status).toBe('withdrawn');
 });
});

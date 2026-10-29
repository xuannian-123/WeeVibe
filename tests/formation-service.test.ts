import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeFormation } from '../apps/web/src/server/activities/formation';
import { changeParticipation } from '../apps/web/src/server/activities/participation';
import { applyToActivity, decideApplication } from '../apps/web/src/server/activities/applications';
import type { FormationCommand } from '../packages/contracts/src/formation';
const h=vi.hoisted(()=>({tx:{} as any,activity:{} as any,apps:[] as any[],keys:new Map<string,any>(),events:[] as any[],order:[] as string[],lockTime:undefined as Date|undefined}));
// Actual services, lock/load helpers, rules, replay and ActivityDetail projector are used.
// This adapter records calls and rolls back fixture state; it is NOT a PostgreSQL concurrency test.
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(action:(tx:any)=>Promise<unknown>)=>{const before=structuredClone({activity:h.activity,apps:h.apps,keys:h.keys,events:h.events});try{return await action(h.tx);}catch(error){h.activity=before.activity;h.apps=before.apps;h.keys=before.keys;h.events=before.events;throw error;}}}));
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const activityId=uuid(1),mainId=uuid(2),otherId=uuid(3),manager=uuid(9),members=Array.from({length:7},(_,i)=>uuid(20+i));
function segment(id:string,position:number,count:number){return{id,activityId,clientRef:`segment-${position}`,position,type:'custom',name:`segment ${position}`,startsAt:new Date('2030-01-01T11:00:00Z'),endsAt:new Date('2030-01-01T13:00:00Z'),deadlineAt:new Date('2030-01-01T10:30:00Z'),minimumParticipants:4,capacity:6,planRevision:3,verificationStatus:'unknown',bookingStatus:'unknown',cancelledAt:null,location:{name:'custom place',address:null,source_url:null},fee:{kind:'total',amount_cents:24000,currency:'CNY',note:'fixed quote'},requirements:'existing requirements',participations:members.slice(0,count).map(userId=>({userId,status:'joined',acceptedPlanRevision:3,acceptedAt:new Date('2030-01-01T09:00:00Z'),lateArrivalAt:null,lateNoticeAt:null}))};}
function update(row:any,data:any){for(const[k,v]of Object.entries(data)){if(v&&typeof v==='object'&&'increment'in v)row[k]+=Number(v.increment);else row[k]=structuredClone(v);}return structuredClone(row);}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));h.order=[];h.lockTime=undefined;h.apps=[];h.keys=new Map();h.events=[];
 h.activity={id:activityId,name:'formation fixture',timezone:'UTC',revision:1,membershipRevision:1,managementRevision:1,mainRevision:1,mainSegmentId:mainId,currentManagerId:manager,cancelledAt:null,confirmedAt:null,confirmedMainRevision:null,confirmedPlanRevision:null,segments:[segment(mainId,0,5),segment(otherId,1,5)]};
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
   update:vi.fn(async({where,data})=>update(h.apps.find(a=>a.id===where.id),data))},
  applicationTarget:{createMany:vi.fn(async({data})=>{for(const target of data)h.apps.find(a=>a.id===target.applicationId).targets.push(structuredClone(target));return{count:data.length};})},
  participation:{updateMany:vi.fn(async({where,data})=>{let count=0;for(const s of h.activity.segments)if(where.segmentId.in.includes(s.id))for(const p of s.participations)if(p.userId===where.userId&&p.status===where.status){update(p,data);count++;}return{count};}),upsert:vi.fn(async({where,create,update:data})=>{const s=h.activity.segments.find((x:any)=>x.id===where.segmentId_userId.segmentId);const old=s.participations.find((p:any)=>p.userId===where.segmentId_userId.userId);if(old)return update(old,data);s.participations.push(structuredClone(create));return create;})},
  requirementSubmission:{update:vi.fn()},
 };
});
afterEach(()=>vi.useRealTimers());
function command(action:'confirm-formation',key?:string):FormationCommand;
function command(action:'set-verification',key?:string,verified?:boolean):FormationCommand;
function command(action:'confirm-formation'|'set-verification',key=`formation-${action}-${h.activity.revision}`,verified=true):FormationCommand{return{idempotency_key:key,expected_revision:h.activity.revision,segment_id:mainId,expected_plan_revision:3,...(action==='set-verification'?{action,verified}:{action})};}
async function verify(){return changeFormation(activityId,manager,command('set-verification'));}
async function confirm(){return changeFormation(activityId,manager,command('confirm-formation'));}
async function exit(member:string,segmentId=mainId){return changeParticipation(activityId,member,{action:'exit',segment_ids:[segmentId],expected_revision:h.activity.revision,idempotency_key:`exit-${member}-${h.activity.revision}`});}
describe('formation actual service + original participation/application services through transaction double',()=>{
 it('completes verify, manual confirm, 5→4 preserve, 4→3 clear, original approval replacement, and manual recovery',async()=>{
  const fee=structuredClone(h.activity.segments[0].fee);const originalAccepted=h.activity.segments[0].participations[0].acceptedAt;
  const verified=await verify();expect(verified.formation_status).toBe('not_confirmed');expect(verified.segments[0].verification_status).toBe('manual_checked');expect(verified.segments[0].booking_status).toBe('unknown');
  const firstConfirm=command('confirm-formation','first-confirm-key');expect((await changeFormation(activityId,manager,firstConfirm)).formation_status).toBe('confirmed');
  expect((await exit(members[4])).activity.formation_status).toBe('confirmed');
  expect((await exit(members[3])).activity.formation_status).toBe('not_confirmed');expect(h.activity.confirmedAt).toBeNull();
  await applyToActivity(activityId,members[5],{idempotency_key:'replacement-apply',expected_revision:h.activity.revision,segments:[{segment_id:mainId,plan_revision:3}]});
  expect((await decideApplication(activityId,h.apps[0].id,manager,{idempotency_key:'replacement-approve',expected_revision:h.activity.revision,decision:'approve'})).formation_status).toBe('not_confirmed');
  const events=h.events.length,revision=h.activity.revision;expect((await changeFormation(activityId,manager,firstConfirm)).formation_status).toBe('not_confirmed');expect(h.events).toHaveLength(events);expect(h.activity.revision).toBe(revision);
  expect((await verify()).formation_status).toBe('not_confirmed');expect((await confirm()).formation_status).toBe('confirmed');
  expect(h.activity.segments[0].participations[0].acceptedAt).toEqual(originalAccepted);expect(h.activity.segments[0].fee).toEqual(fee);expect(h.activity.segments[0].bookingStatus).toBe('unknown');expect(h.tx.requirementSubmission.update).not.toHaveBeenCalled();expect(h.order[0]).toBe('parent-lock');
 });
 it('does not let manual_booked substitute for missing verification',async()=>{h.activity.segments[0].bookingStatus='manual_booked';await expect(confirm()).rejects.toMatchObject({code:'FORMATION_NOT_READY'});expect(h.events).toHaveLength(0);});
 it('never writes seats, accepted versions, booking or membership when verifying/confirming',async()=>{await verify();await confirm();expect(h.tx.participation.updateMany).not.toHaveBeenCalled();expect(h.tx.participation.upsert).not.toHaveBeenCalled();expect(h.activity.membershipRevision).toBe(1);expect(h.activity.segments[0].planRevision).toBe(3);expect(h.tx.segment.update.mock.calls[0][0].data).toEqual({verificationStatus:'manual_checked'});});
 it('rejects below minimum and pending acceptance without mutation',async()=>{await verify();h.activity.segments[0].participations=h.activity.segments[0].participations.slice(0,3);await expect(confirm()).rejects.toMatchObject({code:'FORMATION_NOT_READY'});h.activity.segments[0].participations.push({userId:members[4],status:'joined',acceptedPlanRevision:2});await expect(confirm()).rejects.toMatchObject({code:'FORMATION_NOT_READY'});expect(h.activity.confirmedAt).toBeNull();});
 it('revoking verification clears all confirmation fields and checking again cannot revive them',async()=>{await verify();await confirm();await changeFormation(activityId,manager,command('set-verification','revoke-verification',false));expect([h.activity.confirmedAt,h.activity.confirmedMainRevision,h.activity.confirmedPlanRevision]).toEqual([null,null,null]);expect((await verify()).formation_status).toBe('not_confirmed');expect((await verify()).formation_status).toBe('not_confirmed');expect((await confirm()).formation_status).toBe('confirmed');});
 it('same true mark on a legitimately confirmed unchanged arrangement does not fabricate a new confirmation timestamp',async()=>{await verify();await confirm();const time=h.activity.confirmedAt;vi.setSystemTime(new Date('2030-01-01T10:05:00Z'));expect((await verify()).formation_status).toBe('confirmed');expect(h.activity.confirmedAt).toEqual(time);});
 it('clears stale legacy confirmation while moving from unknown to checked',async()=>{h.activity.confirmedAt=new Date();h.activity.confirmedMainRevision=1;h.activity.confirmedPlanRevision=3;expect((await verify()).formation_status).toBe('not_confirmed');expect(h.activity.confirmedAt).toBeNull();});
 it('requires current manager even before an already processed replay',async()=>{const input=command('set-verification','old-manager-key');await changeFormation(activityId,manager,input);h.activity.currentManagerId=members[0];await expect(changeFormation(activityId,manager,input)).rejects.toMatchObject({code:'FORBIDDEN'});});
 it('rejects stale activity/plan and non-main targets',async()=>{await expect(changeFormation(activityId,manager,{...command('set-verification'),expected_revision:9})).rejects.toMatchObject({code:'VERSION_CONFLICT'});await expect(changeFormation(activityId,manager,{...command('set-verification'),expected_plan_revision:4})).rejects.toMatchObject({code:'ARRANGEMENT_STALE'});await expect(changeFormation(activityId,manager,{...command('set-verification'),segment_id:otherId})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(h.events).toHaveLength(0);});
 it.each(['activity','main'])('rejects cancelled %s',async target=>{if(target==='activity')h.activity.cancelledAt=new Date();else h.activity.segments[0].cancelledAt=new Date();await expect(verify()).rejects.toMatchObject({code:'ACTIVITY_CANCELLED'});expect(h.events).toHaveLength(0);});
 it('does not use application deadline to block before-start verification and confirmation',async()=>{h.activity.segments[0].deadlineAt=new Date('2030-01-01T09:00:00Z');await verify();expect((await confirm()).formation_status).toBe('confirmed');});
 it.each(['set-verification','confirm-formation'] as const)('samples time after parent lock and holds new %s closed at start',async action=>{h.activity.segments[0].verificationStatus='manual_checked';h.lockTime=new Date('2030-01-01T11:00:00Z');const input=action==='set-verification'?command(action):command(action);await expect(changeFormation(activityId,manager,input)).rejects.toMatchObject({code:'FORMATION_RULE_UNCONFIRMED'});expect(h.events).toHaveLength(0);expect(h.activity.revision).toBe(1);});
 it('allows only a pure processed-key replay after start without opening new formation actions',async()=>{await verify();const input=command('confirm-formation','processed-before-start');await changeFormation(activityId,manager,input);const revision=h.activity.revision,eventCount=h.events.length;vi.setSystemTime(new Date('2030-01-01T11:00:00Z'));expect((await changeFormation(activityId,manager,input)).formation_status).toBe('confirmed');expect(h.activity.revision).toBe(revision);expect(h.events).toHaveLength(eventCount);await expect(confirm()).rejects.toMatchObject({code:'FORMATION_RULE_UNCONFIRMED'});});
 it('does not duplicate events on replay and rejects changed body under the same key',async()=>{const input=command('set-verification','stable-verification');await changeFormation(activityId,manager,input);await changeFormation(activityId,manager,input);expect(h.events).toHaveLength(1);await expect(changeFormation(activityId,manager,{...input,action:'set-verification',verified:false})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});});
 it('does not affect main formation when a member only exits a non-main segment',async()=>{await verify();await confirm();expect((await exit(members[0],otherId)).activity.formation_status).toBe('confirmed');});
 it('rejects smuggled authority or answer fields on direct service calls',()=>{expect(()=>changeFormation(activityId,manager,{...command('set-verification'),user_id:members[0]} as unknown as FormationCommand)).toThrow();expect(()=>changeFormation(activityId,manager,{...command('confirm-formation'),private_origin:'hidden'} as unknown as FormationCommand)).toThrow();expect(h.events).toHaveLength(0);});
 it('replaying an old checked marker after revoke cannot mark verification true again',async()=>{const checked=command('set-verification','initial-checked-key');await changeFormation(activityId,manager,checked);await confirm();await changeFormation(activityId,manager,command('set-verification','explicit-revoke',false));const revision=h.activity.revision,eventCount=h.events.length;const result=await changeFormation(activityId,manager,checked);expect(result.segments[0].verification_status).toBe('unknown');expect(result.formation_status).toBe('not_confirmed');expect(h.activity.revision).toBe(revision);expect(h.events).toHaveLength(eventCount);});
 it('same false marker clears stale legacy confirmation fields even if verification was already unknown',async()=>{h.activity.confirmedAt=new Date();h.activity.confirmedMainRevision=1;h.activity.confirmedPlanRevision=3;await changeFormation(activityId,manager,command('set-verification','repeat-unknown',false));expect([h.activity.confirmedAt,h.activity.confirmedMainRevision,h.activity.confirmedPlanRevision]).toEqual([null,null,null]);});
 it('keeps new confirmation atomic if an event write fails in the transaction adapter',async()=>{await verify();const revision=h.activity.revision,eventCount=h.events.length;h.tx.activityEvent.create.mockRejectedValueOnce(new Error('fixture event failure'));await expect(confirm()).rejects.toThrow('fixture event failure');expect(h.activity.revision).toBe(revision);expect(h.activity.confirmedAt).toBeNull();expect(h.events).toHaveLength(eventCount);expect(h.keys.size).toBe(1);});

 it('old exit replay after a newly approved return does not exit again or claim a fresh exit',async()=>{
  await verify();await confirm();
  const input={action:'exit' as const,segment_ids:[mainId],expected_revision:h.activity.revision,idempotency_key:'exit-before-return'};
  await changeParticipation(activityId,members[0],input);
  const applied=await applyToActivity(activityId,members[0],{idempotency_key:'return-after-exit',expected_revision:h.activity.revision,segments:[{segment_id:mainId,plan_revision:3}]});
  await decideApplication(activityId,applied.viewer.applications.at(-1)!.application_id,manager,{idempotency_key:'approve-return',expected_revision:h.activity.revision,decision:'approve'});
  const revision=h.activity.revision,eventCount=h.events.length;
  const replayed=await changeParticipation(activityId,members[0],input);
  expect(replayed.activity.viewer.participations.find(p=>p.segment_id===mainId)?.status).toBe('joined');
  expect(replayed.notice).toContain('本次未重复变更');expect(replayed.notice).not.toContain('已退出所选环节');
  expect(h.activity.revision).toBe(revision);expect(h.events).toHaveLength(eventCount);
 });

});

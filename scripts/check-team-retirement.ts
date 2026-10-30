/** Historical data fixture in disposable PostgreSQL only; no shared DB or external providers. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {emptyGatheringDetails,emptyGatheringIntake,type RequirementCommand} from '../packages/contracts/src';

assert.ok(process.argv.includes('--fixture-only'));
const target=new URL(process.env.DATABASE_URL||'');
assert.ok(['postgres:','postgresql:'].includes(target.protocol));
assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
assert.match(target.pathname,/^\/weevibe_acceptance_[a-z0-9_]+$/);assert.ok(!target.hash);
for(const [key,value] of target.searchParams)assert.ok(key==='schema'&&value==='public');
globalThis.fetch=async()=>{throw Error('External network disabled in retirement fixture');};
const load=createRequire(import.meta.url);
const {getDb}=load('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const service=load('../apps/web/src/server/gatherings/service.ts') as typeof import('../apps/web/src/server/gatherings/service');
const requirements=load('../apps/web/src/server/requirements/service.ts') as typeof import('../apps/web/src/server/requirements/service');
const {generateGatheringItinerary}=load('../apps/web/src/server/gatherings/generation.ts') as typeof import('../apps/web/src/server/gatherings/generation');
const {commandGatheringWorkflow}=load('../apps/web/src/server/gatherings/workflow.ts') as typeof import('../apps/web/src/server/gatherings/workflow');
const {readCoordinationSourceOnce}=load('../apps/web/src/server/requirements/coordination-source.ts') as typeof import('../apps/web/src/server/requirements/coordination-source');
const {getInbox,readInbox}=load('../apps/web/src/server/inbox.ts') as typeof import('../apps/web/src/server/inbox');
const {accountSnapshot,updateAccount}=load('../apps/web/src/server/account.ts') as typeof import('../apps/web/src/server/account');
const db=getDb(),key=()=>randomUUID();let checks=0;
function pass(name:string){checks++;console.log(`PASS ${name}`);}
try{
  const owner=(await db.user.create({data:{}})).id,peer=(await db.user.create({data:{}})).id;
  const details={...emptyGatheringDetails(),date:'2030-11-10'},intake=emptyGatheringIntake();intake.public.activity_nickname='朋友';intake.public.date=details.date;
  const friend=await service.createGathering(owner,{kind:'friend',idempotency_key:key(),details,intake});
  await service.saveGatheringIntake(friend.gathering.id,peer,{expected_revision:1,expected_version:0,join_if_needed:true,idempotency_key:key(),intake});
  const beforeFriend=await db.gathering.findUniqueOrThrow({where:{id:friend.gathering.id}});
  const beforeMembers=await db.gatheringMember.findMany({where:{gatheringId:friend.gathering.id},orderBy:{userId:'asc'}});
  const draft={title:'朋友旧筹备',description:'',starts_at:'',deadline_at:'2030-11-09T00:00:00Z',timezone:'Asia/Shanghai' as const,locations:[],questions:[]};
  const legacyFriend=await requirements.createRequirement(owner,{action:'create',kind:'friend',draft,idempotency_key:key()});
  // Seed more old team records than the 100-row product limit, with intentionally unreadable details.
  // They must be excluded in SQL before limits and parsing, not renamed as friends in JS.
  const ids:string[]=Array.from({length:101},()=>key());
  await db.gathering.createMany({data:ids.map(id=>({id,kind:'team',ownerUserId:owner,details:{retired:'PRIVATE_SENTINEL'},creationKey:key(),creationHash:'a'.repeat(64)}))});
  await db.gatheringMember.createMany({data:ids.map(id=>({gatheringId:id,userId:owner,publicIntake:{retired:true},privateIntake:{retired:'PRIVATE_SENTINEL'},answers:[],responseVersion:1,firstSubmissionSequence:0}))});
  const collectionIds=Array.from({length:101},()=>key());
  await db.requirementSurvey.createMany({data:collectionIds.map(id=>({id,kind:'team',ownerUserId:owner,draft:{retired:'PRIVATE_SENTINEL'},status:'closed',deadlineAt:new Date('2020-01-01T00:00:00Z'),closedAt:new Date('2020-01-01T00:00:00Z'),creationKey:key(),creationHash:'b'.repeat(64)}))});
  assert.deepEqual((await service.listGatherings(owner)).gatherings.map(row=>row.id),[friend.gathering.id]);
  assert.deepEqual((await requirements.listRequirements(owner)).collections.map(row=>row.id),[legacyFriend.collection.id]);
  pass('retired records cannot crowd friend preparations out of bounded lists or poison parsing');

  const id=ids[0],collectionId=collectionIds[0],source='a'.repeat(64);
  const beforeTeam=await db.gathering.findUniqueOrThrow({where:{id}}),beforeSurvey=await db.requirementSurvey.findUniqueOrThrow({where:{id:collectionId}});
  let providerCalls=0;
  const operations=[
    ()=>service.getGathering(id,owner),()=>service.getGathering(id,peer),
    ()=>service.joinGathering(id,owner),()=>service.joinGathering(id,peer),
    ()=>service.saveGatheringIntake(id,owner,{expected_revision:1,expected_version:1,idempotency_key:key(),intake}),
    ()=>service.updateGatheringDetails(id,owner,{expected_revision:1,details}),
    ()=>generateGatheringItinerary(id,owner,{expected_source:source,idempotency_key:key()},{generate:async()=>{providerCalls++;throw Error('retired provider call');}}),
    ()=>commandGatheringWorkflow(id,owner,{action:'propose',generation_id:key(),idempotency_key:key(),expected_version:1,plan_id:'plan1',note:''}),
    ()=>service.finalizeGathering(id,owner,{expected_source:source,generation_id:key(),plan_id:'plan1'}),
    ()=>requirements.getRequirement(collectionId,owner),()=>requirements.getRequirement(collectionId,peer),
    ()=>readCoordinationSourceOnce(collectionId,owner),
  ];
  for(const work of operations)await assert.rejects(work,{code:'NOT_FOUND'});
  await assert.rejects(()=>service.getGatheringMembers(id,owner,undefined),{code:'FORBIDDEN'});
  const commands:RequirementCommand[]=[
    {action:'save-draft',expected_revision:1,draft},{action:'publish',expected_revision:1},{action:'close',expected_revision:1},
    {action:'finalize',expected_revision:1,final_selection:{location_id:null,location_other:null,note:'retired'}},
    {action:'respond',expected_revision:1,expected_response_version:0,response:{selected_segment_ids:[],answers:[],location_ids:[],location_other:null,time_preferences:'',budget_note:'',preferences:'',private_origin:null}},
  ];
  for(const command of commands)await assert.rejects(()=>requirements.commandRequirement(collectionId,owner,command),{code:'NOT_FOUND'});
  assert.equal(providerCalls,0);assert.deepEqual(await db.gathering.findUniqueOrThrow({where:{id}}),beforeTeam);assert.deepEqual(await db.requirementSurvey.findUniqueOrThrow({where:{id:collectionId}}),beforeSurvey);
  assert.equal(await db.gatheringMember.count({where:{gatheringId:id}}),1);assert.equal(await db.gatheringGeneration.count({where:{gatheringId:id}}),0);assert.equal(await db.requirementSubmission.count({where:{collectionId}}),0);
  pass('historical read/write/generation/coordination paths reject owner and participant without data changes');

  const eventIds=ids.map(()=>key()),recipientIds=ids.map(()=>key());
  await db.gatheringSubmissionEvent.createMany({data:ids.map((gatheringId,i)=>({id:eventIds[i],gatheringId,actorUserId:peer,actorVersion:1,sequence:1,action:'submitted'}))});
  await db.gatheringNotificationRecipient.createMany({data:eventIds.map((eventId,i)=>({id:recipientIds[i],eventId,userId:owner}))});
  const inbox=await getInbox(owner);assert.ok(inbox.messages.some(message=>message.gathering_id===friend.gathering.id));assert.ok(inbox.messages.every(message=>!message.gathering_id||!ids.includes(message.gathering_id)));
  assert.ok(!JSON.stringify(await accountSnapshot(owner)).includes('PRIVATE_SENTINEL'));
  for(const messageId of [`gathering-notice:${recipientIds[0]}`,`requirement:${collectionId}:closed:${new Date('2020-01-01T00:00:00Z').getTime()}`])await assert.rejects(()=>readInbox(owner,{action:'read',message_id:messageId}),{code:'NOT_FOUND'});
  await assert.rejects(()=>updateAccount(owner,{action:'read-message',message_id:`requirement:${collectionId}:closed:${new Date('2020-01-01T00:00:00Z').getTime()}`}),{code:'NOT_FOUND'});
  assert.deepEqual(await db.gathering.findUniqueOrThrow({where:{id:friend.gathering.id}}),beforeFriend);assert.deepEqual(await db.gatheringMember.findMany({where:{gatheringId:friend.gathering.id},orderBy:{userId:'asc'}}),beforeMembers);
  pass('retired notifications disappear before pagination and cannot be marked read through either inbox; friend rows are unchanged');
  console.log(`PASS ${checks} team retirement PostgreSQL groups; no shared environment touched`);
}finally{await db.$disconnect();}

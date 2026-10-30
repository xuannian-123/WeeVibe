/** Explicit local-only integration test. Never runs as part of offline/default tests. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createActivity } from '../apps/web/src/server/activities/create';
import { createRequirement, commandRequirement, getRequirement } from '../apps/web/src/server/requirements/service';
import type { CreateActivityInput, RequirementResponseInput, TeamDraft } from '../packages/contracts/src';
import { getDb } from '../apps/web/src/server/db';
import { accountSnapshot, updateAccount } from '../apps/web/src/server/account';

const raw = process.env.DATABASE_URL;
if (!raw) { console.error('NOT RUN: explicit isolated localhost PostgreSQL DATABASE_URL is required'); process.exit(2); }
const target = new URL(raw);
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Only localhost PostgreSQL permitted');
assert.equal(decodeURIComponent(target.pathname.slice(1)), 'weevibe_acceptance_20261026', 'Exact authorized fixture database required');
assert.equal(target.port, '55089', 'Exact authorized fixture port required');
assert.ok(!target.hash);
for (const [key,value] of target.searchParams) assert.ok(key === 'schema' && value === 'public', 'No connection overrides');
const db = getDb();
const passed: string[] = [];
const check = async (name:string, fn:()=>Promise<void>) => { await fn(); passed.push(name); console.log(`PASS ${name}`); };
const key=()=>`test-${randomUUID()}`;
let current='setup';
try {
 const owner=await db.user.create({data:{}}), alice=await db.user.create({data:{}}), bob=await db.user.create({data:{}});
 const starts=new Date(Date.now()+7*86400000), ends=new Date(starts.getTime()+3600000), deadline=new Date(starts.getTime()-86400000);
 const activityInput:CreateActivityInput={idempotency_key:key(),name:'Isolated requirements fixture',timezone:'Asia/Shanghai',main_segment_ref:'one',participating_segment_refs:[],segments:[{client_ref:'one',type:'custom',name:'Fixture segment',starts_at:starts.toISOString(),ends_at:ends.toISOString(),deadline_at:deadline.toISOString(),minimum_participants:1,capacity:10,location:{name:'Synthetic fixture',address:null,source_url:null},fee:{kind:'unknown',amount_cents:null,currency:'CNY',note:''},requirements:''}]};
 const activity=await createActivity(owner.id,activityInput);
 const segment=activity.segments[0].segment_id;
 const draft:TeamDraft={title:'Local collection',description:'Fixture only',starts_at:starts.toISOString(),deadline_at:deadline.toISOString(),timezone:'Asia/Shanghai',locations:[{id:'venue',label:'Fixture candidate'}],questions:[{id:'food',title:'Fixture question',multiple:true,required:true,segment_id:segment,options:[{id:'one',label:'One'},{id:'two',label:'Two'}]}]};
 const creation={action:'create' as const,kind:'friend' as const,activity_id:activity.activity_id,idempotency_key:key(),draft};
 const created=await createRequirement(owner.id,creation);
 let opened=await commandRequirement(created.collection.id,owner.id,{action:'publish',expected_revision:created.collection.revision});
 const id=opened.collection.id;
 const response:RequirementResponseInput={selected_segment_ids:[segment],answers:[{question_id:'food',option_ids:['one','two'],other:null}],location_ids:['venue'],location_other:null,time_preferences:'After noon',budget_note:'Fixture budget',preferences:'Fixture preferences',private_origin:{label:'PRIVATE_FIXTURE_ORIGIN',longitude:120.1,latitude:30.1,crs:'GCJ-02'}};
 current='idempotent_create';await check(current,async()=>{assert.equal((await createRequirement(owner.id,creation)).collection.id,id);});
 current='one_answer_per_user';await check(current,async()=>{
  await commandRequirement(id,alice.id,{action:'respond',expected_revision:opened.collection.revision,expected_response_version:0,response});
  await commandRequirement(id,alice.id,{action:'respond',expected_revision:opened.collection.revision,expected_response_version:1,response:{...response,budget_note:'Updated'}});
  assert.equal(await db.requirementSubmission.count({where:{collectionId:id,userId:alice.id}}),1);
  assert.equal(await db.participation.count({where:{activityId:activity.activity_id,userId:alice.id}}),0);
 });
 current='stale_answer_replay_rejected';await check(current,async()=>{
  await assert.rejects(()=>commandRequirement(id,alice.id,{action:'respond',expected_revision:opened.collection.revision,expected_response_version:0,response}),{code:'VERSION_CONFLICT'});
  const latest=await getRequirement(id,alice.id);assert.equal(latest.own_response?.budget_note,'Updated');assert.equal(latest.own_response?.response_version,2);
 });
 current='private_projection';await check(current,async()=>{
  const manager=await getRequirement(id,owner.id), own=await getRequirement(id,alice.id), other=await getRequirement(id,bob.id);
  assert.equal(manager.manager?.responses[0].budget_note,'Updated');assert.ok(!JSON.stringify(manager).includes('PRIVATE_FIXTURE_ORIGIN'));
  assert.equal(own.own_response?.private_origin?.label,'PRIVATE_FIXTURE_ORIGIN');assert.equal(other.manager,null);assert.equal(other.own_response,null);
 });
 current='foreign_segment_rejected';await check(current,async()=>{
  await assert.rejects(()=>commandRequirement(id,alice.id,{action:'respond',expected_revision:opened.collection.revision,expected_response_version:2,response:{...response,selected_segment_ids:[randomUUID()]}}));
 });
 current='structure_frozen';await check(current,async()=>{
  await assert.rejects(()=>commandRequirement(id,owner.id,{action:'save-draft',expected_revision:opened.collection.revision,draft}));
 });
 current='post_lock_cutoff';await check(current,async()=>{
  await db.requirementSurvey.update({where:{id},data:{deadlineAt:new Date(Date.now()+1000)}});
  let locked!:()=>void;let release!:()=>void;
  const gotLock=new Promise<void>(r=>{locked=r;});const hold=new Promise<void>(r=>{release=r;});
  const locker=db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${activity.activity_id}::uuid FOR UPDATE`;locked();await hold;},{timeout:10000});
  await gotLock;
  const saving=commandRequirement(id,bob.id,{action:'respond',expected_revision:opened.collection.revision,expected_response_version:0,response:{...response,private_origin:null}}).then(()=>({success:true,error:null}),error=>({success:false,error}));
  await new Promise(r=>setTimeout(r,1300));release();await locker;
  const result=await saving;assert.equal(result.success,false);assert.equal(result.error?.code,'SEGMENT_APPLICATION_CLOSED');
  assert.equal(await db.requirementSubmission.count({where:{collectionId:id,userId:bob.id}}),0);
 });
 current='close_and_no_reopen';await check(current,async()=>{
  const closed=await commandRequirement(id,owner.id,{action:'close',expected_revision:opened.collection.revision});
  await assert.rejects(()=>commandRequirement(id,alice.id,{action:'respond',expected_revision:closed.collection.revision,expected_response_version:0,response}));
  await assert.rejects(()=>commandRequirement(id,owner.id,{action:'save-draft',expected_revision:closed.collection.revision,draft:{...draft,deadline_at:new Date(starts.getTime()-1000).toISOString()}}));
  const finalized=await commandRequirement(id,owner.id,{action:'finalize',expected_revision:closed.collection.revision,final_selection:{location_id:'venue',location_other:null,note:'Advisory fixture only'}});
  assert.equal(finalized.collection.status,'finalized');assert.equal(await db.participation.count({where:{activityId:activity.activity_id}}),0);
 });
 current='parallel_manual_close_submit';await check(current,async()=>{
  const second=await createActivity(owner.id,{...activityInput,idempotency_key:key()});
  const secondSegment=second.segments[0].segment_id;
  const secondDraft={...draft,questions:draft.questions.map(q=>({...q,segment_id:secondSegment}))};
  const secondCollection=await createRequirement(owner.id,{action:'create',kind:'friend',activity_id:second.activity_id,idempotency_key:key(),draft:secondDraft});
  const secondOpen=await commandRequirement(secondCollection.collection.id,owner.id,{action:'publish',expected_revision:secondCollection.collection.revision});
  const secondId=secondOpen.collection.id;
  const concurrent=await Promise.allSettled([
   commandRequirement(secondId,owner.id,{action:'close',expected_revision:secondOpen.collection.revision}),
   commandRequirement(secondId,alice.id,{action:'respond',expected_revision:secondOpen.collection.revision,expected_response_version:0,response:{...response,selected_segment_ids:[secondSegment]}})
  ]);
  assert.equal(concurrent[0].status,'fulfilled');
  if(concurrent[1].status==='rejected') assert.ok(['SEGMENT_APPLICATION_CLOSED','VERSION_CONFLICT'].includes(concurrent[1].reason.code));
  const count=await db.requirementSubmission.count({where:{collectionId:secondId}});
  assert.equal(count,concurrent[1].status==='fulfilled'?1:0);
  const closed=await getRequirement(secondId,owner.id);assert.equal(closed.collection.status,'closed');
  await assert.rejects(()=>commandRequirement(secondId,bob.id,{action:'respond',expected_revision:closed.collection.revision,expected_response_version:0,response:{...response,selected_segment_ids:[secondSegment]}}));
 });
 current='source_backed_messages_and_read_ownership';await check(current,async()=>{
  const inbox=await accountSnapshot(alice.id);
  const message=inbox.messages.find(m=>'requirement_id' in m && m.requirement_id===id && m.id.includes(':finalized:'));
  assert.ok(message);assert.equal(message.read,false);
  assert.ok(!JSON.stringify(message).includes('PRIVATE_FIXTURE_ORIGIN'));
  const read=await updateAccount(alice.id,{action:'read-message',message_id:message.id});
  assert.equal(read.messages.find(m=>m.id===message.id)?.read,true);
  await assert.rejects(()=>updateAccount(bob.id,{action:'read-message',message_id:message.id}),{code:'NOT_FOUND'});
  assert.equal(await db.messageRead.count({where:{userId:bob.id,messageId:message.id}}),0);
 });
 current='team_fail_closed';await check(current,async()=>{
  await assert.rejects(()=>createRequirement(owner.id,{action:'create',kind:'team',idempotency_key:key(),draft:{...draft,questions:[]}} as never),{code:'INVALID_INPUT'});
 });
 console.log(`PASS ${passed.length} isolated PostgreSQL requirement checks; fixture identities only, not real WeChat.`);
} catch { console.error(`FAIL ${current}; raw database errors and private fixture values deliberately omitted`); process.exitCode=1; }
finally { await db.$disconnect(); }

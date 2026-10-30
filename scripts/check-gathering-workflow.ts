/** Disposable loopback PostgreSQL only. No WeChat identity, AI or external delivery. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringSnapshotSchema,normalizeGatheringCertainty,type GatheringItinerary,type GatheringSnapshot} from '../packages/contracts/src';
assert.ok(process.argv.includes('--fixture-only'));
const target=new URL(process.env.DATABASE_URL||'');assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.match(target.pathname,/^\/weevibe_acceptance_[a-z0-9_]+$/);
for(const [key,value] of target.searchParams)assert.ok(key==='schema'&&value==='public');
globalThis.fetch=async()=>{throw Error('External network is disabled in this fixture');};
const load=createRequire(import.meta.url),{getDb}=load('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const service=load('../apps/web/src/server/gatherings/service.ts') as typeof import('../apps/web/src/server/gatherings/service');
const {generateGatheringItinerary}=load('../apps/web/src/server/gatherings/generation.ts') as typeof import('../apps/web/src/server/gatherings/generation');
const {commandGatheringWorkflow:command}=load('../apps/web/src/server/gatherings/workflow.ts') as typeof import('../apps/web/src/server/gatherings/workflow');
const {getInbox,readInbox}=load('../apps/web/src/server/inbox.ts') as typeof import('../apps/web/src/server/inbox');
const db=getDb(),key=()=>randomUUID(),date='2030-11-10';let passed=0;
let stage='setup';
const watchdog=setTimeout(()=>{console.error(JSON.stringify({passed:false,stage,error:'Workflow acceptance did not finish within 60 seconds'}));process.exit(1);},60000);
// Use a separate connection so a stalled Prisma transaction cannot hide the
// database lock evidence. This script already requires a disposable loopback DB.
const diagnostics=setTimeout(async()=>{
 const {Client}=load('../apps/web/node_modules/pg'),client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,query_timeout:5000});
 try{await client.connect();const result=await client.query(`SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blocked_by,left(query,500) AS query FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`);console.error(JSON.stringify({fixture_diagnostics:true,stage,connections:result.rows}));}
 catch(error){console.error(JSON.stringify({fixture_diagnostics:true,stage,error_type:error instanceof Error?error.name:typeof error}));}
 finally{await client.end();}
},15000);
const check=(name:string)=>{passed++;console.log('PASS '+name);};
const intake=(name:string)=>{const v=emptyGatheringIntake();v.public.activity_nickname=name;v.public.date=date;v.public.keywords.eat=['常规中餐'];v.public.keywords.environment=['烟味重'];v.private.budget_min=0;v.private.budget_max=100;v.private.origin={label:'PRIVATE_ORIGIN_SENTINEL'};v.public.confirmed_keys=['date','eat_0','environment_1'];v.private.confirmed_keys=['budget','origin'];return v;};
const itinerary:GatheringItinerary={plans:[1,2].map(n=>({id:`plan_${n}`,title:`推荐 ${n}`,summary:'用于检验完整协调流程',segments:[{id:'segment_a',title:'一起吃饭',description:'共同安排',date,start_time:'12:00',end_time:'13:00',place:'',address:'',fee_note:'费用待核实',unknowns:['营业待核实']}],notes:['需要实际核实']})),notes:['建议安排']};
const provider={generate:async()=>itinerary};
const expectFailure=async(work:()=>Promise<unknown>)=>{await assert.rejects(work);};
async function read(id:string,actor:string){return gatheringSnapshotSchema.parse(await service.getGathering(id,actor));}
async function choose(s:GatheringSnapshot,actor:string,ids:string[]=['plan_1']){return command(s.gathering.id,actor,{action:'select',generation_id:s.workflow!.generation_id,idempotency_key:key(),expected_version:s.workflow!.own_selection?.version??0,plan_ids:ids,note:''});}
async function propose(s:GatheringSnapshot,actor:string,plan='plan_1'){return command(s.gathering.id,actor,{action:'propose',generation_id:s.workflow!.generation_id,idempotency_key:key(),expected_version:s.workflow!.version,plan_id:plan,note:'本轮协调安排'});}
async function respond(s:GatheringSnapshot,actor:string,decision:'accept'|'reject'){return command(s.gathering.id,actor,{action:'respond',generation_id:s.workflow!.generation_id,idempotency_key:key(),expected_version:s.workflow!.own_confirmation?.version??0,proposal_version:s.workflow!.proposal_version,decision,note:decision==='reject'?'想调整第二套安排':''});}
try{
 const users=await Promise.all([0,1,2,3,4].map(()=>db.user.create({data:{}}))),[owner,member,outsider,teamOwner,teamMember]=users.map(u=>u.id);
 const details={...emptyGatheringDetails(),date};
 let snapshot=await service.createGathering(owner,{kind:'friend',idempotency_key:key(),details,intake:intake('局头')});const id=snapshot.gathering.id;
 assert.deepEqual(snapshot.own!.intake.public.confirmed_keys,['date','eat_0']);assert.deepEqual(snapshot.own!.intake.private.confirmed_keys,[]);assert.equal(snapshot.own!.intake.private.budget_max,100);assert.deepEqual(snapshot.own!.intake.public.keywords.environment,['烟味重']);check('only date and do certainty is saved; wants, avoids and private inputs survive');
 await service.saveGatheringIntake(id,member,{join_if_needed:true,expected_revision:snapshot.gathering.revision,expected_version:0,idempotency_key:key(),intake:intake('朋友')});
 snapshot=await read(id,owner);snapshot=await generateGatheringItinerary(id,owner,{expected_source:snapshot.source_fingerprint,idempotency_key:key()},provider);assert.equal(snapshot.workflow?.phase,'selecting');check('generation starts a durable selection round and lifecycle outbox');assert.equal((await getInbox(member)).pending_count,1);await readInbox(member,{action:'read-all'});assert.equal((await getInbox(member)).pending_count,1);assert.equal((await read(id,member)).workflow!.own_confirmation,null);check('reading messages never completes a task or implies consent');
 await expectFailure(()=>propose(snapshot,owner));await expectFailure(()=>choose(snapshot,outsider));await expectFailure(()=>choose(snapshot,member,['missing_plan']));await expectFailure(()=>service.finalizeGathering(id,owner,{expected_source:snapshot.source_fingerprint,generation_id:snapshot.itinerary!.generation_id,plan_id:'plan_1'}));check('cannot bypass member choices or consent, foreign actor and plan are refused');
 const selection={action:'select',generation_id:snapshot.workflow!.generation_id,idempotency_key:key(),expected_version:0,plan_ids:['plan_1','plan_2'],note:'两个方案都可以协调'};
 snapshot=await command(id,owner,selection);const eventsBefore=await db.gatheringSubmissionEvent.count({where:{gatheringId:id}});await command(id,owner,selection);assert.equal(await db.gatheringSubmissionEvent.count({where:{gatheringId:id}}),eventsBefore);
 await expectFailure(()=>command(id,owner,{...selection,plan_ids:['plan_2']}));await expectFailure(()=>command(id,owner,{...selection,idempotency_key:key()}));check('replay is idempotent, key reuse and stale own selection versions are rejected');
 await choose(await read(id,member),member,['plan_2']);assert.equal((await getInbox(member)).pending_count,0);assert.equal((await getInbox(owner)).pending_count,1);snapshot=await propose(await read(id,owner),owner);assert.equal(snapshot.workflow!.phase,'confirming');assert.equal(snapshot.final_choice,null);
 await respond(await read(id,owner),owner,'accept');snapshot=await read(id,member);assert.equal(snapshot.workflow!.accepted_count,1);assert.equal(snapshot.final_choice,null);snapshot=await respond(snapshot,member,'reject');assert.equal(snapshot.workflow!.phase,'adjusting');assert.equal(snapshot.final_choice,null);check('preference is not consent; one acceptance is insufficient; rejection returns to adjustment');
 const oldProposal=snapshot.workflow!.proposal_version;snapshot=await propose(await read(id,owner),owner,'plan_2');assert.equal(snapshot.workflow!.accepted_count,0);await expectFailure(()=>command(id,member,{action:'respond',generation_id:snapshot.workflow!.generation_id,idempotency_key:key(),expected_version:0,proposal_version:oldProposal,decision:'accept',note:''}));
 stage='parallel_final_acceptance';
 const s1=await read(id,owner),s2=await read(id,member);await Promise.all([respond(s1,owner,'accept'),respond(s2,member,'accept')]);snapshot=await read(id,owner);assert.equal(snapshot.workflow!.phase,'completed');assert.equal(snapshot.final_choice!.plan_id,'plan_2');assert.equal(snapshot.workflow!.final_plan!.id,'plan_2');assert.equal(snapshot.viewer.can_respond,false);assert.equal((await getInbox(member)).pending_count,0);assert.equal((await getInbox(owner)).pending_count,0);check('new proposal resets every confirmation; concurrent final accepts commit exactly one completed plan');
 for(let round=0;round<3;round++){
  stage=`repeat_parallel_acceptance_${round+1}`;
  let group=await service.createGathering(owner,{kind:'friend',idempotency_key:key(),details,intake:intake('并发局头')});const groupId=group.gathering.id;
  await service.saveGatheringIntake(groupId,member,{join_if_needed:true,expected_revision:group.gathering.revision,expected_version:0,idempotency_key:key(),intake:intake('并发成员')});
  group=await read(groupId,owner);group=await generateGatheringItinerary(groupId,owner,{expected_source:group.source_fingerprint,idempotency_key:key()},provider);
  await choose(group,owner);await choose(await read(groupId,member),member);await propose(await read(groupId,owner),owner);
  const [left,right]=await Promise.all([read(groupId,owner),read(groupId,member)]);
  await Promise.all([respond(left,owner,'accept'),respond(right,member,'accept')]);
  const completed=await read(groupId,owner);assert.equal(completed.workflow!.phase,'completed');assert.equal(completed.workflow!.accepted_count,2);assert.equal(completed.final_choice!.plan_id,'plan_1');
 }
 check('repeated simultaneous final confirmations finish without stale-snapshot commit stalls');
 stage='completed_and_team_guards';
 await expectFailure(()=>service.saveGatheringIntake(id,member,{expected_revision:snapshot.gathering.revision,expected_version:1,idempotency_key:key(),intake:intake('不能改已完成')}));check('completed plan and intake remain locked after reopening');
 // A changed intake invalidates the exact prior generation and its confirmations.
 let stale=await service.createGathering(outsider,{kind:'friend',idempotency_key:key(),details,intake:intake('失效检查')});stale=await generateGatheringItinerary(stale.gathering.id,outsider,{expected_source:stale.source_fingerprint,idempotency_key:key()},provider);const old=stale;
 await service.saveGatheringIntake(stale.gathering.id,outsider,{expected_revision:stale.gathering.revision,expected_version:1,idempotency_key:key(),intake:{...intake('失效检查'),public:{...intake('失效检查').public,note:'修改公开偏好'}}});stale=await read(stale.gathering.id,outsider);assert.equal(stale.workflow!.stale,true);await expectFailure(()=>choose(old,outsider));check('changed public input invalidates stale choices and confirmations');
 await assert.rejects(()=>service.createGathering(teamOwner,{kind:'team',idempotency_key:key(),details,intake:intake('retired')}),{code:'INVALID_INPUT'});
 check('retired team creation is rejected while friend consent workflow remains unchanged');
 assert.deepEqual(normalizeGatheringCertainty(intake('验证')).public.confirmed_keys,['date','eat_0']);console.log(`PASS ${passed} workflow PostgreSQL acceptance groups; no shared environment touched`);
}finally{await db.$disconnect();clearTimeout(watchdog);clearTimeout(diagnostics);}

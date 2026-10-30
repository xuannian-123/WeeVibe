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
 // Candidate places are the stable first question and aggregate only to the owner.
 const teamDetails={...details,deadline_at:new Date(Date.now()+86400000).toISOString(),candidate_places:[{id:'place_a',label:'地点甲'},{id:'place_b',label:'地点乙'}],questions:[{id:'q_activity',title:'想做什么',type:'single' as const,required:true,options:[{id:'o_coffee',label:'喝咖啡'}]}]};
 let team=await service.createGathering(teamOwner,{kind:'team',idempotency_key:key(),details:teamDetails,intake:intake('团建局头')});const teamId=team.gathering.id;
 await expectFailure(()=>service.saveGatheringIntake(teamId,teamMember,{join_if_needed:true,expected_revision:team.gathering.revision,expected_version:0,idempotency_key:key(),intake:intake('团建成员')}));
 const answer={...intake('团建成员'),answers:[{question_id:'candidate_place_choice',option_ids:['place_b'],other:'',text:''},{question_id:'q_activity',option_ids:['o_coffee'],other:'',text:''}]};
 await expectFailure(()=>service.saveGatheringIntake(teamId,teamMember,{join_if_needed:true,expected_revision:team.gathering.revision,expected_version:0,idempotency_key:key(),intake:{...answer,answers:[{...answer.answers[0],option_ids:['missing_place']},answer.answers[1]]}}));
 await service.saveGatheringIntake(teamId,teamMember,{join_if_needed:true,expected_revision:team.gathering.revision,expected_version:0,idempotency_key:key(),intake:answer});team=await read(teamId,teamOwner);assert.equal(team.stats!.questions[0].id,'candidate_place_choice');assert.equal(team.stats!.questions[0].options[1].count,1);assert.equal((await read(teamId,teamMember)).stats,null);check('multiple candidates become required question one; actual venue IDs persist and aggregate privately');
 await expectFailure(()=>service.updateGatheringDetails(teamId,teamOwner,{expected_revision:team.gathering.revision,details:{...teamDetails,candidate_places:teamDetails.candidate_places.slice(0,1)}}));check('answered venue question cannot silently disappear or change under saved responses');
 let captured='';team=await generateGatheringItinerary(teamId,teamOwner,{expected_source:team.source_fingerprint,idempotency_key:key()},{generate:async(_actor,source)=>{captured=JSON.stringify(source);return itinerary;}});assert.ok(captured.includes('question_summary'));assert.ok(!captured.includes('PRIVATE_ORIGIN_SENTINEL'));assert.ok(!captured.includes('团建成员'));await expectFailure(async()=>propose(await read(teamId,teamMember),teamMember));
 team=await propose(await read(teamId,teamOwner),teamOwner);assert.equal(team.workflow!.phase,'completed');const memberView=await read(teamId,teamMember);assert.equal(memberView.stats,null);assert.equal(memberView.itinerary,null);assert.equal(memberView.workflow!.final_plan!.id,'plan_1');assert.deepEqual(memberView.workflow!.people,[]);assert.equal(memberView.workflow!.total,0);check('team uses aggregate model input and organizer confirmation; member receives only final arrangement');
 const recipients=await db.gatheringNotificationRecipient.findMany({where:{event:{gatheringId:teamId,action:'completed'}}});assert.ok(recipients.some(r=>r.userId===teamMember));assert.ok(await db.gatheringPushOutbox.count({where:{recipientId:{in:recipients.map(r=>r.id)}}})>0);check('completion writes member notification and durable delivery outbox atomically');
 assert.deepEqual(normalizeGatheringCertainty(intake('验证')).public.confirmed_keys,['date','eat_0']);console.log(`PASS ${passed} workflow PostgreSQL acceptance groups; no shared environment touched`);
}finally{await db.$disconnect();clearTimeout(watchdog);}

/** Synthetic actors only: real disposable PG + real routes + real queue worker, no WeChat exchange or external send. */
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringSubscriptionConfigSchema,gatheringSubscriptionIntentResultSchema,inboxSchema} from '../packages/contracts/src';

assert.ok(process.argv.includes('--fixture-only'));
let target:URL;try{target=new URL(process.env.DATABASE_URL||'');}catch{throw Error('Explicit disposable database required');}
assert.ok(['postgres:','postgresql:'].includes(target.protocol));assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.match(decodeURIComponent(target.pathname.slice(1)),/^weevibe_acceptance_[a-z0-9_]+$/);assert.ok(!target.hash);
for(const[key,value]of target.searchParams)assert.ok(key==='schema'&&value==='public');
globalThis.fetch=async()=>{throw Error('External network is disabled in the notification fixture');};
Object.assign(process.env,{GATHERING_NOTIFY_ENABLED:'true',GATHERING_NOTIFY_ENV:'cloud-notify-fixture',GATHERING_NOTIFY_APPID:'wx0000000000000000',GATHERING_NOTIFY_WORKER_SECRET:randomBytes(32).toString('base64url'),GATHERING_NOTIFY_TEMPLATE_ID:'fixture-template-never-send'});
const load=createRequire(import.meta.url),{getDb}=load('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const service=load('../apps/web/src/server/gatherings/service.ts') as typeof import('../apps/web/src/server/gatherings/service');
const claimRoute=load('../apps/web/src/app/api/internal/gathering-notifications/claim/route.ts') as typeof import('../apps/web/src/app/api/internal/gathering-notifications/claim/route');
const ackRoute=load('../apps/web/src/app/api/internal/gathering-notifications/ack/route.ts') as typeof import('../apps/web/src/app/api/internal/gathering-notifications/ack/route');
const subscription=load('../apps/web/src/app/api/v1/gatherings/notifications/subscription/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/notifications/subscription/route');
const messages=load('../apps/web/src/app/api/v1/messages/route.ts') as typeof import('../apps/web/src/app/api/v1/messages/route');
const {readConfig,sign}=load('../cloudfunctions/weevibeNotifyGathering/protocol.cjs') as typeof import('../cloudfunctions/weevibeNotifyGathering/protocol.cjs');
const {createWorker,TRIGGER}=load('../cloudfunctions/weevibeNotifyGathering/worker.cjs') as {createWorker:(dependencies:Record<string,unknown>)=>(event:unknown)=>Promise<{sent:number;claimed:number}>;TRIGGER:string};
const conf=readConfig(process.env),db=getDb(),checks:string[]=[],output=resolve(import.meta.dirname,'../.working/html-replacement-20261028/pg');
let current='setup';
type Actor={id:string;token:string};
type Job={outbox_id:string;lease_token:string;gathering_id:string;touser:string;template_id:string;event_kind:string};
async function actor(ready=true):Promise<Actor>{
  const user=await db.user.create({data:{}}),token=randomBytes(32).toString('base64url');
  await db.authSession.create({data:{userId:user.id,tokenHash:createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+3600000)}});
  if(ready){
    await db.wechatIdentity.create({data:{userId:user.id,appId:conf.appId,openId:`fixture_${randomBytes(12).toString('hex')}`}});
    const sharp=load('../apps/web/node_modules/sharp') as (value:unknown)=>{jpeg:()=>{toBuffer:()=>Promise<Buffer>}};
    const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#ddccbb'}}).jpeg().toBuffer();
    await db.privateProfile.create({data:{userId:user.id,data:{nickname:'通知验收合成用户'}}});
    await db.userAvatar.create({data:{userId:user.id,bytes:Uint8Array.from(bytes),contentType:'image/jpeg',digest:createHash('sha256').update(bytes).digest('hex')}});
  }
  return {id:user.id,token};
}
async function check(name:string,work:()=>Promise<void>){current=name;await work();checks.push(name);console.log(`PASS ${name}`);}
function excludes(value:unknown){assert.ok(!/PRIVATE_SENTINEL|PRIVATE_BUDGET|PRIVATE_ORIGIN|RAW_ANSWER/.test(JSON.stringify(value)));}
async function json(response:Response,status=200){assert.equal(response.status,status);assert.equal(response.headers.get('cache-control'),'no-store');return response.json() as Promise<Record<string,unknown>>;}
async function credit(actor:Actor,id:string,key=`mini-fixture-${randomUUID()}`){return gatheringSubscriptionIntentResultSchema.parse(await json(await subscription.POST(new Request('http://localhost/api/v1/gatherings/notifications/subscription',{method:'POST',headers:{Authorization:`Bearer ${actor.token}`,'Content-Type':'application/json'},body:JSON.stringify({gathering_id:id,authorization_key:key,template_id:process.env.GATHERING_NOTIFY_TEMPLATE_ID,result:'accept'})}))));}
function signed(action:'claim'|'ack',payload:unknown,now=Date.now()){const proof=sign(action,payload,conf,now);return new Request(`http://localhost${proof.path}`,{method:'POST',headers:{'Content-Type':'application/json','x-weevibe-notify-signature':proof.signature},body:proof.body});}
async function claim(){return (await json(await claimRoute.POST(signed('claim',{limit:10})))).jobs as Job[];}
async function ack(job:Job,outcome:'sent'|'failed'|'unknown',code:number|null){return json(await ackRoute.POST(signed('ack',{outbox_id:job.outbox_id,lease_token:job.lease_token,outcome,err_code:code})));}
function intake(label:string){const value=emptyGatheringIntake();value.public.activity_nickname='本次活动用户';value.public.note=label;value.private.budget_note='PRIVATE_BUDGET';value.private.origin={label:'PRIVATE_ORIGIN'};return value;}
async function save(id:string,actor:Actor,label:string){const snap=await service.getGathering(id,actor.id),body={expected_revision:snap.gathering.revision,expected_version:snap.own?.version??0,join_if_needed:true,idempotency_key:randomUUID(),intake:intake(label)};return {body,snapshot:await service.saveGatheringIntake(id,actor.id,body)};}

try{
  await mkdir(output,{recursive:true});
  const owner=await actor(),a=await actor(),b=await actor(),idle=await actor(),incomplete=await actor(false);
  const details={...emptyGatheringDetails(),date:new Date(Date.now()+86400000*7).toISOString().slice(0,10),title:'合成通知验收',confirmed_details:['date','title'] as ('date'|'title')[]};
  const created=await service.createGathering(owner.id,{kind:'friend',idempotency_key:randomUUID(),details,intake:intake('Owner public')}),id=created.gathering.id;
  await check('notification constraints remain while account presentation is optional',async()=>{
    const migrations=await db.$queryRaw<{migration_name:string}[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.ok(migrations.length>=15);assert.ok(migrations.some(row=>row.migration_name==='20261028190000_gathering_notifications'));
    await service.createGathering(incomplete.id,{kind:'friend',idempotency_key:randomUUID(),details,intake:intake('allowed without profile')});
    assert.equal(await db.gatheringSubmissionEvent.count({where:{actorUserId:incomplete.id}}),1);
    const status=await json(await subscription.GET(new Request('http://localhost/api/v1/gatherings/notifications/subscription',{headers:{Authorization:`Bearer ${incomplete.token}`}})));assert.equal(status.enabled,false);
  });
  let savedA:Awaited<ReturnType<typeof save>>;
  await check('one accepted intent is actor-bound group-bound and idempotent while successful submits enqueue exact earlier recipients',async()=>{
    await json(await subscription.GET(new Request('http://localhost/api/v1/gatherings/notifications/subscription')),401);
    gatheringSubscriptionConfigSchema.parse(await json(await subscription.GET(new Request('http://localhost/api/v1/gatherings/notifications/subscription',{headers:{Authorization:`Bearer ${owner.token}`}}))));
    const key=`mini-fixture-${randomUUID()}`;assert.equal((await credit(owner,id,key)).available_intents,1);assert.equal((await credit(owner,id,key)).available_intents,1);
    const other=await service.createGathering(owner.id,{kind:'friend',idempotency_key:randomUUID(),details,intake:intake('Other group public')});
    await json(await subscription.POST(new Request('http://localhost/api/v1/gatherings/notifications/subscription',{method:'POST',headers:{Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},body:JSON.stringify({gathering_id:other.gathering.id,authorization_key:key,template_id:process.env.GATHERING_NOTIFY_TEMPLATE_ID,result:'accept'})})),409);
    // This otherwise-valid earlier credit belongs to another group and must remain unused.
    await credit(owner,other.gathering.id);
    savedA=await save(id,a,'A public first');await service.saveGatheringIntake(id,a.id,savedA.body);
    await credit(a,id);await service.joinGathering(id,idle.id);await save(id,b,'B public first');
    const events=await db.gatheringSubmissionEvent.findMany({where:{gatheringId:id},orderBy:{sequence:'asc'},include:{recipients:true}});
    assert.equal(events.length,3);assert.deepEqual(events[0].recipients,[]);
    assert.deepEqual(events[1].recipients.map(row=>row.userId),[owner.id]);assert.deepEqual(events[2].recipients.map(row=>row.userId).sort(),[owner.id,a.id].sort());
    assert.ok(!events.some(event=>event.recipients.some(recipient=>recipient.userId===event.actorUserId||recipient.userId===idle.id)));excludes(events);
    assert.equal(await db.gatheringPushOutbox.count({where:{recipient:{event:{gatheringId:id}}}}),3);
  });
  await check('enqueue database failure rolls back answer version sequence and new recipients together',async()=>{
    const before=await db.gathering.findUniqueOrThrow({where:{id}}),member=await db.gatheringMember.findUniqueOrThrow({where:{gatheringId_userId:{gatheringId:id,userId:a.id}}});
    const collision=await db.gatheringSubmissionEvent.create({data:{gatheringId:id,actorUserId:a.id,actorVersion:2,sequence:999,action:'updated'}});
    await assert.rejects(()=>save(id,a,'must roll back'));
    assert.equal((await db.gathering.findUniqueOrThrow({where:{id}})).submissionSequence,before.submissionSequence);
    assert.equal((await db.gatheringMember.findUniqueOrThrow({where:{gatheringId_userId:{gatheringId:id,userId:a.id}}})).responseVersion,member.responseVersion);
    assert.equal(await db.gatheringPushOutbox.count({where:{recipient:{event:{gatheringId:id}}}}),3);await db.gatheringSubmissionEvent.delete({where:{id:collision.id}});
  });
  let jobs:Job[]=[];
  await check('HMAC proof rejects clients stale signatures and persistent replay while concurrent claims use one grant per outbox',async()=>{
    const expired=await db.gatheringWorkerNonce.create({data:{scope:`${conf.scope}:gathering-submission-notify`,appId:conf.appId,nonceHash:'f'.repeat(64),expiresAt:new Date(Date.now()-86400000)}});
    await json(await claimRoute.POST(new Request('http://localhost/api/internal/gathering-notifications/claim',{method:'POST',headers:{Authorization:`Bearer ${owner.token}`,'Content-Type':'application/json'},body:JSON.stringify({limit:10})})),401);
    await json(await claimRoute.POST(signed('claim',{limit:10},Date.now()-62000)),401);
    const request=signed('claim',{limit:1}),replay=request.clone();const first=await json(await claimRoute.POST(request));jobs.push(...first.jobs as Job[]);await json(await claimRoute.POST(replay),401);
    assert.equal(await db.gatheringWorkerNonce.count({where:{id:expired.id}}),0);
    const batches=await Promise.all([claim(),claim()]);jobs.push(...batches.flat());assert.equal(jobs.length,2);assert.equal(new Set(jobs.map(job=>job.outbox_id)).size,2);excludes(jobs);
    assert.equal(await db.gatheringSubscriptionGrant.count({where:{gatheringId:id,consumedAt:{not:null}}}),2);
    assert.equal(await db.gatheringPushOutbox.count({where:{recipient:{event:{gatheringId:id}},status:'leased'}}),2);
    await json(await ackRoute.POST(signed('ack',{outbox_id:jobs[0].outbox_id,lease_token:'X'.repeat(43),outcome:'sent',err_code:0})),401);
    await ack(jobs[0],'sent',0);await ack(jobs[0],'sent',0);await ack(jobs[1],'unknown',null);assert.equal((await claim()).length,0);
  });
  await check('later credits cannot drain old notices and expired leases become unknown without a resend',async()=>{
    await credit(owner,id);assert.equal((await claim()).length,0);
    await save(id,a,'A public update');const fresh=await claim();assert.equal(fresh.length,1);
    const row=await db.gatheringPushOutbox.findUniqueOrThrow({where:{id:fresh[0].outbox_id},include:{recipient:{include:{event:true}}}});assert.equal(row.recipient.event.actorVersion,2);
    await db.gatheringPushOutbox.update({where:{id:row.id},data:{leaseExpiresAt:new Date(Date.now()-1000)}});assert.equal((await claim()).length,0);
    assert.equal((await db.gatheringPushOutbox.findUniqueOrThrow({where:{id:row.id}})).status,'unknown');await json(await ackRoute.POST(signed('ack',{outbox_id:row.id,lease_token:fresh[0].lease_token,outcome:'sent',err_code:0})),409);
  });
  await check('explicit rate limits retry the same grant at most three attempts and never consume a new credit for that event',async()=>{
    await credit(owner,id);await save(id,a,'A public next update');let [job]=await claim();assert.ok(job);
    const grant=(await db.gatheringPushOutbox.findUniqueOrThrow({where:{id:job.outbox_id}})).grantId;
    for(let attempt=1;attempt<=3;attempt++){
      const receipt=await ack(job,'failed',45009);assert.equal(receipt.status,attempt<3?'pending':'failed');
      const row=await db.gatheringPushOutbox.findUniqueOrThrow({where:{id:job.outbox_id}});assert.equal(row.grantId,grant);assert.equal(row.attempts,attempt);
      if(attempt<3){await db.gatheringPushOutbox.update({where:{id:job.outbox_id},data:{nextAttemptAt:new Date(Date.now()-1000)}});const next=await claim();assert.equal(next.length,1);assert.equal(next[0].outbox_id,job.outbox_id);assert.notEqual(next[0].lease_token,job.lease_token);job=next[0];}
    }
    assert.equal((await claim()).length,0);
  });
  await check('the deployable worker signs real queue routes and acknowledges a single explicit fixture send without exposing private fields',async()=>{
    await credit(owner,id);await save(id,b,'B public update');let sends=0;
    const worker=createWorker({env:{...process.env,GATHERING_NOTIFY_API_ORIGIN:'https://notify.example.test',GATHERING_NOTIFY_TEMPLATE_FIELDS:JSON.stringify({thing1:'event',thing2:'service',time3:'time'}),GATHERING_NOTIFY_MINIPROGRAM_STATE:'developer'},context:()=>({ENV:conf.scope}),send:async(input:unknown)=>{sends++;excludes(input);assert.ok(!JSON.stringify(input).includes('B public'));return {errCode:0};},fetchImpl:async(url:string,init:RequestInit)=>{const request=new Request(url,init);return new URL(url).pathname.endsWith('/claim')?claimRoute.POST(request):ackRoute.POST(request);}});
    const result=await worker({Type:'Timer',TriggerName:TRIGGER});assert.equal(result.sent,1);assert.equal(sends,1);
    assert.equal(await db.gatheringPushOutbox.count({where:{recipient:{event:{gatheringId:id}},status:'sent'}}),2);
  });
  await check('team notifications and inbox are organizer-only while friend inbox keeps immutable per-version messages without original answers',async()=>{
    const teamDetails={...details,deadline_at:new Date(Date.now()+86400000).toISOString(),questions:[{id:'q1',title:'需要什么',type:'text' as const,required:true,options:[]}]};
    const team=await service.createGathering(owner.id,{kind:'team',idempotency_key:randomUUID(),details:teamDetails,intake:intake('团建局头')});
    for(const member of [a,b]){const value=intake('PRIVATE_SENTINEL');value.answers=[{question_id:'q1',option_ids:[],other:'',text:'RAW_ANSWER'}];await service.saveGatheringIntake(team.gathering.id,member.id,{expected_revision:team.gathering.revision,expected_version:0,join_if_needed:true,idempotency_key:randomUUID(),intake:value});}
    const recipients=await db.gatheringNotificationRecipient.findMany({where:{event:{gatheringId:team.gathering.id}}});assert.equal(recipients.length,2);assert.ok(recipients.every(row=>row.userId===owner.id));
    for(const member of [owner,a,b,idle]){
      const body=await json(await messages.GET(new Request('http://localhost/api/v1/messages',{headers:{Authorization:`Bearer ${member.token}`}})));excludes(body);
      const inbox=inboxSchema.parse(body);const notices=inbox.messages.filter(item=>item.gathering_id===team.gathering.id);assert.equal(notices.length,member.id===owner.id?2:0);
    }
  });
  await writeFile(resolve(output,'notification-result.json'),JSON.stringify({passed:true,fixture_groups:checks.length,checks,source:'real_postgresql_http_auth_queue_and_deployable_worker',migrations_applied:15,wechat_exchange:false,wechat_send:'explicit_injected_offline_fixture',external_fetch_disabled:true,shared_environment_touched:false},null,2));console.log(`Notification PostgreSQL/HTTP/worker groups passed: ${checks.length}`);
}catch(error){
  const safe={passed:false,current_check:current,error_type:error instanceof Error?error.name:typeof error,code:error&&typeof error==='object'&&'code'in error?String(error.code):null,raw_response_withheld:true};
  await mkdir(output,{recursive:true});await writeFile(resolve(output,'notification-result.json'),JSON.stringify(safe,null,2));await writeFile(resolve(output,'notification-error.private.log'),error instanceof Error?error.stack||error.message:String(error));console.error(JSON.stringify(safe));process.exitCode=1;
}finally{await db.$disconnect();}

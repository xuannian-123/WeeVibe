import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const {getDb}=require('../apps/web/src/server/db') as typeof import('../apps/web/src/server/db');
const {changeMemory,readMemory,processMemoryJob}=require('../apps/web/src/server/gatherings/memory') as typeof import('../apps/web/src/server/gatherings/memory');
const {createGathering,saveGatheringIntake}=require('../apps/web/src/server/gatherings/service') as typeof import('../apps/web/src/server/gatherings/service');
const {generateGatheringItinerary}=require('../apps/web/src/server/gatherings/generation') as typeof import('../apps/web/src/server/gatherings/generation');
import {emptyGatheringDetails,emptyGatheringIntake} from '../packages/contracts/src';
const target=new URL(process.env.DATABASE_URL??'http://invalid');
assert(['localhost','127.0.0.1'].includes(target.hostname)&&/^weevibe_acceptance_[a-z0-9_]+$/.test(target.pathname.slice(1)),'Explicit local acceptance database only; never shared');
const db=getDb(),a=await db.user.create({data:{}}),b=await db.user.create({data:{}});
const intake=()=>{const i=emptyGatheringIntake();i.public.activity_nickname='记忆验收';i.public.date='2030-02-01';return i;};
async function drain(){const jobs=await db.$queryRaw<{id:string}[]>`SELECT id FROM "PreferenceLearningJob" WHERE "userId"=${a.id}::uuid AND status='pending'`;await Promise.all(jobs.flatMap(j=>[processMemoryJob(j.id),processMemoryJob(j.id)]));return jobs;}
try{
 await changeMemory(a.id,{action:'settings',learning:true,recommending:true});
 const first=intake();first.public.keywords.play=['看展'];
 let one=await createGathering(a.id,{kind:'friend',idempotency_key:randomUUID(),details:{...emptyGatheringDetails(),date:first.public.date},intake:first});
 execFileSync(process.execPath,['--import','tsx','scripts/preference-memory-worker.ts','--once'],{stdio:'inherit'});
 const jobs=await db.$queryRaw<{id:string}[]>`SELECT id FROM "PreferenceLearningJob" WHERE "userId"=${a.id}::uuid`;assert(jobs.length>0);
 assert.equal((await readMemory(a.id)).profiles[0].values[0],'看展');console.log('PASS A persisted evidence through executable worker');
 const defaults=await readMemory(a.id);assert(defaults.profiles.some(p=>p.values.includes('看展')));console.log('PASS B server defaults (UI still separately required)');
 const second=intake();second.public.keywords.play=['看展'];second.private.preference_memory={use_history:true,automatic:{play:['看展']}};
 const two=await createGathering(a.id,{kind:'friend',idempotency_key:randomUUID(),details:{...emptyGatheringDetails(),date:second.public.date},intake:second});await drain();
 assert.equal((await readMemory(a.id)).profiles[0].evidence_count,1);
 let captured='';
 const provider={generate:async(_actor:string,source:unknown)=>{captured=JSON.stringify(source);return {plans:[1,2].map(n=>({id:'p'+n,title:'方案'+n,summary:'仅验输入',segments:[{id:'s',title:'活动',description:'待核实',date:'2030-02-01',start_time:'',end_time:'',place:'',address:'',fee_note:'',unknowns:['待核实']}],notes:[]})),notes:[]};}};
 await generateGatheringItinerary(two.gathering.id,a.id,{idempotency_key:randomUUID(),expected_source:two.source_fingerprint},provider);assert(captured.includes('看展'));console.log('PASS C actual generation service constructs permitted input (fixture provider)');
 const changed=structuredClone(second);changed.public.keywords.play=['唱歌'];const saved=await saveGatheringIntake(two.gathering.id,a.id,{idempotency_key:randomUUID(),expected_revision:two.gathering.revision,expected_version:two.own!.version,intake:changed});
 await generateGatheringItinerary(two.gathering.id,a.id,{idempotency_key:randomUUID(),expected_source:saved.source_fingerprint},provider);assert(captured.includes('唱歌')&&!captured.includes('看展'));console.log('PASS D current input overrides history');
 for(let n=0;n<2;n++){one=await saveGatheringIntake(one.gathering.id,a.id,{idempotency_key:randomUUID(),expected_revision:one.gathering.revision,expected_version:one.own!.version,intake:first});await drain();}
 const evidence=await db.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM "PreferenceEvidence" WHERE "userId"=${a.id}::uuid AND "sourceId"=${one.gathering.id}::uuid`;assert.equal(Number(evidence[0].count),1);console.log('PASS E replace source, never accumulate saves');
 const replay=await db.$queryRaw<{id:string}[]>`SELECT id FROM "PreferenceLearningJob" WHERE "userId"=${a.id}::uuid`;assert(replay.length>0);
 await changeMemory(a.id,{action:'delete',category:'play'});for(const j of replay){await db.$executeRaw`UPDATE "PreferenceLearningJob" SET status='pending' WHERE id=${j.id}::uuid`;await processMemoryJob(j.id);}assert.equal((await readMemory(a.id)).profiles.length,0);console.log('PASS F deletion survives replay');
 assert.equal((await readMemory(b.id)).profiles.length,0);console.log('PASS G actor-bound service reads (HTTP auth separately tested)');
 const normal=await createGathering(b.id,{kind:'friend',idempotency_key:randomUUID(),details:{...emptyGatheringDetails(),date:first.public.date},intake:intake()});await generateGatheringItinerary(normal.gathering.id,b.id,{idempotency_key:randomUUID(),expected_source:normal.source_fingerprint},provider);assert.equal((await readMemory(b.id)).profiles.length,0);console.log('PASS H legacy create/fill/generate');
}finally{await db.gathering.deleteMany({where:{ownerUserId:{in:[a.id,b.id]}}});await db.user.deleteMany({where:{id:{in:[a.id,b.id]}}});await db.$disconnect();}

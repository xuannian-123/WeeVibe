/** Explicit local disposable-PG fixture; no real identities, models or notifications. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {inspirationIntake,emptyGatheringDetails} from '../packages/contracts/src';
import {accountVenue} from '../tests/account-fixtures';
assert.ok(process.argv.includes('--fixture-only'));
const target=new URL(process.env.DATABASE_URL||'');
assert.ok(['127.0.0.1','localhost'].includes(target.hostname));
assert.match(target.pathname,/^\/weevibe_acceptance_[a-z0-9_]+$/);
for(const [key,value] of target.searchParams)assert.ok(key==='schema'&&value==='public');
const load=createRequire(import.meta.url),{getDb}=load('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const service=load('../apps/web/src/server/gatherings/service.ts') as typeof import('../apps/web/src/server/gatherings/service');
const db=getDb();
try{
 const actor=await db.user.create({data:{}}),venue={...accountVenue(),name:'肯悦咖啡（林泉店）',category_text:'餐饮服务;咖啡厅'};
 const intake=inspirationIntake(venue);intake.public.activity_nickname='地点联调';intake.public.date='2030-11-10';
 const input={kind:'friend',idempotency_key:randomUUID(),details:{...emptyGatheringDetails(),date:'2030-11-10'},intake};
 const created=await service.createGathering(actor.id,input);
 const reread=await service.getGathering(created.gathering.id,actor.id);
 assert.equal(reread.own?.intake.public.keyword_notes?.drink,'咖啡：肯悦咖啡（林泉店）');
 assert.ok(reread.own?.blocks.some(b=>b.id==='drink_0'&&b.confirmed&&b.value==='咖啡：肯悦咖啡（林泉店）'));
 assert.deepEqual(reread.own?.intake.public.selected_places?.[0].venue.location,venue.location);
 assert.equal((await service.createGathering(actor.id,input)).gathering.id,created.gathering.id);
 console.log('PASS inspiration venue selection, category, confirmation, source and idempotent write survive real PostgreSQL round trip');
}finally{await db.$disconnect();}

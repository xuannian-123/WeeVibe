/** Narrow migration-16 verification in disposable local PostgreSQL. Synthetic saved profiles, no WeChat/model. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {emptyGatheringDetails,emptyGatheringIntake,gatheringAnimalIds,gatheringAvatarKeys,gatheringSnapshotSchema,type GatheringSnapshot} from '../packages/contracts/src';
assert.ok(process.argv.includes('--fixture-only'));
let target:URL;try{target=new URL(process.env.DATABASE_URL||'');}catch{throw Error('Explicit disposable database required');}
assert.ok(['postgres:','postgresql:'].includes(target.protocol));assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.match(decodeURIComponent(target.pathname.slice(1)),/^weevibe_acceptance_[a-z0-9_]+$/);assert.ok(!target.hash);
for(const[key,value]of target.searchParams)assert.ok(key==='schema'&&value==='public');
globalThis.fetch=async()=>{throw Error('External network disabled for presentation fixture');};
const load=createRequire(import.meta.url),{getDb}=load('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const service=load('../apps/web/src/server/gatherings/service.ts') as typeof import('../apps/web/src/server/gatherings/service');
const {gatheringModelSource}=load('../apps/web/src/server/gatherings/privacy.ts') as typeof import('../apps/web/src/server/gatherings/privacy');
const db=getDb(),output=resolve(import.meta.dirname,'../.working/html-replacement-20261028/pg'),checks:string[]=[];
let current='setup';
const valid=(value:GatheringSnapshot)=>gatheringSnapshotSchema.parse(value);
async function check(name:string,work:()=>Promise<void>){current=name;await work();checks.push(name);console.log(`PASS ${name}`);}
function intake(nickname:string){const value=emptyGatheringIntake();value.public.activity_nickname=nickname;value.public.note='公开节奏偏好';return value;}
async function actor(nickname:string){
  const user=await db.user.create({data:{}}),sharp=load('../apps/web/node_modules/sharp') as (value:unknown)=>{jpeg:()=>{toBuffer:()=>Promise<Buffer>}};
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#e1cdb3'}}).jpeg().toBuffer();
  await db.privateProfile.create({data:{userId:user.id,data:{nickname}}});await db.userAvatar.create({data:{userId:user.id,bytes:Uint8Array.from(bytes),contentType:'image/jpeg',digest:createHash('sha256').update(bytes).digest('hex')}});return {id:user.id,image:bytes.toString('base64')};
}
try{
  await mkdir(output,{recursive:true});const owner=await actor('PERSONAL_OWNER_NICK'),peer=await actor('PERSONAL_PEER_NICK');
  const details={...emptyGatheringDetails(),date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),title:'本次活动身份验收'};
  await check('migration sixteen constrains animal identities and empty activity nicknames cannot create a friend gathering',async()=>{
    const migrations=await db.$queryRaw<{migration_name:string}[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;assert.ok(migrations.length>=16);
    await assert.rejects(()=>service.createGathering(owner.id,{kind:'friend',idempotency_key:randomUUID(),details,intake:intake('  ')}),{code:'INVALID_INPUT'});
    assert.equal(await db.gathering.count({where:{ownerUserId:owner.id}}),0);assert.equal(await db.gatheringSubmissionEvent.count({where:{actorUserId:owner.id}}),0);
  });
  const created=valid(await service.createGathering(owner.id,{kind:'friend',idempotency_key:randomUUID(),details,intake:intake('本次局头别名')})),id=created.gathering.id;
  const ownerAnimal=created.gathering.owner.animal_id;assert.ok(ownerAnimal&&gatheringAnimalIds.includes(ownerAnimal));
  await check('create and repeated invitation reads expose only the activity alias and stable saved animal',async()=>{
    assert.equal(created.gathering.owner.nickname,'本次局头别名');assert.equal(created.gathering.owner.avatar,null);
    for(const actor of [owner,peer])for(let repeat=0;repeat<2;repeat++){
      const snapshot=valid(await service.getGathering(id,actor.id));assert.equal(snapshot.gathering.owner.animal_id,ownerAnimal);assert.equal(snapshot.gathering.owner.nickname,'本次局头别名');
      assert.ok(!JSON.stringify(snapshot).includes('PERSONAL_'));assert.ok(!JSON.stringify(snapshot).includes(owner.image));
    }
    const stored=await db.gatheringMember.findUniqueOrThrow({where:{gatheringId_userId:{gatheringId:id,userId:owner.id}}});assert.equal(stored.animalId,ownerAnimal);
  });
  await check('first save requires an activity nickname without partial joining and later alias edits never reassign the animal',async()=>{
    const blank={expected_revision:created.gathering.revision,expected_version:0,join_if_needed:true,idempotency_key:randomUUID(),intake:intake('')};
    await assert.rejects(()=>service.saveGatheringIntake(id,peer.id,blank),{code:'INVALID_INPUT'});assert.equal(await db.gatheringMember.count({where:{gatheringId:id,userId:peer.id}}),0);
    const joined=valid(await service.joinGathering(id,peer.id));const before=await db.gatheringMember.findUniqueOrThrow({where:{gatheringId_userId:{gatheringId:id,userId:peer.id}}});assert.ok(gatheringAnimalIds.includes(before.animalId as typeof gatheringAnimalIds[number]));
    await assert.rejects(()=>service.saveGatheringIntake(id,peer.id,{...blank,idempotency_key:randomUUID()}),{code:'INVALID_INPUT'});
    assert.equal((await service.getGathering(id,peer.id)).own?.version,0);
    const saved=valid(await service.saveGatheringIntake(id,peer.id,{...blank,idempotency_key:randomUUID(),intake:intake('这次的朋友别名')}));assert.equal(saved.own?.version,1);
    valid(await service.saveGatheringIntake(id,peer.id,{...blank,expected_version:1,idempotency_key:randomUUID(),intake:intake('修改后的活动别名')}));
    for(let repeat=0;repeat<2;repeat++){
      const snapshot=valid(await service.getGathering(id,owner.id)),person=snapshot.members!.find(row=>row.person.user_id===peer.id)!.person;
      assert.equal(person.nickname,'修改后的活动别名');assert.equal(person.animal_id,before.animalId);assert.equal(person.avatar,null);assert.ok(!JSON.stringify(snapshot).includes('PERSONAL_'));
    }
    assert.equal(joined.own?.version,0);const page=await service.getGatheringMembers(id,owner.id,undefined);assert.ok(page.members.every(row=>row.person.avatar===null&&!!row.person.animal_id));
    const rows=await db.$transaction(tx=>service.readGatheringRows(tx,id));const model=JSON.stringify(gatheringModelSource(details,rows));assert.ok(!/PERSONAL_|本次局头别名|修改后的活动别名|animal_id/.test(model));
    const where={gatheringId_userId:{gatheringId:id,userId:peer.id}};
    await assert.rejects(()=>db.gatheringMember.update({where,data:{animalId:'unapproved-animal'}}));assert.equal((await db.gatheringMember.findUniqueOrThrow({where})).animalId,before.animalId);
  });
  await check('legacy missing aliases use a placeholder without profile fallback and team also uses its activity alias',async()=>{
    const member=await db.gatheringMember.findUniqueOrThrow({where:{gatheringId_userId:{gatheringId:id,userId:peer.id}}});
    const legacy={...(member.publicIntake as Record<string,unknown>)};delete legacy.activity_nickname;
    await db.gatheringMember.update({where:{gatheringId_userId:{gatheringId:id,userId:peer.id}},data:{publicIntake:service.gatheringJson(legacy)}});
    const snapshot=valid(await service.getGathering(id,owner.id)),person=snapshot.members!.find(row=>row.person.user_id===peer.id)!.person;
    assert.equal(person.nickname,'还未设置活动昵称');assert.equal(person.animal_id,member.animalId);assert.equal(person.avatar,null);assert.ok(!JSON.stringify(snapshot).includes('PERSONAL_'));
    const team=valid(await service.createGathering(owner.id,{kind:'team',idempotency_key:randomUUID(),details:{...details,deadline_at:new Date(Date.now()+86400000).toISOString()},intake:intake('团建活动昵称')}));
    assert.equal(team.gathering.owner.nickname,'团建活动昵称');assert.equal(team.gathering.owner.avatar,null);
  });
  await check('504-key pool remains unique under concurrent joins at the real 500-member limit',async()=>{
    const created=valid(await service.createGathering(owner.id,{kind:'friend',idempotency_key:randomUUID(),details,intake:intake('头像容量验收')})),group=created.gathering.id;
    const ownerKey=created.gathering.owner.avatar_key!;assert.ok(gatheringAvatarKeys.includes(ownerKey));
    const keys=gatheringAvatarKeys.filter(key=>key!==ownerKey),users=Array.from({length:500},()=>({id:randomUUID()}));
    await db.user.createMany({data:users});
    const blank=emptyGatheringIntake();
    await db.gatheringMember.createMany({data:users.slice(0,497).map((user,index)=>({gatheringId:group,userId:user.id,avatarKey:keys[index],publicIntake:service.gatheringJson(blank.public),privateIntake:service.gatheringJson(blank.private),answers:[]}))});
    await Promise.all(users.slice(497,499).map(user=>service.joinGathering(group,user.id)));
    const rows=await db.gatheringMember.findMany({where:{gatheringId:group},select:{userId:true,avatarKey:true}});
    assert.equal(rows.length,500);assert.equal(new Set(rows.map(row=>row.avatarKey)).size,500);assert.ok(rows.every(row=>row.avatarKey&&gatheringAvatarKeys.includes(row.avatarKey)));
    await assert.rejects(()=>service.joinGathering(group,users[499].id),{code:'CAPACITY_FULL'});
    const last=users[498].id,key=rows.find(row=>row.userId===last)!.avatarKey;
    await service.joinGathering(group,last);assert.equal((await db.gatheringMember.findUniqueOrThrow({where:{gatheringId_userId:{gatheringId:group,userId:last}}})).avatarKey,key);
    await assert.rejects(()=>db.gatheringMember.update({where:{gatheringId_userId:{gatheringId:group,userId:last}},data:{avatarKey:ownerKey}}),{code:'P2002'});
    await assert.rejects(()=>db.gatheringMember.update({where:{gatheringId_userId:{gatheringId:group,userId:last}},data:{avatarKey:'art-cat-24'}}));
  });
  await writeFile(resolve(output,'presentation-result.json'),JSON.stringify({passed:true,fixture_groups:checks.length,checks,migrations_applied:17,source:'real_disposable_postgresql_activity_alias_animal_projection',external_fetch_disabled:true,wechat_exchange:false,shared_environment_touched:false},null,2));console.log(`Presentation PostgreSQL groups passed: ${checks.length}`);
}catch(error){const safe={passed:false,current_check:current,error_type:error instanceof Error?error.name:typeof error,code:error&&typeof error==='object'&&'code'in error?String(error.code):null,raw_response_withheld:true};await mkdir(output,{recursive:true});await writeFile(resolve(output,'presentation-result.json'),JSON.stringify(safe,null,2));await writeFile(resolve(output,'presentation-error.private.log'),error instanceof Error?error.stack||error.message:String(error));console.error(JSON.stringify(safe));process.exitCode=1;}finally{await db.$disconnect();}

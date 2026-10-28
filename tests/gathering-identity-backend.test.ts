import {createHash,randomUUID} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Tx} from '../apps/web/src/server/activities/state';
const h=vi.hoisted(()=>({tx:null as Tx|null}));
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(action:(tx:Tx)=>unknown)=>action(h.tx!)}));
vi.mock('../apps/web/src/server/db',()=>({withDb:async(action:(db:unknown)=>unknown)=>action({$transaction:(fn:(tx:Tx)=>unknown)=>fn(h.tx!)})}));
vi.mock('../apps/web/src/server/requirements/service',async()=>{const actual=await vi.importActual<typeof import('../apps/web/src/server/requirements/service')>('../apps/web/src/server/requirements/service');return{...actual,consumeRequirementBudget:async()=>{}};});
import {gatheringAnimalIds,gatheringSnapshotSchema,gatheringMembersPageSchema,gatheringPublicBlocks,emptyGatheringIntake} from '../packages/contracts/src';
import {createGathering,gatheringSnapshotTx,getGatheringMembers,saveGatheringIntake,readGatheringRows} from '../apps/web/src/server/gatherings/service';
import {gatheringModelSource} from '../apps/web/src/server/gatherings/privacy';
import {gatheringBackendFixture,gatheringFixtureDetails,gatheringFixtureIntake,gatheringId as id,gatheringOwner as owner,gatheringAlice as alice,gatheringBob as bob} from './gathering-backend-fixture';
let f:ReturnType<typeof gatheringBackendFixture>;
const createInput=()=>({kind:'friend',idempotency_key:randomUUID(),details:gatheringFixtureDetails(),intake:gatheringFixtureIntake()});
const saveInput=(version=1)=>({expected_version:version,expected_revision:1,idempotency_key:randomUUID(),intake:gatheringFixtureIntake()});
beforeEach(()=>{f=gatheringBackendFixture();h.tx=f.tx;});

describe('activity identity stays separate from personal profile and AI preferences',()=>{
  it('requires a nonempty bounded friend alias for each new create or save and rejects client-selected animals',async()=>{
    for(const nickname of ['', '   ', '名'.repeat(33)]){
      const created=createInput();created.intake.public.activity_nickname=nickname;
      await expect(createGathering(owner,created)).rejects.toMatchObject({code:'INVALID_INPUT'});
      const save=saveInput();save.intake.public.activity_nickname=nickname;
      await expect(saveGatheringIntake(id,alice,save)).rejects.toMatchObject({code:'INVALID_INPUT'});
    }
    const forged=saveInput();(forged.intake.public as unknown as Record<string,unknown>).animal_id='lion';
    await expect(saveGatheringIntake(id,alice,forged)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.events.size).toBe(0);expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();expect(f.raw.gathering.create).not.toHaveBeenCalled();
  });
  it('persists a server-selected animal once, trims the alias and keeps the animal across refreshes and alias changes',async()=>{
    const input=createInput();input.intake.public.activity_nickname='  这次的昵称  ';
    const created=await createGathering(owner,input),animal=created.gathering.owner.animal_id;
    expect(gatheringAnimalIds).toContain(animal);expect(created.gathering.owner).toMatchObject({nickname:'这次的昵称',avatar:null});
    const group=created.gathering.id,stored=f.members.get(`${group}:${owner}`)!;expect(stored.animalId).toBe(animal);
    expect((await gatheringSnapshotTx(f.tx,group,owner)).gathering.owner.animal_id).toBe(animal);
    expect((await createGathering(owner,input)).gathering.owner.animal_id).toBe(animal);
    const next=saveInput();next.intake.public.activity_nickname='更新后的活动昵称';
    const edited=await saveGatheringIntake(group,owner,next);expect(edited.gathering.owner).toMatchObject({nickname:'更新后的活动昵称',animal_id:animal,avatar:null});expect(f.members.get(`${group}:${owner}`)!.animalId).toBe(animal);
    expect(gatheringSnapshotSchema.safeParse(edited).success).toBe(true);
  });
  it('never queries or falls back to real profiles or avatars in friend snapshots and member pagination',async()=>{
    const ownerInput=gatheringFixtureIntake();ownerInput.public.activity_nickname='本次局头';f.seed(owner,ownerInput);
    const memberInput=gatheringFixtureIntake();memberInput.public.activity_nickname='本次成员';f.seed(alice,memberInput);
    f.raw.privateProfile.findMany.mockImplementation(async()=>{throw Error('real profile query forbidden in friends');});
    f.raw.userAvatar.findMany.mockImplementation(async()=>{throw Error('real avatar query forbidden in friends');});
    const view=await gatheringSnapshotTx(f.tx,id,owner),page=await getGatheringMembers(id,owner,undefined);
    expect(view.gathering.owner.nickname).toBe('本次局头');expect(page.members.map(member=>member.person.nickname)).toEqual(['本次局头','本次成员']);
    expect([view.gathering.owner,...view.members!.map(member=>member.person),...page.members.map(member=>member.person)].every(person=>person.avatar===null&&gatheringAnimalIds.includes(person.animal_id!))).toBe(true);
    expect(f.raw.privateProfile.findMany).not.toHaveBeenCalled();expect(f.raw.userAvatar.findMany).not.toHaveBeenCalled();
    const invalid={...view,gathering:{...view.gathering,owner:{...view.gathering.owner,animal_id:undefined}}};expect(gatheringSnapshotSchema.safeParse(invalid).success).toBe(false);
    expect(gatheringMembersPageSchema.safeParse(page).success).toBe(true);const invalidPage={...page,members:page.members.map((member,index)=>index===0?{...member,person:{...member.person,animal_id:undefined}}:member)};expect(gatheringMembersPageSchema.safeParse(invalidPage).success).toBe(false);
  });
  it('reads old missing aliases as an explicit placeholder and never backfills from real nickname',async()=>{
    const old=gatheringFixtureIntake();delete (old.public as unknown as Record<string,unknown>).activity_nickname;
    f.seed(owner,old);f.seed(alice,old);
    const view=await gatheringSnapshotTx(f.tx,id,owner);expect(view.gathering.owner.nickname).toBe('还未设置活动昵称');expect(view.members!.every(member=>member.person.nickname==='还未设置活动昵称')).toBe(true);
    expect(view.own!.intake.public.activity_nickname).toBe('');expect(f.raw.privateProfile.findMany).not.toHaveBeenCalled();
  });
  it('does not turn alias or animal into preference blocks or model input',async()=>{
    const input=gatheringFixtureIntake();input.public.activity_nickname='ACTIVITY_ALIAS_DO_NOT_SEND';f.seed(alice,input);f.members.get(`${id}:${alice}`)!.animalId='capybara';
    expect(JSON.stringify(gatheringPublicBlocks(input.public))).not.toContain('ACTIVITY_ALIAS_DO_NOT_SEND');
    const source=JSON.stringify(gatheringModelSource(f.details(),await readGatheringRows(f.tx,id)));
    expect(source).not.toMatch(/ACTIVITY_ALIAS_DO_NOT_SEND|activity_nickname|animalId|animal_id|capybara/);expect(source).toContain('一起吃饭');
  });
  it('keeps team organizer identity based on their real saved profile rather than the unused activity alias',async()=>{
    f=gatheringBackendFixture('team');h.tx=f.tx;
    const input=emptyGatheringIntake();input.public.activity_nickname='不能代替真实团建资料';f.seed(owner,input,0);
    const bytes=Buffer.from([0xff,0xd8,0xff,0xd9]);
    f.raw.userAvatar.findMany.mockResolvedValue([{userId:owner,bytes,contentType:'image/jpeg',digest:createHash('sha256').update(bytes).digest('hex'),updatedAt:new Date()}] as never);
    const view=await gatheringSnapshotTx(f.tx,id,bob);expect(view.gathering.owner.nickname).toBe('局头');expect(view.gathering.owner.animal_id).toBeUndefined();expect(view.gathering.owner.avatar?.content_type).toBe('image/jpeg');
  });
  it('acknowledges legacy successful requests with missing alias using the original hash without new writes',async()=>{
    const old=saveInput();delete (old.intake.public as unknown as Record<string,unknown>).activity_nickname;
    const stored=f.members.get(`${id}:${alice}`)!;stored.lastWriteKey=old.idempotency_key;stored.lastWriteHash=createHash('sha256').update(JSON.stringify(old)).digest('hex');stored.responseVersion=2;
    expect((await saveGatheringIntake(id,alice,old)).own?.version).toBe(2);expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();expect(f.events.size).toBe(0);
    const created=createInput();delete(created.intake.public as unknown as Record<string,unknown>).activity_nickname;
    const row=f.gatherings.get(id)!;row.creationKey=created.idempotency_key;row.creationHash=createHash('sha256').update(JSON.stringify(created)).digest('hex');
    expect((await createGathering(owner,created)).gathering.id).toBe(id);expect(f.raw.gathering.create).not.toHaveBeenCalled();
  });
});

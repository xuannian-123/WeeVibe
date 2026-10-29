import {randomUUID} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {gatheringAvatarKeys,gatheringAvatarParts,gatheringAvatarKeySchema} from '../packages/contracts/src';
import type {Tx} from '../apps/web/src/server/activities/state';
const h=vi.hoisted(()=>({tx:null as Tx|null}));
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(fn:(tx:Tx)=>unknown)=>fn(h.tx!)}));
vi.mock('../apps/web/src/server/db',()=>({withDb:async(fn:(db:unknown)=>unknown)=>fn({$transaction:(task:(tx:Tx)=>unknown)=>task(h.tx!)})}));
vi.mock('../apps/web/src/server/requirements/service',()=>({consumeRequirementBudget:async()=>{}}));
import {allocateGatheringAvatar} from '../apps/web/src/server/gatherings/avatars';
import {joinGathering,saveGatheringIntake,gatheringSnapshotTx} from '../apps/web/src/server/gatherings/service';
import {gatheringBackendFixture,gatheringFixtureIntake,gatheringId as id,gatheringBob as bob,gatheringOwner as owner} from './gathering-backend-fixture';
let f:ReturnType<typeof gatheringBackendFixture>;
beforeEach(()=>{f=gatheringBackendFixture();h.tx=f.tx;});
describe('user supplied activity avatar pool',()=>{
  it('covers the 500-member limit with 504 unique valid keys and distinct backgrounds per animal',()=>{
    expect(gatheringAvatarKeys).toHaveLength(504);expect(new Set(gatheringAvatarKeys).size).toBe(504);
    for(const key of gatheringAvatarKeys){expect(gatheringAvatarKeySchema.safeParse(key).success).toBe(true);expect(gatheringAvatarParts(key)).not.toBeNull();}
    expect(new Set(gatheringAvatarKeys.filter(key=>key.startsWith('art-panda-')).map(key=>gatheringAvatarParts(key)!.background)).size).toBe(24);
    expect(gatheringAvatarKeySchema.safeParse('art-cat-24').success).toBe(false);expect(gatheringAvatarKeySchema.safeParse('https://private.test/avatar').success).toBe(false);
  });
  it('allocates without replacement across the complete pool and never recycles an assigned key on exhaustion',async()=>{
    const used=new Set<string>();
    for(let index=0;index<504;index++){const key=await allocateGatheringAvatar(f.tx,id);expect(used.has(key)).toBe(false);used.add(key);const row=f.seed(randomUUID());row.avatarKey=key;}
    await expect(allocateGatheringAvatar(f.tx,id)).rejects.toMatchObject({code:'CAPACITY_FULL'});
    expect(f.raw.gatheringMember.findMany.mock.calls.every(([args])=>JSON.stringify(args.select)==='{"avatarKey":true}')).toBe(true);
  });
  it('persists one server assignment through joins, refreshes, nickname edits and idempotent saves',async()=>{
    const joined=await joinGathering(id,bob),key=joined.own&&f.members.get(`${id}:${bob}`)!.avatarKey;
    expect(gatheringAvatarKeys).toContain(key);
    await joinGathering(id,bob);expect(f.members.get(`${id}:${bob}`)!.avatarKey).toBe(key);
    const intake=gatheringFixtureIntake();intake.public.activity_nickname='本次昵称';intake.private.budget_note='PRIVATE_BUDGET';intake.private.origin={label:'PRIVATE_ORIGIN'};
    const request={expected_version:0,expected_revision:1,idempotency_key:randomUUID(),intake};await saveGatheringIntake(id,bob,request);await saveGatheringIntake(id,bob,request);
    const view=await gatheringSnapshotTx(f.tx,id,owner),person=view.members!.find(row=>row.person.user_id===bob)!;
    expect(person.person).toMatchObject({nickname:'本次昵称',avatar:null,avatar_key:key});expect(JSON.stringify(person)).not.toMatch(/PRIVATE_|budget|origin/);
    expect(f.raw.privateProfile.findMany).not.toHaveBeenCalled();expect(f.raw.userAvatar.findMany).not.toHaveBeenCalled();
  });
  it('keeps blank private constraints absent and preserves an explicit zero without publishing either',async()=>{const intake=gatheringFixtureIntake();intake.private.budget_min=0;await saveGatheringIntake(id,bob,{join_if_needed:true,expected_version:0,expected_revision:1,idempotency_key:randomUUID(),intake});const own=await gatheringSnapshotTx(f.tx,id,bob);expect(own.own!.intake.private).toMatchObject({origin:null,budget_min:0,budget_max:null,budget_note:''});expect(own.own!.blocks.find(block=>block.id==='budget')?.value).toContain('最低 0 元');const shared=(await gatheringSnapshotTx(f.tx,id,owner)).members!.find(row=>row.person.user_id===bob)!;expect(shared.blocks.some(block=>block.id==='budget'||block.id==='origin')).toBe(false);});
  it('does not accept client-picked avatar identities or account photos in answers',async()=>{
    const intake=gatheringFixtureIntake();(intake.public as unknown as Record<string,unknown>).avatar_key='art-panda-00';
    await expect(saveGatheringIntake(id,bob,{join_if_needed:true,expected_version:0,expected_revision:1,idempotency_key:randomUUID(),intake})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.members.has(`${id}:${bob}`)).toBe(false);
  });
});

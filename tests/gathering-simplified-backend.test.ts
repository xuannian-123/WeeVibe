import {randomUUID} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Tx} from '../apps/web/src/server/activities/state';
import {emptyGatheringDetails,gatheringCreateSchema,type GatheringIntake,type GatheringWorkflowState} from '../packages/contracts/src';
const h=vi.hoisted(()=>({tx:undefined as Tx|undefined,budget:vi.fn()}));
vi.mock('../apps/web/src/server/db',()=>({withDb:async(action:(db:unknown)=>unknown)=>action({$transaction:(fn:(tx:Tx)=>unknown)=>fn(h.tx!)})}));
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(action:(tx:Tx)=>unknown)=>action(h.tx!)}));
vi.mock('../apps/web/src/server/requirements/service',()=>({consumeRequirementBudget:h.budget}));
import {createGathering,gatheringSnapshotTx,saveGatheringIntake,updateGatheringDetails} from '../apps/web/src/server/gatherings/service';
import {generateGatheringItinerary} from '../apps/web/src/server/gatherings/generation';
import {commandGatheringWorkflow} from '../apps/web/src/server/gatherings/workflow';
import {friendDetailsFromIntake,friendIntakeFromDraft} from '../apps/miniprogram/src/features/gatherings/friend-draft';
import {gatheringBackendFixture,gatheringFixtureIntake,gatheringFixturePlan,gatheringOwner as owner,gatheringAlice as alice,gatheringBob as visitor} from './gathering-backend-fixture';

// Real service functions with an explicit transaction double; no database or provider calls.
let f:ReturnType<typeof gatheringBackendFixture>;
let workflows:Map<string,{version:number;state:GatheringWorkflowState}>,commands:Map<string,{hash:string}>;
beforeEach(()=>{
  f=gatheringBackendFixture();f.gatherings.clear();f.members.clear();h.tx=f.tx;h.budget.mockReset().mockResolvedValue(undefined);workflows=new Map();commands=new Map();
  Object.assign(f.raw,{
    gatheringWorkflow:{
      findUnique:async({where}:any)=>workflows.get(where.gatheringId)??null,
      upsert:async({where,create,update}:any)=>{const previous=workflows.get(where.gatheringId);const next=previous?{version:previous.version+1,state:structuredClone(update.state)}:{version:1,state:structuredClone(create.state)};workflows.set(where.gatheringId,next);return next;},
      update:async({where,data}:any)=>{const previous=workflows.get(where.gatheringId)!;const next={version:previous.version+1,state:structuredClone(data.state)};workflows.set(where.gatheringId,next);return next;},
    },
    gatheringWorkflowCommand:{
      findUnique:async({where}:any)=>{const key=where.gatheringId_actorId_key;return commands.get(`${key.gatheringId}:${key.actorId}:${key.key}`)??null;},
      create:async({data}:any)=>{commands.set(`${data.gatheringId}:${data.actorId}:${data.key}`,data);return data;},
    },
  });
});
const inputFor=(confirmed=false)=>{
  const intake=gatheringFixtureIntake();intake.public.activity_nickname='局头小林';intake.public.confirmed_keys=confirmed?['date']:[];
  intake.private.budget_note='OWNER_PRIVATE_BUDGET';intake.private.origin={label:'OWNER_PRIVATE_ORIGIN'};
  return {kind:'friend' as const,idempotency_key:randomUUID(),details:{...emptyGatheringDetails(),date:intake.public.date,confirmed_details:confirmed?['date' as const]:[]},intake};
};
const saveInput=(intake:GatheringIntake)=>({join_if_needed:true,expected_revision:1,expected_version:0,idempotency_key:randomUUID(),intake});
const generationInput=(source:string)=>({expected_source:source,idempotency_key:randomUUID()});

describe('simplified friend creation retains existing backend boundaries',()=>{
  it.each([false,true])('creates using only preferences and date without inventing optional details (date confirmed=%s)',async confirmed=>{
    const input=inputFor(confirmed),result=await createGathering(owner,input);
    expect(result.gathering.title).toBe('朋友出游');expect(result.gathering.date).toBe(input.intake.public.date);
    expect(result.gathering.details).toEqual(input.details);expect(result.gathering.details).toMatchObject({title:'',start_time:'',end_time:'',end_date:'',place:'',address:'',minimum:null,capacity:null,fee:{kind:'unknown',amount:null,note:''},questions:[],candidate_places:[],deadline_at:null});
    expect(result.gathering.details.confirmed_details).toEqual(confirmed?['date']:[]);expect(result.own?.intake.private.budget_note).toBe('OWNER_PRIVATE_BUDGET');expect(result.workflow).toBeUndefined();expect(result.final_choice).toBeNull();
    expect(f.gatherings.get(result.gathering.id)!.details).toEqual(input.details);
  });
  it('runs the unchanged two-person generation, coordination and explicit finalization flow with empty optional details',async()=>{
    const input=inputFor(),created=await createGathering(owner,input),id=created.gathering.id;
    const peer=gatheringFixtureIntake('想轻松聊聊天');peer.public.activity_nickname='朋友小夏';peer.private.budget_note='PEER_PRIVATE_BUDGET';
    await saveGatheringIntake(id,alice,saveInput(peer));
    const source=await gatheringSnapshotTx(f.tx,id,owner),provider={generate:vi.fn(async()=>gatheringFixturePlan())};
    const generated=await generateGatheringItinerary(id,owner,generationInput(source.source_fingerprint!),provider),generation=generated.itinerary!.generation_id;
    expect(generated.workflow).toMatchObject({phase:'selecting',total:2,selected_count:0});
    const providerSource=provider.generate.mock.calls[0] as unknown as [string,unknown];
    expect(providerSource[0]).toBe(owner);expect(JSON.stringify(providerSource[1])).not.toMatch(/OWNER_PRIVATE|PEER_PRIVATE|budget|origin/);
    expect(providerSource[1]).toMatchObject({date:input.intake.public.date,title:'',start_time:'',end_time:'',place:'',address:''});
    const select=(actor:string)=>commandGatheringWorkflow(id,actor,{action:'select',expected_version:0,plan_ids:['plan1'],note:'',generation_id:generation,idempotency_key:randomUUID()});
    await select(owner);const chosen=await select(alice);
    const proposed=await commandGatheringWorkflow(id,owner,{action:'propose',expected_version:chosen.workflow!.version,plan_id:'plan1',note:'',generation_id:generation,idempotency_key:randomUUID()});
    const accept=(actor:string)=>commandGatheringWorkflow(id,actor,{action:'respond',expected_version:0,proposal_version:proposed.workflow!.proposal_version,decision:'accept',note:'',generation_id:generation,idempotency_key:randomUUID()});
    expect((await accept(owner)).final_choice).toBeNull();const completed=await accept(alice);
    expect(completed.workflow).toMatchObject({phase:'completed',accepted_count:2,total:2});expect(completed.final_choice).toMatchObject({generation_id:generation,plan_id:'plan1'});
    expect(completed.viewer.can_respond).toBe(false);expect(completed.gathering.details).toEqual(input.details);
    const shared=await gatheringSnapshotTx(f.tx,id,visitor);expect(shared).toMatchObject({own:null,members:null,viewer:{is_member:false,can_respond:false,can_generate:false},workflow:{phase:'completed',people:[]}});
    expect(shared.workflow?.final_plan?.id).toBe('plan1');expect(JSON.stringify(shared)).not.toMatch(/OWNER_PRIVATE|PEER_PRIVATE/);
  });
  it('keeps the default friend system limit at 50 even when no optional capacity was supplied',async()=>{
    const created=await createGathering(owner,inputFor()),id=created.gathering.id;
    for(let i=1;i<50;i++)f.seed(randomUUID(),gatheringFixtureIntake(),1,id);
    await expect(saveGatheringIntake(id,visitor,saveInput(gatheringFixtureIntake()))).rejects.toMatchObject({code:'CAPACITY_FULL'});
    expect(f.members.size).toBe(50);expect(f.members.has(`${id}:${visitor}`)).toBe(false);expect(f.gatherings.get(id)!.details).toMatchObject({capacity:null});
  });
  it('replays a legacy create request with its exact original key and body instead of rewriting optional data',async()=>{
    const input=inputFor();input.details={...input.details,title:'已有安排的旧草稿',start_time:'13:00',place:'文星广场',capacity:5,fee:{kind:'per_person',amount:80,note:'发起人提供的参考费用'}};
    const created=await createGathering(owner,input),replayed=await createGathering(owner,structuredClone(input));
    expect(replayed.gathering.id).toBe(created.gathering.id);expect(replayed.gathering.details).toEqual(input.details);
    await expect(createGathering(owner,{...input,details:{...emptyGatheringDetails(),date:input.intake.public.date}})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(f.raw.gathering.create).toHaveBeenCalledTimes(1);
  });
  it('treats legacy details retries as revision conflicts and keeps the original saved body intact',async()=>{
    const created=await createGathering(owner,inputFor()),id=created.gathering.id;
    const update={expected_revision:1,details:{...created.gathering.details,start_time:'13:00',capacity:5}};
    const saved=await updateGatheringDetails(id,owner,update);expect(saved.gathering.revision).toBe(2);
    await expect(updateGatheringDetails(id,owner,structuredClone(update))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    expect(f.gatherings.get(id)!.details).toEqual(update.details);expect(f.raw.gathering.update).toHaveBeenCalledTimes(1);
  });
  it('retains legacy source constraints and rejects commands based on their previous fingerprint',async()=>{
    const created=await createGathering(owner,inputFor()),id=created.gathering.id,provider={generate:vi.fn(async()=>gatheringFixturePlan())};
    const generated=await generateGatheringItinerary(id,owner,generationInput(created.source_fingerprint!),provider);
    const updated=await updateGatheringDetails(id,owner,{expected_revision:1,details:{...created.gathering.details,start_time:'13:00',place:'文星广场'}});
    expect(updated.workflow?.stale).toBe(true);expect(updated.gathering.details).toMatchObject({start_time:'13:00',place:'文星广场'});
    await expect(commandGatheringWorkflow(id,owner,{action:'select',expected_version:0,plan_ids:['plan1'],note:'',generation_id:generated.itinerary!.generation_id,idempotency_key:randomUUID()})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    await expect(generateGatheringItinerary(id,owner,generationInput(created.source_fingerprint!),provider)).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it('does not apply the simplified friend defaults to team creation requirements',async()=>{
    await expect(createGathering(owner,{...inputFor(),kind:'team'})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.raw.gathering.create).not.toHaveBeenCalled();expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();
  });
});


describe('retired friend questionnaire data is omitted only from fresh creation',()=>{
  const legacyQuestion={id:'old_choice',title:'旧附加问题',type:'single' as const,required:false,options:[{id:'old_option',label:'轻松散步'}]};
  const legacyAnswer={question_id:'old_choice',option_ids:['old_option'],other:'',text:''};
  it('removes hidden old answers with the fresh-only helper so default empty questions can be created',async()=>{
    const originalIntake=inputFor(true).intake;originalIntake.answers=[legacyAnswer];
    // The old answer is invalid with newly empty question definitions; it cannot be silently forwarded.
    await expect(createGathering(owner,{kind:'friend',idempotency_key:randomUUID(),details:friendDetailsFromIntake(originalIntake),intake:originalIntake})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.raw.gathering.create).not.toHaveBeenCalled();
    const intake=friendIntakeFromDraft(originalIntake),details=friendDetailsFromIntake(intake);
    expect(intake.answers).toEqual([]);expect(originalIntake.answers).toEqual([legacyAnswer]);expect(intake.private).toEqual(originalIntake.private);expect(details.questions).toEqual([]);
    const result=await createGathering(owner,{kind:'friend',idempotency_key:randomUUID(),details,intake});
    expect(result.own?.intake.answers).toEqual([]);expect(result.own?.intake.private.budget_note).toBe('OWNER_PRIVATE_BUDGET');expect(result.gathering.details.questions).toEqual([]);expect(result.gathering.details.confirmed_details).toEqual(['date']);
    expect(f.raw.gathering.create).toHaveBeenCalledTimes(1);
  });
  it('replays an old pending creation with original question definitions, answers and nonce intact',async()=>{
    const original=inputFor();original.details={...original.details,title:'旧请求中的问卷',questions:[legacyQuestion]};original.intake.answers=[legacyAnswer];
    const created=await createGathering(owner,original),restored=gatheringCreateSchema.parse(structuredClone(original));
    expect(restored).toEqual(original);expect(restored.idempotency_key).toBe(original.idempotency_key);
    const replay=await createGathering(owner,restored);expect(replay.gathering.id).toBe(created.gathering.id);expect(replay.own?.intake.answers).toEqual([legacyAnswer]);expect(replay.gathering.details.questions).toEqual([legacyQuestion]);
    const newIntake=friendIntakeFromDraft(original.intake);
    await expect(createGathering(owner,{...original,details:friendDetailsFromIntake(newIntake),intake:newIntake})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(f.raw.gathering.create).toHaveBeenCalledTimes(1);
  });
});

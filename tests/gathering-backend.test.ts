import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Tx} from '../apps/web/src/server/activities/state';
import {gatheringSnapshotSchema} from '../packages/contracts/src';
const h=vi.hoisted(()=>({tx:undefined as Tx|undefined,budget:vi.fn()}));
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(action:(tx:Tx)=>unknown)=>action(h.tx!)}));
vi.mock('../apps/web/src/server/db',()=>({withDb:async(action:(db:unknown)=>unknown)=>action({$transaction:(fn:(tx:Tx)=>unknown)=>fn(h.tx!)})}));
vi.mock('../apps/web/src/server/requirements/service',async()=>{const actual=await vi.importActual<typeof import('../apps/web/src/server/requirements/service')>('../apps/web/src/server/requirements/service');return{...actual,consumeRequirementBudget:h.budget};});
import {createGathering,getGatheringMembers,gatheringSnapshotTx,joinGathering,readGatheringRows,saveGatheringIntake,updateGatheringDetails,finalizeGathering} from '../apps/web/src/server/gatherings/service';
import {generateGatheringItinerary} from '../apps/web/src/server/gatherings/generation';
import {gatheringSourceFingerprint} from '../apps/web/src/server/gatherings/privacy';
import {gatheringBackendFixture,gatheringFixtureDetails,gatheringFixtureIntake,gatheringFixturePlan,gatheringOwner as owner,gatheringAlice as alice,gatheringBob as bob,gatheringId as id} from './gathering-backend-fixture';

let f:ReturnType<typeof gatheringBackendFixture>;
beforeEach(()=>{f=gatheringBackendFixture();h.tx=f.tx;h.budget.mockReset().mockResolvedValue(undefined);});
afterEach(()=>vi.useRealTimers());
const save=(version=1,revision=1)=>({expected_version:version,expected_revision:revision,idempotency_key:randomUUID(),intake:gatheringFixtureIntake('新的公开想法')});
const generationInput=async()=>({expected_source:gatheringSourceFingerprint(f.details(),await readGatheringRows(f.tx,id)),idempotency_key:randomUUID()});
describe('gathering server projections and access',()=>{
  it('shares friend identities and public blocks but returns private fields only to their actor',async()=>{
    const privateAnswer=gatheringFixtureIntake('想一起唱歌');privateAnswer.private.budget_max=987;privateAnswer.private.budget_note='ALICE_PRIVATE_BUDGET';privateAnswer.private.origin={label:'ALICE_PRIVATE_HOME'};f.seed(alice,privateAnswer);
    const ownerView=await gatheringSnapshotTx(f.tx,id,owner);expect(ownerView.members?.map(m=>m.person.nickname)).toEqual(['出游伙伴','出游伙伴']);expect(ownerView.members?.every(m=>m.person.animal_id==='cat'&&m.person.avatar===null)).toBe(true);expect(JSON.stringify(ownerView)).not.toMatch(/ALICE_PRIVATE|PRIVATE_PROFILE/);expect(ownerView.own?.intake.private.budget_max).toBeNull();
    const aliceView=await gatheringSnapshotTx(f.tx,id,alice);expect(aliceView.own?.intake.private.budget_note).toBe('ALICE_PRIVATE_BUDGET');expect(aliceView.source_fingerprint).toBeNull();expect(gatheringSnapshotSchema.safeParse(aliceView).success).toBe(true);
    const publicQuery=f.raw.gatheringMember.findMany.mock.calls[0][0];expect(publicQuery.select).not.toHaveProperty('privateIntake');
    expect(f.raw.gatheringMember.findUnique.mock.calls.every(([arg])=>[owner,alice].includes(arg.where.gatheringId_userId.userId))).toBe(true);
  });
  it('gives an invitation visitor no member content, private response, generated plans or statistics without joining',async()=>{const view=await gatheringSnapshotTx(f.tx,id,bob);expect(view).toMatchObject({own:null,members:null,stats:null,itinerary:null,final_choice:null,source_fingerprint:null,viewer:{is_member:false,can_respond:true}});expect(JSON.stringify(view)).not.toContain('想一起唱歌');expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();});
  it('returns team statistics only to the owner and redacts unconfirmed owner information from participants',async()=>{
    f=gatheringBackendFixture('team');h.tx=f.tx;const d=f.details();d.place='UNCONFIRMED_PLACE';d.questions=[{id:'q1',title:'吃什么',type:'single',required:false,options:[{id:'hotpot',label:'火锅'}]}];f.gatherings.get(id)!.details=d as never;
    const own=gatheringFixtureIntake();own.answers=[{question_id:'q1',option_ids:['hotpot'],other:'',text:''}];f.seed(alice,own);
    const manager=await gatheringSnapshotTx(f.tx,id,owner);expect(manager.stats?.questions[0].options[0].count).toBe(1);expect(manager.members).toBeNull();
    const participant=await gatheringSnapshotTx(f.tx,id,alice);expect(participant.stats).toBeNull();expect(participant.members).toBeNull();expect(JSON.stringify(participant)).not.toContain('UNCONFIRMED_PLACE');
  });
  it('paginates all public friend members without retrieving their private row',async()=>{
    for(let i=10;i<22;i++)f.seed(`99999999-9999-4999-8999-${String(i).padStart(12,'0')}`);
    const first=await gatheringSnapshotTx(f.tx,id,owner),second=await getGatheringMembers(id,owner,first.next_member_cursor!);
    expect(first.members).toHaveLength(10);expect(second.members).toHaveLength(4);expect(new Set([...first.members!,...second.members].map(m=>m.person.user_id)).size).toBe(14);
    expect(f.raw.gatheringMember.findMany.mock.calls.every(([arg])=>!arg.select.privateIntake)).toBe(true);
  });
  it.each(['visitor','team'])('rejects the member-list endpoint for %s',async mode=>{if(mode==='team'){f=gatheringBackendFixture('team');h.tx=f.tx;}await expect(getGatheringMembers(id,mode==='visitor'?bob:owner,undefined)).rejects.toMatchObject({code:'FORBIDDEN'});});
});
describe('gathering creation and response boundaries',()=>{
  it.each(['nickname','date'] as const)('rejects missing %s before creating any friend gathering or member',async missing=>{
    f.gatherings.clear();f.members.clear();const input={kind:'friend',idempotency_key:randomUUID(),details:gatheringFixtureDetails(),intake:gatheringFixtureIntake()};
    if(missing==='nickname')input.intake.public.activity_nickname='';else input.details.date='';
    await expect(createGathering(owner,input)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(f.raw.gathering.create).not.toHaveBeenCalled();expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();
  });
  it('creates once with the original owner key and rejects changed payload reuse',async()=>{
    f.gatherings.clear();f.members.clear();const input={kind:'friend',idempotency_key:randomUUID(),details:gatheringFixtureDetails(),intake:gatheringFixtureIntake()};
    const created=await createGathering(owner,input),replay=await createGathering(owner,input);expect(replay.gathering.id).toBe(created.gathering.id);expect(f.raw.gathering.create).toHaveBeenCalledTimes(1);
    await expect(createGathering(owner,{...input,details:{...input.details,title:'不同内容'}})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('does not accept a forged actor field in create or save bodies',async()=>{await expect(createGathering(owner,{kind:'friend',ownerUserId:bob,idempotency_key:randomUUID(),details:gatheringFixtureDetails(),intake:gatheringFixtureIntake()})).rejects.toMatchObject({code:'INVALID_INPUT'});await expect(saveGatheringIntake(id,alice,{...save(),user_id:bob})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();});
  it('requires membership and the original own-answer and questionnaire versions before saving',async()=>{
    await expect(saveGatheringIntake(id,bob,save())).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(saveGatheringIntake(id,alice,save(0))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    await expect(saveGatheringIntake(id,alice,save(1,2))).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();
  });
  it('saves only the current actor and makes identical retries idempotent',async()=>{
    const input=save();await saveGatheringIntake(id,alice,input);await saveGatheringIntake(id,alice,input);
    expect(f.members.get(`${id}:${alice}`)?.responseVersion).toBe(2);expect(f.members.get(`${id}:${owner}`)?.responseVersion).toBe(1);expect(f.raw.gatheringMember.update).toHaveBeenCalledTimes(1);
    await expect(saveGatheringIntake(id,alice,{...input,intake:gatheringFixtureIntake('不同内容')})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('atomically joins and saves only on explicit submission, preserving own-only private fields and original retry key',async()=>{
    const input={...save(0),join_if_needed:true};input.intake.private={budget_min:null,budget_max:777,budget_note:'BOB_PRIVATE_BUDGET',origin:{label:'BOB_PRIVATE_HOME'},confirmed_keys:[]};
    const result=await saveGatheringIntake(id,bob,input),replay=await saveGatheringIntake(id,bob,input);
    expect(result.viewer.is_member).toBe(true);expect(result.own?.version).toBe(1);expect(replay.own?.version).toBe(1);expect(result.gathering.has_responded).toBe(true);
    expect(f.raw.gatheringMember.create).toHaveBeenCalledTimes(1);expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();
    const organizerView=await gatheringSnapshotTx(f.tx,id,owner);expect(JSON.stringify(organizerView)).not.toContain('BOB_PRIVATE');expect(organizerView.own?.intake.private.budget_max).toBeNull();expect(organizerView.members?.every(member=>member.blocks.every(block=>block.id!=='budget'&&block.id!=='origin'))).toBe(true);
    await expect(saveGatheringIntake(id,bob,{...input,intake:gatheringFixtureIntake('另一份输入')})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect(f.members.size).toBe(3);
  });
  it('keeps the legacy non-member rejection when explicit join consent is absent or false',async()=>{
    for(const input of [save(0),{...save(0),join_if_needed:false}])await expect(saveGatheringIntake(id,bob,input)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();
  });
  it.each(['revision','version','capacity','private-note','required-answer','deadline'])('does not leave a membership behind after a rejected %s submission',async mode=>{
    const input={...save(0),join_if_needed:true};
    if(mode==='revision')input.expected_revision=2;
    if(mode==='version')input.expected_version=1;
    if(mode==='capacity')f.gatherings.get(id)!.details={...f.details(),capacity:2} as never;
    if(mode==='private-note')input.intake.public.note='个人预算200元';
    if(mode==='required-answer'||mode==='deadline'){
      f=gatheringBackendFixture('team');h.tx=f.tx;
      f.gatherings.get(id)!.details={...f.details(),...(mode==='deadline'?{deadline_at:'2000-01-01T00:00:00Z'}:{questions:[{id:'q1',title:'想吃什么',type:'single',required:true,options:[{id:'hotpot',label:'火锅'}]}]})} as never;
    }
    await expect(saveGatheringIntake(id,bob,input)).rejects.toMatchObject({code:['revision','version'].includes(mode)?'VERSION_CONFLICT':mode==='capacity'?'CAPACITY_FULL':'INVALID_INPUT'});
    expect(f.members.has(`${id}:${bob}`)).toBe(false);expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();
  });
  it('creates a team respondent only with a complete answer and keeps post-cutoff retries idempotent',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));f=gatheringBackendFixture('team');h.tx=f.tx;
    f.gatherings.get(id)!.details={...f.details(),questions:[{id:'q1',title:'想吃什么',type:'single',required:true,options:[{id:'hotpot',label:'火锅'}]}]} as never;
    const input={...save(0),join_if_needed:true};input.intake.answers=[{question_id:'q1',option_ids:['hotpot'],other:'',text:''}];
    const result=await saveGatheringIntake(id,bob,input);expect(result.own?.version).toBe(1);expect(result.stats).toBeNull();expect(result.members).toBeNull();
    vi.setSystemTime(new Date('2030-01-31T00:00:00Z'));expect((await saveGatheringIntake(id,bob,input)).own?.version).toBe(1);expect(f.raw.gatheringMember.create).toHaveBeenCalledTimes(1);
  });
  it('rejects invalid required answers, stale choices and missing answer revisions',async()=>{
    f=gatheringBackendFixture('team');h.tx=f.tx;const d=f.details();d.questions=[{id:'q1',title:'想吃什么',type:'single',required:true,options:[{id:'hotpot',label:'火锅'}]}];f.gatherings.get(id)!.details=d as never;
    await expect(saveGatheringIntake(id,alice,save())).rejects.toMatchObject({code:'INVALID_INPUT'});
    const input=save();input.intake.answers=[{question_id:'q1',option_ids:['stale-option'],other:'',text:''}];await expect(saveGatheringIntake(id,alice,input)).rejects.toMatchObject({code:'INVALID_INPUT'});
    const noRevision:Record<string,unknown>={...save()};delete noRevision.expected_revision;await expect(saveGatheringIntake(id,alice,noRevision)).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
  it('samples the team cutoff after waiting for its gathering lock',async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));f=gatheringBackendFixture('team');h.tx=f.tx;f.setOnLock(()=>vi.setSystemTime(new Date('2030-01-31T00:00:00Z')));
    await expect(saveGatheringIntake(id,alice,save())).rejects.toMatchObject({code:'INVALID_INPUT'});expect(f.raw.gatheringMember.update).not.toHaveBeenCalled();expect(f.locks[0]).toContain('Gathering');
  });
  it('enforces the member limit but keeps an existing join idempotent',async()=>{f.gatherings.get(id)!.details={...f.details(),capacity:2} as never;await expect(joinGathering(id,bob)).rejects.toMatchObject({code:'CAPACITY_FULL'});await joinGathering(id,alice);expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();});
  it('allows only owner edits, checks the displayed revision, and rejects extra edit authority',async()=>{
    const input={expected_revision:1,details:{...f.details(),title:'新的标题'}};
    await expect(updateGatheringDetails(id,alice,input)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(updateGatheringDetails(id,owner,{...input,expected_revision:2})).rejects.toMatchObject({code:'VERSION_CONFLICT'});await expect(updateGatheringDetails(id,owner,{...input,ownerUserId:alice})).rejects.toMatchObject({code:'INVALID_INPUT'});
    const result=await updateGatheringDetails(id,owner,input);expect(result.gathering.title).toBe('新的标题');expect(f.gatherings.get(id)!.ownerUserId).toBe(owner);
  });
  it('does not replace published questions after an answer exists',async()=>{await expect(updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),questions:[{id:'q1',title:'新问题',type:'text',required:false,options:[]}]}})).rejects.toMatchObject({code:'INVALID_INPUT'});expect(f.raw.gathering.update).not.toHaveBeenCalled();});
});
describe('generated alternatives preserve actor, roster and source',()=>{
  it('persists multiple complete plans once and never creates formal activity or participation writes',async()=>{
    const input=await generationInput(),provider={generate:vi.fn(async()=>gatheringFixturePlan())};const result=await generateGatheringItinerary(id,owner,input,provider);const replay=await generateGatheringItinerary(id,owner,input,provider);
    expect(result.itinerary?.plans).toHaveLength(2);expect(replay.itinerary?.plans).toHaveLength(2);expect(provider.generate).toHaveBeenCalledTimes(1);expect(f.raw).not.toHaveProperty('activity');expect(f.raw).not.toHaveProperty('participation');
  });
  it('blocks another actor or an old source before calling the provider',async()=>{const provider={generate:vi.fn()},input=await generationInput();await expect(generateGatheringItinerary(id,alice,input,provider)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(generateGatheringItinerary(id,owner,{...input,expected_source:'a'.repeat(64)},provider)).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(provider.generate).not.toHaveBeenCalled();});
  it('does not omit an unsubmitted member or silently truncate a group',async()=>{const provider={generate:vi.fn()};f.seed(bob,gatheringFixtureIntake(),0);await expect(generateGatheringItinerary(id,owner,await generationInput(),provider)).rejects.toMatchObject({code:'INVALID_INPUT'});expect(provider.generate).not.toHaveBeenCalled();});
  it('returns the same pending request on replay and rejects a second key while it runs',async()=>{
    const input=await generationInput();let finish!:(v:ReturnType<typeof gatheringFixturePlan>)=>void;const provider={generate:vi.fn(()=>new Promise<ReturnType<typeof gatheringFixturePlan>>(resolve=>{finish=resolve;}))};const pending=generateGatheringItinerary(id,owner,input,provider);await vi.waitFor(()=>expect(provider.generate).toHaveBeenCalledTimes(1));
    const replay=await generateGatheringItinerary(id,owner,input,provider);expect(replay.generation?.status).toBe('processing');await expect(generateGatheringItinerary(id,owner,{...input,idempotency_key:randomUUID()},provider)).rejects.toMatchObject({code:'CONCURRENT_MODIFICATION'});
    finish(gatheringFixturePlan());await pending;expect(provider.generate).toHaveBeenCalledTimes(1);
  });
  it.each(['new-member','new-answer','new-details'])('discards late output after %s and preserves the previous plan pointer',async mode=>{
    const input=await generationInput();let finish!:(v:ReturnType<typeof gatheringFixturePlan>)=>void;const provider={generate:vi.fn(()=>new Promise<ReturnType<typeof gatheringFixturePlan>>(resolve=>{finish=resolve;}))};const pending=generateGatheringItinerary(id,owner,input,provider);await vi.waitFor(()=>expect(provider.generate).toHaveBeenCalledTimes(1));
    if(mode==='new-member')f.seed(bob,gatheringFixtureIntake(),0);if(mode==='new-answer')f.seed(alice,gatheringFixtureIntake('已修改的想法'),2);if(mode==='new-details')f.gatherings.get(id)!.details={...f.details(),capacity:9} as never;
    finish(gatheringFixturePlan());await expect(pending).rejects.toMatchObject({code:'VERSION_CONFLICT'});expect(f.gatherings.get(id)!.currentGenerationId).toBeNull();expect([...f.generations.values()][0].status).toBe('failed');
  });
  it.each(['malformed','throw'])('normalizes %s provider failure and does not replace an earlier successful itinerary',async mode=>{
    await generateGatheringItinerary(id,owner,await generationInput(),{generate:async()=>gatheringFixturePlan()});const before=f.gatherings.get(id)!.currentGenerationId;
    const provider={generate:async()=>{if(mode==='throw')throw Error('PRIVATE_VENDOR_ERROR');return {private_origin:'PRIVATE_VENDOR_ERROR'} as never;}};
    let error:unknown;try{await generateGatheringItinerary(id,owner,await generationInput(),provider);}catch(e){error=e;}
    expect(error).toMatchObject({code:'UPSTREAM_UNAVAILABLE'});expect(String(error)).not.toContain('PRIVATE_VENDOR_ERROR');expect(f.gatherings.get(id)!.currentGenerationId).toBe(before);
  });
  it('projects an expired processing record as retryable and allows a new key to supersede it',async()=>{
    const input=await generationInput(),old=await f.raw.gatheringGeneration.create({data:{gatheringId:id,creatorUserId:owner,idempotencyKey:input.idempotency_key,sourceHash:input.expected_source,status:'processing',createdAt:new Date(Date.now()-100000)}});
    const snapshot=await gatheringSnapshotTx(f.tx,id,owner);expect(snapshot.generation?.status).toBe('failed');expect(f.generations.get(old.id)!.status).toBe('processing');
    const result=await generateGatheringItinerary(id,owner,{...input,idempotency_key:randomUUID()},{generate:async()=>gatheringFixturePlan()});expect(result.generation?.status).toBe('ready');expect(f.generations.get(old.id)!.status).toBe('failed');
  });
});

describe('final choice freezes the selected gathering after generation',()=>{
  const ready=async()=>{const snapshot=await generateGatheringItinerary(id,owner,await generationInput(),{generate:async()=>gatheringFixturePlan()});return {expected_source:snapshot.source_fingerprint!,generation_id:snapshot.itinerary!.generation_id,plan_id:snapshot.itinerary!.plans[0].id};};
  it('allows editing after generation, requires a fresh source to finalize, and freezes only after owner selection',async()=>{
    const input=await ready();await saveGatheringIntake(id,alice,save());
    await expect(finalizeGathering(id,owner,input)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    await expect(finalizeGathering(id,owner,{...input,expected_source:(await generationInput()).expected_source})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    expect(f.gatherings.get(id)!.finalizedAt).toBeNull();
    const fresh=await ready(),result=await finalizeGathering(id,owner,fresh);
    expect(result.final_choice).toMatchObject({generation_id:fresh.generation_id,plan_id:fresh.plan_id});expect(result.viewer).toMatchObject({can_respond:false,can_generate:false});expect(result.itinerary?.generation_id).toBe(fresh.generation_id);expect(gatheringSnapshotSchema.safeParse(result).success).toBe(true);
  });
  it('keeps same-choice retries naturally idempotent and rejects choosing a different plan',async()=>{
    const input=await ready(),first=await finalizeGathering(id,owner,input);const writes=f.raw.gathering.update.mock.calls.length;
    const replay=await finalizeGathering(id,owner,input);expect(replay.final_choice).toEqual(first.final_choice);expect(first.gathering.revision).toBe(2);expect(replay.gathering.revision).toBe(2);expect(f.raw.gathering.update).toHaveBeenCalledTimes(writes);
    await expect(finalizeGathering(id,owner,{...input,plan_id:'plan2'})).rejects.toMatchObject({code:'INVALID_INPUT',status:409});
    expect(f.gatherings.get(id)!.finalPlanId).toBe('plan1');
  });
  it.each(['not-owner','not-ready','different-gathering','missing-generation','missing-plan','team'])('rejects %s final selection without recording a choice',async mode=>{
    const input=await ready();
    if(mode==='not-ready')f.generations.get(input.generation_id)!.status='processing';
    if(mode==='different-gathering')f.generations.get(input.generation_id)!.gatheringId=randomUUID();
    if(mode==='missing-generation')input.generation_id=randomUUID();
    if(mode==='missing-plan')input.plan_id='absent';
    if(mode==='team')f.gatherings.get(id)!.kind='team';
    await expect(finalizeGathering(id,mode==='not-owner'?alice:owner,input)).rejects.toMatchObject({code:mode==='not-owner'?'FORBIDDEN':'INVALID_INPUT'});
    expect(f.gatherings.get(id)!.finalizedAt).toBeNull();
  });
  it('blocks every new mutation after selection while allowing original successful write receipts',async()=>{
    const saved=save();await saveGatheringIntake(id,alice,saved);const generation=await generationInput();
    const snapshot=await generateGatheringItinerary(id,owner,generation,{generate:async()=>gatheringFixturePlan()});
    await finalizeGathering(id,owner,{expected_source:snapshot.source_fingerprint!,generation_id:snapshot.itinerary!.generation_id,plan_id:'plan1'});
    const provider={generate:vi.fn()};
    for(const task of [
      ()=>joinGathering(id,bob),()=>joinGathering(id,alice),
      ()=>saveGatheringIntake(id,alice,save(2)),()=>saveGatheringIntake(id,bob,{...save(0),join_if_needed:true}),
      ()=>updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),title:'改选之后的标题'}}),
      ()=>generateGatheringItinerary(id,owner,{...generation,idempotency_key:randomUUID()},provider),
    ])await expect(task()).rejects.toMatchObject({code:'INVALID_INPUT',status:409});
    expect(provider.generate).not.toHaveBeenCalled();expect(f.members.has(`${id}:${bob}`)).toBe(false);
    expect((await saveGatheringIntake(id,alice,saved)).own?.version).toBe(2);
    expect((await generateGatheringItinerary(id,owner,generation,provider)).final_choice?.plan_id).toBe('plan1');
  });
  it('shows the final generation to a non-member visitor without joining or sharing member/private data',async()=>{
    const secret=gatheringFixtureIntake();secret.private.budget_note='ALICE_PRIVATE';secret.private.origin={label:'ALICE_HOME'};f.seed(alice,secret);
    const input=await ready();await finalizeGathering(id,owner,input);const view=await gatheringSnapshotTx(f.tx,id,bob);
    expect(view).toMatchObject({final_choice:{generation_id:input.generation_id,plan_id:'plan1'},itinerary:{generation_id:input.generation_id},viewer:{is_member:false,can_respond:false,can_generate:false},own:null,members:null,stats:null,source_fingerprint:null});
    expect(JSON.stringify(view)).not.toMatch(/ALICE_PRIVATE|ALICE_HOME/);expect(f.members.has(`${id}:${bob}`)).toBe(false);
  });
  it('does not let an already running generation replace a finalized earlier ready generation',async()=>{
    const input=await ready();let finish!:(value:ReturnType<typeof gatheringFixturePlan>)=>void;
    const provider={generate:vi.fn(()=>new Promise<ReturnType<typeof gatheringFixturePlan>>(resolve=>{finish=resolve;}))};
    const pending=generateGatheringItinerary(id,owner,await generationInput(),provider);await vi.waitFor(()=>expect(provider.generate).toHaveBeenCalledTimes(1));
    await finalizeGathering(id,owner,input);finish(gatheringFixturePlan());await expect(pending).rejects.toMatchObject({code:'INVALID_INPUT',status:409});
    expect(f.gatherings.get(id)!.currentGenerationId).toBe(input.generation_id);expect(f.gatherings.get(id)!.finalGenerationId).toBe(input.generation_id);
  });
});


describe('preparation headcount limits keep fields aligned with actual membership',()=>{
  it.each(['friend','team'] as const)('refuses to reduce a %s capacity below all existing members, including unsubmitted people',async kind=>{
    f=gatheringBackendFixture(kind);h.tx=f.tx;f.seed(bob,gatheringFixtureIntake(),0);
    await expect(updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),capacity:2}})).rejects.toMatchObject({code:'INVALID_INPUT',status:409});
    expect(f.raw.gathering.update).not.toHaveBeenCalled();expect(f.details().capacity).toBeNull();expect(f.gatherings.get(id)!.revision).toBe(1);expect(f.members.size).toBe(3);
  });
  it('checks actual membership after acquiring the gathering lock rather than trusting the old visible count',async()=>{
    f.setOnLock(()=>f.seed(bob,gatheringFixtureIntake(),0));
    await expect(updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),capacity:2}})).rejects.toMatchObject({code:'INVALID_INPUT',status:409});
    expect(f.locks[0]).toContain('Gathering');expect(f.members.size).toBe(3);expect(f.raw.gathering.update).not.toHaveBeenCalled();
  });
  it('allows capacity equal to current members without finalizing or occupying formal seats',async()=>{
    const result=await updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),capacity:2}});
    expect(result.gathering.details.capacity).toBe(2);expect(result.gathering.revision).toBe(2);expect(result.final_choice).toBeNull();expect(result.viewer.can_respond).toBe(true);expect(f.raw).not.toHaveProperty('participation');
  });
  it('lets the owner clear a self-set limit and permits another member within the system limit',async()=>{
    f.gatherings.get(id)!.details={...f.details(),capacity:2} as never;
    const result=await updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),capacity:null}});
    expect(result.gathering.details.capacity).toBeNull();expect((await joinGathering(id,bob)).gathering.member_count).toBe(3);expect(f.details().capacity).toBeNull();
  });
  it('stores a reference minimum above present membership without inventing a formation condition',async()=>{
    const result=await updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),minimum:5,capacity:10}});
    expect(result.gathering.member_count).toBe(2);expect(result.gathering.details.minimum).toBe(5);expect(result.final_choice).toBeNull();expect(f.gatherings.get(id)!.finalizedAt).toBeNull();
  });
  it.each(['minimum','capacity'] as const)('rejects a new friend %s above 50 before creating or replacing records',async field=>{
    const details={...f.details(),[field]:51};
    await expect(createGathering(owner,{kind:'friend',idempotency_key:randomUUID(),details,intake:gatheringFixtureIntake()})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(updateGatheringDetails(id,owner,{expected_revision:1,details})).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.raw.gathering.create).not.toHaveBeenCalled();expect(f.raw.gathering.update).not.toHaveBeenCalled();expect(f.members.size).toBe(2);
  });
  it.each(['join','intake'] as const)('blocks a new friend %s at the default 50-person ceiling even when capacity is null',async mode=>{
    for(let i=2;i<50;i++)f.seed(randomUUID());
    const attempt=()=>mode==='join'?joinGathering(id,bob):saveGatheringIntake(id,bob,{...save(0),join_if_needed:true});
    await expect(attempt()).rejects.toMatchObject({code:'CAPACITY_FULL',status:409});
    expect(f.details().capacity).toBeNull();expect(f.members.size).toBe(50);expect(f.members.has(`${id}:${bob}`)).toBe(false);expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();
    expect((await joinGathering(id,alice)).viewer.is_member).toBe(true);expect((await saveGatheringIntake(id,alice,save())).own?.version).toBe(2);
  });
  it.each(['join','intake'] as const)('allows exactly the 50th friend through %s and preserves successful retries',async mode=>{
    for(let i=2;i<49;i++)f.seed(randomUUID());
    const input={...save(0),join_if_needed:true};
    const attempt=()=>mode==='join'?joinGathering(id,bob):saveGatheringIntake(id,bob,input);
    expect((await attempt()).gathering.member_count).toBe(50);expect((await attempt()).gathering.member_count).toBe(50);
    expect(f.raw.gatheringMember.create).toHaveBeenCalledTimes(1);expect(f.members.size).toBe(50);
  });
  it('preserves old oversized friend records and existing members without admitting another person',async()=>{
    f.gatherings.get(id)!.details={...f.details(),capacity:500} as never;for(let i=2;i<51;i++)f.seed(randomUUID());
    expect((await gatheringSnapshotTx(f.tx,id,owner)).gathering.member_count).toBe(51);
    expect((await joinGathering(id,alice)).viewer.is_member).toBe(true);expect((await saveGatheringIntake(id,alice,save())).own?.version).toBe(2);
    await expect(joinGathering(id,bob)).rejects.toMatchObject({code:'CAPACITY_FULL'});
    expect(f.members.size).toBe(51);expect(f.details().capacity).toBe(500);expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();
  });
  it('retains the separate team maximum of 500 and does not apply the friend generation limit',async()=>{
    f=gatheringBackendFixture('team');h.tx=f.tx;
    const result=await updateGatheringDetails(id,owner,{expected_revision:1,details:{...f.details(),minimum:300,capacity:500}});
    expect(result.gathering.details).toMatchObject({minimum:300,capacity:500});
    for(let i=2;i<500;i++)f.seed(randomUUID());
    await expect(joinGathering(id,bob)).rejects.toMatchObject({code:'CAPACITY_FULL'});expect(f.members.size).toBe(500);expect(f.raw.gatheringMember.create).not.toHaveBeenCalled();
  });
});

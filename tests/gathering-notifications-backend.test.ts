import {randomUUID} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Tx} from '../apps/web/src/server/activities/state';
const h=vi.hoisted(()=>({tx:null as Tx|null}));
vi.mock('../apps/web/src/server/activities/mutation',()=>({mutation:async(action:(tx:Tx)=>unknown)=>action(h.tx!)}));
vi.mock('../apps/web/src/server/db',()=>({withDb:async(action:(db:unknown)=>unknown)=>action({$transaction:(fn:(tx:Tx)=>unknown)=>fn(h.tx!)})}));
vi.mock('../apps/web/src/server/requirements/service',async()=>{const actual=await vi.importActual<typeof import('../apps/web/src/server/requirements/service')>('../apps/web/src/server/requirements/service');return{...actual,consumeRequirementBudget:async()=>{}};});
import {createGathering,joinGathering,saveGatheringIntake,updateGatheringDetails,finalizeGathering} from '../apps/web/src/server/gatherings/service';
import {generateGatheringItinerary} from '../apps/web/src/server/gatherings/generation';
import {gatheringSourceFingerprint} from '../apps/web/src/server/gatherings/privacy';
import {inboxSnapshot,readInbox} from '../apps/web/src/server/inbox';
import {gatheringBackendFixture,gatheringFixtureIntake,gatheringFixtureDetails,gatheringFixturePlan,gatheringId as id,gatheringOwner as owner,gatheringAlice as alice,gatheringBob as bob} from './gathering-backend-fixture';
let f:ReturnType<typeof gatheringBackendFixture>;
const input=(version:number,join=false)=>({expected_revision:1,expected_version:version,idempotency_key:randomUUID(),...(join?{join_if_needed:true}:{}),intake:gatheringFixtureIntake()});
const eventRecipients=()=>[...f.events.values()].sort((a,b)=>a.sequence-b.sequence).map(event=>({action:event.action,version:event.actorVersion,sequence:event.sequence,to:[...f.recipients.values()].filter(row=>row.eventId===event.id).map(row=>row.userId).sort()}));
beforeEach(()=>{f=gatheringBackendFixture();h.tx=f.tx;});

describe('per-version gathering notifications (query double, real PG verified separately)',()=>{
  it('persists each submit/update, excludes self and preserves first-submitter eligibility across later edits',async()=>{
    f.seed(alice,gatheringFixtureIntake(),0);
    const first=input(0);await saveGatheringIntake(id,alice,first);await saveGatheringIntake(id,alice,first);
    expect(eventRecipients()).toEqual([{action:'submitted',version:1,sequence:1,to:[owner]}]);
    const second=input(0,true);await saveGatheringIntake(id,bob,second);
    await saveGatheringIntake(id,alice,input(1));
    await saveGatheringIntake(id,bob,input(1));
    expect(eventRecipients()).toEqual([
      {action:'submitted',version:1,sequence:1,to:[owner]},
      {action:'submitted',version:1,sequence:2,to:[owner,alice]},
      {action:'updated',version:2,sequence:3,to:[owner,bob]},
      {action:'updated',version:2,sequence:4,to:[owner,alice]},
    ]);
    expect(f.members.get(`${id}:${alice}`)?.firstSubmissionSequence).toBe(1);expect(f.members.get(`${id}:${bob}`)?.firstSubmissionSequence).toBe(2);
    expect(f.outbox.size).toBe(7);expect(new Set([...f.outbox.values()].map(row=>row.recipientId)).size).toBe(7);
  });
  it('notifies only the team organizer for every answer version, never another respondent',async()=>{
    f=gatheringBackendFixture('team');h.tx=f.tx;await saveGatheringIntake(id,alice,input(1));await saveGatheringIntake(id,bob,input(0,true));await saveGatheringIntake(id,alice,input(2));
    expect(eventRecipients().map(event=>event.to)).toEqual([[owner],[owner],[owner]]);expect(f.outbox.size).toBe(3);
  });
  it('does not notify the organizer about their own submit but notifies previously submitted friends',async()=>{
    await saveGatheringIntake(id,owner,input(1));expect(eventRecipients()[0].to).toEqual([alice]);
    f=gatheringBackendFixture('team');h.tx=f.tx;await saveGatheringIntake(id,owner,input(1));expect(f.events.size).toBe(1);expect(f.recipients.size).toBe(0);expect(f.outbox.size).toBe(0);
  });
  it('records the initial friend creator answer version without creating a self notification',async()=>{
    const result=await createGathering(owner,{kind:'friend',idempotency_key:randomUUID(),details:gatheringFixtureDetails(),intake:gatheringFixtureIntake()});
    const event=[...f.events.values()][0];expect(event).toMatchObject({gatheringId:result.gathering.id,actorUserId:owner,actorVersion:1,sequence:1,action:'submitted'});expect(f.recipients.size).toBe(0);
  });
  it('never puts private answers, budgets, origin coordinates, profiles or identity tokens into notification/outbox records',async()=>{
    const value=input(0,true);value.intake.private={budget_min:123,budget_max:987,budget_note:'PRIVATE_BUDGET_SENTINEL',origin:{label:'PRIVATE_HOME_SENTINEL',latitude:30.123,longitude:120.987,crs:'GCJ-02'},confirmed_keys:[]};
    await saveGatheringIntake(id,bob,value);
    const stored=JSON.stringify({events:[...f.events.values()],recipients:[...f.recipients.values()],outbox:[...f.outbox.values()]});
    expect(stored).not.toMatch(/PRIVATE_|budget|origin|latitude|longitude|nickname|openId|access_token|session/);expect(stored).not.toContain('一起吃饭');
  });
  it('does not create a notification or queue item for conflicts or invalid answers',async()=>{
    await expect(saveGatheringIntake(id,alice,input(0))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
    const bad=input(1);bad.intake.public.note='我的预算100元';await expect(saveGatheringIntake(id,alice,bad)).rejects.toMatchObject({code:'INVALID_INPUT'});
    expect(f.events.size).toBe(0);expect(f.recipients.size).toBe(0);expect(f.outbox.size).toBe(0);
  });
});

describe('account presentation is optional at the gathering write boundaries',()=>{
  it.each(['create','join','save','details','generate','finalize'])('allows authenticated %s without an account avatar or nickname',async action=>{
    const provider={generate:vi.fn(async()=>gatheringFixturePlan())};
    const source=()=>gatheringSourceFingerprint(f.details(),[...f.members.values()].map(row=>({userId:row.userId,publicIntake:row.publicIntake,answers:row.answers,responseVersion:row.responseVersion})));
    let generationId:string|undefined;
    if(action==='finalize')generationId=(await generateGatheringItinerary(id,owner,{expected_source:source(),idempotency_key:randomUUID()},provider)).itinerary!.generation_id;
    f.incompleteProfiles.add(action==='join'?bob:action==='save'?alice:owner);
    const before={members:f.members.size,events:f.events.size,generations:f.generations.size,gatherings:f.gatherings.size};
    const task=()=>action==='create'?createGathering(owner,{kind:'friend',idempotency_key:randomUUID(),details:gatheringFixtureDetails(),intake:gatheringFixtureIntake()}):action==='join'?joinGathering(id,bob):action==='save'?saveGatheringIntake(id,alice,input(1)):action==='details'?updateGatheringDetails(id,owner,{expected_revision:1,details:f.details()}):action==='generate'?generateGatheringItinerary(id,owner,{expected_source:source(),idempotency_key:randomUUID()},provider):finalizeGathering(id,owner,{expected_source:source(),generation_id:generationId,plan_id:'plan1'});
    await expect(task()).resolves.toHaveProperty('gathering');expect(f.raw.privateProfile.findUnique).not.toHaveBeenCalled();expect(f.raw.userAvatar.findUnique).not.toHaveBeenCalled();
    expect(f.gatherings.size).toBeGreaterThanOrEqual(before.gatherings);
  });
  it('acknowledges an already successful original save after profile removal without creating new writes',async()=>{
    const value=input(1);await saveGatheringIntake(id,alice,value);f.incompleteProfiles.add(alice);expect((await saveGatheringIntake(id,alice,value)).own?.version).toBe(2);expect(f.events.size).toBe(1);
    expect((await saveGatheringIntake(id,alice,input(2))).own?.version).toBe(3);expect(f.events.size).toBe(2);
  });
});

describe('gathering inbox events preserve every recipient record and independent read state',()=>{
  function inboxFixture(){
    const read=new Set<string>(),raw=f.raw as any;
    for(const name of ['activity','activityApplication','managementHandover','requirementSurvey'])raw[name]={findMany:vi.fn(async()=>[])};
    raw.messageRead={findMany:vi.fn(async({where}:any)=>[...read].filter(value=>value.startsWith(where.userId+':')).map(value=>({messageId:value.slice(where.userId.length+1)}))),createMany:vi.fn(async({data}:any)=>{data.forEach((value:any)=>read.add(value.userId+':'+value.messageId));return{count:data.length};})};
  }
  it('shows distinct save versions to eligible recipients, routes to gathering and never shares private text',async()=>{
    await saveGatheringIntake(id,alice,input(1));await saveGatheringIntake(id,alice,input(2));inboxFixture();
    const view=await inboxSnapshot(f.tx,owner);expect(view.messages).toHaveLength(2);expect(view.unread_count).toBe(2);expect(new Set(view.messages.map(message=>message.id)).size).toBe(2);
    expect(view.messages.every(message=>message.gathering_id===id&&message.activity_id===null&&message.section==='gathering')).toBe(true);
    expect((await inboxSnapshot(f.tx,alice)).messages).toHaveLength(0);expect((await inboxSnapshot(f.tx,bob)).messages).toHaveLength(0);
    expect(JSON.stringify(view)).not.toMatch(/一起吃饭|预算|出发|PRIVATE_|actorUserId|openId|privateIntake/);
    const before=JSON.stringify([...f.members.values()]);await readInbox(owner,{action:'read',message_id:view.messages[0].id});expect((await inboxSnapshot(f.tx,owner)).unread_count).toBe(1);expect(JSON.stringify([...f.members.values()])).toBe(before);
    await expect(readInbox(bob,{action:'read',message_id:view.messages[0].id})).rejects.toMatchObject({code:'NOT_FOUND'});
  });
});

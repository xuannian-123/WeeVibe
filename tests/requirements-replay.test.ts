import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tx } from '../apps/web/src/server/activities/state';
import { Prisma, type RequirementSurvey } from '@prisma/client';
import { requirementCreateSchema, requirementCommandSchema, requirementDraftSchema, type RequirementResponseInput, type TeamDraft } from '../packages/contracts/src';
import { commandRequirementTx, requirementSnapshotTx, organizerAvatarProjection } from '../apps/web/src/server/requirements/service';
import { assertPublishable, effectiveSurveyStatus, normalizeSubmission, normalizeFinalSelection } from '../apps/web/src/server/requirements/rules';
const owner = '11111111-1111-4111-8111-111111111111';
const alice = '22222222-2222-4222-8222-222222222222';
const bob = '33333333-3333-4333-8333-333333333333';
const activityId = '44444444-4444-4444-8444-444444444444';
const segmentId = '55555555-5555-4555-8555-555555555555';
const id = '66666666-6666-4666-8666-666666666666';
const now = new Date('2030-01-01T00:00:00Z');
const deadline = new Date('2030-01-02T00:00:00Z');
const draft: TeamDraft = { title: '朋友聚会', description: '', timezone: 'Asia/Shanghai', starts_at: '2030-01-03T00:00:00Z', deadline_at: deadline.toISOString(),
 locations: [{id:'park',label:'自填公园'}], questions:[{id:'food',title:'菜系',multiple:true,required:true,segment_id:segmentId,options:[{id:'mild',label:'清淡'},{id:'spicy',label:'辣'}]}] };
const segments = [{id:segmentId,name:'吃饭',startsAt:new Date(draft.starts_at),endsAt:new Date('2030-01-03T02:00:00Z'),cancelledAt:null}];
const surveyBase = { id,kind:'friend',ownerUserId:owner,activityId,draft:draft as unknown as Prisma.JsonObject,revision:2,status:'open',deadlineAt:deadline,closedAt:null,finalSelection:null,creationKey:'fixture-key',creationHash:'a'.repeat(64),createdAt:now,updatedAt:now } satisfies RequirementSurvey;
const response: RequirementResponseInput = {selected_segment_ids:[segmentId],answers:[{question_id:'food',option_ids:['mild','spicy'],other:'素食'}],location_ids:['park'],location_other:null,time_preferences:'午后',budget_note:'每人100元以内',preferences:'不喝酒',private_origin:{label:'PRIVATE_HOME_SENTINEL',longitude:120.1,latitude:30.1,crs:'GCJ-02'}};
/** Transaction double only. It models ownership/query projection, not PostgreSQL concurrency. */
function fixture(initial: Partial<RequirementSurvey> = {}) {
 let survey = {...surveyBase,...initial};
 const records = new Map<string,{collectionId:string;userId:string;revision:number;responseVersion:number;publicAnswers:Prisma.JsonValue;privateOrigin:Prisma.JsonValue|null;updatedAt:Date}>();
 const locks:string[]=[]; let afterLock:(()=>void)|undefined;
 const tx = {
  $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {const sql=strings.join('?');locks.push(sql);if(sql.includes('RequirementSurvey'))afterLock?.();return[{id}];}),
  activity: {findUnique:vi.fn(async()=>({id:activityId,currentManagerId:owner,cancelledAt:null,segments}))},
  requirementSurvey: {
   findUnique:vi.fn(async()=>survey), findUniqueOrThrow:vi.fn(async()=>survey),
   update:vi.fn(async({data}:{data:Record<string,unknown>})=>{survey={...survey,...data,revision:survey.revision+1} as typeof survey;return survey;})
  },
  requirementSubmission: {
   findUnique:vi.fn(async({where}:{where:{collectionId_userId:{userId:string}}})=>records.get(where.collectionId_userId.userId)??null),
   findMany:vi.fn(async({select}:{select:Record<string,boolean>})=>[...records.values()].map(row=>Object.fromEntries(Object.keys(select).filter(k=>select[k]).map(k=>[k,row[k as keyof typeof row]])))),
   count:vi.fn(async()=>records.size),
   create:vi.fn(async({data}:{data:Record<string,unknown>})=>{
    const userId=data.userId as string;if(records.has(userId))throw new Error('duplicate composite key');
    const row:Record<string,unknown>={...data,updatedAt:new Date()};if(row.privateOrigin===Prisma.DbNull)row.privateOrigin=null;
    records.set(userId,row as unknown as Exclude<ReturnType<typeof records.get>,undefined>);return row;
   }),
   updateMany:vi.fn(async({where,data}:{where:{collectionId:string;userId:string;responseVersion:number};data:Record<string,unknown>})=>{
    const old=records.get(where.userId);if(!old||old.collectionId!==where.collectionId||old.responseVersion!==where.responseVersion)return {count:0};
    const row:Record<string,unknown>={...old,...data,responseVersion:old.responseVersion+1,updatedAt:new Date()};if(row.privateOrigin===Prisma.DbNull)row.privateOrigin=null;
    records.set(where.userId,row as unknown as Exclude<ReturnType<typeof records.get>,undefined>);return {count:1};
   })
  },
  userAvatar:{findUnique:vi.fn(async()=>null)},
  privateProfile:{findMany:vi.fn(async()=>[{userId:owner,data:{nickname:'局头',birthday:'1980-01-01',signature:'PRIVATE_PROFILE_SENTINEL'}},{userId:alice,data:{nickname:'Alice'}}])}
 };
 return {tx:tx as unknown as Tx,raw:tx,records,locks,setAfterLock:(fn:()=>void)=>{afterLock=fn;},getSurvey:()=>survey};
}
afterEach(()=>vi.useRealTimers());
describe('requirement answer CAS/replay protection (transaction double, not live PostgreSQL)',()=>{
 const command=(version:number,budget='A')=>({action:'respond' as const,expected_revision:2,expected_response_version:version,response:{...response,budget_note:budget}});
 it('preserves B when the earlier successful A request is replayed',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();const a=command(0,'A: original');
  const first=await commandRequirementTx(f.tx,id,alice,a);expect(first.own_response?.response_version).toBe(1);
  const second=await commandRequirementTx(f.tx,id,alice,command(1,'B: newer saved'));expect(second.own_response?.response_version).toBe(2);
  await expect(commandRequirementTx(f.tx,id,alice,a)).rejects.toMatchObject({code:'VERSION_CONFLICT',status:409});
  expect((f.records.get(alice)!.publicAnswers as {budget_note:string}).budget_note).toBe('B: newer saved');
  expect(f.records.get(alice)!.responseVersion).toBe(2);expect(f.raw.requirementSubmission.create).toHaveBeenCalledTimes(1);expect(f.raw.requirementSubmission.updateMany).toHaveBeenCalledTimes(1);
 });
 it('rejects an exact retry after a lost success rather than claiming another successful save',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();const request=command(0);
  await commandRequirementTx(f.tx,id,alice,request);
  await expect(commandRequirementTx(f.tx,id,alice,request)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  expect((await requirementSnapshotTx(f.tx,id,alice,now)).own_response?.response_version).toBe(1);
 });
 it('rejects a stale first-submission request after a competing version-zero request has committed',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();await commandRequirementTx(f.tx,id,alice,command(0,'first device'));
  await expect(commandRequirementTx(f.tx,id,alice,command(0,'stale second device'))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  expect((f.records.get(alice)!.publicAnswers as {budget_note:string}).budget_note).toBe('first device');
 });
 it('requires a matching current actor answer and never uses another actor version or identity',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();await commandRequirementTx(f.tx,id,alice,command(0));await commandRequirementTx(f.tx,id,alice,command(1));
  await expect(commandRequirementTx(f.tx,id,bob,command(2))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  await commandRequirementTx(f.tx,id,bob,command(0,'Bob'));expect(f.records.get(alice)!.responseVersion).toBe(2);expect(f.records.get(bob)!.responseVersion).toBe(1);
  expect(requirementCommandSchema.safeParse({...command(2),user_id:bob}).success).toBe(false);
 });
 it('rejects legacy clients lacking a precondition even when no prior answer exists',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();const legacy={action:'respond' as const,expected_revision:2,response};
  expect(requirementCommandSchema.safeParse(legacy).success).toBe(true); // parsed only to explain required upgrade
  await expect(commandRequirementTx(f.tx,id,alice,legacy)).rejects.toMatchObject({code:'VERSION_CONFLICT',message:expect.stringContaining('更新小程序')});
  expect(f.records.size).toBe(0);expect(f.raw.requirementSubmission.create).not.toHaveBeenCalled();
 });
 it('checks the per-answer precondition after locks and also conditions the database UPDATE',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();await commandRequirementTx(f.tx,id,alice,command(0));
  f.raw.requirementSubmission.updateMany.mockResolvedValueOnce({count:0});
  await expect(commandRequirementTx(f.tx,id,alice,command(1))).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  expect(f.raw.requirementSubmission.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{collectionId:id,userId:alice,responseVersion:1},data:expect.objectContaining({responseVersion:{increment:1}})}));
  expect(f.raw.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(f.raw.requirementSubmission.findUnique.mock.invocationCallOrder[0]);
  expect(f.records.get(alice)!.responseVersion).toBe(1);
 });
 it('does not reopen or save on a stale replay after manual close or deadline',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();await commandRequirementTx(f.tx,id,alice,command(0));
  await commandRequirementTx(f.tx,id,owner,{action:'close',expected_revision:2});
  await expect(commandRequirementTx(f.tx,id,alice,{...command(1),expected_revision:3})).rejects.toMatchObject({code:'SEGMENT_APPLICATION_CLOSED'});
  const g=fixture();vi.setSystemTime(deadline);await expect(commandRequirementTx(g.tx,id,bob,command(0))).rejects.toMatchObject({code:'SEGMENT_APPLICATION_CLOSED'});
  expect(f.records.get(alice)!.responseVersion).toBe(1);expect(g.records.size).toBe(0);
 });
 it('does not include saved answers, private origins or version details in conflict errors',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();await commandRequirementTx(f.tx,id,alice,command(0,'SECRET_BUDGET'));
  try{await commandRequirementTx(f.tx,id,alice,command(0));throw new Error('expected conflict');}catch(error){expect(error).toMatchObject({code:'VERSION_CONFLICT'});expect(JSON.stringify(error)).not.toMatch(/SECRET_BUDGET|PRIVATE_HOME_SENTINEL|longitude|privateOrigin|responseVersion/);}
  const manager=await requirementSnapshotTx(f.tx,id,owner,now);expect(manager.manager?.responses[0]).not.toHaveProperty('response_version');
 });
 it('rejects malformed, negative and overflow answer version tokens in the contract',()=>{
  for(const value of [-1,0.5,null,'1',2147483647])expect(requirementCommandSchema.safeParse({...command(0),expected_response_version:value}).success).toBe(false);
  expect(requirementCommandSchema.safeParse(command(0)).success).toBe(true);
 });
});

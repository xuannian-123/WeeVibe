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
describe('requirements persisted transaction boundaries (test transaction double, not live PostgreSQL)',()=>{
 it('samples cutoff after waiting on the shared locks and writes nothing',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now); const f=fixture();f.setAfterLock(()=>vi.setSystemTime(deadline));
  await expect(commandRequirementTx(f.tx,id,alice,{action:'respond',expected_revision:2,expected_response_version:0,response})).rejects.toMatchObject({code:'SEGMENT_APPLICATION_CLOSED'});
  expect(f.raw.requirementSubmission.create).not.toHaveBeenCalled();expect(f.raw.requirementSubmission.updateMany).not.toHaveBeenCalled();expect(f.locks[0]).toContain('Activity');expect(f.locks[1]).toContain('RequirementSurvey');
 });
 it('upserts exactly one own answer, keeps another actor unchanged, and never acquires seats',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();
  await commandRequirementTx(f.tx,id,alice,{action:'respond',expected_revision:2,expected_response_version:0,response});
  await commandRequirementTx(f.tx,id,bob,{action:'respond',expected_revision:2,expected_response_version:0,response:{...response,budget_note:'bob',private_origin:null}});
  await commandRequirementTx(f.tx,id,alice,{action:'respond',expected_revision:2,expected_response_version:1,response:{...response,budget_note:'alice changed'}});
  expect(f.records.size).toBe(2);expect((f.records.get(bob)!.publicAnswers as {budget_note:string}).budget_note).toBe('bob');
  expect(f.raw.requirementSurvey.update).not.toHaveBeenCalled();expect(f.raw).not.toHaveProperty('participation');
  expect(JSON.stringify(f.records.get(alice)!.publicAnswers)).not.toContain('PRIVATE_HOME_SENTINEL');
 });
 it('manager query never selects others origin and nonmanager never receives raw others answers',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();
  await commandRequirementTx(f.tx,id,alice,{action:'respond',expected_revision:2,expected_response_version:0,response});
  const manager=await requirementSnapshotTx(f.tx,id,owner,now);
  expect(manager.manager?.responses[0].budget_note).toBe(response.budget_note);
  expect(JSON.stringify(manager)).not.toContain('PRIVATE_HOME_SENTINEL');expect(JSON.stringify(manager)).not.toContain('PRIVATE_PROFILE_SENTINEL');expect(JSON.stringify(manager)).not.toContain('longitude');
  expect(f.raw.requirementSubmission.findMany.mock.calls[0][0].select).not.toHaveProperty('privateOrigin');
  const own=await requirementSnapshotTx(f.tx,id,alice,now);expect(own.own_response?.private_origin?.label).toBe('PRIVATE_HOME_SENTINEL');expect(own.manager).toBeNull();
  const other=await requirementSnapshotTx(f.tx,id,bob,now);expect(other.own_response).toBeNull();expect(other.manager).toBeNull();
 });
 it('manual close uses the same lock and then rejects first or edited response',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();
  await commandRequirementTx(f.tx,id,owner,{action:'close',expected_revision:2});
  expect(f.getSurvey().closedAt).toEqual(now);
  await expect(commandRequirementTx(f.tx,id,alice,{action:'respond',expected_revision:3,expected_response_version:0,response})).rejects.toMatchObject({code:'SEGMENT_APPLICATION_CLOSED'});
  expect(f.raw.requirementSubmission.create).not.toHaveBeenCalled();expect(f.raw.requirementSubmission.updateMany).not.toHaveBeenCalled();
 });
 it('only manager closes or finalizes and published questions can never reopen through save-draft',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture();
  await expect(commandRequirementTx(f.tx,id,alice,{action:'close',expected_revision:2})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(commandRequirementTx(f.tx,id,owner,{action:'save-draft',expected_revision:2,draft:{...draft,deadline_at:'2040-01-01T00:00:00Z'}})).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  expect(f.raw.requirementSurvey.update).not.toHaveBeenCalled();
 });
 it('blocks team publishing even for owner and never allows unknown group flags',async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);const f=fixture({kind:'team',activityId:null,status:'draft',deadlineAt:null});
  await expect(commandRequirementTx(f.tx,id,owner,{action:'publish',expected_revision:2})).rejects.toMatchObject({code:'NOT_CONFIGURED'});
  expect(requirementCommandSchema.safeParse({action:'publish',expected_revision:2,verifiedGroupAccess:true}).success).toBe(false);
 });
 it('finalizes only after cutoff and never mutates original activity or user acceptance',async()=>{
  vi.useFakeTimers();vi.setSystemTime(deadline);const f=fixture();
  const result=await commandRequirementTx(f.tx,id,owner,{action:'finalize',expected_revision:2,final_selection:{location_id:'park',location_other:null,note:'待大家确认原活动安排'}});
  expect(result.collection.status).toBe('finalized');expect(result.collection.final_selection?.location_id).toBe('park');expect(f.raw.activity).not.toHaveProperty('update');
 });
});
describe('requirements strict input and domain validation',()=>{
 it('does not accept user ownership claims or private origin mixed into public answer fields',()=>{
  expect(requirementCommandSchema.safeParse({action:'respond',expected_revision:2,expected_response_version:0,user_id:bob,response}).success).toBe(false);
  expect(requirementCommandSchema.safeParse({action:'respond',expected_revision:2,expected_response_version:0,response:{...response,answers:[{...response.answers[0],private_origin:'secret'}]}}).success).toBe(false);
  expect(requirementCreateSchema.safeParse({action:'create',kind:'friend',idempotency_key:'a-valid-key',draft}).success).toBe(false);
 });
 it('projects only canonical avatar asset fields, never raw user/profile data',()=>{
  const bytes=Buffer.from([255,216,255,217]);const digest=createHash('sha256').update(bytes).digest('hex');
  const row={bytes,contentType:'image/jpeg',digest,updatedAt:now,birthday:'PRIVATE_BIRTHDAY',userId:owner};
  const avatar=organizerAvatarProjection(row);expect(avatar).not.toBeNull();expect(Object.keys(avatar!).sort()).toEqual(['base64','content_type','digest','updated_at']);
  expect(JSON.stringify(avatar)).not.toContain('PRIVATE_BIRTHDAY');expect(organizerAvatarProjection({...row,contentType:'image/svg+xml'})).toBeNull();expect(organizerAvatarProjection({...row,digest:'0'.repeat(64)})).toBeNull();
 });
 it('preserves map-backed candidates separately from manual labels and rejects mismatched names',()=>{
  const venue={name:'地图公园',address:'示例地址',location:{longitude:120.1,latitude:30.1,crs:'GCJ-02' as const},source:{provider:'amap' as const,checked_at:now.toISOString(),source_api:'https://restapi.amap.com/v5/place/text' as const}};
  const mapped={...draft,locations:[{id:'mapped',label:venue.name,venue}]};
  expect(requirementDraftSchema.safeParse(mapped).success).toBe(true);
  expect(requirementDraftSchema.safeParse({...mapped,locations:[{id:'mapped',label:'改过名字',venue}]}).success).toBe(false);
  expect(requirementDraftSchema.safeParse({...draft,locations:[{id:'manual',label:'自行填写地点'}]}).success).toBe(true);
 });
 it('validates actual segment ownership, not just UUID syntax',()=>{
  expect(()=>normalizeSubmission(surveyBase,draft,alice,{...response,selected_segment_ids:[activityId]},segments,now)).toThrow('环节');
  expect(()=>normalizeSubmission(surveyBase,{...draft,questions:[{...draft.questions[0],segment_id:activityId}]},alice,response,segments,now)).toThrow('关联');
 });
 it('natural deadline is closed and future deadline edits cannot reopen it',()=>{
  expect(effectiveSurveyStatus(surveyBase,deadline)).toBe('closed');
  expect(()=>assertPublishable({...surveyBase,status:'closed'},{...draft,deadline_at:'2040-01-01T00:00:00Z'},segments,now)).toThrow('重新发布');
 });
 it('rejects ambiguous offsetless publish times and accepts equivalent explicit zones',()=>{
  const unpublished={...surveyBase,status:'draft',deadlineAt:null};
  expect(()=>assertPublishable(unpublished,{...draft,deadline_at:'2030-01-02T00:00:00'},segments,now)).toThrow('时区');
  expect(()=>assertPublishable(unpublished,{...draft,starts_at:'2030-01-03'},segments,now)).toThrow('时区');
  expect(()=>assertPublishable(unpublished,{...draft,deadline_at:'2030-01-02T08:00:00+08:00'},segments,now)).not.toThrow();
  expect(()=>assertPublishable(unpublished,draft,segments,now)).not.toThrow();
 });
 it('validates final option ownership, other semantics and nonblank decisions',()=>{
  expect(()=>normalizeFinalSelection(draft,{location_id:'foreign',location_other:null,note:''})).toThrow('候选');
  expect(()=>normalizeFinalSelection(draft,{location_id:'park',location_other:'other',note:''})).toThrow('同时');
  expect(()=>normalizeFinalSelection(draft,{location_id:null,location_other:null,note:'  '})).toThrow('明确');
 });
});

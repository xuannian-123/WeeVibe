import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { attributionFixture, I, id } from './application-attribution-fixture';
import { activityDetailSchema, applyToActivityInputSchema } from '../packages/contracts/src/activities';
import { applicationAttributionsSchema } from '../packages/contracts/src/application-attributions';
const h = vi.hoisted(() => ({ f: null as any }));
vi.mock('../apps/web/src/server/db', () => ({ withDb: async (run: any) => run(h.f.db) }));
import { applyToActivity, decideApplication } from '../apps/web/src/server/activities/applications';
import { getApplicationAttributions } from '../apps/web/src/server/activities/application-attributions';
import { withdrawApplication } from '../apps/web/src/server/activities/withdrawal';
const body = (extra = {}) => applyToActivityInputSchema.parse({ idempotency_key: 'original-application-key', expected_revision: h.f.activity.revision,
 segments: [{ segment_id: I.main, plan_revision: 3 }], display_name: 'public applicant', invitation_source_id: id(31), ...extra });
const read = (actor = I.a) => getApplicationAttributions(I.activity, actor);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T10:00:00Z')); h.f = attributionFixture(); });
afterEach(() => vi.useRealTimers());
describe('actual application attribution service with offline transactional adapter (not PostgreSQL)', () => {
 it('persists only validated same-activity public source, preserving original public snapshot shape', async () => {
  const r = await applyToActivity(I.activity, I.stranger, body());
  expect(h.f.apps[0].invitationSourceId).toBe(id(31)); expect(activityDetailSchema.parse(r)).toEqual(r);
  expect(r.viewer.applications[0]).not.toHaveProperty('invitation_source_id');
  expect(JSON.stringify(r)).not.toContain('PUBLIC_ENTRY_NAME');
  expect(h.f.order[0]).toBe('lock'); expect(h.f.db.$transaction.mock.calls[0][1].isolationLevel).toBe('Serializable');
  expect(h.f.tx.invitationSource.findFirst).toHaveBeenCalledExactlyOnceWith({where:{id:id(31),activityId:I.activity},select:{id:true,activityId:true}});
  expect(h.f.activity.membershipRevision).toBe(1); expect(h.f.tx.participation.upsert).not.toHaveBeenCalled();
 });
 it('old input has no new field added, direct/legacy source remains unknown and original response valid', async () => {
  const old = body(); delete old.invitation_source_id; const original = structuredClone(old);
  const r = await applyToActivity(I.activity, I.stranger, old); expect(old).toEqual(original);
  expect(h.f.tx.invitationSource.findFirst).not.toHaveBeenCalled(); expect(h.f.tx.activityApplication.create.mock.calls[0][0].data).not.toHaveProperty('invitationSourceId');
  expect((await read()).entries[0].source).toBeNull(); expect(activityDetailSchema.safeParse(r).success).toBe(true);
 });
 it.each(['missing','foreign'])('rejects %s source before writes and rolls back', async kind => {
  const before = h.f.snapshot(); await expect(applyToActivity(I.activity,I.stranger,body({invitation_source_id:kind==='missing'?id(99):id(32)}))).rejects.toMatchObject({code:'INVALID_INPUT',status:409});
  expect(h.f.snapshot()).toEqual(before); expect(h.f.tx.activityApplication.create).not.toHaveBeenCalled();
 });
 it('does not require inviter still joined or manager, and does not query private identity', async () => {
  h.f.activity.segments.forEach((s:any)=>s.participations.forEach((p:any)=>{if(p.userId===I.b)p.status='exited';}));
  await applyToActivity(I.activity,I.stranger,body()); const r=await read();expect(r.entries[0].source?.inviter_display_name).toBe('PUBLIC_ENTRY_NAME');
  expect(h.f.tx.privateProfile.findMany).not.toHaveBeenCalled(); expect(h.f.tx.privateProfile.findUnique).not.toHaveBeenCalled();
 });
 it('successful original key replays current snapshot even when old source no longer readable and activity canceled', async () => {
  const input=body();await applyToActivity(I.activity,I.stranger,input);h.f.sources=[];h.f.activity.cancelledAt=new Date();h.f.activity.revision=5;
  h.f.tx.invitationSource.findFirst.mockClear();const before=h.f.snapshot();const r=await applyToActivity(I.activity,I.stranger,input);
  expect(r.revision).toBe(5);expect(h.f.snapshot()).toEqual(before);expect(h.f.tx.invitationSource.findFirst).not.toHaveBeenCalled();
 });
 it('same key with different or omitted source cannot overwrite first provenance',async()=>{
  const input=body();await applyToActivity(I.activity,I.stranger,input);
  await expect(applyToActivity(I.activity,I.stranger,{...input,invitation_source_id:id(32)})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  const without={...input};delete without.invitation_source_id;await expect(applyToActivity(I.activity,I.stranger,without)).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  expect(h.f.apps).toHaveLength(1);expect(h.f.apps[0].invitationSourceId).toBe(id(31));
 });
 it.each(['canceled','closed','full','stale-plan','already-joined','pending'])('source never bypasses ordinary %s rule',async kind=>{
  let actor=I.stranger;
  if(kind==='canceled')h.f.activity.cancelledAt=new Date();if(kind==='closed')h.f.activity.segments[0].deadlineAt=new Date();
  if(kind==='full')h.f.activity.segments[0].capacity=3;if(kind==='stale-plan')h.f.activity.segments[0].planRevision=4;
  if(kind==='already-joined')actor=I.b;if(kind==='pending')h.f.addApp();
  const before=h.f.snapshot();await expect(applyToActivity(I.activity,actor,body())).rejects.toThrow();expect(h.f.snapshot()).toEqual(before);
 });
 it.each(['targets','event','key','projection'])('failure at %s rolls back source and all original application writes',async phase=>{
  const before=h.f.snapshot();if(phase==='targets')h.f.tx.applicationTarget.createMany.mockRejectedValueOnce(Error('fixture'));
  if(phase==='event')h.f.tx.activityEvent.create.mockRejectedValueOnce(Error('fixture'));if(phase==='key')h.f.tx.activityMutationKey.create.mockRejectedValueOnce(Error('fixture'));
  if(phase==='projection')h.f.tx.activityApplication.findMany.mockRejectedValueOnce(Error('fixture'));
  await expect(applyToActivity(I.activity,I.stranger,body())).rejects.toThrow();expect(h.f.snapshot()).toEqual(before);
 });
 it('source lookup cannot move a first application past its existing cutoff',async()=>{
  const impl=h.f.tx.invitationSource.findFirst.getMockImplementation();h.f.tx.invitationSource.findFirst.mockImplementationOnce(async(args:any)=>{const result=await impl(args);vi.setSystemTime(new Date('2030-01-01T10:30:00Z'));return result;});
  const before=h.f.snapshot();await expect(applyToActivity(I.activity,I.stranger,body())).rejects.toMatchObject({code:'SEGMENT_APPLICATION_CLOSED'});expect(h.f.snapshot()).toEqual(before);
 });
 it('Serializable retry preserves one provenance/application/event',async()=>{
  h.f.tx.activityEvent.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('fixture',{code:'P2034',clientVersion:'fixture'}));
  await applyToActivity(I.activity,I.stranger,body());expect(h.f.apps).toHaveLength(1);expect(h.f.events).toHaveLength(1);expect(h.f.db.$transaction).toHaveBeenCalledTimes(2);
 });
 it('approval retains provenance while original seats and accepted versions work unchanged',async()=>{
  await applyToActivity(I.activity,I.stranger,body());const app=h.f.apps[0];const r=await decideApplication(I.activity,app.id,I.a,{decision:'approve',expected_revision:2,idempotency_key:'approve-attributed'});
  expect(h.f.apps[0]).toMatchObject({status:'approved',invitationSourceId:id(31)});expect(r.segments[0].counts.occupied_count).toBe(4);
  expect(h.f.activity.segments[0].participations.find((p:any)=>p.userId===I.stranger)).toMatchObject({sourceApplicationId:app.id,acceptedPlanRevision:3});
  expect((await read()).entries[0].source?.invitation_id).toBe(id(31));
 });
 it('withdrawal preserves historical attribution and never obtains/removes seats',async()=>{
  await applyToActivity(I.activity,I.stranger,body());const a=h.f.apps[0];await withdrawApplication(I.activity,a.id,I.stranger,{expected_revision:2,idempotency_key:'withdraw-attributed'});
  expect(h.f.apps[0]).toMatchObject({status:'withdrawn',invitationSourceId:id(31)});expect((await read()).entries[0].source?.invitation_id).toBe(id(31));expect(h.f.tx.participation.upsert).not.toHaveBeenCalled();
 });
});
describe('read-only actor-filtered attribution projection',()=>{
 it('manager gets all statuses with public source only, applicant gets only own, stranger gets empty not others',async()=>{
  for(const status of ['pending','approved','rejected','withdrawn'])h.f.addApp(status==='pending'?I.stranger:I.b,id(31),status);
  const r=await read();expect(r.entries).toHaveLength(4);expect(r).toMatchObject({schema_version:1,revision:1,viewer_user_id:I.a,is_manager:true,complete:true,limit:2000});
  expect((await read(I.stranger)).entries).toHaveLength(1);expect((await read(I.c)).entries).toEqual([]);
  expect(JSON.stringify(r)).not.toMatch(/PRIVATE_|inviterUserId|applicantUserId|targets|avatar|displayName|privateProfile/);
  expect(h.f.db.$transaction.mock.calls.every((c:any)=>c[1].isolationLevel==='RepeatableRead')).toBe(true);
  expect(h.f.tx.activity.update).not.toHaveBeenCalled();expect(h.f.tx.activityEvent.create).not.toHaveBeenCalled();expect(h.f.tx.activityMutationKey.create).not.toHaveBeenCalled();
 });
 it('requests only bounded identity/ownership and public-source fields in stable order',async()=>{
  h.f.addApp();await read(I.stranger);expect(h.f.tx.activity.findUnique).toHaveBeenCalledExactlyOnceWith({where:{id:I.activity},select:{id:true,revision:true,currentManagerId:true}});
  expect(h.f.tx.activityApplication.findMany).toHaveBeenCalledExactlyOnceWith({where:{activityId:I.activity,applicantUserId:I.stranger},orderBy:[{createdAt:'asc'},{id:'asc'}],take:2001,select:{id:true,activityId:true,applicantUserId:true,invitationSourceId:true,invitationSource:{select:{id:true,activityId:true,inviterDisplayName:true}}}});
 });
 it('permission is recomputed after manager handover; original creator has only own application',async()=>{
  h.f.addApp(I.a);h.f.addApp(I.stranger);h.f.activity.currentManagerId=I.b;expect((await read(I.a)).entries).toHaveLength(1);expect((await read(I.b)).entries).toHaveLength(2);
 });
 it('null published name is kept null, duplicates remain independent',async()=>{
  h.f.sources[0].inviterDisplayName=null;h.f.addApp();h.f.addApp();const r=await read();expect(r.entries).toHaveLength(2);expect(r.entries.every(e=>e.source?.inviter_display_name===null)).toBe(true);
 });
 it('canceled activity still supports authorized historical attribution',async()=>{h.f.addApp();h.f.activity.cancelledAt=new Date();expect((await read()).entries).toHaveLength(1);});
 it('complete upper limit is explicit; overflow returns no truncated list',async()=>{
  for(let n=0;n<2000;n++)h.f.addApp();expect((await read()).entries).toHaveLength(2000);h.f.addApp();await expect(read()).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE',status:503});
 });
 it.each(['foreign-activity','foreign-owner','dangling','foreign-source','source-extra','duplicate','invalid-revision'])('fails closed for malformed projected %s',async kind=>{
  h.f.addApp();const impl=h.f.tx.activityApplication.findMany.getMockImplementation();
  if(kind==='invalid-revision')h.f.activity.revision=0;
  else h.f.tx.activityApplication.findMany.mockImplementationOnce(async(args:any)=>{const rows=await impl(args);const r=rows[0];if(kind==='foreign-activity')r.activityId=id(999);if(kind==='foreign-owner')r.applicantUserId=I.b;if(kind==='dangling')r.invitationSource=null;if(kind==='foreign-source')r.invitationSource.activityId=id(999);if(kind==='source-extra')r.invitationSource.inviterDisplayName='x'.repeat(41);if(kind==='duplicate')rows.push(structuredClone(r));return rows;});
  await expect(read(I.stranger)).rejects.toMatchObject({code:'DATABASE_UNAVAILABLE'});
 });
 it('normalizes legal uppercase UUIDs and rejects malformed actor/activity before query',async()=>{
  expect((await getApplicationAttributions(I.activity.toUpperCase(),I.a.toUpperCase())).viewer_user_id).toBe(I.a);h.f.db.$transaction.mockClear();
  expect(()=>getApplicationAttributions('bad',I.a)).toThrow();expect(()=>getApplicationAttributions(I.activity,'bad')).toThrow();expect(h.f.db.$transaction).not.toHaveBeenCalled();
 });
 it('missing activity is 404 without querying applications',async()=>{await expect(getApplicationAttributions(id(999),I.a)).rejects.toMatchObject({code:'NOT_FOUND'});expect(h.f.tx.activityApplication.findMany).not.toHaveBeenCalled();});
 it('real projection satisfies strict dedicated DTO without modifying legacy public DTO',async()=>{h.f.addApp();expect(applicationAttributionsSchema.parse(await read())).toEqual(await read());});
});

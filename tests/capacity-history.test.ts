import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandoverFixture, handoverIds as I } from './handover-fixture';
const h = vi.hoisted(() => ({ f: null as any }));
vi.mock('../apps/web/src/server/db', () => ({ withDb: async (action: any) => action(h.f.db) }));
import { changeCapacity } from '../apps/web/src/server/activities/capacity';
import { getArrangementReview, reacceptArrangement } from '../apps/web/src/server/activities/arrangement';
import { arrangementPlan } from '../apps/web/src/server/activities/arrangement-history';
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T10:00:00Z')); h.f = createHandoverFixture();
  h.f.activity.revision = 3; h.f.activity.segments[0].participations[1].acceptedPlanRevision = 1;
  const current = arrangementPlan(h.f.activity.segments[0]);
  h.f.events = [
    { activityId: I.activity, revision: 2, createdAt: new Date('2030-01-01T09:01:00Z'), type: 'segment_arrangement_changed', detail: { schema_version: 1, segment_id: I.main, from_plan_revision: 1, to_plan_revision: 2, before: { ...current, minimum_participants: 2 }, after: { ...current, minimum_participants: 3 } } },
    { activityId: I.activity, revision: 3, createdAt: new Date('2030-01-01T09:02:00Z'), type: 'segment_arrangement_changed', detail: { schema_version: 1, segment_id: I.main, from_plan_revision: 2, to_plan_revision: 3, before: { ...current, minimum_participants: 3 }, after: { ...current, minimum_participants: 2 } } }
  ];
  h.f.tx.activityEvent.create.mockImplementation(async ({ data }: any) => { const row = { ...structuredClone(data), createdAt: new Date() }; h.f.events.push(row); return row; });
  h.f.tx.activityEvent.findMany = vi.fn(async ({ where, take }: any) => structuredClone(h.f.events.filter((e: any) => e.activityId === where.activityId && e.type === where.type && e.detail.segment_id === where.detail.equals).sort((a: any, b: any) => a.revision - b.revision).slice(0, take)));
});
afterEach(() => vi.useRealTimers());
const write = (capacity: number, key = `history-capacity-${h.f.activity.revision}`) => changeCapacity(I.activity, I.main, I.a, { idempotency_key: key, expected_revision: h.f.activity.revision, expected_capacity: h.f.activity.segments[0].capacity, capacity });
const read = (actor = I.b) => getArrangementReview(I.activity, I.main, actor);
const capEvent = (revision: number, planRevision: number, before: any, capacity: number) => ({ activityId: I.activity, revision, createdAt: new Date('2030-01-01T09:00:00Z'), type: 'segment_capacity_changed', detail: { schema_version: 1, segment_id: I.main, plan_revision: planRevision, before: structuredClone(before), after: { ...structuredClone(before), capacity }, occupied_count: 3 } });
describe('v2 actual reader/writer preserves independent capacity and acceptance history', () => {
  it('fixes recorded gap: ready → capacity-only write → still ready; actual reaccept succeeds without changing seats/capacity', async () => {
    const before = await read(); expect(before.state).toBe('ready'); expect(before.can_reaccept).toBe(true); expect(before.changes).toHaveLength(2);
    const oldEvents = structuredClone(h.f.events); await write(4);
    const after = await read(); expect(after).toMatchObject({ schema_version: 3, history_format: 'verified_v3', state: 'ready', can_reaccept: true, current_plan_revision: 3, accepted_plan_revision: 1,
      capacity_changes: [{ activity_revision: 4, plan_revision: 3, before_capacity: 8, capacity: 4 }] });
    expect(after.accepted_plan).not.toHaveProperty('capacity'); expect(after.changes.every(change => !('capacity' in change.before) && !('capacity' in change.after))).toBe(true);
    expect(h.f.events.slice(0, 2)).toEqual(oldEvents); expect(after.history_digest).not.toBe(before.history_digest);
    const seats = structuredClone(h.f.activity.segments[0].participations);
    const result = await reacceptArrangement(I.activity, I.main, I.b, { action: 'reaccept', idempotency_key: 'accept-after-capacity', expected_revision: after.revision, expected_plan_revision: 3, from_accepted_plan_revision: 1, history_digest: after.history_digest! });
    expect(result.segments[0].capacity).toBe(4); expect(result.segments[0].counts.occupied_count).toBe(3); expect(h.f.activity.segments[0].participations).toEqual(seats.map((p: any) => p.userId === I.b ? { ...p, acceptedPlanRevision: 3, acceptedAt: new Date() } : p));
  });
  it('reads multiple same-version capacity operations without inventing new acceptance revisions', async () => { await write(4); await write(6); await write(3); const r = await read(); expect(r.state).toBe('ready'); expect(r.changes).toHaveLength(2); expect(r.capacity_changes.map(e => [e.activity_revision, e.plan_revision, e.before_capacity, e.capacity])).toEqual([[4,3,8,4],[5,3,4,6],[6,3,6,3]]); expect(r.current_plan_revision).toBe(3); });
  it('reconstructs capacity events before, between and after minimum events by activity revision', async () => {
    const first = h.f.events[0], second = h.f.events[1]; first.revision = 3; second.revision = 5;
    const before = structuredClone(first.detail.before);
    for (const p of [first.detail.before, first.detail.after]) p.capacity = 10;
    for (const p of [second.detail.before, second.detail.after]) p.capacity = 12;
    const prefix = capEvent(2,1,before,10), middle = capEvent(4,2,first.detail.after,12);
    h.f.events = [prefix,first,middle,second]; h.f.activity.revision = 5; h.f.activity.segments[0].capacity = 12;
    await write(4); const r = await read(); expect(r.state).toBe('ready'); expect(r.changes.map(x=>x.activity_revision)).toEqual([3,5]); expect(r.capacity_changes.map(x=>x.activity_revision)).toEqual([2,4,6]); expect(r.accepted_plan).not.toHaveProperty('capacity');
  });
  it('member accepted during the same plan version never acquires an invented acceptance-time capacity', async () => {
    await write(4); h.f.activity.segments[0].participations[1].acceptedPlanRevision = 2;
    h.f.activity.segments[0].participations[1].acceptedAt = new Date('2030-01-01T09:01:30Z');
    const r = await read(); expect(r.state).toBe('ready'); expect(r.accepted_plan?.minimum_participants).toBe(3); expect(r.accepted_plan).not.toHaveProperty('capacity'); expect(r.changes).toHaveLength(1); expect(r.capacity_changes[0].capacity).toBe(4);
  });
  it('current acceptance remains up-to-date across same-version capacity changes and does not claim historical capacity', async () => { await write(4); h.f.tx.activityEvent.findMany.mockClear(); const r = await read(I.a); expect(r).toMatchObject({ schema_version:3, state:'up_to_date', can_reaccept:false, history_digest:null, changes:[], capacity_changes:[], current_plan:{capacity:4} }); expect(r.accepted_plan).not.toHaveProperty('capacity'); expect(h.f.tx.activityEvent.findMany).not.toHaveBeenCalled(); });
  it.each(['missing-capacity','duplicate-capacity','capacity-extra','capacity-conditions','capacity-plan','capacity-before','capacity-tail','capacity-occupied','future-event','future-plan','cross-event-revision','unknown-version','missing-minimum','minimum-capacity-gap'])('fails closed for %s without partial promises', async flaw => {
    await write(4); const e=h.f.events[2];
    if(flaw==='missing-capacity')h.f.events.pop(); if(flaw==='duplicate-capacity')h.f.events.push(structuredClone(e));
    if(flaw==='capacity-extra')e.detail.privateOrigin='PRIVATE_SENTINEL';if(flaw==='capacity-conditions')e.detail.after.requirements='changed';if(flaw==='capacity-plan')e.detail.plan_revision=2;
    if(flaw==='capacity-before')e.detail.before.capacity=9;if(flaw==='capacity-tail')e.detail.after.capacity=5;if(flaw==='capacity-occupied')e.detail.occupied_count=5;
    if(flaw==='future-event')e.revision=99;if(flaw==='future-plan')e.detail.plan_revision=4;if(flaw==='cross-event-revision')e.revision=3;
    if(flaw==='unknown-version')e.detail.schema_version=2;if(flaw==='missing-minimum')h.f.events.shift();if(flaw==='minimum-capacity-gap')h.f.events[1].detail.before.capacity=9;
    const r=await read();expect(r).toMatchObject({state:'unavailable',can_reaccept:false,accepted_plan:null,history_digest:null,changes:[],capacity_changes:[]});expect(JSON.stringify(r)).not.toContain('PRIVATE_SENTINEL');
  });
  it('rejects time-invalid or over-limit mixed records without truncating to a valid-looking chain', async () => { await write(4); h.f.events[2].createdAt=new Date('2031-01-01T00:00:00Z'); expect((await read()).state).toBe('unavailable'); h.f.events[2].createdAt=new Date();h.f.tx.activityEvent.findMany.mockResolvedValueOnce(Array.from({length:500},()=>h.f.events[0])).mockResolvedValueOnce([h.f.events[2]]);expect((await read()).state).toBe('unavailable'); });
  it('a capacity edit invalidates a reviewed old revision/digest without granting new acceptance', async () => { const r=await read();await write(4);await expect(reacceptArrangement(I.activity,I.main,I.b,{action:'reaccept',idempotency_key:'old-reviewed-capacity',expected_revision:r.revision,expected_plan_revision:3,from_accepted_plan_revision:1,history_digest:r.history_digest!})).rejects.toMatchObject({code:'VERSION_CONFLICT'});await expect(reacceptArrangement(I.activity,I.main,I.b,{action:'reaccept',idempotency_key:'old-digest-fresh-revision',expected_revision:h.f.activity.revision,expected_plan_revision:3,from_accepted_plan_revision:1,history_digest:r.history_digest!})).rejects.toMatchObject({code:'ARRANGEMENT_HISTORY_UNAVAILABLE'});expect(h.f.activity.segments[0].participations[1].acceptedPlanRevision).toBe(1); });
});

/** WG-04 acceptance against a disposable, explicitly selected LOCAL PostgreSQL.
 * Real services/transactions; users are fixtures, not a wx.login or phone check.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { ActivityDetail, CreateActivityInput } from '../packages/contracts/src';

assert.ok(process.argv.includes('--fixture-only'), 'Explicit --fixture-only required');
assert.ok(process.env.DATABASE_URL, 'An isolated acceptance database is required');
const target = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'No shared or remote databases');
assert.match(target.pathname, /^\/weevibe_acceptance_[a-z0-9_]+$/);
assert.ok(!target.hash);
for (const [name, value] of target.searchParams) assert.ok(name === 'schema' && value === 'public');
const { getDb } = await import('../apps/web/src/server/db');
const { createActivity } = await import('../apps/web/src/server/activities/create');
const { getActivity } = await import('../apps/web/src/server/activities/snapshot');
const { applyToActivity, decideApplication } = await import('../apps/web/src/server/activities/applications');
const { changeFormation } = await import('../apps/web/src/server/activities/formation');
const { changeParticipation } = await import('../apps/web/src/server/activities/participation');
const db = getDb(), key = () => `wg04-${randomUUID()}`;
const checks: string[] = [];
async function check(name: string, action: () => Promise<void>) {
  await action(); checks.push(name); console.log(`PASS ${name}`);
}
function input(capacity = 6, minimum = 4): CreateActivityInput {
  const day = Date.now() + 7 * 86_400_000;
  return { idempotency_key: key(), name: 'WG04 LOCAL FIXTURE', timezone: 'Asia/Shanghai',
    main_segment_ref: 'main', participating_segment_refs: ['main', 'dinner', 'karaoke'],
    segments: ['main', 'dinner', 'karaoke'].map((ref, i) => ({
      client_ref: ref, name: `Local ${ref}`, type: 'custom',
      starts_at: new Date(day + i * 7_200_000).toISOString(),
      ends_at: new Date(day + i * 7_200_000 + 3_600_000).toISOString(),
      deadline_at: new Date(day - 3_600_000 + i * 7_200_000).toISOString(),
      minimum_participants: i === 0 ? minimum : 1, capacity: i === 2 ? 1 : capacity,
      location: { name: 'Synthetic local venue', address: null, source_url: null },
      fee: { kind: 'total', amount_cents: 24000, currency: 'CNY', note: 'fixed fixture quote' }, requirements: 'Original fixture conditions'
    })) };
}
try {
  const people = await Promise.all(Array.from({ length: 9 }, () => db.user.create({ data: {} })));
  const [manager, a, b, c, e, newcomer, challenger, outsider, extra] = people;
  let d = await createActivity(manager.id, input());
  const id = d.activity_id, main = d.main_segment_id, dinner = d.segments[1].segment_id, karaoke = d.segments[2].segment_id;
  async function join(activityId: string, person: string, segmentIds: string[]) {
    const current = await getActivity(activityId, person);
    const applied = await applyToActivity(activityId, person, {
      idempotency_key: key(), expected_revision: current.revision,
      segments: segmentIds.map(segment_id => ({ segment_id, plan_revision: current.segments.find(s => s.segment_id === segment_id)!.plan_revision }))
    });
    return decideApplication(activityId, applied.viewer.applications.at(-1)!.application_id, manager.id,
      { idempotency_key: key(), expected_revision: applied.revision, decision: 'approve' });
  }
  async function form(action: 'set-verification' | 'confirm-formation') {
    const current = await getActivity(id, manager.id);
    const m = current.segments.find(s => s.segment_id === current.main_segment_id)!;
    return changeFormation(id, manager.id, { idempotency_key: key(), expected_revision: current.revision,
      segment_id: m.segment_id, expected_plan_revision: m.plan_revision,
      ...(action === 'set-verification' ? { action, verified: true } : { action }) });
  }
  async function exit(person: string, segments: string[]) {
    const current = await getActivity(id, person);
    return changeParticipation(id, person, { action: 'exit', idempotency_key: key(), expected_revision: current.revision, segment_ids: segments });
  }
  await check('five joined, explicit verification and confirmation; formation is distinct from booking', async () => {
    for (const person of [a, b, c, e]) d = await join(id, person.id, [main, dinner]);
    assert.equal(d.segments[0].counts.occupied_count, 5); assert.equal(d.formation_status, 'not_confirmed');
    d = await form('set-verification'); assert.equal(d.formation_status, 'not_confirmed');
    d = await form('confirm-formation'); assert.equal(d.formation_status, 'confirmed');
    assert.equal(d.segments[0].counts.is_full, false); assert.equal(d.segments[0].booking_status, 'unknown');
  });
  const original = await db.segment.findUniqueOrThrow({ where: { id: main } });
  const originalAcceptance = await db.participation.findUniqueOrThrow({ where: { segmentId_userId: { segmentId: main, userId: c.id } } });
  await check('non-main exit preserves main confirmation and every unselected seat', async () => {
    d = (await exit(a.id, [dinner])).activity;
    assert.equal(d.formation_status, 'confirmed'); assert.equal(d.segments[0].counts.occupied_count, 5);
    assert.equal(d.segments[1].counts.occupied_count, 4);
  });
  let oldExit!: { action: 'exit'; idempotency_key: string; expected_revision: number; segment_ids: string[] };
  await check('5 to 4 stays formed; 4 to 3 releases seat and requires replacement', async () => {
    oldExit = { action: 'exit', idempotency_key: key(), expected_revision: d.revision, segment_ids: [main] };
    d = (await changeParticipation(id, a.id, oldExit)).activity;
    assert.equal(d.formation_status, 'confirmed'); assert.equal(d.segments[0].counts.occupied_count, 4);
    d = (await exit(b.id, [main])).activity;
    assert.equal(d.formation_status, 'not_confirmed'); assert.equal(d.segments[0].counts.occupied_count, 3);
    const row = await db.activity.findUniqueOrThrow({ where: { id } }); assert.equal(row.confirmedAt, null);
    const s = await db.segment.findUniqueOrThrow({ where: { id: main } });
    for (const field of ['fee', 'location', 'minimumParticipants', 'capacity', 'planRevision', 'requirements', 'bookingStatus'] as const) assert.deepEqual(s[field], original[field]);
    await assert.rejects(() => form('confirm-formation'), { code: 'FORMATION_NOT_READY' });
  });
  await check('replacement joins only main; reaching minimum never restores formation automatically', async () => {
    d = await join(id, newcomer.id, [main]);
    assert.equal(d.segments[0].counts.occupied_count, 4); assert.equal(d.formation_status, 'not_confirmed');
    assert.equal((await getActivity(id, newcomer.id)).viewer.participations.length, 1);
    assert.equal(d.segments[1].counts.occupied_count, 4);
    const retained = await db.participation.findUniqueOrThrow({ where: { segmentId_userId: { segmentId: main, userId: c.id } } });
    assert.deepEqual(retained.acceptedAt, originalAcceptance.acceptedAt); assert.equal(retained.acceptedPlanRevision, originalAcceptance.acceptedPlanRevision);
    d = await form('confirm-formation'); assert.equal(d.formation_status, 'confirmed');
  });
  await check('return requires a fresh approved application; replaying old exit cannot remove the new seat', async () => {
    d = await join(id, a.id, [main]);
    const revision = d.revision, events = await db.activityEvent.count({ where: { activityId: id } });
    const replayed = await changeParticipation(id, a.id, oldExit);
    assert.equal(replayed.activity.viewer.participations.find(p => p.segment_id === main)?.status, 'joined');
    assert.match(replayed.notice, /本次未重复变更/); assert.equal(replayed.activity.revision, revision);
    assert.equal(await db.activityEvent.count({ where: { activityId: id } }), events);
    assert.equal(replayed.activity.formation_status, 'confirmed');
  });
  await check('adding a full segment fails as a whole without losing existing participation', async () => {
    const current = await getActivity(id, a.id);
    await assert.rejects(() => applyToActivity(id, a.id, { idempotency_key: key(), expected_revision: current.revision,
      segments: [dinner, karaoke].map(segment_id => ({ segment_id, plan_revision: 1 })) }), { code: 'CAPACITY_FULL' });
    assert.equal((await getActivity(id, a.id)).viewer.participations.find(p => p.segment_id === main)?.status, 'joined');
    assert.equal((await db.participation.findUniqueOrThrow({ where: { segmentId_userId: { segmentId: dinner, userId: a.id } } })).status, 'exited');
  });
  await check('failed exit rolls back seat, formation, revisions, event and idempotency key in real PG', async () => {
    const before = await getActivity(id, c.id), requestKey = key();
    const fn = `wg04_failure_${randomUUID().replaceAll('-', '')}`, trigger = `${fn}_trigger`;
    // All identifiers are locally generated; failure injection is allowed only by the local fixture guard above.
    await db.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."activityId" = '${id}'::uuid AND NEW."type" = 'participation_exited' THEN RAISE EXCEPTION 'WG04 fixture event failure'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "ActivityEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
      await assert.rejects(() => changeParticipation(id, c.id, { action: 'exit', idempotency_key: requestKey, expected_revision: before.revision, segment_ids: [main, dinner] }));
      const after = await getActivity(id, c.id);
      assert.equal(after.revision, before.revision); assert.equal(after.formation_status, before.formation_status);
      assert.deepEqual(after.viewer.participations, before.viewer.participations);
      assert.deepEqual(after.segments.map(s => s.counts), before.segments.map(s => s.counts));
      assert.equal(await db.activityMutationKey.count({ where: { actorUserId: c.id, key: requestKey } }), 0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "ActivityEvent"`);
      await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`);
    }
  });
  await check('outsider cannot exit another person and non-manager cannot confirm', async () => {
    d = await getActivity(id, manager.id);
    await assert.rejects(() => changeParticipation(id, outsider.id, { action: 'exit', idempotency_key: key(), expected_revision: d.revision, segment_ids: [main] }), { code: 'FORBIDDEN' });
    await assert.rejects(() => changeFormation(id, outsider.id, { action: 'confirm-formation', idempotency_key: key(), expected_revision: d.revision, segment_id: main, expected_plan_revision: 1 }), { code: 'FORBIDDEN' });
  });
  await check('retained but unaccepted seats block formation and cannot be taken by a replacement', async () => {
    const held = await createActivity(manager.id, input(1, 1));
    const heldMain = held.main_segment_id;
    await db.segment.update({ where: { id: heldMain }, data: { planRevision: 2, verificationStatus: 'manual_checked' } });
    const current = await getActivity(held.activity_id, manager.id);
    assert.equal(current.segments[0].counts.pending_acceptance_count, 1); assert.equal(current.segments[0].counts.remaining_capacity, 0);
    await assert.rejects(() => changeFormation(held.activity_id, manager.id, { action: 'confirm-formation', idempotency_key: key(), expected_revision: current.revision, segment_id: heldMain, expected_plan_revision: 2 }), { code: 'FORMATION_NOT_READY' });
    await assert.rejects(() => applyToActivity(held.activity_id, outsider.id, { idempotency_key: key(), expected_revision: current.revision, segments: [{ segment_id: heldMain, plan_revision: 2 }] }), { code: 'CAPACITY_FULL' });
  });
  await check('two concurrent approvals compete for one replacement seat; at most one commits', async () => {
    let race = await createActivity(manager.id, input(4, 4));
    const raceMain = race.main_segment_id;
    for (const person of [a, b]) race = await join(race.activity_id, person.id, [raceMain]);
    const pending: string[] = [];
    for (const person of [challenger, extra]) {
      race = await applyToActivity(race.activity_id, person.id, { idempotency_key: key(), expected_revision: race.revision, segments: [{ segment_id: raceMain, plan_revision: 1 }] });
      pending.push(race.viewer.applications.at(-1)!.application_id);
    }
    const results = await Promise.allSettled(pending.map(applicationId => decideApplication(race.activity_id, applicationId, manager.id,
      { decision: 'approve', idempotency_key: key(), expected_revision: race.revision })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const losing = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    assert.ok(['VERSION_CONFLICT', 'CAPACITY_FULL', 'CONCURRENT_MODIFICATION'].includes(losing.reason.code));
    const current = await getActivity(race.activity_id, manager.id);
    assert.equal(current.segments[0].counts.occupied_count, 4); assert.equal(current.formation_status, 'not_confirmed');
  });
  await check('main cutoff and start do not close later segments; manager exit does not transfer management', async () => {
    await db.segment.update({ where: { id: main }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    d = await getActivity(id, outsider.id);
    await assert.rejects(() => applyToActivity(id, outsider.id, { idempotency_key: key(), expected_revision: d.revision, segments: [{ segment_id: main, plan_revision: 1 }] }), { code: 'SEGMENT_APPLICATION_CLOSED' });
    await db.segment.update({ where: { id: main }, data: { startsAt: new Date(Date.now() - 1000) } });
    d = await join(id, outsider.id, [dinner]);
    assert.equal(d.segments[0].is_join_open, false); assert.equal(d.segments[1].counts.occupied_count, 5);
    d = (await exit(manager.id, [main, dinner, karaoke])).activity;
    assert.equal(d.viewer.is_manager, true); assert.ok(d.viewer.participations.every(p => p.status === 'exited'));
    assert.equal((await db.activity.findUniqueOrThrow({ where: { id } })).currentManagerId, manager.id);
  });
  console.log(`WG04 real PostgreSQL fixture groups passed: ${checks.length}`);
} finally {
  await db.$disconnect();
}

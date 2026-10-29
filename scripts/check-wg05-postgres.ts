/** Explicit local-only fixture acceptance; no real WeChat login or shared writes. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { editArrangementInputSchema, type ActivityDetail, type EditArrangementInput } from '../packages/contracts/src';
assert.ok(process.argv.includes('--fixture-only'));
assert.ok(process.env.DATABASE_URL);
const target = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname)); assert.match(target.pathname, /^\/weevibe_acceptance_[a-z0-9_]+$/); assert.ok(!target.hash);
for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public');
const { getDb } = await import('../apps/web/src/server/db');
const { createActivity } = await import('../apps/web/src/server/activities/create');
const { applyToActivity, decideApplication } = await import('../apps/web/src/server/activities/applications');
const { getActivity } = await import('../apps/web/src/server/activities/snapshot');
const { editArrangement, previewArrangementEdit } = await import('../apps/web/src/server/activities/arrangement-edit');
const { getArrangementReview, reacceptArrangement } = await import('../apps/web/src/server/activities/arrangement');
const { changeFormation } = await import('../apps/web/src/server/activities/formation');
const { verifySegment } = await import('../apps/web/src/server/activities/verification');
const { declareBooking, readBookingHistory } = await import('../apps/web/src/server/activities/booking');
const db = getDb(), key = () => `wg05-${randomUUID()}`;
let checks = 0;
const check = async (label: string, work: () => Promise<void>) => { await work(); checks++; console.log(`PASS ${label}`); };
function command(d: ActivityDetail): EditArrangementInput {
  return editArrangementInputSchema.parse({ idempotency_key: key(), expected_revision: d.revision,
    main_segment_ref: d.segments.find(s => s.segment_id === d.main_segment_id)!.client_ref,
    segments: d.segments.map(s => ({ segment_id: s.segment_id, client_ref: s.client_ref, type: s.type, name: s.name,
      starts_at: s.starts_at, ends_at: s.ends_at, deadline_at: s.deadline_at, minimum_participants: s.minimum_participants, capacity: s.capacity,
      location: s.location, fee: s.fee, requirements: s.requirements, cancelled: !!s.cancelled_at })) });
}
try {
  const [manager, member, outsider] = await Promise.all([0, 1, 2].map(() => db.user.create({ data: {} })));
  const day = Date.now() + 7 * 86400000;
  let d = await createActivity(manager.id, { idempotency_key: key(), name: 'WG05 LOCAL FIXTURE', timezone: 'Asia/Shanghai', main_segment_ref: 'main', participating_segment_refs: ['main', 'dinner'],
    segments: ['main', 'dinner'].map((client_ref, i) => ({ client_ref, name: client_ref, type: 'custom', starts_at: new Date(day + i * 7200000).toISOString(),
      ends_at: new Date(day + i * 7200000 + 3600000).toISOString(), deadline_at: new Date(day - 3600000).toISOString(), minimum_participants: 1, capacity: 3,
      location: { name: 'Synthetic original venue', address: null, source_url: null }, fee: { kind: 'per_person', amount_cents: 6000, currency: 'CNY', note: 'reference' }, requirements: '' })) });
  const id = d.activity_id, main = d.main_segment_id, dinner = d.segments[1].segment_id;
  d = await applyToActivity(id, member.id, { idempotency_key: key(), expected_revision: d.revision, segments: d.segments.map(s => ({ segment_id: s.segment_id, plan_revision: s.plan_revision })) });
  d = await decideApplication(id, d.viewer.applications[0].application_id, manager.id, { decision: 'approve', idempotency_key: key(), expected_revision: d.revision });
  d = await changeFormation(id, manager.id, { action: 'set-verification', verified: true, idempotency_key: key(), expected_revision: d.revision, segment_id: main, expected_plan_revision: 1 });
  d = await changeFormation(id, manager.id, { action: 'confirm-formation', idempotency_key: key(), expected_revision: d.revision, segment_id: main, expected_plan_revision: 1 });
  d = await declareBooking(id, dinner, manager.id, { idempotency_key: key(), expected_revision: d.revision, expected_plan_revision: 1, expected_booking_status: 'unknown' });
  await check('restaurant-only edit retains seats, clears new booking and keeps unaffected main formed', async () => {
    const edit = command(d); edit.segments[1].location.name = 'Synthetic new restaurant'; edit.segments[1].fee.amount_cents = 8000;
    edit.segments[1].deadline_at = new Date(Date.now() - 1000).toISOString();
    const revision = d.revision, preview = await previewArrangementEdit(id, manager.id, edit);
    assert.equal(preview.changes.length, 1); assert.equal((await getActivity(id, manager.id)).revision, revision);
    d = await editArrangement(id, manager.id, edit);
    assert.equal(d.formation_status, 'confirmed'); assert.equal(d.segments[1].plan_revision, 2);
    assert.equal(d.segments[1].counts.occupied_count, 2); assert.equal(d.segments[1].counts.pending_acceptance_count, 2);
    assert.equal(d.segments[1].booking_status, 'unknown'); assert.equal(d.segments[1].verification_status, 'unknown');
    const history = await readBookingHistory(id, dinner, manager.id);
    assert.equal(history.items.length, 1); assert.equal(history.items[0].matches_current_venue_time, false);
    assert.equal((await editArrangement(id, manager.id, edit)).revision, d.revision);
    d = await verifySegment(id, manager.id, { action: 'verify-segment', segment_id: dinner, expected_revision: d.revision, expected_plan_revision: 2, idempotency_key: key(), verified: true });
    assert.equal(d.segments[1].verification_status, 'manual_checked'); assert.equal(d.segments[1].booking_status, 'unknown');
    await assert.rejects(() => editArrangement(id, outsider.id, edit), { code: 'FORBIDDEN' });
  });
  await check('member reads full old/new venue and price, and accepts after enrollment cutoff without changing seats', async () => {
    const review = await getArrangementReview(id, dinner, member.id);
    assert.equal(review.schema_version, 4); assert.equal(review.state, 'ready'); assert.equal(review.can_reaccept, true);
    if (review.schema_version !== 4) throw new Error('Expected complete v4 history');
    assert.equal(review.plan_changes[0].event.before.location.name, 'Synthetic original venue');
    assert.equal(review.plan_changes[0].event.after.fee.amount_cents, 8000);
    assert.ok(review.history_digest && review.accepted_plan_revision !== null);
    d = await reacceptArrangement(id, dinner, member.id, { action: 'reaccept', idempotency_key: key(), expected_revision: review.revision,
      expected_plan_revision: review.current_plan_revision, from_accepted_plan_revision: review.accepted_plan_revision, history_digest: review.history_digest });
    assert.equal(d.segments[1].counts.occupied_count, 2); assert.equal(d.segments[1].counts.pending_acceptance_count, 1);
    await assert.rejects(() => getArrangementReview(id, dinner, outsider.id), { code: 'FORBIDDEN' });
  });
  await check('adding an optional segment does not enroll anyone or alter current acceptance', async () => {
    const edit = command(d); edit.segments.push({ ...edit.segments[1], segment_id: undefined, client_ref: 'karaoke', name: 'Karaoke',
      starts_at: new Date(day + 14400000).toISOString(), ends_at: new Date(day + 18000000).toISOString(), deadline_at: new Date(day + 10800000).toISOString() });
    d = await editArrangement(id, manager.id, edit);
    assert.equal(d.segments[2].counts.occupied_count, 0); assert.equal(d.segments[1].counts.pending_acceptance_count, 1);
  });
  await check('time changes detect shared-participant cross impact and clear affected main confirmation', async () => {
    const edit = command(d); edit.segments[1].starts_at = new Date(day + 9000000).toISOString();
    d = await editArrangement(id, manager.id, edit);
    assert.equal(d.formation_status, 'not_confirmed'); assert.equal(d.segments[0].counts.pending_acceptance_count, 2);
    const mainReview = await getArrangementReview(id, main, member.id); assert.equal(mainReview.state, 'ready');
    assert.equal(d.segments[1].verification_status, 'unknown');
  });
  await check('minimum and operational changes remain reconstructable across multiple edits', async () => {
    const edit = command(d); edit.segments[0].minimum_participants = 2; edit.segments[0].capacity = 4;
    d = await editArrangement(id, manager.id, edit);
    const review = await getArrangementReview(id, main, member.id);
    assert.equal(review.state, 'ready'); assert.equal(review.current_plan.minimum_participants, 2); assert.equal(review.current_plan.capacity, 4);
    assert.equal(d.segments[0].counts.occupied_count, 2);
    const bad = command(d); bad.segments[0].capacity = 1; bad.segments[0].minimum_participants = 1;
    await assert.rejects(() => editArrangement(id, manager.id, bad), { code: 'CAPACITY_BELOW_OCCUPIED' });
  });
  await check('cancel original main with explicit replacement preserves historical rows and never inherits formation', async () => {
    const edit = command(d); edit.main_segment_ref = 'dinner'; edit.segments[0].cancelled = true;
    d = await editArrangement(id, manager.id, edit);
    assert.equal(d.main_segment_id, dinner); assert.ok(d.segments[0].cancelled_at); assert.equal(d.formation_status, 'not_confirmed');
    assert.equal(await db.participation.count({ where: { segmentId: main } }), 2);
  });
  await check('failed summary event rolls the entire multi-segment edit and key back', async () => {
    const before = await getActivity(id, manager.id), edit = command(before); edit.segments[1].requirements = 'New future requirement';
    const fn = `wg05_failure_${randomUUID().replaceAll('-', '')}`, trigger = `${fn}_trigger`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."activityId" = '${id}'::uuid AND NEW."type" = 'activity_arrangement_edited' THEN RAISE EXCEPTION 'WG05 fixture failure'; END IF; RETURN NEW; END $$`);
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "ActivityEvent" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`);
      await assert.rejects(() => editArrangement(id, manager.id, edit));
      const after = await getActivity(id, manager.id); assert.equal(after.revision, before.revision); assert.deepEqual(after.segments, before.segments);
      assert.equal(await db.activityMutationKey.count({ where: { actorUserId: manager.id, key: edit.idempotency_key } }), 0);
    } finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "ActivityEvent"`); await db.$executeRawUnsafe(`DROP FUNCTION "${fn}"()`); }
  });
  console.log(`WG05 real PostgreSQL fixture groups passed: ${checks}`);
} finally { await db.$disconnect(); }

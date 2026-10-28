/** Disposable PostgreSQL only. No shared database, real WeChat or deployment. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
assert.ok(process.argv.includes('--fixture-only'));
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname));
assert.match(target.pathname, /^\/weevibe_acceptance_[a-z0-9_]+$/);
assert.ok(!target.hash);
for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public');
const { getDb } = await import('../apps/web/src/server/db');
const { createActivity } = await import('../apps/web/src/server/activities/create');
const { applyToActivity, decideApplication } = await import('../apps/web/src/server/activities/applications');
const { createHandover, commandHandover, getHandovers } = await import('../apps/web/src/server/activities/handover');
const { cancelActivity } = await import('../apps/web/src/server/activities/cancellation');
const { changeParticipation } = await import('../apps/web/src/server/activities/participation');
const { getActivity } = await import('../apps/web/src/server/activities/snapshot');
const db = getDb(), key = () => `wg06-${randomUUID()}`;
let checks = 0;
const check = async (label: string, work: () => Promise<void>) => { await work(); checks++; console.log(`PASS ${label}`); };
async function fixture() {
  const [a, b, c] = await Promise.all([0, 1, 2].map(() => db.user.create({ data: {} })));
  const day = Date.now() + 7 * 86400000;
  let detail = await createActivity(a.id, { name: 'WG06 LOCAL FIXTURE', timezone: 'Asia/Shanghai', idempotency_key: key(), main_segment_ref: 'main', participating_segment_refs: ['main'], segments: [{ client_ref: 'main', name: 'main', type: 'custom', starts_at: new Date(day).toISOString(), ends_at: new Date(day + 3600000).toISOString(), deadline_at: new Date(day - 3600000).toISOString(), minimum_participants: 1, capacity: 5, location: { name: 'Synthetic venue', address: null, source_url: null }, fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, requirements: '' }] });
  detail = await applyToActivity(detail.activity_id, b.id, { idempotency_key: key(), expected_revision: detail.revision, segments: [{ segment_id: detail.main_segment_id, plan_revision: 1 }] });
  detail = await decideApplication(detail.activity_id, detail.viewer.applications[0].application_id, a.id, { decision: 'approve', idempotency_key: key(), expected_revision: detail.revision });
  const state = await createHandover(detail.activity_id, a.id, { target_user_id: b.id, expected_revision: detail.revision, expected_management_revision: 1, idempotency_key: key() });
  assert.equal(state.activity.viewer.is_manager, true);
  const offer = state.offer!;
  const command = (action: 'accept' | 'reject' | 'withdraw') => ({ action, expected_revision: state.activity.revision, expected_management_revision: state.management_revision, idempotency_key: key() });
  return { id: detail.activity_id, segment: detail.main_segment_id, a: a.id, b: b.id, c: c.id, state, offer: offer.handover_id, command };
}
try {
  await check('acceptance and replay preserve seats and transfer only current authority; manager may exit', async () => {
    const f = await fixture(), input = f.command('accept');
    const before = await db.participation.findMany({ where: { activityId: f.id }, orderBy: { userId: 'asc' } });
    const accepted = await commandHandover(f.id, f.offer, f.b, input);
    assert.equal(accepted.activity.viewer.is_manager, true);
    assert.deepEqual(await db.participation.findMany({ where: { activityId: f.id }, orderBy: { userId: 'asc' } }), before);
    assert.equal((await commandHandover(f.id, f.offer, f.b, input)).management_revision, 2);
    assert.equal(await db.activityEvent.count({ where: { activityId: f.id, type: 'management_handover_accepted' } }), 1);
    await assert.rejects(() => cancelActivity(f.id, f.a, { expected_revision: accepted.activity.revision, idempotency_key: key() }), { code: 'FORBIDDEN' });
    await changeParticipation(f.id, f.b, { action: 'exit', segment_ids: [f.segment], expected_revision: accepted.activity.revision, idempotency_key: key() });
    assert.equal((await getHandovers(f.id, f.b)).activity.viewer.is_manager, true);
  });
  await check('recipient departure blocks acceptance; rejection and withdrawal retain manager', async () => {
    const f = await fixture();
    const exited = await changeParticipation(f.id, f.b, { action: 'exit', segment_ids: [f.segment], expected_revision: f.state.activity.revision, idempotency_key: key() });
    await assert.rejects(() => commandHandover(f.id, f.offer, f.b, { ...f.command('accept'), expected_revision: exited.activity.revision }), { code: 'HANDOVER_SCOPE_UNAVAILABLE' });
    await commandHandover(f.id, f.offer, f.b, { ...f.command('reject'), expected_revision: exited.activity.revision });
    assert.equal((await db.activity.findUniqueOrThrow({ where: { id: f.id } })).currentManagerId, f.a);
    const g = await fixture();
    await commandHandover(g.id, g.offer, g.a, g.command('withdraw'));
    assert.equal((await db.managementHandover.findUniqueOrThrow({ where: { id: g.offer } })).status, 'withdrawn');
    await assert.rejects(() => getHandovers(g.id, g.c, g.offer), { code: 'NOT_FOUND' });
  });
  await check('ongoing and awaiting-reaccept participation remain eligible without accepting arrangements', async () => {
    const f = await fixture();
    await db.segment.update({ where: { id: f.segment }, data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 3600000), planRevision: 2 } });
    const state = await commandHandover(f.id, f.offer, f.b, f.command('accept'));
    assert.equal(state.activity.viewer.is_manager, true);
    assert.equal((await db.participation.findUniqueOrThrow({ where: { segmentId_userId: { segmentId: f.segment, userId: f.b } } })).acceptedPlanRevision, 1);
  });
  for (const rival of ['withdraw', 'cancel'] as const) {
    await check(`real concurrent accept versus ${rival} permits exactly one winner`, async () => {
      for (let i = 0; i < 4; i++) {
        const f = await fixture();
        const results = await Promise.allSettled([
          commandHandover(f.id, f.offer, f.b, f.command('accept')),
          rival === 'withdraw' ? commandHandover(f.id, f.offer, f.a, f.command('withdraw')) : cancelActivity(f.id, f.a, { expected_revision: f.state.activity.revision, idempotency_key: key() })
        ]);
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        const a = await db.activity.findUniqueOrThrow({ where: { id: f.id } });
        const offer = await db.managementHandover.findUniqueOrThrow({ where: { id: f.offer } });
        if (offer.status === 'accepted') { assert.equal(a.currentManagerId, f.b); assert.equal(a.cancelledAt, null); }
        else { assert.equal(a.currentManagerId, f.a); assert.equal(offer.status, rival === 'cancel' ? 'invalidated' : 'withdrawn'); }
        assert.equal(a.managementRevision, offer.status === 'accepted' ? 2 : 1);
      }
    });
  }
  await check('cancel invalidates pending and never reverts an accepted manager', async () => {
    const f = await fixture();
    await cancelActivity(f.id, f.a, { expected_revision: f.state.activity.revision, idempotency_key: key() });
    assert.equal((await getHandovers(f.id, f.b, f.offer)).offer?.status, 'invalidated');
    await assert.rejects(() => commandHandover(f.id, f.offer, f.b, f.command('accept')), { code: 'ACTIVITY_CANCELLED' });
    const g = await fixture(); const accepted = await commandHandover(g.id, g.offer, g.b, g.command('accept'));
    await cancelActivity(g.id, g.b, { expected_revision: accepted.activity.revision, idempotency_key: key() });
    assert.equal((await getActivity(g.id, g.b)).viewer.is_manager, true);
    assert.equal((await db.managementHandover.findUniqueOrThrow({ where: { id: g.offer } })).status, 'accepted');
  });
  console.log(`PASS WG06 ${checks} PostgreSQL groups`);
} finally { await db.$disconnect(); }

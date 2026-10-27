/** Real PostgreSQL, explicit disposable CI fixture only. No WeChat or suppliers. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { type RequirementResponseInput, type TeamDraft } from '../packages/contracts/src';

assert.ok(process.argv.includes('--fixture-only'), 'Explicit fixture-only argument required');
const raw = process.env.DATABASE_URL;
assert.ok(raw, 'Explicit disposable CI database required');
const target = new URL(raw);
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '5432');
assert.equal(target.pathname, '/weevibe_acceptance_ci');
assert.ok(!target.hash);
for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public');
// apps/web is a CommonJS package. Match the existing real-PG CLI's loader;
// ESM named imports from its TS sources are not portable under Node 24/tsx.
const loadServer = createRequire(import.meta.url);
const { getDb } = loadServer('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const { createRequirement, commandRequirement, getRequirement, listRequirements } = loadServer('../apps/web/src/server/requirements/service.ts') as typeof import('../apps/web/src/server/requirements/service');
const { createActivity } = loadServer('../apps/web/src/server/activities/create.ts') as typeof import('../apps/web/src/server/activities/create');
const { applyToActivity, decideApplication } = loadServer('../apps/web/src/server/activities/applications.ts') as typeof import('../apps/web/src/server/activities/applications');
const { getActivityRoster } = loadServer('../apps/web/src/server/activities/roster.ts') as typeof import('../apps/web/src/server/activities/roster');
const { updateAccount } = loadServer('../apps/web/src/server/account.ts') as typeof import('../apps/web/src/server/account');
const { memberDirectory, memberProfile } = loadServer('../apps/web/src/server/member-profile.ts') as typeof import('../apps/web/src/server/member-profile');
const { getInbox, readInbox } = loadServer('../apps/web/src/server/inbox.ts') as typeof import('../apps/web/src/server/inbox');
const db = getDb(), key = () => `v38-fixture-${randomUUID()}`;
const checks: string[] = [];
function pass(name: string) { checks.push(name); console.log(`PASS ${name}`); }
try {
  const owner = await db.user.create({ data: {} }), member = await db.user.create({ data: {} }), outsider = await db.user.create({ data: {} });
  const deadline = new Date(Date.now() + 2 * 86400000).toISOString();
  const draft: TeamDraft = { title: 'V38 CI synthetic preparation', description: 'Disposable fixture only', starts_at: '', deadline_at: deadline, timezone: 'Asia/Shanghai', locations: [], questions: [] };
  for (const kind of ['friend', 'team'] as const) {
    const request = { action: 'create' as const, kind, idempotency_key: key(), draft };
    const created = await createRequirement(owner.id, request);
    assert.equal(created.collection.activity_id, null);
    assert.equal((await createRequirement(owner.id, request)).collection.id, created.collection.id);
    assert.equal(await db.activity.count({ where: { currentManagerId: owner.id } }), 0);
    await assert.rejects(() => getRequirement(created.collection.id, outsider.id), { code: 'NOT_FOUND' });
    const opened = await commandRequirement(created.collection.id, owner.id, { action: 'publish', expected_revision: created.collection.revision });
    const response: RequirementResponseInput = { selected_segment_ids: [], answers: [], location_ids: [], location_other: null,
      time_preferences: 'Saturday afternoon', budget_note: 'PRIVATE_BUDGET_SENTINEL', preferences: 'PRIVATE_REASON_SENTINEL',
      budget_max_yuan: 80, preference_tags: ['桌游'], constraint_tags: ['不安排酒精'], private_origin: { label: 'PRIVATE_ORIGIN_SENTINEL' } };
    await commandRequirement(created.collection.id, member.id, { action: 'respond', expected_revision: opened.collection.revision, expected_response_version: 0, response });
    const managerView = await getRequirement(created.collection.id, owner.id);
    assert.equal(managerView.manager?.responses[0].time_preferences, response.time_preferences);
    assert.equal(managerView.aggregate?.budget.min_max_yuan, 80);
    assert.ok(!JSON.stringify(managerView).includes('PRIVATE_'));
    const publicView = await getRequirement(created.collection.id, outsider.id);
    assert.equal(publicView.manager, null); assert.equal(publicView.own_response, null);
    assert.ok(!JSON.stringify(publicView).includes('PRIVATE_'));
    const own = await getRequirement(created.collection.id, member.id);
    assert.equal(own.own_response?.budget_note, response.budget_note);
    assert.equal(own.own_response?.private_origin?.label, 'PRIVATE_ORIGIN_SENTINEL');
    await assert.rejects(() => commandRequirement(created.collection.id, member.id, { action: 'respond', expected_revision: opened.collection.revision, expected_response_version: 0, response }), { code: 'VERSION_CONFLICT' });
    assert.ok((await listRequirements(member.id)).collections.some(s => s.id === created.collection.id));
    const closed = await commandRequirement(created.collection.id, owner.id, { action: 'close', expected_revision: opened.collection.revision });
    const final = await commandRequirement(created.collection.id, owner.id, { action: 'finalize', expected_revision: closed.collection.revision, final_selection: { location_id: null, location_other: null, note: 'Confirmed synthetic plan; fill formal activity before publishing' } });
    assert.equal(final.collection.status, 'finalized');
    assert.equal(await db.participation.count({ where: { userId: member.id } }), 0);
    pass(`${kind}: real unbound preparation/publish/respond/CAS/privacy/finalize, no seats`);
  }
  const starts = new Date(Date.now() + 4 * 86400000), ends = new Date(starts.getTime() + 3600000);
  const activity = await createActivity(owner.id, { idempotency_key: key(), name: 'V38 roster CI synthetic fixture', timezone: 'Asia/Shanghai', main_segment_ref: 'one', participating_segment_refs: [], segments: [{ client_ref: 'one', type: 'custom', name: 'CI fixture', starts_at: starts.toISOString(), ends_at: ends.toISOString(), deadline_at: deadline, minimum_participants: 1, capacity: 4, location: { name: 'Synthetic venue', address: null, source_url: null }, fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, requirements: '' }] });
  const pending = await applyToActivity(activity.activity_id, member.id, { idempotency_key: key(), expected_revision: activity.revision, display_name: 'V38 synthetic signup name', segments: [{ segment_id: activity.segments[0].segment_id, plan_revision: activity.segments[0].plan_revision }] });
  assert.equal((await getActivityRoster(activity.activity_id, member.id)).segments[0].availability, 'counts_only');
  await decideApplication(activity.activity_id, pending.viewer.applications[0].application_id, owner.id, { idempotency_key: key(), expected_revision: pending.revision, decision: 'approve' });
  for (const actor of [null, outsider.id]) {
    const view = await getActivityRoster(activity.activity_id, actor);
    assert.equal(view.segments[0].members, null); assert.equal(view.segments[0].counts?.occupied_count, 1);
    assert.ok(!JSON.stringify(view).includes('V38 synthetic signup name'));
  }
  for (const actor of [owner.id, member.id]) assert.equal((await getActivityRoster(activity.activity_id, actor)).segments[0].members?.[0].display_name, 'V38 synthetic signup name');
  pass('real roster permissions: anonymous/outsider/pending counts only; manager/joined names');
  await updateAccount(member.id, { action: 'profile', profile: { nickname: 'CI member', birthday: '1999-01-02', signature: 'PRIVATE_SIGNATURE', introduction: 'PRIVATE_INTRODUCTION', bio: 'Opt-in biography', interests: ['徒步'], mbti: 'INFP', zodiac: '天秤座' } });
  const privateView = await memberProfile(activity.activity_id, member.id, owner.id);
  assert.equal(privateView.bio, undefined); assert.equal(privateView.mbti, undefined);
  assert.ok(!JSON.stringify(privateView).includes('PRIVATE_')); assert.ok(!JSON.stringify(privateView).includes('1999-01-02'));
  await assert.rejects(() => memberDirectory(activity.activity_id, outsider.id), { code: 'FORBIDDEN' });
  const nextPending = await applyToActivity(activity.activity_id, outsider.id, { idempotency_key: key(), expected_revision: (await db.activity.findUniqueOrThrow({ where: { id: activity.activity_id } })).revision, display_name: 'CI pending outsider', segments: [{ segment_id: activity.segments[0].segment_id, plan_revision: 1 }] });
  await assert.rejects(() => memberProfile(activity.activity_id, member.id, outsider.id), { code: 'FORBIDDEN' });
  const managerInbox = await getInbox(owner.id);
  const applicationMessage = managerInbox.messages.find(m => m.section === 'applications'); assert.ok(applicationMessage?.pending);
  const marked = await readInbox(owner.id, { action: 'read-all' });
  assert.equal(marked.unread_count, 0); assert.equal(marked.pending_count, managerInbox.pending_count);
  assert.equal(await db.activityApplication.count({ where: { activityId: activity.activity_id, status: 'pending' } }), 1);
  await assert.rejects(() => readInbox(outsider.id, { action: 'read', message_id: applicationMessage.id }), { code: 'NOT_FOUND' });
  assert.equal((await getInbox(outsider.id)).messages.some(m => m.section === 'applications'), false);
  await decideApplication(activity.activity_id, nextPending.viewer.applications[0].application_id, owner.id, { idempotency_key: key(), expected_revision: nextPending.revision, decision: 'approve' });
  const completedMessage = (await getInbox(owner.id)).messages.find(m => m.id === applicationMessage.id);
  assert.equal(completedMessage?.pending, false); assert.equal(completedMessage?.read, true);
  await updateAccount(member.id, { action: 'profile', profile: { visibility: { bio: true, interests: true, mbti: false, zodiac: false } } });
  const publicView = await memberProfile(activity.activity_id, member.id, outsider.id);
  assert.equal(publicView.bio, 'Opt-in biography'); assert.deepEqual(publicView.interests, ['徒步']); assert.equal(publicView.mbti, undefined);
  assert.ok(!JSON.stringify(publicView).includes('PRIVATE_')); assert.ok(!JSON.stringify(publicView).includes('1999-01-02'));
  pass('navigation: real private/public profile projections and outsider/pending denial; read-all does not approve');
  await db.segment.update({ where: { id: activity.segments[0].segment_id }, data: { planRevision: 2 } });
  await db.activityEvent.createMany({ data: [0, 1].map(i => ({ activityId: activity.activity_id, actorUserId: owner.id, type: 'segment_capacity_changed', revision: 6 + i, detail: { segment_id: activity.segments[0].segment_id }, createdAt: new Date(Date.now() - 20 + i) })) });
  const reviewMessages = await getInbox(member.id);
  assert.equal(reviewMessages.messages.filter(m => m.section === 'arrangement' && m.pending).length, 1);
  const readReview = await readInbox(member.id, { action: 'read-all' }); assert.equal(readReview.pending_count, 1);
  assert.equal((await db.participation.findFirstOrThrow({ where: { activityId: activity.activity_id, userId: member.id } })).acceptedPlanRevision, 1);
  await db.activity.update({ where: { id: activity.activity_id }, data: { currentManagerId: outsider.id, managementRevision: { increment: 1 } } });
  await assert.rejects(() => memberDirectory(activity.activity_id, owner.id), { code: 'FORBIDDEN' });
  assert.equal((await memberProfile(activity.activity_id, member.id, outsider.id)).bio, 'Opt-in biography');
  await db.participation.updateMany({ where: { activityId: activity.activity_id, userId: member.id }, data: { status: 'exited', exitedAt: new Date() } });
  await assert.rejects(() => memberDirectory(activity.activity_id, member.id), { code: 'FORBIDDEN' });
  await assert.rejects(() => memberProfile(activity.activity_id, member.id, outsider.id), { code: 'NOT_FOUND' });
  pass('navigation: real arrangement read does not accept; old manager and exited member lose profile access');
  // CI service container is destroyed by the job. No shared data is ever cleaned here.
  console.log(`V38 real PostgreSQL fixture groups passed: ${checks.length}`);
} finally { await db.$disconnect(); }

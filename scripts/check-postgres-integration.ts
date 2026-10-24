import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { activityDetailSchema, type ActivityDetail, type CreateActivityInput } from '../packages/contracts/src';

// Explicit opt-in only. This file is not part of the default offline test suite.
// Users/sessions below are fixtures; no wx.login exchange is performed.
const phase = process.argv[2] ?? 'prepare';
const root = resolve(import.meta.dirname, '..');
const statePath = resolve(root, '.working/postgres-integration-state.json');
const resultPath = resolve(root, `.working/postgres-integration-${phase}-result.json`);
const checks: string[] = [];
let current = 'target_guard';
type Database = ReturnType<(typeof import('../apps/web/src/server/db'))['getDb']>;
let db: Database | undefined;
type Actor = { id: string; token: string };
type State = { version: 1; database: string; run_id: string; manager_id: string; alice_id: string;
  activity_id: string; revision: number; segment_ids: string[]; record_value: string;
  expected_participations: number; expected_applications: number; expected_events: number; postgres_started_epoch: string };

function requireTargets() {
  assert.ok(['prepare', 'verify'].includes(phase), 'Unsupported phase');
  const raw = process.env.DATABASE_URL;
  assert.ok(raw, 'Explicit local acceptance database required');
  const target = new URL(raw);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  const database = decodeURIComponent(target.pathname.slice(1));
  assert.match(database, /^weego_acceptance_[a-z0-9_]+$/);
  assert.ok(!target.hash);
  for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public', 'Unexpected connection override');
  const api = new URL(process.env.WEEGO_CHECK_API_BASE_URL ?? 'http://127.0.0.1:43188');
  assert.ok(['http:', 'https:'].includes(api.protocol) && ['localhost', '127.0.0.1'].includes(api.hostname));
  assert.ok(!api.username && !api.password && !api.search && !api.hash && api.pathname === '/');
  return { database, api };
}
async function check(name: string, work: () => Promise<void>) {
  current = name; await work(); checks.push(name); console.log(`PASS ${name}`);
}
function client(api: URL, actor?: Actor) {
  return async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(new URL(path, api), { method,
      headers: { 'content-type': 'application/json', ...(actor ? { authorization: `Bearer ${actor.token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    // Parse errors and raw server responses are never printed by the outer error handler.
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
}
async function seedActor(id?: string): Promise<Actor> {
  assert.ok(db);
  const user = id ? await db.user.findUniqueOrThrow({ where: { id } }) : await db.user.create({ data: {} });
  const token = randomBytes(32).toString('base64url');
  await db.authSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3_600_000) } });
  return { id: user.id, token };
}
const key = () => `pg-${randomUUID()}`;
function createInput(count = 2, capacity = 3): CreateActivityInput {
  const day = Date.now() + 7 * 86_400_000;
  return { idempotency_key: key(), name: 'Local acceptance fixture', timezone: 'Asia/Shanghai', main_segment_ref: 'part_0', participating_segment_refs: [],
    segments: Array.from({ length: count }, (_, i) => ({ client_ref: `part_${i}`, type: 'custom', name: `Fixture ${i}`,
      starts_at: new Date(day + i * 7_200_000).toISOString(), ends_at: new Date(day + i * 7_200_000 + 3_600_000).toISOString(), deadline_at: new Date(day - 86_400_000).toISOString(),
      minimum_participants: 1, capacity, location: { name: 'Synthetic local-only venue', address: null, source_url: null },
      fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, requirements: '' })) };
}
function detail(response: { status: number; body: unknown }): ActivityDetail {
  assert.equal(response.status, 200, 'Expected successful local API operation');
  return activityDetailSchema.parse(response.body);
}
function error(response: { status: number; body: Record<string, unknown> }, status: number, code?: string) {
  assert.equal(response.status, status, 'Unexpected API rejection status');
  if (code) assert.equal((response.body.error as { code?: string } | undefined)?.code, code);
}
const path = (id: string) => `/api/v1/activities/${id}`;
const appInput = (d: ActivityDetail) => ({ idempotency_key: key(), expected_revision: d.revision,
  segments: d.segments.map(s => ({ segment_id: s.segment_id, plan_revision: s.plan_revision })) });

async function prepare(database: string, api: URL) {
  assert.ok(db);
  const manager = await seedActor(), alice = await seedActor(), bob = await seedActor();
  const manage = client(api, manager), one = client(api, alice), two = client(api, bob), anonymous = client(api);
  const input = createInput();
  let activity!: ActivityDetail;
  await check('fixture_session_uses_real_database_auth', async () => {
    assert.equal((await manage('/api/v1/me')).body.user_id, manager.id);
    assert.equal((await one('/api/v1/me')).body.user_id, alice.id);
    assert.equal((await two('/api/v1/me')).body.user_id, bob.id);
  });
  await check('create_multi_segment_manager_does_not_auto_join_or_form', async () => {
    activity = detail(await manage('/api/v1/activities', input));
    assert.equal(activity.segments.length, 2); assert.equal(activity.viewer.is_manager, true);
    assert.equal(activity.viewer.participations.length, 0); assert.equal(activity.formation_status, 'not_confirmed');
    assert.ok(activity.segments.every(s => s.counts.occupied_count === 0 && s.fee.amount_cents === null));
    assert.equal(activity.main_segment_id, activity.segments[0].segment_id);
  });
  await check('create_idempotency_and_payload_binding', async () => {
    assert.equal(detail(await manage('/api/v1/activities', input)).activity_id, activity.activity_id);
    error(await manage('/api/v1/activities', { ...input, name: 'Different semantic intent' }), 409, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await db!.activityMutationKey.count({ where: { actorUserId: manager.id, key: input.idempotency_key } }), 1);
  });
  const application = appInput(activity);
  let applicationId = '';
  await check('application_is_pending_without_seat_and_replay_is_unique', async () => {
    activity = detail(await one(`${path(activity.activity_id)}/applications`, application));
    applicationId = activity.viewer.applications[0].application_id;
    assert.ok(activity.segments.every(s => s.counts.occupied_count === 0));
    assert.equal(activity.viewer.applications[0].status, 'pending');
    const replay = detail(await one(`${path(activity.activity_id)}/applications`, application));
    assert.equal(replay.viewer.applications.length, 1);
    assert.equal(replay.viewer.applications[0].application_id, applicationId);
  });
  await check('public_and_other_user_projection_hides_private_applications', async () => {
    for (const call of [anonymous, two]) {
      const view = detail(await call(path(activity.activity_id)));
      assert.equal(view.applications, undefined); assert.equal(view.viewer.applications.length, 0);
      assert.ok(!JSON.stringify(view).includes(alice.id));
    }
    error(await two(`${path(activity.activity_id)}/applications/${applicationId}/decision`, { idempotency_key: key(), expected_revision: activity.revision, decision: 'approve' }), 403, 'FORBIDDEN');
  });
  let approvalKey = '';
  await check('whole_application_approval_acquires_both_seats_once', async () => {
    activity = detail(await manage(path(activity.activity_id)));
    approvalKey = key(); const decision = { idempotency_key: approvalKey, expected_revision: activity.revision, decision: 'approve' };
    activity = detail(await manage(`${path(activity.activity_id)}/applications/${applicationId}/decision`, decision));
    assert.ok(activity.segments.every(s => s.counts.occupied_count === 1 && s.counts.accepted_count === 1));
    assert.equal(activity.applications?.find(a => a.application_id === applicationId)?.status, 'approved');
    const replay = detail(await manage(`${path(activity.activity_id)}/applications/${applicationId}/decision`, decision));
    assert.equal(replay.revision, activity.revision);
    assert.equal(await db!.participation.count({ where: { activityId: activity.activity_id, userId: alice.id } }), 2);
  });
  await check('stale_revision_and_cross_actor_key_do_not_replay_other_work', async () => {
    error(await two(`${path(activity.activity_id)}/applications`, { ...appInput(activity), expected_revision: activity.revision - 1 }), 409, 'VERSION_CONFLICT');
    const stalePlan = appInput(activity);
    stalePlan.segments = stalePlan.segments.map(s => ({ ...s, plan_revision: s.plan_revision + 1 }));
    error(await two(`${path(activity.activity_id)}/applications`, stalePlan), 409, 'ARRANGEMENT_STALE');
    // A different actor's same textual key is a distinct intent and independent result.
    const other = detail(await two('/api/v1/activities', input));
    assert.notEqual(other.activity_id, activity.activity_id); assert.equal(other.viewer.is_manager, true);
    assert.equal(detail(await manage(path(other.activity_id))).viewer.is_manager, false);
    assert.equal(await db!.activityMutationKey.count({ where: { key: input.idempotency_key } }), 2);
  });
  await check('last_seat_concurrent_approvals_exactly_one_winner', async () => {
    let race = detail(await manage('/api/v1/activities', createInput(2, 1)));
    const first = detail(await one(`${path(race.activity_id)}/applications`, appInput(race)));
    race = detail(await manage(path(race.activity_id)));
    const second = detail(await two(`${path(race.activity_id)}/applications`, appInput(race)));
    race = detail(await manage(path(race.activity_id)));
    const ids = [first.viewer.applications[0].application_id, second.viewer.applications[0].application_id];
    const responses = await Promise.all(ids.map(id => manage(`${path(race.activity_id)}/applications/${id}/decision`, { idempotency_key: key(), expected_revision: race.revision, decision: 'approve' })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const final = detail(await manage(path(race.activity_id)));
    assert.ok(final.segments.every(s => s.counts.occupied_count === 1 && s.counts.remaining_capacity === 0));
    assert.equal(final.applications?.filter(a => a.status === 'approved').length, 1);
    assert.equal(final.applications?.filter(a => a.status === 'pending').length, 1);
    const seats = await db!.participation.findMany({ where: { activityId: race.activity_id } });
    assert.equal(seats.length, 2); assert.equal(new Set(seats.map(s => s.userId)).size, 1);
  });
  await check('mid_second_seat_failure_rolls_back_everything_then_same_key_succeeds', async () => {
    let rollback = detail(await manage('/api/v1/activities', createInput()));
    const applied = detail(await one(`${path(rollback.activity_id)}/applications`, appInput(rollback)));
    const id = applied.viewer.applications[0].application_id;
    rollback = detail(await manage(path(rollback.activity_id)));
    const decision = { idempotency_key: key(), expected_revision: rollback.revision, decision: 'approve' };
    const suffix = randomBytes(8).toString('hex');
    const trigger = `weego_acceptance_trigger_${suffix}`, fn = `weego_acceptance_function_${suffix}`, seq = `weego_acceptance_seq_${suffix}`;
    // All identifiers are generated hex; UUID literals come from validated DB/API fixtures.
    assert.match(rollback.activity_id, /^[a-f0-9-]{36}$/); assert.match(alice.id, /^[a-f0-9-]{36}$/);
    let createdSequence = false, createdFunction = false, createdTrigger = false;
    try {
      await db!.$executeRawUnsafe(`CREATE SEQUENCE "${seq}"`); createdSequence = true;
      await db!.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW."activityId" = '${rollback.activity_id}'::uuid AND NEW."userId" = '${alice.id}'::uuid THEN
          PERFORM nextval('"${seq}"');
          IF EXISTS (SELECT 1 FROM "Participation" WHERE "activityId" = NEW."activityId" AND "userId" = NEW."userId") THEN
            RAISE EXCEPTION 'controlled local acceptance failure';
          END IF;
        END IF; RETURN NEW; END $$`); createdFunction = true;
      await db!.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "Participation" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`); createdTrigger = true;
      error(await manage(`${path(rollback.activity_id)}/applications/${id}/decision`, decision), 503, 'DATABASE_UNAVAILABLE');
      const reached = await db!.$queryRawUnsafe<Array<{ last_value: bigint }>>(`SELECT last_value FROM "${seq}"`);
      assert.ok(Number(reached[0].last_value) >= 2, 'Failure must occur after the first seat write');
      const failed = detail(await manage(path(rollback.activity_id)));
      assert.equal(failed.revision, rollback.revision); assert.ok(failed.segments.every(s => s.counts.occupied_count === 0));
      assert.equal(failed.applications?.find(a => a.application_id === id)?.status, 'pending');
      assert.equal(await db!.activityMutationKey.count({ where: { actorUserId: manager.id, key: decision.idempotency_key } }), 0);
      assert.equal(await db!.activityEvent.count({ where: { activityId: rollback.activity_id, type: 'application_approved' } }), 0);
    } finally {
      if (createdTrigger) await db!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "Participation"`);
      if (createdFunction) await db!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
      if (createdSequence) await db!.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${seq}"`);
    }
    const recovered = detail(await manage(`${path(rollback.activity_id)}/applications/${id}/decision`, decision));
    assert.ok(recovered.segments.every(s => s.counts.occupied_count === 1));
  });
  await check('real_sql_check_rejects_capacity_below_minimum', async () => {
    const id = activity.segments[0].segment_id;
    let rejected = false;
    try { await db!.$executeRaw`UPDATE "Segment" SET "capacity" = 0 WHERE "id" = ${id}::uuid`; } catch { rejected = true; }
    assert.ok(rejected);
    assert.equal((await db!.segment.findUniqueOrThrow({ where: { id } })).capacity, 3);
  });
  const recordValue = `acceptance-record-${randomUUID()}`;
  await check('own_record_persists_and_other_identity_cannot_read_it', async () => {
    assert.equal((await one('/api/v1/me/test-record', { value: recordValue }, 'PUT')).status, 200);
    assert.equal((await one('/api/v1/me/test-record')).body.value, recordValue);
    assert.equal((await two('/api/v1/me/test-record')).body.value, null);
    assert.equal(await db!.authSession.count({ where: { tokenHash: alice.token } }), 0);
  });
  activity = detail(await manage(path(activity.activity_id)));
  const state: State = { version: 1, database, run_id: randomUUID(), manager_id: manager.id, alice_id: alice.id,
    activity_id: activity.activity_id, revision: activity.revision, segment_ids: activity.segments.map(s => s.segment_id), record_value: recordValue,
    expected_participations: await db!.participation.count({ where: { activityId: activity.activity_id } }),
    expected_applications: await db!.activityApplication.count({ where: { activityId: activity.activity_id } }),
    expected_events: await db!.activityEvent.count({ where: { activityId: activity.activity_id } }),
    postgres_started_epoch: (await db!.$queryRaw<Array<{ started: string }>>`SELECT extract(epoch FROM pg_postmaster_start_time())::text AS started`)[0].started };
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', flag: 'w' });
  console.log('State saved without session tokens or connection credentials. Restart PostgreSQL/API before verify.');
}

async function verify(database: string, api: URL) {
  assert.ok(db);
  const state = JSON.parse(await readFile(statePath, 'utf8')) as State;
  assert.equal(state.version, 1); assert.equal(state.database, database);
  await check('postgres_process_actually_restarted_between_phases', async () => {
    const rows = await db!.$queryRaw<Array<{ started: string }>>`SELECT extract(epoch FROM pg_postmaster_start_time())::text AS started`;
    assert.ok(Number(rows[0].started) > Number(state.postgres_started_epoch), 'A genuine PostgreSQL restart is required before verify');
  });
  const manager = await seedActor(state.manager_id), alice = await seedActor(state.alice_id);
  await check('post_restart_same_business_identity_and_record', async () => {
    assert.equal((await client(api, alice)('/api/v1/me')).body.user_id, state.alice_id);
    assert.equal((await client(api, alice)('/api/v1/me/test-record')).body.value, state.record_value);
  });
  await check('post_restart_activity_seats_applications_events_unchanged', async () => {
    const d = detail(await client(api, manager)(path(state.activity_id)));
    assert.equal(d.revision, state.revision); assert.deepEqual(d.segments.map(s => s.segment_id), state.segment_ids);
    assert.equal(await db!.participation.count({ where: { activityId: state.activity_id } }), state.expected_participations);
    assert.equal(await db!.activityApplication.count({ where: { activityId: state.activity_id } }), state.expected_applications);
    assert.equal(await db!.activityEvent.count({ where: { activityId: state.activity_id } }), state.expected_events);
    assert.ok(d.segments.every(s => s.counts.occupied_count === 1));
  });
}

async function main() {
  const { database, api } = requireTargets();
  await mkdir(resolve(root, '.working'), { recursive: true });
  // apps/web is a CommonJS package under the root ESM workspace. Load its TS
  // module through tsx's require hook, after the target guard has succeeded.
  const { getDb } = createRequire(import.meta.url)(resolve(root, 'apps/web/src/server/db.ts')) as typeof import('../apps/web/src/server/db');
  db = getDb();
  await check('database_identity_matches_guarded_target', async () => {
    const rows = await db!.$queryRaw<Array<{ database: string }>>`SELECT current_database()::text AS database`;
    assert.equal(rows[0].database, database);
    const migrations = (await readdir(resolve(root, 'prisma/migrations'), { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
    const applied = await db!.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
    assert.deepEqual(applied.map(row => row.migration_name), migrations);
  });
  if (phase === 'prepare') await prepare(database, api); else await verify(database, api);
  await writeFile(resultPath, JSON.stringify({ phase, status: 'passed', checks, wechat_exchange: 'not_executed_fixture_sessions', database_scope: 'dedicated_local_acceptance', checked_at: new Date().toISOString() }, null, 2) + '\n');
  console.log(`PASS ${checks.length} real local database/HTTP checks (${phase}); no real WeChat exchange.`);
}
main().catch(async () => {
  // Assertion messages/driver errors may include bodies, parameters or connection details.
  console.error(`FAIL local PostgreSQL integration at check: ${current}. Raw error intentionally withheld.`);
  try { await mkdir(resolve(root, '.working'), { recursive: true }); await writeFile(resultPath, JSON.stringify({ phase, status: 'failed', failed_check: current, completed_checks: checks }, null, 2) + '\n'); } catch { /* no secrets/log dump on reporting failure */ }
  process.exitCode = 1;
}).finally(async () => { await db?.$disconnect(); });

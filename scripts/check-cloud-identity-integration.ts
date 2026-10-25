import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sessionSchema } from '../packages/contracts/src';

// Explicit local acceptance only. Generated identities, fixture signature keys
// and HTTP sessions do NOT prove a real cloud-function request context.
const root = resolve(import.meta.dirname, '..');
const resultPath = resolve(root, '.working/cloud-identity-integration-result.json');
type Database = ReturnType<(typeof import('../apps/web/src/server/db'))['getDb']>;
type Store = (typeof import('../apps/web/src/server/auth/cloud-store'))['issueCloudSession'];
type Protocol = typeof import('../cloudfunctions/weevibeLogin/proof.cjs');
type Envelope = { body: string; signature: string };
let db: Database | undefined;
let current = 'target_and_fixture_guard';
const checks: string[] = [];

function targets() {
  assert.ok(process.env.DATABASE_URL, 'An explicit acceptance database is required');
  const target = new URL(process.env.DATABASE_URL);
  assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  const database = decodeURIComponent(target.pathname.slice(1));
  assert.match(database, /^(?:weevibe|weego)_acceptance_[a-z0-9_]+$/);
  assert.ok(!target.hash);
  for (const [name, value] of target.searchParams) assert.ok(name === 'schema' && value === 'public');
  const api = new URL(process.env.WEEVIBE_CHECK_API_BASE_URL ?? 'http://127.0.0.1:43188');
  assert.ok(['http:', 'https:'].includes(api.protocol) && ['localhost', '127.0.0.1'].includes(api.hostname));
  assert.ok(!api.username && !api.password && !api.search && !api.hash && api.pathname === '/');
  assert.equal(process.env.WECHAT_APP_ID, 'wx1111111111111111', 'Fixture AppID required');
  assert.equal(process.env.WEEGO_CLOUD_AUTH_ENV_ID, 'fixture-env');
  assert.equal(process.env.WEEGO_CLOUD_AUTH_KEY_ID, 'fixture-key');
  assert.equal(process.env.WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS ?? 'false', 'false');
  assert.ok(process.env.WEEGO_CLOUD_AUTH_TEST_PRIVATE_KEY_B64, 'Explicit fixture private key required');
  return { database, api };
}
async function check(name: string, action: () => Promise<void>) {
  current = name; await action(); checks.push(name); console.log(`PASS ${name}`);
}
function rejected(response: { status: number; body: unknown }, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal((response.body as { error?: { code?: string } }).error?.code, code);
}
async function rejectedStore(operation: Promise<unknown>) {
  let failure: unknown;
  try { await operation; } catch (error) { failure = error; }
  assert.ok(failure && typeof failure === 'object');
  assert.equal((failure as { code?: string }).code, 'UNAUTHENTICATED');
  assert.equal((failure as { status?: number }).status, 401);
}
const identity = () => `fixture_${randomUUID().replaceAll('-', '')}`;

async function run(database: string, api: URL, issue: Store, protocol: Protocol) {
  assert.ok(db);
  const verifier = protocol.readVerifierConfig(process.env);
  const signer = protocol.readSignerConfig({ ...process.env, WEEGO_CLOUD_AUTH_PRIVATE_KEY_B64: process.env.WEEGO_CLOUD_AUTH_TEST_PRIVATE_KEY_B64 });
  const envelope = (openId: string, now = Date.now()) => protocol.createSignedProof({ appId: signer.appId, openId, source: 'wx_client' }, signer, now);
  const verified = (proof: Envelope, now = Date.now()) => protocol.verifySignedProof(proof.body, proof.signature, verifier, now);
  const send = async (proof?: Envelope, headers: Record<string, string> = {}) => {
    const response = await fetch(new URL(protocol.LOGIN_PATH, api), { method: 'POST', headers: { 'content-type': 'application/json', ...(proof ? { 'x-weego-cloud-signature': proof.signature } : {}), ...headers },
      body: proof?.body ?? '{}', signal: AbortSignal.timeout(30_000) });
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);
    return { status: response.status, body: await response.json() as unknown };
  };
  const session = (response: { status: number; body: unknown }) => {
    assert.equal(response.status, 200); return sessionSchema.parse(response.body);
  };
  const me = async (token: string) => {
    const response = await fetch(new URL('/api/v1/me', api), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    assert.equal(response.status, 200); return await response.json() as { user_id: string };
  };
  await check('guarded_database_has_cloud_proof_migration', async () => {
    const rows = await db!.$queryRaw<Array<{ database: string }>>`SELECT current_database()::text AS database`;
    assert.equal(rows[0].database, database);
    const migration = await db!.$queryRaw<Array<{ n: bigint }>>`SELECT count(*) AS n FROM "_prisma_migrations" WHERE migration_name = '202610240003_cloud_login_use' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.equal(Number(migration[0].n), 1);
    assert.equal(await db!.cloudLoginUse.count({ where: { digest: '0'.repeat(64) } }), 0);
  });
  await check('missing_forged_tampered_expired_wrong_app_env_source_rejected', async () => {
    const before = await db!.cloudLoginUse.count();
    rejected(await send(undefined, { 'x-wx-openid': 'forged', 'x-wx-appid': signer.appId }), 401, 'UNAUTHENTICATED');
    const good = envelope(identity());
    rejected(await send({ ...good, signature: (good.signature[0] === 'A' ? 'B' : 'A') + good.signature.slice(1) }), 401, 'UNAUTHENTICATED');
    rejected(await send({ ...good, body: good.body.replace('wx_client', 'wx_devtools') }), 401, 'UNAUTHENTICATED');
    rejected(await send(envelope(identity(), Date.now() - 120_000)), 401, 'UNAUTHENTICATED');
    for (const overrides of [{ appId: 'wx2222222222222222' }, { envId: 'other-fixture-env' }]) {
      const config = { ...signer, ...overrides };
      rejected(await send(protocol.createSignedProof({ appId: config.appId, openId: identity(), source: 'wx_client' }, config)), 401, 'UNAUTHENTICATED');
    }
    rejected(await send(protocol.createSignedProof({ appId: signer.appId, openId: identity(), source: 'wx_devtools' }, { ...signer, allowDevtools: true })), 401, 'UNAUTHENTICATED');
    assert.equal(await db!.cloudLoginUse.count(), before);
  });
  await check('valid_proof_preserves_existing_identity_and_sessions', async () => {
    const openId = identity(), oldToken = randomBytes(32).toString('base64url');
    const oldHash = createHash('sha256').update(oldToken).digest('hex');
    const existing = await db!.user.create({ data: { identities: { create: { appId: signer.appId, openId } }, sessions: { create: { tokenHash: oldHash, expiresAt: new Date(Date.now() + 3_600_000) } } } });
    const proof = envelope(openId), proofDigest = verified(proof).proof.digest;
    const issued = session(await send(proof));
    assert.equal(issued.user.user_id, existing.id); assert.notEqual(issued.token, oldToken);
    assert.equal((await me(oldToken)).user_id, existing.id); assert.equal((await me(issued.token)).user_id, existing.id);
    assert.ok(Date.parse(issued.expires_at) > Date.now() + 23 * 3_600_000 && Date.parse(issued.expires_at) < Date.now() + 25 * 3_600_000);
    assert.equal(await db!.authSession.count({ where: { userId: existing.id } }), 2);
    assert.equal(await db!.authSession.count({ where: { tokenHash: issued.token } }), 0);
    assert.ok(await db!.authSession.findUnique({ where: { tokenHash: createHash('sha256').update(issued.token).digest('hex') } }));
    assert.equal(await db!.cloudLoginUse.count({ where: { digest: proofDigest } }), 1);
    rejected(await send(proof), 401, 'UNAUTHENTICATED');
    assert.equal(await db!.authSession.count({ where: { userId: existing.id } }), 2);
  });
  await check('actual_function_sdk_context_signer_http_pg_session_fixture_chain', async () => {
    // This is the REAL function module and its installed SDK parser. Only its
    // transport is injected: production still requires a fixed public HTTPS URL.
    const { createLoginHandler } = createRequire(import.meta.url)(resolve(root, 'cloudfunctions/weevibeLogin/index.js')) as typeof import('../cloudfunctions/weevibeLogin/index');
    const openA = identity(), openB = identity(), forwarded: string[] = [];
    let requestCalls = 0;
    const fixedHttpsEndpoint = 'https://api.example.invalid/api/v1/auth/cloud-wechat';
    const request: typeof fetch = async (input, init) => {
      requestCalls++;
      assert.equal(String(input), fixedHttpsEndpoint);
      assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
      assert.equal(typeof init?.body, 'string');
      const signature = new Headers(init?.headers).get('x-weego-cloud-signature');
      assert.ok(signature);
      const parsed = protocol.verifySignedProof(init!.body as string, signature, verifier);
      assert.ok([openA, openB].includes(parsed.identity.openId));
      forwarded.push(parsed.identity.openId);
      return fetch(new URL(protocol.LOGIN_PATH, api), init);
    };
    const handler = createLoginHandler({ env: { ...process.env,
      WEEGO_API_BASE_URL: 'https://api.example.invalid',
      WEEGO_CLOUD_AUTH_PRIVATE_KEY_B64: process.env.WEEGO_CLOUD_AUTH_TEST_PRIVATE_KEY_B64,
    }, request });
    const context = (openId: string, source = 'wx_client') => ({ namespace: signer.envId,
      environment: JSON.stringify({ TCB_SOURCE: source, WX_APPID: signer.appId, WX_OPENID: openId, TCB_ENV: signer.envId }) });
    const returned = [
      await handler({ WX_OPENID: openB, url: 'https://ignored.invalid' }, context(openA)),
      await handler({ open_id: 'ignored-event' }, context(openA)),
      await handler({}, context(openB)),
    ];
    const sessions = returned.map(value => {
      assert.ok(value !== null && typeof value === 'object');
      assert.deepEqual(Object.keys(value).sort(), ['expires_at', 'token', 'user']);
      assert.deepEqual(Object.keys((value as { user: object }).user), ['user_id']);
      const encoded = JSON.stringify(value);
      assert.ok(!encoded.includes(openA) && !encoded.includes(openB));
      assert.ok(!/"(?:open_id|openId|signature|nonce)"/.test(encoded));
      return sessionSchema.parse(value);
    });
    assert.deepEqual(forwarded, [openA, openA, openB]);
    assert.equal(requestCalls, 3);
    assert.equal(sessions[0].user.user_id, sessions[1].user.user_id);
    assert.notEqual(sessions[0].token, sessions[1].token);
    assert.notEqual(sessions[0].user.user_id, sessions[2].user.user_id);
    for (const issued of sessions) assert.equal((await me(issued.token)).user_id, issued.user.user_id);
    assert.equal(await db!.wechatIdentity.count({ where: { appId: signer.appId, openId: openA } }), 1);
    assert.equal(await db!.wechatIdentity.count({ where: { appId: signer.appId, openId: openB } }), 1);
    const beforeRejected = forwarded.length, callsBeforeRejected = requestCalls;
    for (const invalid of [{ namespace: signer.envId, environment: '{}' }, context(openA, 'server')]) {
      const result = await handler({ WX_APPID: signer.appId, WX_OPENID: openA, TCB_SOURCE: 'wx_client' }, invalid) as { error?: { code?: string } };
      assert.equal(result.error?.code, 'UNAUTHENTICATED');
      assert.equal(forwarded.length, beforeRejected);
      assert.equal(requestCalls, callsBeforeRejected);
      const encoded = JSON.stringify(result);
      assert.ok(!encoded.includes(openA) && !encoded.includes(openB));
    }
  });
  await check('same_proof_concurrent_requests_issue_exactly_one_session', async () => {
    const openId = identity(), proof = envelope(openId), digest = verified(proof).proof.digest;
    const responses = await Promise.all([send(proof), send(proof)]);
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 401]);
    const issued = session(responses.find(r => r.status === 200)!);
    rejected(responses.find(r => r.status === 401)!, 401, 'UNAUTHENTICATED');
    assert.equal(await db!.cloudLoginUse.count({ where: { digest } }), 1);
    assert.equal(await db!.wechatIdentity.count({ where: { appId: signer.appId, openId } }), 1);
    assert.equal(await db!.authSession.count({ where: { userId: issued.user.user_id } }), 1);
  });
  await check('different_proofs_concurrent_same_identity_resolve_one_user', async () => {
    const openId = identity(), proofs = [envelope(openId), envelope(openId)];
    const sessions = (await Promise.all(proofs.map(p => send(p)))).map(session);
    assert.equal(sessions[0].user.user_id, sessions[1].user.user_id); assert.notEqual(sessions[0].token, sessions[1].token);
    assert.equal(await db!.wechatIdentity.count({ where: { appId: signer.appId, openId } }), 1);
    assert.equal(await db!.authSession.count({ where: { userId: sessions[0].user.user_id } }), 2);
    for (const p of proofs) assert.equal(await db!.cloudLoginUse.count({ where: { digest: verified(p).proof.digest } }), 1);
  });
  await check('session_insert_failure_rolls_back_nonce_identity_and_new_user', async () => {
    const openId = identity(), proof = envelope(openId), digest = verified(proof).proof.digest;
    const beforeUsers = await db!.user.count();
    const suffix = randomBytes(8).toString('hex');
    const trigger = `weego_cloud_test_trigger_${suffix}`, fn = `weego_cloud_test_fn_${suffix}`, seq = `weego_cloud_test_seq_${suffix}`;
    assert.match(openId, /^[A-Za-z0-9_]+$/); assert.match(signer.appId, /^wx[0-9a-f]{16}$/);
    let createdSequence = false, createdFunction = false, createdTrigger = false;
    try {
      await db!.$executeRawUnsafe(`CREATE SEQUENCE "${seq}"`); createdSequence = true;
      await db!.$executeRawUnsafe(`CREATE FUNCTION "${fn}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF EXISTS (SELECT 1 FROM "WechatIdentity" WHERE "userId" = NEW."userId" AND "appId" = '${signer.appId}' AND "openId" = '${openId}') THEN
          PERFORM nextval('"${seq}"'); RAISE EXCEPTION 'controlled cloud login acceptance failure';
        END IF; RETURN NEW; END $$`); createdFunction = true;
      await db!.$executeRawUnsafe(`CREATE TRIGGER "${trigger}" BEFORE INSERT ON "AuthSession" FOR EACH ROW EXECUTE FUNCTION "${fn}"()`); createdTrigger = true;
      rejected(await send(proof), 503, 'DATABASE_UNAVAILABLE');
      const reached = await db!.$queryRawUnsafe<Array<{ last_value: bigint }>>(`SELECT last_value FROM "${seq}"`);
      assert.ok(Number(reached[0].last_value) >= 1, 'Failure must reach session insert after identity creation');
      assert.equal(await db!.cloudLoginUse.count({ where: { digest } }), 0);
      assert.equal(await db!.wechatIdentity.count({ where: { appId: signer.appId, openId } }), 0);
      assert.equal(await db!.user.count(), beforeUsers);
    } finally {
      if (createdTrigger) await db!.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuthSession"`);
      if (createdFunction) await db!.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
      if (createdSequence) await db!.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS "${seq}"`);
    }
    const recovered = session(await send(proof));
    assert.equal(await db!.cloudLoginUse.count({ where: { digest } }), 1);
    assert.equal(await db!.authSession.count({ where: { userId: recovered.user.user_id } }), 1);
    assert.equal(await db!.user.count(), beforeUsers + 1);
  });
  await check('proof_expiring_while_waiting_on_database_lock_is_rolled_back', async () => {
    const openId = identity(), parsed = verified(envelope(openId));
    let release!: () => void, locked!: () => void;
    const releaseSignal = new Promise<void>(r => { release = r; });
    const lockSignal = new Promise<void>(r => { locked = r; });
    const holder = db!.$transaction(async tx => {
      await tx.$executeRaw`LOCK TABLE "CloudLoginUse" IN ACCESS EXCLUSIVE MODE`;
      locked(); await releaseSignal;
    }, { timeout: 5000 });
    let outcome: Promise<unknown> | undefined;
    try {
      await Promise.race([lockSignal, holder.then(() => { throw new Error('Lock holder did not remain active'); })]);
      outcome = issue(parsed.identity, { ...parsed.proof, expiresAt: new Date(Date.now() + 800) }).then(value => ({ value }), failure => ({ failure }));
      let sawWaiting = false;
      for (let i = 0; i < 15; i++) {
        const rows = await db!.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%CloudLoginUse%'`;
        if (rows[0].n > 0) { sawWaiting = true; break; }
        await delay(30);
      }
      assert.ok(sawWaiting, 'The store must actually queue on the controlled table lock');
      await delay(900);
    } finally { release(); await holder; }
    const completed = await outcome as { failure?: { code?: string; status?: number }; value?: unknown };
    assert.ok(completed.failure); assert.equal(completed.failure.code, 'UNAUTHENTICATED'); assert.equal(completed.failure.status, 401);
    assert.equal(await db!.cloudLoginUse.count({ where: { digest: parsed.proof.digest } }), 0);
    assert.equal(await db!.wechatIdentity.count({ where: { appId: signer.appId, openId } }), 0);
  });
  await check('already_expired_or_malformed_store_proof_rejected_without_write', async () => {
    const parsed = verified(envelope(identity())), before = await db!.cloudLoginUse.count();
    await rejectedStore(issue(parsed.identity, { ...parsed.proof, expiresAt: new Date(Date.now() - 1) }));
    await rejectedStore(issue(parsed.identity, { ...parsed.proof, digest: 'invalid' }));
    assert.equal(await db!.cloudLoginUse.count(), before);
  });
}

async function main() {
  const { database, api } = targets();
  await mkdir(resolve(root, '.working'), { recursive: true });
  const require = createRequire(import.meta.url);
  const protocol = require(resolve(root, 'cloudfunctions/weevibeLogin/proof.cjs')) as Protocol;
  const { getDb } = require(resolve(root, 'apps/web/src/server/db.ts')) as typeof import('../apps/web/src/server/db');
  const { issueCloudSession } = require(resolve(root, 'apps/web/src/server/auth/cloud-store.ts')) as typeof import('../apps/web/src/server/auth/cloud-store');
  db = getDb(); await run(database, api, issueCloudSession, protocol);
  await writeFile(resultPath, JSON.stringify({ status: 'passed', checks, checked_at: new Date().toISOString(), evidence: 'actual_function_sdk_with_synthetic_context_and_fixture_signatures_to_local_http_pg', real_wechat_context: 'not_executed' }, null, 2) + '\n');
  console.log(`PASS ${checks.length} cloud identity PG/HTTP checks; fixture signatures, no real WeChat context.`);
}
main().catch(async () => {
  console.error(`FAIL cloud identity integration at check: ${current}. Raw error withheld.`);
  try { await mkdir(resolve(root, '.working'), { recursive: true }); await writeFile(resultPath, JSON.stringify({ status: 'failed', failed_check: current, completed_checks: checks }, null, 2) + '\n'); } catch { /* never print original errors or configuration */ }
  process.exitCode = 1;
}).finally(async () => {
  try { await db?.$disconnect(); }
  catch {
    console.error('FAIL cloud identity integration while closing the local database pool. Raw error withheld.');
    process.exitCode = 1;
    try { await writeFile(resultPath, JSON.stringify({ status: 'failed', failed_check: 'database_pool_cleanup', completed_checks: checks }, null, 2) + '\n'); } catch { /* no raw cleanup error */ }
  }
});

/** Real Next Request/Response handlers and real disposable-PG auth, with no network server or WeChat exchange. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  emptyGatheringDetails, emptyGatheringIntake, gatheringSnapshotSchema, cloudHttpEnvelopeSchema,
  CLOUD_HTTP_ENVELOPE_HEADER, CLOUD_HTTP_ENVELOPE_VERSION,
  type GatheringIntake, type GatheringItinerary,
} from '../packages/contracts/src';

assert.ok(process.argv.includes('--fixture-only'), 'Explicit fixture-only argument required');
const raw = process.env.DATABASE_URL;
assert.ok(raw, 'Explicit disposable local acceptance database required');
let target: URL;
try { target = new URL(raw); } catch { throw new Error('Invalid disposable database URL'); }
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol));
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Only loopback fixture databases are allowed');
assert.match(target.port || '5432', /^\d{2,5}$/);
assert.match(decodeURIComponent(target.pathname.slice(1)), /^weevibe_acceptance_[a-z0-9_]+$/);
assert.ok(!target.hash);
for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public', 'Unexpected connection override');
globalThis.fetch = async () => { throw new Error('External HTTP is disabled in the disposable gathering HTTP fixture'); };

const loadServer = createRequire(import.meta.url);
const { getDb } = loadServer('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const { generateGatheringItinerary } = loadServer('../apps/web/src/server/gatherings/generation.ts') as typeof import('../apps/web/src/server/gatherings/generation');
const collectionRoute = loadServer('../apps/web/src/app/api/v1/gatherings/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/route');
const itemRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/route');
const joinRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/join/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/join/route');
const intakeRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/intake/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/intake/route');
const detailsRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/details/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/details/route');
const generationRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/generate/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/generate/route');
const finalizeRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/finalize/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/finalize/route');
const membersRoute = loadServer('../apps/web/src/app/api/v1/gatherings/[id]/members/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/[id]/members/route');
const organizeRoute = loadServer('../apps/web/src/app/api/v1/gatherings/organize/route.ts') as typeof import('../apps/web/src/app/api/v1/gatherings/organize/route');

const db = getDb(), checks: string[] = [], output = resolve(import.meta.dirname, '../.working/html-replacement-20261028/pg');
let current = 'setup';
const key = () => randomUUID();
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Response | Promise<Response>;
type HttpResult = { status: number; body: unknown; cache: string | null };
async function call(handler: Handler, path: string, { token, body, rawBody, method = 'GET', id = '', envelope = false }: { token?: string; body?: unknown; rawBody?: string; method?: 'GET' | 'POST'; id?: string; envelope?: boolean } = {}): Promise<HttpResult> {
  const response = await handler(new Request(`http://127.0.0.1:55440${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(envelope ? { [CLOUD_HTTP_ENVELOPE_HEADER]: CLOUD_HTTP_ENVELOPE_VERSION } : {}) },
    ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), { params: Promise.resolve({ id }) });
  return { status: response.status, body: await response.json() as unknown, cache: response.headers.get('Cache-Control') };
}
function snapshot(result: HttpResult) { assert.equal(result.status, 200); assert.equal(result.cache, 'no-store'); return gatheringSnapshotSchema.parse(result.body); }
function rejected(result: HttpResult, status: number, code?: string) {
  assert.equal(result.status, status); assert.equal(result.cache, 'no-store');
  if (code) assert.equal((result.body as { error?: { code?: string } }).error?.code, code);
}
function excludes(value: unknown, ...sentinels: string[]) { const text = JSON.stringify(value); for (const sentinel of sentinels) assert.ok(!text.includes(sentinel), 'Private fixture fields escaped the HTTP response'); }
async function check(name: string, work: () => Promise<void>) { current = name; await work(); checks.push(name); console.log(`PASS ${name}`); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function actor() {
  const user = await db.user.create({ data: {} }), token = randomBytes(32).toString('base64url');
  await db.authSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
  return { id: user.id, token };
}
function ownIntake(prefix: string): GatheringIntake {
  const value = emptyGatheringIntake(); value.public.note = `${prefix} public preference`;
  value.private = { budget_min: 5555.55, budget_max: 5666.66, budget_note: `${prefix}_PRIVATE_BUDGET_SENTINEL`, origin: { label: `${prefix}_PRIVATE_ORIGIN_SENTINEL` }, confirmed_keys: ['budget', 'origin'] };
  return value;
}

try {
  await mkdir(output, { recursive: true });
  const owner = await actor(), member = await actor(), outsider = await actor();
  const expiredToken = randomBytes(32).toString('base64url');
  await db.authSession.create({ data: { userId: owner.id, tokenHash: createHash('sha256').update(expiredToken).digest('hex'), expiresAt: new Date(Date.now() - 10000) } });
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const details = { ...emptyGatheringDetails(), date, title: 'HTTP synthetic friend fixture', place: 'Synthetic common venue', confirmed_details: ['date', 'title', 'place'] };
  const friendBody = { kind: 'friend', idempotency_key: key(), details, intake: ownIntake('OWNER') };
  let friend = snapshot(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: owner.token, body: friendBody }));
  const friendId = friend.gathering.id, itemPath = `/api/v1/gatherings/${friendId}`;
  await check('real hashed fixture sessions protect read and write entry points', async () => {
    rejected(await call(collectionRoute.GET, '/api/v1/gatherings'), 401, 'UNAUTHENTICATED');
    rejected(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', body: friendBody }), 401, 'UNAUTHENTICATED');
    rejected(await call(itemRoute.GET, itemPath, { id: friendId }), 401, 'UNAUTHENTICATED');
    rejected(await call(joinRoute.POST, `${itemPath}/join`, { method: 'POST', id: friendId }), 401, 'UNAUTHENTICATED');
    rejected(await call(generationRoute.POST, `${itemPath}/generate`, { method: 'POST', id: friendId, body: { expected_source: friend.source_fingerprint, idempotency_key: key() } }), 401, 'UNAUTHENTICATED');
    rejected(await call(organizeRoute.POST, '/api/v1/gatherings/organize', { method: 'POST', body: { public: emptyGatheringIntake().public } }), 401, 'UNAUTHENTICATED');
    rejected(await call(collectionRoute.GET, '/api/v1/gatherings', { token: expiredToken }), 401, 'UNAUTHENTICATED');
    rejected(await call(collectionRoute.GET, '/api/v1/gatherings', { token: randomBytes(32).toString('base64url') }), 401, 'UNAUTHENTICATED');
    const result = await call(collectionRoute.GET, '/api/v1/gatherings', { token: owner.token }); assert.equal(result.status, 200);
  });
  const joined = snapshot(await call(joinRoute.POST, `${itemPath}/join`, { method: 'POST', token: member.token, id: friendId }));
  const memberBody = { expected_revision: joined.gathering.revision, expected_version: joined.own!.version, idempotency_key: key(), intake: ownIntake('MEMBER') };
  await check('HTTP create and member save replay exact requests without duplicate records or versions', async () => {
    const before = await db.gathering.count({ where: { ownerUserId: owner.id } });
    assert.equal(snapshot(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: owner.token, body: friendBody })).gathering.id, friendId);
    assert.equal(await db.gathering.count({ where: { ownerUserId: owner.id } }), before);
    rejected(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: owner.token, body: { ...friendBody, details: { ...details, title: 'Different original intent' } } }), 409, 'IDEMPOTENCY_CONFLICT');
    const saved = snapshot(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: member.token, id: friendId, body: memberBody }));
    assert.equal(saved.own?.version, 1);
    assert.equal(snapshot(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: member.token, id: friendId, body: memberBody })).own?.version, 1);
    rejected(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: member.token, id: friendId, body: { ...memberBody, user_id: owner.id } }), 400, 'INVALID_INPUT');
    assert.equal((await db.gatheringMember.findUniqueOrThrow({ where: { gatheringId_userId: { gatheringId: friendId, userId: member.id } } })).responseVersion, 1);
  });
  await check('HTTP roles reject foreign edits, generation and nonmember response or directory access', async () => {
    rejected(await call(detailsRoute.POST, `${itemPath}/details`, { method: 'POST', token: member.token, id: friendId, body: { expected_revision: friend.gathering.revision, details } }), 403, 'FORBIDDEN');
    rejected(await call(generationRoute.POST, `${itemPath}/generate`, { method: 'POST', token: member.token, id: friendId, body: { expected_source: friend.source_fingerprint, idempotency_key: key() } }), 403, 'FORBIDDEN');
    rejected(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: outsider.token, id: friendId, body: { ...memberBody, idempotency_key: key(), expected_version: 0 } }), 403, 'FORBIDDEN');
    rejected(await call(membersRoute.GET, `${itemPath}/members`, { token: outsider.token, id: friendId }), 403, 'FORBIDDEN');
    const preview = snapshot(await call(itemRoute.GET, itemPath, { token: outsider.token, id: friendId }));
    assert.equal(preview.viewer.is_member, false); assert.equal(preview.members, null); assert.equal(preview.own, null);
    excludes(preview, 'OWNER_PRIVATE', 'MEMBER_PRIVATE', '5555.55', '5666.66');
    const manager = snapshot(await call(itemRoute.GET, itemPath, { token: owner.token, id: friendId })); excludes(manager.members, 'MEMBER_PRIVATE', '5555.55', '5666.66');
    const directory = await call(membersRoute.GET, `${itemPath}/members`, { token: member.token, id: friendId }); assert.equal(directory.status, 200); excludes(directory.body, 'OWNER_PRIVATE', 'MEMBER_PRIVATE', '5555.55', '5666.66');
  });
  await check('HTTP input boundary rejects malformed UUID, JSON and oversized streamed bodies', async () => {
    rejected(await call(itemRoute.GET, '/api/v1/gatherings/not-a-uuid', { token: owner.token, id: 'not-a-uuid' }), 400, 'INVALID_INPUT');
    rejected(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: owner.token, rawBody: '{' }), 400, 'INVALID_INPUT');
    const oversized = await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: owner.token, rawBody: JSON.stringify({ text: 'OVERSIZE_PRIVATE_SENTINEL' + 'x'.repeat(65536) }) });
    rejected(oversized, 400, 'INVALID_INPUT'); excludes(oversized.body, 'OVERSIZE_PRIVATE_SENTINEL');
  });
  await check('native cloud HTTP envelope retains rejection status without exposing a private response', async () => {
    const response = await call(detailsRoute.POST, `${itemPath}/details`, { method: 'POST', token: member.token, id: friendId, envelope: true, body: { expected_revision: friend.gathering.revision, details } });
    assert.equal(response.status, 200); const envelope = cloudHttpEnvelopeSchema.parse(response.body); assert.equal(envelope.status, 403);
    assert.equal((envelope.body as { error: { code: string } }).error.code, 'FORBIDDEN'); excludes(envelope.body, 'OWNER_PRIVATE', 'MEMBER_PRIVATE');
  });
  friend = snapshot(await call(itemRoute.GET, itemPath, { token: owner.token, id: friendId }));
  const generationBody = { expected_source: friend.source_fingerprint!, idempotency_key: key() };
  const result: GatheringItinerary = { plans: [1,2].map(number=>({ id: `plan${number}`, title: `Fixture plan ${number}`, summary: 'Explicit fixture provider', segments: [{ id: 's1', title: '聚餐', date, start_time: '', end_time: '', description: 'Synthetic', place: 'Synthetic common venue', address: '', fee_note: '费用待核实', unknowns: [] }], notes: [] })), notes: [] };
  await generateGatheringItinerary(friendId, owner.id, generationBody, { async generate() { return result; } });
  await check('HTTP generation replay reaches the real idempotency record without contacting any model', async () => {
    const before = await db.gatheringGeneration.count({ where: { gatheringId: friendId } });
    const response = snapshot(await call(generationRoute.POST, `${itemPath}/generate`, { method: 'POST', token: owner.token, id: friendId, body: generationBody }));
    assert.equal(response.itinerary?.plans[0].segments[0].title, '聚餐');
    assert.equal(await db.gatheringGeneration.count({ where: { gatheringId: friendId } }), before);
  });
  const teamDetails = { ...emptyGatheringDetails(), date, title: 'HTTP synthetic team fixture', description: 'UNCONFIRMED_TEAM_DESCRIPTION_SENTINEL', place: 'Synthetic common venue',
    confirmed_details: ['date', 'title', 'place'], deadline_at: new Date(Date.now() + 86400000).toISOString(),
    questions: [
      { id: 'q_public', title: '想做什么', type: 'single', required: true, options: [{ id: 'o1', label: '聚餐' }] },
      { id: 'q_budget', title: '我的预算', type: 'text', required: false, options: [] },
    ] };
  const team = snapshot(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: owner.token, body: { kind: 'team', idempotency_key: key(), details: teamDetails, intake: ownIntake('TEAM_OWNER') } }));
  const teamId = team.gathering.id, teamPath = `/api/v1/gatherings/${teamId}`;
  const teamMember = snapshot(await call(joinRoute.POST, `${teamPath}/join`, { method: 'POST', token: member.token, id: teamId }));
  const teamIntake = ownIntake('TEAM_MEMBER'); teamIntake.answers = [{ question_id: 'q_public', option_ids: ['o1'], other: '', text: '' }, { question_id: 'q_budget', option_ids: [], other: '', text: 'TEAM_QUESTION_PRIVATE_SENTINEL' }];
  snapshot(await call(intakeRoute.POST, `${teamPath}/intake`, { method: 'POST', token: member.token, id: teamId, body: { expected_revision: team.gathering.revision, expected_version: teamMember.own!.version, idempotency_key: key(), intake: teamIntake } }));
  await check('team HTTP responses separate organizer statistics from participant information and own private answers', async () => {
    const manager = snapshot(await call(itemRoute.GET, teamPath, { token: owner.token, id: teamId })); assert.equal(manager.stats?.respondent_count, 1); assert.equal(manager.stats?.questions.find(q => q.id === 'q_public')?.options[0].count, 1);
    excludes(manager, 'TEAM_MEMBER_PRIVATE', 'TEAM_QUESTION_PRIVATE_SENTINEL');
    for (const actor of [member, outsider]) {
      const view = snapshot(await call(itemRoute.GET, teamPath, { token: actor.token, id: teamId })); assert.equal(view.stats, null); assert.equal(view.members, null);
      excludes(view, 'TEAM_OWNER_PRIVATE', 'UNCONFIRMED_TEAM_DESCRIPTION_SENTINEL');
      if (actor.id === outsider.id) excludes(view, 'TEAM_MEMBER_PRIVATE', 'TEAM_QUESTION_PRIVATE_SENTINEL');
      else assert.ok(JSON.stringify(view.own).includes('TEAM_QUESTION_PRIVATE_SENTINEL'));
    }
  });
  await check('a friend share visitor joins only when submitting and replays the atomic intake without duplicate membership or versions', async () => {
    const invitation = snapshot(await call(itemRoute.GET, itemPath, { token: outsider.token, id: friendId }));
    assert.equal(invitation.viewer.is_member, false); assert.equal(invitation.own, null);
    const memberWhere = { gatheringId: friendId, userId: outsider.id };
    assert.equal(await db.gatheringMember.count({ where: memberWhere }), 0);
    const submission = { expected_revision: invitation.gathering.revision, expected_version: 0, idempotency_key: key(), intake: ownIntake('SHARE_VISITOR') };
    rejected(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: outsider.token, id: friendId, body: submission }), 403, 'FORBIDDEN');
    assert.equal(await db.gatheringMember.count({ where: memberWhere }), 0);
    const atomic = { ...submission, join_if_needed: true };
    const saved = snapshot(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: outsider.token, id: friendId, body: atomic }));
    assert.equal(saved.viewer.is_member, true); assert.equal(saved.own?.version, 1); assert.equal(saved.own?.intake.private.budget_note, 'SHARE_VISITOR_PRIVATE_BUDGET_SENTINEL');
    const replay = snapshot(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: outsider.token, id: friendId, body: atomic }));
    assert.equal(replay.own?.version, 1); assert.equal(await db.gatheringMember.count({ where: memberWhere }), 1);
    const stored = await db.gatheringMember.findUniqueOrThrow({ where: { gatheringId_userId: memberWhere } });
    assert.equal(stored.responseVersion, 1); assert.equal(stored.lastWriteKey, atomic.idempotency_key);
    rejected(await call(intakeRoute.POST, `${itemPath}/intake`, { method: 'POST', token: outsider.token, id: friendId, body: { ...atomic, intake: ownIntake('CHANGED_SHARE_VISITOR') } }), 409, 'IDEMPOTENCY_CONFLICT');
    const manager = snapshot(await call(itemRoute.GET, itemPath, { token: owner.token, id: friendId }));
    excludes(manager, 'SHARE_VISITOR_PRIVATE');
  });
  await check('a team share submission rolls back invalid required answers and atomically joins only after a valid save', async () => {
    const invitation = snapshot(await call(itemRoute.GET, teamPath, { token: outsider.token, id: teamId }));
    const memberWhere = { gatheringId: teamId, userId: outsider.id };
    assert.equal(invitation.viewer.is_member, false); assert.equal(await db.gatheringMember.count({ where: memberWhere }), 0);
    const submission = { expected_revision: invitation.gathering.revision, expected_version: 0, idempotency_key: key(), join_if_needed: true, intake: ownIntake('TEAM_SHARE_VISITOR') };
    rejected(await call(intakeRoute.POST, `${teamPath}/intake`, { method: 'POST', token: outsider.token, id: teamId, body: submission }), 400, 'INVALID_INPUT');
    assert.equal(await db.gatheringMember.count({ where: memberWhere }), 0);
    const completed = { ...submission, intake: { ...submission.intake, answers: [{ question_id: 'q_public', option_ids: ['o1'], other: '', text: '' }] } };
    const saved = snapshot(await call(intakeRoute.POST, `${teamPath}/intake`, { method: 'POST', token: outsider.token, id: teamId, body: completed }));
    assert.equal(saved.viewer.is_member, true); assert.equal(saved.own?.version, 1); assert.equal(saved.stats, null); assert.equal(saved.members, null);
    assert.equal(snapshot(await call(intakeRoute.POST, `${teamPath}/intake`, { method: 'POST', token: outsider.token, id: teamId, body: completed })).own?.version, 1);
    assert.equal(await db.gatheringMember.count({ where: memberWhere }), 1);
    const manager = snapshot(await call(itemRoute.GET, teamPath, { token: owner.token, id: teamId }));
    assert.equal(manager.stats?.respondent_count, 2); excludes(manager, 'TEAM_SHARE_VISITOR_PRIVATE');
  });
  const finalOwner = await actor(), finalMember = await actor(), finalVisitor = await actor();
  let final = snapshot(await call(collectionRoute.POST, '/api/v1/gatherings', { method: 'POST', token: finalOwner.token,
    body: { ...friendBody, idempotency_key: key(), intake: ownIntake('FINAL_OWNER') } }));
  const finalId = final.gathering.id, finalPath = `/api/v1/gatherings/${finalId}`;
  const memberSubmission = { expected_revision: final.gathering.revision, expected_version: 0, idempotency_key: key(), join_if_needed: true, intake: ownIntake('FINAL_MEMBER') };
  snapshot(await call(intakeRoute.POST, `${finalPath}/intake`, { method: 'POST', token: finalMember.token, id: finalId, body: memberSubmission }));
  final = snapshot(await call(itemRoute.GET, finalPath, { token: finalOwner.token, id: finalId }));
  final = await generateGatheringItinerary(finalId, finalOwner.id, { expected_source: final.source_fingerprint!, idempotency_key: key() }, { async generate() { return result; } });
  const oldChoice = { expected_source: final.source_fingerprint!, generation_id: final.itinerary!.generation_id, plan_id: 'plan1' };
  const changedSubmission = { ...memberSubmission, expected_version: 1, idempotency_key: key(), intake: ownIntake('FINAL_MEMBER_CHANGED') };
  await check('finalization authorizes only the owner and rejects stale or foreign proposals before recording any choice', async () => {
    const migrations = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.ok(migrations.length >= 14); assert.ok(migrations.some(row => row.migration_name === '20261028173000_gathering_final_choice'));
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', id: finalId, body: oldChoice }), 401, 'UNAUTHENTICATED');
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalMember.token, id: finalId, body: oldChoice }), 403, 'FORBIDDEN');
    const foreign = await db.gatheringGeneration.findFirstOrThrow({ where: { gatheringId: friendId, status: 'ready' } });
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: { ...oldChoice, generation_id: foreign.id } }), 409, 'INVALID_INPUT');
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: { ...oldChoice, plan_id: 'missing_plan' } }), 400, 'INVALID_INPUT');
    rejected(await call(finalizeRoute.POST, `${teamPath}/finalize`, { method: 'POST', token: owner.token, id: teamId, body: oldChoice }), 409, 'INVALID_INPUT');
    snapshot(await call(intakeRoute.POST, `${finalPath}/intake`, { method: 'POST', token: finalMember.token, id: finalId, body: changedSubmission }));
    final = snapshot(await call(itemRoute.GET, finalPath, { token: finalOwner.token, id: finalId }));
    assert.notEqual(final.source_fingerprint, oldChoice.expected_source); assert.equal(final.itinerary?.stale, true);
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: oldChoice }), 409, 'VERSION_CONFLICT');
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: { ...oldChoice, expected_source: final.source_fingerprint } }), 409, 'VERSION_CONFLICT');
    const stored = await db.gathering.findUniqueOrThrow({ where: { id: finalId } });
    assert.equal(stored.finalGenerationId, null); assert.equal(stored.finalPlanId, null); assert.equal(stored.finalizedAt, null);
  });
  const regeneratedRequest = { expected_source: final.source_fingerprint!, idempotency_key: key() };
  final = await generateGatheringItinerary(finalId, finalOwner.id, regeneratedRequest, { async generate() { return result; } });
  await check('a final choice is naturally idempotent, visible to share visitors and locks every subsequent mutation without losing acknowledged writes', async () => {
    const choice = { expected_source: final.source_fingerprint!, generation_id: final.itinerary!.generation_id, plan_id: 'plan1' };
    const lateStarted = deferred<void>(), lateResult = deferred<GatheringItinerary>();
    const late = generateGatheringItinerary(finalId, finalOwner.id, { expected_source: final.source_fingerprint!, idempotency_key: key() }, { async generate() { lateStarted.resolve(); return lateResult.promise; } });
    const lateRejection = assert.rejects(late, { code: 'INVALID_INPUT' });
    await lateStarted.promise;
    const selected = snapshot(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: choice }));
    assert.equal(selected.final_choice?.generation_id, choice.generation_id); assert.equal(selected.final_choice?.plan_id, 'plan1');
    assert.equal(selected.gathering.revision, final.gathering.revision + 1);
    assert.equal(selected.viewer.can_respond, false); assert.equal(selected.viewer.can_generate, false);
    lateResult.resolve(result); await lateRejection;
    const stored = await db.gathering.findUniqueOrThrow({ where: { id: finalId } });
    assert.equal(stored.currentGenerationId, choice.generation_id); assert.equal(stored.finalGenerationId, choice.generation_id);
    const replay = snapshot(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: choice }));
    assert.deepEqual(replay.final_choice, selected.final_choice); assert.equal(replay.gathering.revision, selected.gathering.revision);
    rejected(await call(finalizeRoute.POST, `${finalPath}/finalize`, { method: 'POST', token: finalOwner.token, id: finalId, body: { ...choice, plan_id: 'plan2' } }), 409, 'INVALID_INPUT');
    const invitation = snapshot(await call(itemRoute.GET, finalPath, { token: finalVisitor.token, id: finalId }));
    assert.deepEqual(invitation.final_choice, selected.final_choice); assert.equal(invitation.itinerary?.generation_id, choice.generation_id); assert.equal(invitation.itinerary?.plans.length, 2);
    assert.equal(invitation.viewer.is_member, false); assert.equal(invitation.viewer.can_respond, false); assert.equal(invitation.members, null); assert.equal(invitation.stats, null); assert.equal(invitation.own, null);
    excludes(invitation, 'FINAL_OWNER', 'FINAL_MEMBER', '5555.55', '5666.66');
    rejected(await call(joinRoute.POST, `${finalPath}/join`, { method: 'POST', token: finalVisitor.token, id: finalId }), 409, 'INVALID_INPUT');
    rejected(await call(intakeRoute.POST, `${finalPath}/intake`, { method: 'POST', token: finalMember.token, id: finalId, body: { ...changedSubmission, expected_version: 2, idempotency_key: key(), intake: ownIntake('MUST_NOT_SAVE') } }), 409, 'INVALID_INPUT');
    rejected(await call(intakeRoute.POST, `${finalPath}/intake`, { method: 'POST', token: finalVisitor.token, id: finalId, body: { ...memberSubmission, idempotency_key: key() } }), 409, 'INVALID_INPUT');
    rejected(await call(detailsRoute.POST, `${finalPath}/details`, { method: 'POST', token: finalOwner.token, id: finalId, body: { expected_revision: selected.gathering.revision, details: { ...selected.gathering.details, title: 'MUST_NOT_UPDATE_TITLE' } } }), 409, 'INVALID_INPUT');
    rejected(await call(generationRoute.POST, `${finalPath}/generate`, { method: 'POST', token: finalOwner.token, id: finalId, body: { expected_source: selected.source_fingerprint, idempotency_key: key() } }), 409, 'INVALID_INPUT');
    const answerReplay = snapshot(await call(intakeRoute.POST, `${finalPath}/intake`, { method: 'POST', token: finalMember.token, id: finalId, body: changedSubmission }));
    assert.equal(answerReplay.own?.version, 2); assert.deepEqual(answerReplay.final_choice, selected.final_choice);
    assert.deepEqual(snapshot(await call(generationRoute.POST, `${finalPath}/generate`, { method: 'POST', token: finalOwner.token, id: finalId, body: regeneratedRequest })).final_choice, selected.final_choice);
    const after = await db.gathering.findUniqueOrThrow({ where: { id: finalId } });
    assert.deepEqual(after, stored); assert.equal(await db.gatheringMember.count({ where: { gatheringId: finalId } }), 2);
    assert.equal((await db.gatheringMember.findUniqueOrThrow({ where: { gatheringId_userId: { gatheringId: finalId, userId: finalMember.id } } })).responseVersion, 2);
    assert.equal(await db.gatheringGeneration.count({ where: { gatheringId: finalId } }), 3);
    assert.equal(await db.gatheringGeneration.count({ where: { gatheringId: finalId, status: 'failed' } }), 1);
    await assert.rejects(() => db.gathering.update({ where: { id: finalId }, data: { finalPlanId: null } }));
    assert.equal((await db.gathering.findUniqueOrThrow({ where: { id: finalId } })).finalPlanId, 'plan1');
  });
  await writeFile(resolve(output, 'http-result.json'), JSON.stringify({ passed: true, source: 'real_next_route_request_response_with_real_postgresql_auth', checks, fixture_groups: checks.length,
    external_fetch_disabled: true, model_provider: 'explicit_fixture_for_setup_and_idempotent_http_replay', wechat_exchange: false, network_listener: false, shared_environment_touched: false }, null, 2));
  console.log(`Gathering real PostgreSQL / HTTP handler fixture groups passed: ${checks.length}`);
} catch (error) {
  const safe = { passed: false, current_check: current, error_type: error instanceof Error ? error.name : typeof error, code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null, raw_response_withheld: true };
  await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'http-result.json'), JSON.stringify(safe, null, 2));
  await writeFile(resolve(output, 'http-error.private.log'), error instanceof Error ? error.stack || error.message : String(error));
  console.error(JSON.stringify(safe)); process.exitCode = 1;
} finally { await db.$disconnect(); }

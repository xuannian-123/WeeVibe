/** Explicit disposable PostgreSQL fixtures. Never authenticates as a real WeChat user or calls a model. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  emptyGatheringDetails, emptyGatheringIntake, gatheringSnapshotSchema,
  type GatheringDetails, type GatheringIntake, type GatheringItinerary, type GatheringSnapshot,
} from '../packages/contracts/src';

// Validate before loading any server module or constructing its database client.
assert.ok(process.argv.includes('--fixture-only'), 'Explicit fixture-only argument required');
const raw = process.env.DATABASE_URL;
assert.ok(raw, 'Explicit disposable local acceptance database required');
let target: URL;
try { target = new URL(raw); } catch { throw new Error('Invalid disposable database URL'); }
assert.ok(['postgres:', 'postgresql:'].includes(target.protocol), 'PostgreSQL required');
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname), 'Only loopback fixture databases are allowed');
assert.match(target.port || '5432', /^\d{2,5}$/);
assert.match(decodeURIComponent(target.pathname.slice(1)), /^weevibe_acceptance_[a-z0-9_]+$/);
assert.ok(!target.hash, 'Unexpected connection fragment');
for (const [key, value] of target.searchParams) assert.ok(key === 'schema' && value === 'public', 'Unexpected connection override');
// Defense in depth: this fixture process cannot contact a supplier even if an unrelated shell contains AI settings.
globalThis.fetch = async () => { throw new Error('External HTTP is disabled in the disposable gathering fixture'); };

const loadServer = createRequire(import.meta.url);
const { getDb } = loadServer('../apps/web/src/server/db.ts') as typeof import('../apps/web/src/server/db');
const service = loadServer('../apps/web/src/server/gatherings/service.ts') as typeof import('../apps/web/src/server/gatherings/service');
const { generateGatheringItinerary } = loadServer('../apps/web/src/server/gatherings/generation.ts') as typeof import('../apps/web/src/server/gatherings/generation');
const db = getDb();
const output = resolve(import.meta.dirname, '../.working/html-replacement-20261028/pg');
const checks: string[] = [];
let current = 'migration_contract';
const key = () => randomUUID();
const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const deadline = new Date(Date.now() + 2 * 86400000).toISOString();
function publicDetails(kind: 'friend' | 'team'): GatheringDetails {
  return { ...emptyGatheringDetails(), date, title: `Synthetic ${kind} fixture`,
    place: 'Synthetic common venue', confirmed_details: ['date', 'title', 'place'],
    ...(kind === 'team' ? { deadline_at: deadline } : {}) };
}
function intake(note: string, privatePrefix: string): GatheringIntake {
  const value = emptyGatheringIntake();
  value.public = { ...value.public, activity_nickname:privatePrefix==='OWNER_PRIVATE'?'活动局头甲':privatePrefix==='MEMBER_PRIVATE'?'活动朋友乙':'活动参与者', date, note, keywords: { ...value.public.keywords, eat: ['常规中餐'], play: ['唱歌'] }, confirmed_keys: ['date', 'eat_0'] };
  const privateNumber = privatePrefix === 'OWNER_PRIVATE' ? 1111.11 : privatePrefix === 'MEMBER_PRIVATE' ? 2222.22 : privatePrefix === 'TEAM_PRIVATE' ? 3333.33 : 4444.44;
  value.private = { budget_min: privateNumber, budget_max: privateNumber + 100, budget_note: `${privatePrefix}_BUDGET`,
    origin: { label: `${privatePrefix}_ORIGIN`, latitude: privatePrefix === 'OWNER_PRIVATE' ? 30.123456 : 31.234567, longitude: 120.234567, crs: 'GCJ-02' }, confirmed_keys: ['budget', 'origin'] };
  return value;
}
function itinerary(title = 'Synthetic plan'): GatheringItinerary {
  return { plans: [1, 2].map(number => ({ id: `plan${number}`, title: `${title} ${number}`, summary: 'Fixture proposal; no supplier or model call',
    segments: [
      { id: 's1', title: '共同吃饭', description: 'Synthetic first segment', date, start_time: '12:00', end_time: '13:00', place: 'Synthetic common venue', address: '', fee_note: '费用待核实', unknowns: ['营业与预订待核实'] },
      { id: 's2', title: '一起唱歌', description: 'Synthetic next segment', date, start_time: '14:00', end_time: '16:00', place: '', address: '', fee_note: '费用待核实', unknowns: ['场地待核实'] },
    ], notes: ['Fixture result for transaction checks only'] })), notes: ['Not an accepted arrangement or booking'] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function check(name: string, work: () => Promise<void>) {
  current = name; await work(); checks.push(name); console.log(`PASS ${name}`);
}
function valid(value: GatheringSnapshot) { return gatheringSnapshotSchema.parse(value); }
function excludes(value: unknown, ...sentinels: string[]) {
  const serialized = JSON.stringify(value);
  for (const sentinel of sentinels) assert.ok(!serialized.includes(sentinel), 'Private fixture data escaped its own projection');
}
async function save(id: string, actor: string, value: GatheringIntake, override?: { expected_version: number; expected_revision: number; idempotency_key: string }) {
  const current = await service.getGathering(id, actor);
  return valid(await service.saveGatheringIntake(id, actor, {
    expected_revision: current.gathering.revision, expected_version: current.own!.version, idempotency_key: key(), ...override, intake: value,
  }));
}

try {
  await mkdir(output, { recursive: true });
  await check('fresh migration installs constrained gathering tables and generation uniqueness', async () => {
    const indexes = await db.$queryRaw<{ indexname: string; indexdef: string }[]>`SELECT indexname::text,indexdef::text FROM pg_indexes WHERE schemaname=current_schema() AND tablename='GatheringGeneration'`;
    assert.ok(indexes.some(row => row.indexname === 'GatheringGeneration_one_processing_idx' && row.indexdef.includes("'processing'")));
    const constraints = await db.$queryRaw<{ conname: string }[]>`SELECT conname::text FROM pg_constraint WHERE conname IN ('Gathering_kind_check','Gathering_revision_check','GatheringMember_version_check','GatheringGeneration_status_check')`;
    assert.equal(constraints.length, 4);
  });
  const owner = await db.user.create({ data: {} }), member = await db.user.create({ data: {} }), outsider = await db.user.create({ data: {} });
  const sharp = loadServer('../apps/web/node_modules/sharp') as (options: unknown) => { jpeg: () => { toBuffer: () => Promise<Buffer> } };
  const avatarBytes = await sharp({create:{width:2,height:2,channels:3,background:'#e4d6c8'}}).jpeg().toBuffer();
  for(const actor of [owner,member,outsider])await db.userAvatar.create({data:{userId:actor.id,bytes:Uint8Array.from(avatarBytes),contentType:'image/jpeg',digest:createHash('sha256').update(avatarBytes).digest('hex')}});
  await db.privateProfile.create({data:{userId:outsider.id,data:{nickname:'Fixture participant'}}});
  for (const [actor, nickname] of [[owner, 'Fixture owner'], [member, 'Fixture member']] as const) {
    await db.privateProfile.create({ data: { userId: actor.id, data: { nickname, birthday: '1999-01-01', signature: 'PRIVATE_PROFILE_SENTINEL' } } });
  }
  const friendInput = { kind: 'friend', idempotency_key: key(), details: publicDetails('friend'), intake: intake('Public owner preference', 'OWNER_PRIVATE') };
  let friend = valid(await service.createGathering(owner.id, friendInput));
  const friendId = friend.gathering.id;
  await check('create replay binds payload and leaves formal activity and seats untouched', async () => {
    assert.equal(valid(await service.createGathering(owner.id, friendInput)).gathering.id, friendId);
    await assert.rejects(() => service.createGathering(owner.id, { ...friendInput, details: { ...friendInput.details, title: 'Different body' } }), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal(await db.gathering.count({ where: { ownerUserId: owner.id, creationKey: friendInput.idempotency_key } }), 1);
    assert.equal(await db.activity.count({ where: { currentManagerId: owner.id } }), 0);
    assert.equal(await db.participation.count({ where: { userId: owner.id } }), 0);
  });
  await check('invitation read is bounded and cannot act as a membership or member directory', async () => {
    const view = valid(await service.getGathering(friendId, outsider.id));
    assert.equal(view.viewer.is_member, false); assert.equal(view.own, null); assert.equal(view.members, null); assert.equal(view.itinerary, null);
    excludes(view, 'OWNER_PRIVATE', 'PRIVATE_PROFILE_SENTINEL', '1999-01-01');
    assert.equal(await db.gatheringMember.count({ where: { gatheringId: friendId, userId: outsider.id } }), 0);
    await assert.rejects(() => service.getGatheringMembers(friendId, outsider.id, undefined), { code: 'FORBIDDEN' });
    await assert.rejects(() => service.saveGatheringIntake(friendId, outsider.id, { expected_revision: friend.gathering.revision, expected_version: 0, idempotency_key: key(), intake: emptyGatheringIntake() }), { code: 'FORBIDDEN' });
  });
  const joined = valid(await service.joinGathering(friendId, member.id));
  const memberIntake = intake('Public member preference', 'MEMBER_PRIVATE');
  const memberSave = { expected_revision: joined.gathering.revision, expected_version: joined.own!.version, idempotency_key: key(), intake: memberIntake };
  await check('own intake save is idempotent and friend projections expose only named public blocks', async () => {
    const own = valid(await service.saveGatheringIntake(friendId, member.id, memberSave));
    assert.equal(own.own?.version, 1); assert.equal(own.own?.intake.private.budget_note, 'MEMBER_PRIVATE_BUDGET');
    assert.equal(valid(await service.saveGatheringIntake(friendId, member.id, memberSave)).own?.version, 1);
    const manager = valid(await service.getGathering(friendId, owner.id));
    assert.ok(manager.members?.some(row => row.person.nickname === '活动朋友乙' && row.blocks.some(block => block.value === 'Public member preference')));
    excludes(manager, 'MEMBER_PRIVATE', '2222.22', '2322.22', '31.234567', 'PRIVATE_PROFILE_SENTINEL', '1999-01-01');
    excludes(own, 'OWNER_PRIVATE', 'PRIVATE_PROFILE_SENTINEL', '1999-01-01');
    assert.ok(!manager.members?.some(row => row.blocks.some(block => block.id === 'budget' || block.id === 'origin')));
    assert.ok((await service.listGatherings(member.id)).gatherings.some(row => row.id === friendId));
    assert.ok(!(await service.listGatherings(outsider.id)).gatherings.some(row => row.id === friendId));
    await assert.rejects(() => service.saveGatheringIntake(friendId, member.id, { ...memberSave, intake: { ...memberIntake, public: { ...memberIntake.public, note: 'Different replay intent' } } }), { code: 'IDEMPOTENCY_CONFLICT' });
  });
  await check('concurrent own-answer CAS accepts one writer and retains its exact replay version', async () => {
    const expected = valid(await service.getGathering(friendId, member.id));
    const requests = [0, 1].map(index => ({ expected_revision: expected.gathering.revision, expected_version: expected.own!.version, idempotency_key: key(), intake: { ...memberIntake, public: { ...memberIntake.public, note: `Concurrent public preference ${index}` } } }));
    const outcomes = await Promise.allSettled(requests.map(body => service.saveGatheringIntake(friendId, member.id, body)));
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason?.code === 'VERSION_CONFLICT').length, 1);
    const winner = outcomes.findIndex(item => item.status === 'fulfilled');
    assert.equal(valid(await service.saveGatheringIntake(friendId, member.id, requests[winner])).own!.version, expected.own!.version + 1);
  });
  let providerCalls = 0;
  const fixtureProvider = { async generate(_actor: string, source: unknown) {
    providerCalls++; excludes(source, 'OWNER_PRIVATE', 'MEMBER_PRIVATE', '1111.11', '2222.22', '30.123456', '31.234567', '120.234567', 'Fixture owner', 'Fixture member', owner.id, member.id, 'PRIVATE_PROFILE_SENTINEL');
    return itinerary();
  } };
  friend = valid(await service.getGathering(friendId, owner.id));
  const generationInput = { expected_source: friend.source_fingerprint!, idempotency_key: key() };
  await check('real generation transaction publishes ordered segments within alternative plan cards and replays without another model call', async () => {
    const generated = valid(await generateGatheringItinerary(friendId, owner.id, generationInput, fixtureProvider));
    assert.equal(generated.itinerary?.plans.length, 2); assert.equal(generated.itinerary?.plans[0].segments.length, 2); assert.equal(generated.itinerary?.stale, false);
    assert.equal(generated.generation?.status, 'ready'); assert.equal(providerCalls, 1);
    assert.equal(valid(await generateGatheringItinerary(friendId, owner.id, generationInput, fixtureProvider)).generation?.id, generated.generation?.id);
    assert.equal(providerCalls, 1);
    assert.equal((await service.getGathering(friendId, member.id)).itinerary?.plans[0].segments[1].title, '一起唱歌');
    assert.equal((await service.getGathering(friendId, outsider.id)).itinerary, null);
    await assert.rejects(() => generateGatheringItinerary(friendId, member.id, { ...generationInput, idempotency_key: key() }, fixtureProvider), { code: 'FORBIDDEN' });
    assert.equal(providerCalls, 1);
  });
  await check('pending generation lease blocks another key while same-key retry reads status', async () => {
    const before = valid(await service.getGathering(friendId, owner.id)), started = deferred<void>(), result = deferred<GatheringItinerary>();
    let calls = 0;
    const provider = { async generate() { calls++; started.resolve(); return result.promise; } };
    const request = { expected_source: before.source_fingerprint!, idempotency_key: key() };
    const running = generateGatheringItinerary(friendId, owner.id, request, provider);
    await started.promise;
    const pending = valid(await generateGatheringItinerary(friendId, owner.id, request, provider));
    assert.equal(pending.generation?.status, 'processing'); assert.equal(calls, 1);
    await assert.rejects(() => generateGatheringItinerary(friendId, owner.id, { ...request, idempotency_key: key() }, provider), { code: 'CONCURRENT_MODIFICATION' });
    result.resolve(itinerary('Second synthetic plan')); await running; assert.equal(calls, 1);
  });
  await check('answer mutation during generation rejects late application and preserves the previous itinerary', async () => {
    const before = valid(await service.getGathering(friendId, owner.id));
    const currentId = (await db.gathering.findUniqueOrThrow({ where: { id: friendId } })).currentGenerationId;
    const started = deferred<void>(), result = deferred<GatheringItinerary>();
    const running = generateGatheringItinerary(friendId, owner.id, { expected_source: before.source_fingerprint!, idempotency_key: key() }, { async generate() { started.resolve(); return result.promise; } });
    // Attach the rejection expectation before settling the provider to avoid an unhandled rejection.
    const rejection = assert.rejects(running, { code: 'VERSION_CONFLICT' });
    await started.promise; await save(friendId, member.id, { ...memberIntake, public: { ...memberIntake.public, note: 'New public preference during generation' } });
    result.resolve(itinerary('Stale synthetic plan')); await rejection;
    assert.equal((await db.gathering.findUniqueOrThrow({ where: { id: friendId } })).currentGenerationId, currentId);
    assert.equal((await service.getGathering(friendId, owner.id)).itinerary?.stale, true);
  });
  await check('member joining during generation invalidates a source even before submitting an answer', async () => {
    const before = valid(await service.getGathering(friendId, owner.id));
    const currentId = (await db.gathering.findUniqueOrThrow({ where: { id: friendId } })).currentGenerationId;
    const started = deferred<void>(), result = deferred<GatheringItinerary>();
    const running = generateGatheringItinerary(friendId, owner.id, { expected_source: before.source_fingerprint!, idempotency_key: key() }, { async generate() { started.resolve(); return result.promise; } });
    const rejection = assert.rejects(running, { code: 'VERSION_CONFLICT' });
    await started.promise; await service.joinGathering(friendId, outsider.id); result.resolve(itinerary('Incomplete roster plan')); await rejection;
    assert.equal((await db.gathering.findUniqueOrThrow({ where: { id: friendId } })).currentGenerationId, currentId);
    const incomplete = valid(await service.getGathering(friendId, owner.id));
    await assert.rejects(() => generateGatheringItinerary(friendId, owner.id, { expected_source: incomplete.source_fingerprint!, idempotency_key: key() }, fixtureProvider), { code: 'INVALID_INPUT' });
  });
  await save(friendId, outsider.id, intake('Public third-member preference', 'OUTSIDER_PRIVATE'));
  await check('failed provider preserves previous plans and stores only a safe failure message', async () => {
    const before = valid(await service.getGathering(friendId, owner.id)), request = { expected_source: before.source_fingerprint!, idempotency_key: key() };
    const currentId = (await db.gathering.findUniqueOrThrow({ where: { id: friendId } })).currentGenerationId;
    await assert.rejects(() => generateGatheringItinerary(friendId, owner.id, request, { async generate() { throw Error('PRIVATE_PROVIDER_ERROR_SENTINEL'); } }));
    assert.equal((await db.gathering.findUniqueOrThrow({ where: { id: friendId } })).currentGenerationId, currentId);
    const generation = await db.gatheringGeneration.findUniqueOrThrow({ where: { gatheringId_idempotencyKey: { gatheringId: friendId, idempotencyKey: request.idempotency_key } } });
    assert.equal(generation.status, 'failed'); excludes(generation.error, 'PRIVATE_PROVIDER_ERROR_SENTINEL');
  });
  await check('member list pagination returns distinct names without private intake data', async () => {
    const pageGroup = await service.createGathering(owner.id, { ...friendInput, idempotency_key: key() });
    for (let index = 0; index < 11; index++) {
      const actor = await db.user.create({ data: {} });
      await db.privateProfile.create({data:{userId:actor.id,data:{nickname:'Fixture participant'}}});
      await db.userAvatar.create({data:{userId:actor.id,bytes:Uint8Array.from(avatarBytes),contentType:'image/jpeg',digest:createHash('sha256').update(avatarBytes).digest('hex')}});
      await service.joinGathering(pageGroup.gathering.id, actor.id);
    }
    const first = valid(await service.getGathering(pageGroup.gathering.id, owner.id));
    assert.equal(first.members?.length, 10); assert.ok(first.next_member_cursor);
    const next = await service.getGatheringMembers(pageGroup.gathering.id, owner.id, first.next_member_cursor!);
    const all = [...first.members!, ...next.members]; assert.equal(all.length, 12); assert.equal(new Set(all.map(row => row.person.user_id)).size, 12);
    assert.equal(next.next_cursor, null); excludes(all, 'OWNER_PRIVATE', 'PRIVATE_PROFILE_SENTINEL');
  });
  const teamDetails = publicDetails('team');
  teamDetails.address = 'UNCONFIRMED_ADDRESS_SENTINEL'; teamDetails.description = 'UNCONFIRMED_DESCRIPTION_SENTINEL';
  teamDetails.questions = [
    { id: 'q_activity', title: '想做什么？', type: 'single', required: true, options: [{ id: 'o_food', label: '聚餐' }, { id: 'o_song', label: '唱歌' }] },
    { id: 'q_budget', title: '我的预算', type: 'text', required: false, options: [] },
    { id: 'q_origin', title: '个人出发地点', type: 'text', required: false, options: [] },
    { id: 'q_text', title: '其他建议', type: 'text', required: false, options: [] },
  ];
  let team = valid(await service.createGathering(owner.id, { kind: 'team', idempotency_key: key(), details: teamDetails, intake: emptyGatheringIntake() }));
  const teamId = team.gathering.id;
  await service.joinGathering(teamId, member.id);
  const teamIntake = intake('Team own public draft', 'TEAM_PRIVATE');
  teamIntake.answers = [
    { question_id: 'q_activity', option_ids: ['o_food'], other: '', text: '' },
    { question_id: 'q_budget', option_ids: [], other: '', text: 'QUESTION_PRIVATE_BUDGET_SENTINEL' },
    { question_id: 'q_origin', option_ids: [], other: '', text: 'QUESTION_PRIVATE_ORIGIN_SENTINEL' },
    { question_id: 'q_text', option_ids: [], other: '', text: 'RAW_FREE_TEXT_SENTINEL' },
  ];
  await save(teamId, member.id, teamIntake);
  await check('team statistics stay owner-only and exclude private budget/origin questions and raw prose', async () => {
    team = valid(await service.getGathering(teamId, owner.id));
    assert.equal(team.stats?.respondent_count, 1);
    assert.equal(team.stats?.questions.find(q => q.id === 'q_activity')?.options.find(o => o.id === 'o_food')?.count, 1);
    for (const id of ['q_budget', 'q_origin']) {
      const item: NonNullable<GatheringSnapshot['stats']>['questions'][number] | undefined = team.stats?.questions.find(q => q.id === id); assert.equal(item?.private, true); assert.equal(item?.response_count, 0); assert.deepEqual(item?.options, []);
    }
    assert.equal(team.stats?.questions.find(q => q.id === 'q_text')?.response_count, 1);
    excludes(team, 'TEAM_PRIVATE', 'QUESTION_PRIVATE', 'RAW_FREE_TEXT_SENTINEL');
    for (const actor of [member.id, outsider.id]) {
      const view = valid(await service.getGathering(teamId, actor)); assert.equal(view.stats, null); assert.equal(view.members, null); assert.equal(view.generation, null);
      excludes(view.gathering.details, 'UNCONFIRMED_ADDRESS_SENTINEL', 'UNCONFIRMED_DESCRIPTION_SENTINEL');
      assert.equal(view.gathering.details.place, 'Synthetic common venue');
      if (actor === outsider.id) excludes(view, 'TEAM_PRIVATE', 'QUESTION_PRIVATE', 'RAW_FREE_TEXT_SENTINEL');
    }
    const own = valid(await service.getGathering(teamId, member.id)); assert.equal(own.own!.intake.private.origin?.label, 'TEAM_PRIVATE_ORIGIN');
    assert.ok(JSON.stringify(own.own).includes('QUESTION_PRIVATE_BUDGET_SENTINEL'));
    await assert.rejects(() => service.getGatheringMembers(teamId, owner.id, undefined), { code: 'FORBIDDEN' });
  });
  await check('owner-only detail CAS and questionnaire revision prevent stale first answers', async () => {
    await assert.rejects(() => service.updateGatheringDetails(teamId, member.id, { expected_revision: team.gathering.revision, details: teamDetails }), { code: 'FORBIDDEN' });
    await assert.rejects(() => service.updateGatheringDetails(teamId, owner.id, { expected_revision: team.gathering.revision + 1, details: teamDetails }), { code: 'VERSION_CONFLICT' });
    await assert.rejects(() => service.updateGatheringDetails(teamId, owner.id, { expected_revision: team.gathering.revision, details: { ...teamDetails, questions: [] } }));
    const fresh = valid(await service.createGathering(owner.id, { kind: 'team', idempotency_key: key(), details: teamDetails, intake: emptyGatheringIntake() }));
    await service.joinGathering(fresh.gathering.id, outsider.id);
    const changed = valid(await service.updateGatheringDetails(fresh.gathering.id, owner.id, { expected_revision: fresh.gathering.revision, details: { ...teamDetails, title: 'Changed questionnaire source' } }));
    assert.equal(changed.gathering.revision, fresh.gathering.revision + 1);
    await assert.rejects(() => service.saveGatheringIntake(fresh.gathering.id, outsider.id, { expected_revision: fresh.gathering.revision, expected_version: 0, idempotency_key: key(), intake: teamIntake }), { code: 'VERSION_CONFLICT' });
    assert.equal((await service.getGathering(fresh.gathering.id, outsider.id)).own?.version, 0);
  });
  await check('server deadline rejects a response after cutoff without overwriting the previous answer', async () => {
    const before = valid(await service.getGathering(teamId, member.id));
    await db.gathering.update({ where: { id: teamId }, data: { details: { ...teamDetails, deadline_at: new Date(Date.now() - 10000).toISOString() } } });
    const closed = valid(await service.getGathering(teamId, member.id)); assert.equal(closed.viewer.can_respond, false);
    await assert.rejects(() => service.saveGatheringIntake(teamId, member.id, { expected_revision: closed.gathering.revision, expected_version: before.own!.version, idempotency_key: key(), intake: { ...teamIntake, public: { ...teamIntake.public, note: 'Late input must not replace saved answer' } } }));
    assert.equal((await service.getGathering(teamId, member.id)).own!.version, before.own!.version);
  });
  await check('database CHECK constraints reject impossible kind and answer versions', async () => {
    await assert.rejects(() => db.gathering.create({ data: { ownerUserId: owner.id, kind: 'other', details: {}, creationKey: key(), creationHash: createHash('sha256').update('fixture').digest('hex') } }));
    await assert.rejects(() => db.gatheringMember.update({ where: { gatheringId_userId: { gatheringId: friendId, userId: member.id } }, data: { responseVersion: -1 } }));
    assert.ok((await db.gatheringMember.findUniqueOrThrow({ where: { gatheringId_userId: { gatheringId: friendId, userId: member.id } } })).responseVersion > 0);
  });
  const report = { passed: true, source: 'real_disposable_postgresql_service_fixtures', database: decodeURIComponent(target.pathname.slice(1)),
    checks, fixture_groups: checks.length, migration_applied: true, model_provider: 'explicit_fixture_no_network', wechat_auth: 'not_run', shared_environment_touched: false };
  await writeFile(resolve(output, 'integration-result.json'), JSON.stringify(report, null, 2));
  console.log(`Gathering real PostgreSQL fixture groups passed: ${checks.length}`);
} catch (error) {
  const safe = { passed: false, current_check: current, error_type: error instanceof Error ? error.name : typeof error,
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : null, raw_response_withheld: true };
  await mkdir(output, { recursive: true }); await writeFile(resolve(output, 'integration-result.json'), JSON.stringify(safe, null, 2));
  await writeFile(resolve(output, 'integration-error.private.log'), error instanceof Error ? error.stack || error.message : String(error));
  console.error(JSON.stringify(safe)); process.exitCode = 1;
} finally { await db.$disconnect(); }

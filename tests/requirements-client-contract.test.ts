import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequirementSnapshot } from '../packages/contracts/src/requirements-api';
const state = vi.hoisted(() => ({ token: 'session-a', transport: vi.fn() }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => state.token, transport: state.transport }));
import { listRequirements, requestRequirement, requirementForActivity } from '../apps/miniprogram/src/platform/requirements-api';
import { uncertain } from '../apps/miniprogram/src/platform/write-policy';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activityId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const path = `/api/v1/requirements/${id}`;
function snapshot(): RequirementSnapshot {
  return {
    collection: { id, kind: 'friend', activity_id: activityId, title: '测试需求', status: 'open', deadline_at: '2030-01-09T00:00:00Z', revision: 2, is_manager: false, has_responded: false, updated_at: '2030-01-01T00:00:00Z',
      draft: { title: '测试需求', description: '', starts_at: '2030-01-10T00:00:00Z', deadline_at: '2030-01-09T00:00:00Z', timezone: 'Asia/Shanghai', locations: [{ id: 'park', label: '公园' }], questions: [] },
      closed_at: null, final_selection: null, organizer_nickname: '组织者' },
    viewer: { is_manager: false, can_respond: true, can_edit: false, can_publish: false, can_close: false, can_finalize: false, blocked_reason: null },
    segments: [], own_response: null, manager: null, server_time: '2030-01-01T00:00:00Z',
  };
}
function own() { return { user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', revision: 2, response_version: 1, updated_at: '2030-01-01T00:00:00Z', nickname: '本人', selected_segment_ids: [], answers: [], location_ids: [], location_other: null, time_preferences: '', budget_note: '', preferences: '', private_origin: null }; }
beforeEach(() => { state.token = 'session-a'; state.transport.mockReset(); });
function reply(body: unknown) { state.transport.mockResolvedValueOnce({ status: 200, body }); }
describe('runtime requirement success payload contract (real client, mocked transport)', () => {
  it('filters historical team summaries without relabeling them or hiding valid friend records',async()=>{
    reply({collections:[{...snapshot().collection,kind:'team',id:activityId},snapshot().collection],limit:100,server_time:snapshot().server_time});
    expect((await listRequirements()).collections.map(row=>row.id)).toEqual([id]);
    reply({...snapshot(),collection:{...snapshot().collection,kind:'team'}});await expect(requestRequirement(path)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    reply({collections:[{...snapshot().collection,kind:'unknown'}],limit:100,server_time:snapshot().server_time});await expect(listRequirements()).rejects.toMatchObject({code:'INVALID_RESPONSE'});
  });
  it('accepts a valid older shape without the optional organizer avatar', async () => {
    const value = snapshot(); reply(value); await expect(requestRequirement(path)).resolves.toEqual(value);
  });
  it('accepts current versioned own answers without removing the private origin from the owner', async () => {
    const value = snapshot(); value.own_response = { ...own(), private_origin: { label: '本人私有地点' } };
    value.collection.organizer_avatar = null; reply(value); await expect(requestRequirement(path)).resolves.toEqual(value);
  });
  it('accepts incomplete draft times without inventing publish validation at read time', async () => {
    const value = snapshot(); value.collection.status = 'draft'; value.collection.draft.starts_at = ''; value.collection.draft.deadline_at = ''; value.collection.deadline_at = null;
    reply(value); await expect(requestRequirement(path)).resolves.toEqual(value);
  });
  it.each([['null',null], ['array',[]], ['unrelated object',{ ok: true }], ['absent detail',{ collection: null }], ['missing viewer',{ ...snapshot(), viewer: undefined }], ['boolean string',{ ...snapshot(), viewer: { ...snapshot().viewer, can_edit: 'false' } }], ['wrong segments',{ ...snapshot(), segments: {} }], ['invalid timestamp',{ ...snapshot(), server_time: 'yesterday' }]])('rejects incompatible success %s without raw diagnostics', async (_name,value) => {
    reply(value);
    try { await requestRequirement(path); throw new Error('expected rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'INVALID_RESPONSE' }); expect(uncertain(error)).toBe(true); expect((error as Error).message).toMatch(/未确认|无法验证/); }
  });
  it('strips unknown output fields, including another person’s private origin in a manager projection', async () => {
    const value = snapshot(); const { private_origin: _origin, response_version: _version, ...publicAnswer } = own();
    const incoming = { ...value, private_secret: 'SENTINEL', viewer: { ...value.viewer, is_manager: true, extra: 'SENTINEL' }, manager: { responses: [{ ...publicAnswer, private_origin: { label: 'SENTINEL' } }], respondent_count: 1, questions: [], locations: [], location_other_count: 0 } };
    reply(incoming); const result = await requestRequirement(path);
    expect(result.manager?.responses).toEqual([publicAnswer]); expect(JSON.stringify(result)).not.toContain('SENTINEL');
  });
  it('rejects malformed nested answers without exposing their private contents', async () => {
    reply({ ...snapshot(), own_response: { ...own(), answers: [{ question_id: 'q', option_ids: 'PRIVATE_SENTINEL', other: null }], private_origin: { label: 'PRIVATE_SENTINEL' } } });
    try { await requestRequirement(path); throw new Error('expected rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'INVALID_RESPONSE' }); expect((error as Error).message).not.toContain('PRIVATE_SENTINEL'); }
  });
  it('rejects a saved answer lacking the required CAS version rather than enabling an unsafe legacy write', async () => {
    const { response_version: _, ...legacy } = own(); reply({ ...snapshot(), own_response: legacy });
    await expect(requestRequirement(path)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects another collection’s otherwise valid snapshot', async () => {
    const value = snapshot(); value.collection.id = activityId; reply(value); await expect(requestRequirement(path)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('accepts canonical lower-case response UUIDs for valid uppercase detail and activity routes', async () => {
    reply(snapshot()); await expect(requestRequirement(`/api/v1/requirements/${id.toUpperCase()}`)).resolves.toEqual(snapshot());
    reply(snapshot()); await expect(requirementForActivity(activityId.toUpperCase())).resolves.toEqual(snapshot());
  });
  it.each([{ kind: 'team' }, { kind: 'friend', activity_id: id }])('rejects create results for a different kind or activity: %j', async input => {
    reply(snapshot()); await expect(requestRequirement('/api/v1/requirements', 'POST', { action: 'create', ...input })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('allows a matching create replay to return the later server revision and status, including canonical UUIDs', async () => {
    reply(snapshot()); await expect(requestRequirement('/api/v1/requirements', 'POST', { action: 'create', kind: 'friend', activity_id: activityId.toUpperCase(), draft: { title: 'earlier draft' } })).resolves.toEqual(snapshot());
  });
  it('requires a list shape, accepts its additive fields without retaining them', async () => {
    const expected = { collections: [snapshot().collection], limit: 50, server_time: snapshot().server_time };
    reply({ ...expected, private_extra: 'SENTINEL' }); const result = await listRequirements();
    expect(result.collections[0].id).toBe(id); expect(result.collections[0]).not.toHaveProperty('draft'); expect(result).not.toHaveProperty('private_extra');
    reply({ collections: null }); await expect(listRequirements()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('only accepts absent collection for the activity lookup, and binds a found collection to that activity', async () => {
    reply({ collection: null }); await expect(requirementForActivity(activityId)).resolves.toEqual({ collection: null });
    reply(snapshot()); await expect(requirementForActivity(activityId)).resolves.toEqual(snapshot());
    reply(snapshot()); await expect(requirementForActivity(id)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('does not turn a structured transport rejection into a success-contract error', async () => {
    state.transport.mockResolvedValueOnce({ status: 409, body: { error: { code: 'VERSION_CONFLICT', message: '请刷新核对' }, request_id: 'fixture' } });
    await expect(requestRequirement(path, 'POST', { action: 'respond' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
  });
  it('still rejects late responses when the account changes before validating them', async () => {
    state.transport.mockImplementationOnce(async () => { state.token = 'session-b'; return { status: 200, body: snapshot() }; });
    await expect(requestRequirement(path)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

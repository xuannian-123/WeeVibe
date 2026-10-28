import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transport: vi.fn(), token: 'test-session' }));
vi.mock('../apps/miniprogram/src/platform/api', () => ({ getToken: () => mocks.token, transport: mocks.transport }));
import { extensionRequest } from '../apps/miniprogram/src/platform/extension-api';
import { readCoordination } from '../apps/miniprogram/src/features/requirements/coordination-read';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const activity = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload = () => ({ collection_id: id, activity_id: activity, source_fingerprint: 'a'.repeat(64), server_time: '2030-01-01T10:00:00Z', collection_state: 'open', capabilities: { generate: false, apply: false }, limitations: ['仅计数'], aggregate: { population: 'all_recorded_responses', respondent_count: 0, joined_people_count: 0, joined_seat_count: 0, respondents_with_active_seats: 0, respondents_without_active_seats: 0, joined_people_without_response: 0, segments: [], questions: [], locations: [], free_text: { time_preferences_count: 0, budget_note_count: 0, preferences_count: 0, question_other_count: 0, location_other_count: 0 } } });
afterEach(() => { mocks.transport.mockReset(); mocks.token = 'test-session'; });
describe('read-only coordination through the shared transport', () => {
  it('validates the bound collection and activity using the existing session', async () => {
    mocks.transport.mockResolvedValue({ status: 200, body: payload() }); await expect(readCoordination(id, activity)).resolves.toMatchObject({ capabilities: { generate: false, apply: false } });
    expect(mocks.transport.mock.calls[0][0]).toMatchObject({ method: 'GET', path: `/api/v1/requirements/${id}/coordination`, headers: { Authorization: 'Bearer test-session' } });
  });
  it.each(['POST', 'PUT', 'PATCH'] as const)('rejects %s before transport', async method => {
    await expect(extensionRequest(`/api/v1/requirements/${id}/coordination`, method)).rejects.toMatchObject({ code: 'INVALID_INPUT' }); expect(mocks.transport).not.toHaveBeenCalled();
  });
  it.each(['wrong-activity', 'malformed', 'unexpected-capability'])('rejects %s without presenting a usable result', async mode => {
    const body = payload(); if (mode === 'wrong-activity') body.activity_id = id; if (mode === 'malformed') body.aggregate.respondent_count = 2; if (mode === 'unexpected-capability') (body.capabilities as { generate: boolean }).generate = true;
    mocks.transport.mockResolvedValue({ status: 200, body }); await expect(readCoordination(id, activity)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it('rejects a late transport response after session changes', async () => {
    mocks.transport.mockImplementation(async () => { mocks.token = 'other-session'; return { status: 200, body: payload() }; });
    await expect(readCoordination(id, activity)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

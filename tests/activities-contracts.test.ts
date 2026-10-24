import { describe, expect, it } from 'vitest';
import { createApiClient, type TransportRequest } from '../packages/api-client/src';
import { applyToActivityInputSchema, createActivityInputSchema, decideApplicationInputSchema, type CreateActivityInput } from '../packages/contracts/src';

const segmentId = '00000000-0000-4000-8000-000000000001';
const activityId = '00000000-0000-4000-8000-000000000002';
const applicationId = '00000000-0000-4000-8000-000000000003';
function segment(client_ref = 'a') {
  return { client_ref, type: 'board_game' as const, name: '桌游', starts_at: '2026-11-01T14:00:00+08:00', ends_at: '2026-11-01T16:00:00+08:00', deadline_at: '2026-11-01T12:00:00+08:00', minimum_participants: 4, capacity: 6,
    location: { name: '本人手填地点', address: null, source_url: null }, fee: { kind: 'unknown' as const, amount_cents: null, currency: 'CNY' as const, note: '待核实' }, requirements: '' };
}
function draft(): CreateActivityInput {
  return { idempotency_key: 'create-test-001', name: '测试活动', timezone: 'Asia/Shanghai', main_segment_ref: 'a', segments: [segment()], participating_segment_refs: [] };
}
describe('WG-02/03 stable input contracts', () => {
  it('permits a nonparticipating manager and a non-first main segment with repeated types', () => {
    const input = { ...draft(), main_segment_ref: 'b', segments: [segment('a'), segment('b')] };
    expect(createActivityInputSchema.parse(input).participating_segment_refs).toEqual([]);
  });
  it('does not accept manager identity, role, initial count, or confirmed status from a client', () => {
    for (const injected of [{ current_manager_id: segmentId }, { user_id: segmentId }, { is_manager: true }, { formation_status: 'confirmed' }]) {
      expect(createActivityInputSchema.safeParse({ ...draft(), ...injected }).success).toBe(false);
    }
    expect(createActivityInputSchema.safeParse({ ...draft(), segments: [{ ...segment(), occupied_count: 4 }] }).success).toBe(false);
  });
  it('rejects duplicate or missing main refs and unknown or repeated self selections', () => {
    for (const patch of [ { main_segment_ref: 'missing' }, { segments: [segment(), segment()] }, { participating_segment_refs: ['missing'] }, { participating_segment_refs: ['a', 'a'] } ]) {
      expect(createActivityInputSchema.safeParse({ ...draft(), ...patch }).success).toBe(false);
    }
  });
  it('rejects invalid limits, invalid intervals, and deadlines after the segment begins', () => {
    for (const patch of [{ minimum_participants: 7 }, { capacity: -1 }, { capacity: 1.2 }, { ends_at: segment().starts_at }, { deadline_at: segment().ends_at }]) {
      expect(createActivityInputSchema.safeParse({ ...draft(), segments: [{ ...segment(), ...patch }] }).success).toBe(false);
    }
  });
  it('distinguishes unknown price from known free and rejects fabricated fee shapes', () => {
    expect(createActivityInputSchema.safeParse(draft()).success).toBe(true);
    expect(createActivityInputSchema.safeParse({ ...draft(), segments: [{ ...segment(), fee: { kind: 'per_person', amount_cents: 0, currency: 'CNY', note: '明确免费' } }] }).success).toBe(true);
    for (const fee of [{ kind: 'unknown', amount_cents: 0, currency: 'CNY', note: '' }, { kind: 'total', amount_cents: null, currency: 'CNY', note: '' }, { kind: 'total', amount_cents: -1, currency: 'CNY', note: '' }]) {
      expect(createActivityInputSchema.safeParse({ ...draft(), segments: [{ ...segment(), fee }] }).success).toBe(false);
    }
  });
  it('validates timezone, location URL and line-up order without inventing travel times', () => {
    expect(createActivityInputSchema.safeParse({ ...draft(), timezone: 'not/a-zone' }).success).toBe(false);
    expect(createActivityInputSchema.safeParse({ ...draft(), segments: [{ ...segment(), location: { ...segment().location, source_url: 'javascript:alert(1)' } }] }).success).toBe(false);
    expect(createActivityInputSchema.safeParse({ ...draft(), segments: [segment('a'), { ...segment('b'), starts_at: '2026-11-01T13:00:00+08:00' }] }).success).toBe(false);
  });
  it('requires explicit segment versions, rejects duplicate targets and spoofed actors', () => {
    const input = { idempotency_key: 'apply-test-001', expected_revision: 1, segments: [{ segment_id: segmentId, plan_revision: 1 }] };
    expect(applyToActivityInputSchema.safeParse(input).success).toBe(true);
    for (const patch of [{ user_id: segmentId }, { segments: [] }, { segments: [...input.segments, ...input.segments] }, { segments: [{ segment_id: segmentId }] }, { segments: [{ segment_id: '../other', plan_revision: 1 }] }]) {
      expect(applyToActivityInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
    }
  });
  it('requires an idempotency key and rejects decision payloads trying to select fewer targets', () => {
    const input = { idempotency_key: 'decide-test-001', expected_revision: 1, decision: 'approve' };
    expect(decideApplicationInputSchema.safeParse(input).success).toBe(true);
    expect(decideApplicationInputSchema.safeParse({ ...input, segments: [segmentId] }).success).toBe(false);
    expect(decideApplicationInputSchema.safeParse({ ...input, idempotency_key: 'x' }).success).toBe(false);
  });
});

describe('four formal client methods, injected transport only', () => {
  it('uses stable paths, caller session and validated payloads; exposes business error codes', async () => {
    const seen: TransportRequest[] = [];
    const api = createApiClient(async request => { seen.push(request); return { status: 409, body: { error: { code: 'CAPACITY_FULL', message: '所选环节已满' }, request_id: 'test-only' } }; }, () => 'test-session');
    const apply = { idempotency_key: 'apply-test-001', expected_revision: 1, segments: [{ segment_id: segmentId, plan_revision: 1 }] };
    await expect(api.createActivity(draft())).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    await expect(api.getActivity(activityId)).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    await expect(api.applyToActivity(activityId, apply)).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    await expect(api.decideApplication(activityId, applicationId, { idempotency_key: 'decide-test-001', expected_revision: 2, decision: 'approve' })).rejects.toMatchObject({ code: 'CAPACITY_FULL' });
    expect(seen.map(r => r.path)).toEqual(['/api/v1/activities', `/api/v1/activities/${activityId}`, `/api/v1/activities/${activityId}/applications`, `/api/v1/activities/${activityId}/applications/${applicationId}/decision`]);
    expect(seen.every(r => r.headers.Authorization === 'Bearer test-session')).toBe(true);
    await expect(api.getActivity('../../elsewhere')).rejects.toThrow();
    expect(seen).toHaveLength(4);
  });
});

import { describe, expect, it } from 'vitest';
import { createApiClient, type TransportRequest } from '../packages/api-client/src';
import { activityDraftSchema } from '../packages/contracts/src';

describe('shared transport', () => {
  it('injects bearer only for authenticated operations and preserves structured errors', async () => {
    const seen: TransportRequest[] = [];
    const client = createApiClient(async request => {
      seen.push(request);
      return { status: 503, body: { error: { code: 'NOT_CONFIGURED', message: 'not configured' }, request_id: 'test' } };
    }, () => 'test-session');
    await expect(client.health()).rejects.toMatchObject({ code: 'NOT_CONFIGURED', status: 503 });
    await expect(client.me()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(seen[0].headers.Authorization).toBeUndefined();
    expect(seen[1].headers.Authorization).toBe('Bearer test-session');
  });
  it('rejects malformed successful bodies rather than showing fake health', async () => {
    const client = createApiClient(async () => ({ status: 200, body: { success: true } }));
    await expect(client.health()).rejects.toThrow();
  });
});
describe('future activity draft semantics', () => {
  it('supports non-first main segment and rejects missing/duplicate references or bad limits', () => {
    const segment = { client_ref: 'a', name: '桌游', type: 'board_game', minimum_participants: 4, capacity: 6, starts_at: '2026-10-30T14:00:00+08:00', ends_at: '2026-10-30T16:00:00+08:00', deadline_at: '2026-10-30T12:00:00+08:00' };
    const draft = { name: 'test', main_segment_ref: 'b', segments: [segment, { ...segment, client_ref: 'b' }] };
    expect(activityDraftSchema.safeParse(draft).success).toBe(true);
    expect(activityDraftSchema.safeParse({ ...draft, main_segment_ref: 'missing' }).success).toBe(false);
    expect(activityDraftSchema.safeParse({ ...draft, segments: [segment, segment] }).success).toBe(false);
    expect(activityDraftSchema.safeParse({ ...draft, segments: [{ ...segment, capacity: 3 }] }).success).toBe(false);
  });
});

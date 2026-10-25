import { describe, expect, it, vi } from 'vitest';
import { createAiCreationProvider, createAiLimiter, reviewGeneratedDraft } from '../apps/web/src/server/ai/creation';
import { createAiCreationHandler } from '../apps/web/src/server/ai/creation-handler';
import { ServiceError } from '../apps/web/src/server/http';
import { createApiClient, type Transport } from '../packages/api-client/src';
import { aiCreateRequestSchema, aiCreateResponseSchema, type AiCreationDraft } from '../packages/contracts/src';
import { CLOUD_HTTP_ENVELOPE_HEADER, CLOUD_HTTP_ENVELOPE_VERSION } from '../packages/contracts/src/cloud-http';

const input = { text: '下午两点打球，至少4人、最多6人，在朋友球馆', selected_date: '2026-10-30', source_revision: 2 };
const key = 'fixture-model-key';
const config = () => ({ url: 'https://api.deepseek.com/chat/completions', key, model: 'deepseek-flash' });
function draft(): AiCreationDraft { return {
  source_revision: 2, apply_intent: false, publishable: false, name: '朋友打球', primary_segment_ref: 's1',
  segments: [{ ref: 's1', type: 'sport', name: '打球', starts_at: '2026-10-30T14:00:00+08:00', ends_at: null, deadline_at: null,
    location: { id: 'invented-poi-id', label: '朋友球馆' }, minimum: 4, capacity: 6, fee_minor: 0 }], missing_fields: [], unknowns: [],
}; }
const response = (value: unknown = draft(), finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }] }));

describe('AI creation suggestions (offline, no live model claim)', () => {
  it('validates actual calendar dates and rejects client-supplied provider/identity claims', () => {
    expect(aiCreateRequestSchema.safeParse({ ...input, selected_date: '2026-02-30' }).success).toBe(false);
    expect(aiCreateRequestSchema.safeParse({ ...input, url: 'https://evil.test' }).success).toBe(false);
    expect(aiCreateRequestSchema.safeParse({ ...input, user_id: 'other' }).success).toBe(false);
  });
  it('keeps suggestions unpublished, removes model POI identities and unsupported fees, recomputes missing fields', () => {
    const result = reviewGeneratedDraft(draft(), input);
    expect(aiCreateResponseSchema.safeParse(result).success).toBe(true);
    expect(result.draft).toMatchObject({ apply_intent: false, publishable: false, source_revision: 2 });
    expect(result.draft.segments[0]).toMatchObject({ fee_minor: null, minimum: 4, capacity: 6, location: { id: 'user-place-s1' } });
    expect(result.draft.missing_fields).toContain('segments.s1.ends_at');
    expect(result.draft.missing_fields).toContain('segments.s1.fee_minor');
  });
  it('leaves ungrounded places and headcounts missing instead of adopting model inventions', () => {
    const raw = draft(); raw.segments[0].location!.label = '模型杜撰球馆';
    const result = reviewGeneratedDraft(raw, { ...input, text: '10月30日打球，预算46元' });
    expect(result.draft.segments[0]).toMatchObject({ location: null, minimum: null, capacity: null, fee_minor: null });
  });
  it('derives advisory metadata itself when a live-style model returns free-text unknowns', () => {
    const raw = { ...draft(), name: null, missing_fields: 'model prose', unknowns: ['地点未决定', '模型猜测已预订'] };
    const result = reviewGeneratedDraft(raw, input);
    expect(result.draft.name).toBe('打球');
    expect(result.draft.missing_fields).toContain('segments.s1.ends_at');
    expect(result.draft.unknowns[0].code).toBe('missing_information');
    expect(JSON.stringify(result)).not.toContain('模型猜测已预订');
    expect(aiCreateResponseSchema.safeParse(result).success).toBe(true);
  });
  it('rejects stale, duplicate, contradictory, overlapping and publish-intent drafts', () => {
    const cases: unknown[] = [{ ...draft(), source_revision: 1 }, { ...draft(), apply_intent: true },
      { ...draft(), segments: [...draft().segments, ...draft().segments] },
      { ...draft(), primary_segment_ref: 'absent' },
      { ...draft(), segments: [{ ...draft().segments[0], minimum: 8, capacity: 4 }] },
      { ...draft(), segments: [{ ...draft().segments[0], ends_at: '2026-10-30T13:00:00+08:00' }] },
      { ...draft(), segments: [{ ...draft().segments[0], ends_at: '2026-10-30T16:00:00+08:00' }, { ...draft().segments[0], ref: 's2', starts_at: '2026-10-30T15:00:00+08:00' }] },
    ];
    for (const value of cases) expect(() => reviewGeneratedDraft(value, input)).toThrow(ServiceError);
  });
  it('authenticates before parsing body or touching a model, preserving cloud HTTP error envelopes', async () => {
    const generate = vi.fn();
    const handler = createAiCreationHandler({ authenticate: async () => { throw new ServiceError('UNAUTHENTICATED', 401, '请登录'); } }, { generate });
    const result = await handler(new Request('https://api.test/api/v1/ai/creation-draft', { method: 'POST', body: 'invalid-json', headers: { [CLOUD_HTTP_ENVELOPE_HEADER]: CLOUD_HTTP_ENVELOPE_VERSION } }));
    expect(await result.json()).toMatchObject({ status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
    expect(generate).not.toHaveBeenCalled();
  });
  it('uses one configured server URL and never returns provider credentials', async () => {
    const fetcher = vi.fn(async () => response());
    const provider = createAiCreationProvider({ fetch: fetcher, config });
    const result = await provider.generate('user-one', input);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe(config().url);
    expect(init.redirect).toBe('error');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'deepseek-flash', stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it('fails closed for missing config, provider failure, leaked key, truncation or oversize response', async () => {
    const fetcher = vi.fn();
    await expect(createAiCreationProvider({ fetch: fetcher, config: () => ({}) }).generate('u', input)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetcher).not.toHaveBeenCalled();
    for (const make of [() => new Response(key, { status: 500 }), () => response({ ...draft(), name: key }), () => response(draft(), 'length'), () => new Response('x'.repeat(65_537))]) {
      await expect(createAiCreationProvider({ fetch: async () => make(), config }).generate('u', input)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    }
  });
  it('bounds elapsed time and per-user request rate without retrying model calls', async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    await expect(createAiCreationProvider({ fetch: fetcher, config, timeoutMs: 5 }).generate('u', input)).rejects.toThrow('超时');
    expect(fetcher).toHaveBeenCalledTimes(1);
    let now = 0; const consume = createAiLimiter(() => now);
    for (let i = 0; i < 3; i++) consume('u');
    expect(() => consume('u')).toThrow('请求较多');
    expect(() => consume('another')).not.toThrow();
    now = 60_000; expect(() => consume('u')).not.toThrow();
  });
  it('shares authenticated transport and extends only the model request timeout', async () => {
    const transport = vi.fn<Transport>(async () => ({ status: 200, body: reviewGeneratedDraft(draft(), input) }));
    const api = createApiClient(transport, () => 'fixture-session');
    await api.generateActivityDraft(input);
    expect(transport.mock.calls[0]?.[0]).toMatchObject({ path: '/api/v1/ai/creation-draft', timeoutMs: 35000, headers: { Authorization: 'Bearer fixture-session' } });
  });
});

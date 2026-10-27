import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ authenticate: vi.fn(), prepare: vi.fn(), generate: vi.fn() }));
vi.mock('../apps/web/src/server/auth', () => ({ identityService: { authenticate: h.authenticate } }));
vi.mock('../apps/web/src/server/ai/coordination', () => ({ coordinationBoundary: { prepare: h.prepare, generate: h.generate } }));
import { GET, POST } from '../apps/web/src/app/api/v1/requirements/[collectionId]/coordination/route';
import { ServiceError } from '../apps/web/src/server/http';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const context = { params: Promise.resolve({ collectionId: id.toUpperCase() }) }, input = { expected_source_fingerprint: 'a'.repeat(64) };
const request = (body?: unknown, envelope = false) => new Request(`http://localhost/api/v1/requirements/${id}/coordination`, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: 'Bearer fixture-only-token', ...(envelope ? { 'X-Weego-Response-Envelope': '1' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
beforeEach(() => { h.authenticate.mockReset().mockResolvedValue({ user_id: actor }); h.prepare.mockReset().mockResolvedValue({ capabilities: { generate: false, apply: false } }); h.generate.mockReset().mockRejectedValue(new ServiceError('NOT_CONFIGURED', 503, '多人协调适配未接通')); });
describe('C1 actual route dispatch through authenticated identity/service doubles', () => {
  it('canonicalizes the collection target and forwards only the authenticated actor', async () => { expect((await GET(request(), context)).status).toBe(200); expect(h.prepare).toHaveBeenCalledExactlyOnceWith(id, actor); expect(h.authenticate).toHaveBeenCalledExactlyOnceWith('Bearer fixture-only-token'); });
  it('POST forwards the original source request, not any client role override', async () => { expect((await POST(request(input), context)).status).toBe(503); expect(h.generate).toHaveBeenCalledExactlyOnceWith(id, actor, input); });
  it('preserves unconfigured 503 in native cloud envelope, never a generated-success body', async () => { const response = await POST(request(input, true), context); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ transport: 'weego.http.v1', status: 503, body: { error: { code: 'NOT_CONFIGURED' } } }); });
  it('rejects invalid target and oversized request before generation dispatch', async () => { expect((await GET(request(), { params: Promise.resolve({ collectionId: 'not-a-uuid' }) })).status).toBe(400); expect((await POST(request({ blob: 'x'.repeat(4096) }), context)).status).toBe(400); expect(h.prepare).not.toHaveBeenCalled(); expect(h.generate).not.toHaveBeenCalled(); });
  it('does not echo internal source/provider exceptions', async () => { h.prepare.mockRejectedValueOnce(new Error('PRIVATE_SENTINEL')); const response = await GET(request(), context); expect(response.status).toBe(500); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_SENTINEL'); });
});

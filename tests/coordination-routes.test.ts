import { describe, expect, it } from 'vitest';
import { GET, POST } from '../apps/web/src/app/api/v1/requirements/[collectionId]/coordination/route';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const context = { params: Promise.resolve({ collectionId: id }) };
const url = `http://localhost/api/v1/requirements/${id}/coordination`;
describe('C1 actual route authentication before any source/DB/provider access', () => {
  it.each(['GET', 'POST'])('denies unauthenticated %s including forged identity headers', async method => { const request = new Request(url, { method, headers: { 'x-wx-openid': 'forged' }, ...(method === 'POST' ? { body: JSON.stringify({ actor_id: 'PRIVATE_SENTINEL' }) } : {}) }); const response = await (method === 'GET' ? GET : POST)(request, context); expect(response.status).toBe(401); expect(response.headers.get('cache-control')).toBe('no-store'); expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_SENTINEL'); });
  it.each(['GET', 'POST'])('preserves business 401 in native cloud %s envelope', async method => { const request = new Request(url, { method, headers: { 'X-Weego-Response-Envelope': '1' }, ...(method === 'POST' ? { body: '{}' } : {}) }); const response = await (method === 'GET' ? GET : POST)(request, context); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ transport: 'weego.http.v1', status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }); });
});

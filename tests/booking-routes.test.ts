import { describe, expect, it } from 'vitest';
import { POST, GET } from '../apps/web/src/app/api/v1/activities/[activityId]/segments/[segmentId]/booking/route';
const context = { params: Promise.resolve({ activityId: '00000000-0000-4000-8000-000000000001', segmentId: '00000000-0000-4000-8000-000000000002' }) };
describe.each([['POST', POST], ['GET', GET]] as const)('booking actual %s auth/HTTP boundary without database', (_method, call) => {
  it('rejects anonymous forged platform identity before body access, with no-store', async () => { const r = await call(new Request('http://localhost/api', { method: 'POST', headers: { 'x-wx-openid': 'forged' }, body: JSON.stringify({ actor_id: 'forged' }) }), context); expect(r.status).toBe(401); expect(r.headers.get('cache-control')).toBe('no-store'); });
  it('preserves native cloud HTTP401 error envelope', async () => { const r = await call(new Request('http://localhost/api', { method: 'POST', headers: { 'X-Weego-Response-Envelope': '1' }, body: '{}' }), context); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ transport: 'weego.http.v1', status: 401, body: { error: { code: 'UNAUTHENTICATED' } } }); });
});

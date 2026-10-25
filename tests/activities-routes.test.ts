import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST as create } from '../apps/web/src/app/api/v1/activities/route';
import { GET as detail } from '../apps/web/src/app/api/v1/activities/[activityId]/route';
import { POST as apply } from '../apps/web/src/app/api/v1/activities/[activityId]/applications/route';
import { POST as decide } from '../apps/web/src/app/api/v1/activities/[activityId]/applications/[applicationId]/decision/route';

const id = '00000000-0000-4000-8000-000000000001';
const applicationId = '00000000-0000-4000-8000-000000000002';
afterEach(() => vi.unstubAllEnvs());
describe('actual route functions, no HTTP server, real login or database', () => {
  it('keeps authorization checks when cloud HTTP requests opt into response envelopes', async () => {
    const response = await create(new Request('http://localhost/api/v1/activities', { method: 'POST', headers: { 'X-Weego-Response-Envelope': '1', 'x-wx-openid': 'forged', 'Content-Type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transport: 'weego.http.v1', status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
  });
  it('does not let forged platform headers or manager JSON create an activity', async () => {
    const response = await create(new Request('http://localhost/api/v1/activities', { method: 'POST', headers: { 'x-wx-openid': 'forged', 'Content-Type': 'application/json' }, body: JSON.stringify({ current_manager_id: id }) }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it('does not let an anonymous requester apply or approve by knowing IDs', async () => {
    const req = () => new Request('http://localhost/api/v1/activities', { method: 'POST', body: '{}' });
    expect((await apply(req(), { params: Promise.resolve({ activityId: id }) })).status).toBe(401);
    expect((await decide(req(), { params: Promise.resolve({ activityId: id, applicationId }) })).status).toBe(401);
  });
  it('rejects an invalid detail locator before touching persistence', async () => {
    const response = await detail(new Request('http://localhost/api/v1/activities/invalid'), { params: Promise.resolve({ activityId: '../other' }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_INPUT');
  });
  it('reports missing persistence honestly instead of fabricating a public activity', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const response = await detail(new Request(`http://localhost/api/v1/activities/${id}`, { headers: { 'x-wx-openid': 'forged' } }), { params: Promise.resolve({ activityId: id }) });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.code).toBe('NOT_CONFIGURED');
    expect(body).not.toHaveProperty('applications');
    expect(body.error.message).not.toContain('postgresql://');
  });
});

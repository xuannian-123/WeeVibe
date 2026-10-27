import { describe, expect, it } from 'vitest';
import { GET, PATCH, POST } from '../apps/web/src/app/api/v1/account/route';
describe('account HTTP authorization boundary (no live database)', () => {
  it('does not return private account data without a verified session', async () => {
    const response = await GET(new Request('http://localhost/api/v1/account', { headers: { 'x-wx-openid': 'forged' } }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
  it.each([['PATCH', PATCH], ['POST', POST]] as const)('rejects forged identity for %s before reading or saving user data', async (method, handler) => {
    const response = await handler(new Request('http://localhost/api/v1/account', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 'someone-else', action: 'profile', profile: { nickname: 'forged' } }) }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
  });
  it('preserves auth failure inside signed cloud HTTP response envelope', async () => {
    const response = await POST(new Request('http://localhost/api/v1/account', { method: 'POST', headers: { 'X-Weego-Response-Envelope': '1' }, body: '{}' }));
    expect(await response.json()).toMatchObject({ transport: 'weego.http.v1', status: 401, body: { error: { code: 'UNAUTHENTICATED' } } });
  });
});

// Real local HTTP checks for auth boundaries only; no fake login or provider calls.
import assert from 'node:assert/strict';

const base = process.env.WEEVIBE_CHECK_API_BASE_URL ?? 'http://127.0.0.1:43188';
const url = new URL(base);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
  throw new Error('This check only targets a local server.');
}
const id = '00000000-0000-4000-8000-000000000001';
const paths = [
  '/api/v1/activities',
  `/api/v1/activities/${id}/applications`,
  `/api/v1/activities/${id}/applications/${id}/decision`,
  '/api/v1/venues/search',
  '/api/v1/venues/nearby',
  '/api/v1/venues/walk',
  '/api/v1/ai/creation-draft',
];
for (const path of paths) {
  const response = await fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wx-openid': 'forged-local-check', 'x-wx-appid': 'forged-local-check' },
    body: JSON.stringify({ user_id: id, openid: 'forged-local-check' }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 401, `${path}: anonymous/forged platform headers must be rejected`);
  assert.equal((await response.json()).error?.code, 'UNAUTHENTICATED', `${path}: stable auth error`);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/, `${path}: private response cache policy`);
  console.log(`PASS POST ${path}: 401, UNAUTHENTICATED, no-store`);
}
console.log(`${paths.length} local HTTP boundaries passed; authenticated database/provider success remains unverified.`);

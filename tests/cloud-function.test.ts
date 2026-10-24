import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createLoginHandler } from '../cloudfunctions/weegoLogin/index.js';
import { readVerifierConfig, verifySignedProof } from '../cloudfunctions/weegoLogin/proof.cjs';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const fixture = {
  WEEGO_CLOUD_AUTH_ENABLED: 'true', WECHAT_APP_ID: 'wx1111111111111111', WEEGO_CLOUD_AUTH_ENV_ID: 'fixture-env',
  WEEGO_CLOUD_AUTH_KEY_ID: 'fixture-key', WEEGO_API_BASE_URL: 'https://api.example.invalid',
  WEEGO_CLOUD_AUTH_PRIVATE_KEY_B64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
};
const current = (openId = 'fixture-open-a', source = 'wx_client') => ({ namespace: 'fixture-env', environment: JSON.stringify({
  TCB_SOURCE: source, WX_APPID: fixture.WECHAT_APP_ID, WX_OPENID: openId
}) });
const session = () => ({ token: randomBytes(32).toString('base64url'), expires_at: new Date(Date.now() + 86400000).toISOString(), user: { user_id: randomUUID() } });
afterEach(() => vi.unstubAllEnvs());

describe('cloud login function with real SDK parser, injected network and fixture identity only', () => {
  it('signs only current platform identity and sends it server-to-server to the fixed endpoint', async () => {
    const issued = session();
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const verified = verifySignedProof(String(init?.body), (init?.headers as Record<string, string>)['x-weego-cloud-signature'], readVerifierConfig(fixture));
      expect(verified.identity).toEqual({ appId: fixture.WECHAT_APP_ID, openId: 'fixture-open-a' });
      return Response.json(issued);
    });
    const handler = createLoginHandler({ env: fixture, request });
    expect(await handler({ openid: 'forged', url: 'https://attacker.invalid', context: current('forged') }, current())).toEqual(issued);
    expect(request).toHaveBeenCalledWith('https://api.example.invalid/api/v1/auth/cloud-wechat', expect.objectContaining({ method: 'POST', redirect: 'error' }));
    const output = JSON.stringify(await handler({}, current()));
    expect(output).not.toContain('fixture-open'); expect(output).not.toContain('signature'); expect(output).not.toContain('proof');
  });
  it('never inherits a previous caller from process env or a successful hot invocation', async () => {
    vi.stubEnv('WX_APPID', fixture.WECHAT_APP_ID); vi.stubEnv('WX_OPENID', 'fixture-open-a');
    vi.stubEnv('TCB_SOURCE', 'wx_client'); vi.stubEnv('WX_CONTEXT_KEYS', 'WX_APPID,WX_OPENID');
    const request = vi.fn<typeof fetch>(async () => Response.json(session()));
    const handler = createLoginHandler({ env: fixture, request });
    await handler({}, current());
    for (const context of [undefined, null, {}, { namespace: 'fixture-env', environment: '{}' },
      { namespace: 'fixture-env', environment: JSON.stringify({ WX_APPID: fixture.WECHAT_APP_ID, TCB_SOURCE: 'wx_client' }) }, current('fixture-b', 'http')]) {
      expect(await handler({ openid: 'forged', context: current() }, context)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('supports the actual SDK legacy environ parser without identity fallback', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json(session()));
    const handler = createLoginHandler({ env: fixture, request });
    const legacy = { namespace: 'fixture-env', environ: `WX_APPID=${fixture.WECHAT_APP_ID};WX_OPENID=fixture-old;TCB_SOURCE=wx_client;` };
    expect(await handler({}, legacy)).toHaveProperty('token');
    expect(await handler({}, { ...legacy, environ: 'TCB_SOURCE=wx_client;' })).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(await handler({}, { ...legacy, environ: `${legacy.environ}WX_OPENID=a,b;` })).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects other apps, environments, web and SDK calls, and devtools unless explicitly enabled', async () => {
    const request = vi.fn<typeof fetch>();
    const handler = createLoginHandler({ env: fixture, request });
    const wrongApp = { namespace: 'fixture-env', environment: JSON.stringify({ TCB_SOURCE: 'wx_client', WX_APPID: 'wx2222222222222222', WX_OPENID: 'fixture-open-a' }) };
    for (const context of [wrongApp, { ...current(), namespace: 'wrong-env' }, current('fixture-open-a', 'wx_devtools'), current('fixture-open-a', 'wx_http'), current('fixture-open-a', 'server')]) {
      expect(await handler({}, context)).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
    }
    expect(request).not.toHaveBeenCalled();
    const enabledRequest = vi.fn<typeof fetch>(async () => Response.json(session()));
    expect(await createLoginHandler({ env: { ...fixture, WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS: 'true' }, request: enabledRequest })({}, current('fixture-open-a', 'wx_devtools'))).toHaveProperty('token');
  });
  it('fails closed without explicit config and never follows a client URL or permits a local/HTTP upstream', async () => {
    const request = vi.fn<typeof fetch>();
    for (const env of [{}, { ...fixture, WEEGO_CLOUD_AUTH_ENABLED: 'false' }, ...['http://api.example.invalid', 'https://127.0.0.1', 'https://api.example.invalid/other', 'https://user:password@api.example.invalid', 'https://api.example.invalid?x=1'].map(WEEGO_API_BASE_URL => ({ ...fixture, WEEGO_API_BASE_URL }))]) {
      expect(await createLoginHandler({ env, request })({}, current())).toMatchObject({ error: { code: 'NOT_CONFIGURED' } });
    }
    expect(request).not.toHaveBeenCalled();
  });
  it('redacts network/provider exceptions, rejects oversized and identity-bearing upstream responses', async () => {
    const rawSecret = 'SENSITIVE_FIXTURE_ONLY';
    for (const request of [vi.fn<typeof fetch>(async () => { throw new Error(rawSecret); }),
      vi.fn<typeof fetch>(async () => Response.json({ ...session(), openid: rawSecret })),
      vi.fn<typeof fetch>(async () => Response.json({ error: { message: rawSecret } }, { status: 500 })),
      vi.fn<typeof fetch>(async () => new Response('x'.repeat(4097)))]) {
      const result = await createLoginHandler({ env: fixture, request })({}, current());
      expect(result).toMatchObject({ error: { code: 'UPSTREAM_UNAVAILABLE' } });
      expect(JSON.stringify(result)).not.toContain(rawSecret);
    }
  });
});

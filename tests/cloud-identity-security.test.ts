import { createRequire } from 'node:module';
import { generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const protocol = createRequire(import.meta.url)('../cloudfunctions/weevibeLogin/proof.cjs') as typeof import('../cloudfunctions/weevibeLogin/proof.cjs');
const { createLoginHandler } = createRequire(import.meta.url)('../cloudfunctions/weevibeLogin/index.js') as {
  createLoginHandler(options?: { env?: NodeJS.ProcessEnv; request?: typeof fetch; now?: () => number }): (event: unknown, context: unknown) => Promise<unknown>;
};
const pair = generateKeyPairSync('ed25519');
const publicB64 = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const privateB64 = pair.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const settings: NodeJS.ProcessEnv = {
  WEEGO_CLOUD_AUTH_ENABLED: 'true', WECHAT_APP_ID: 'wx0000000000000000',
  WEEGO_CLOUD_AUTH_ENV_ID: 'synthetic-env', WEEGO_CLOUD_AUTH_KEY_ID: 'synthetic-key',
  WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64: publicB64, WEEGO_CLOUD_AUTH_PRIVATE_KEY_B64: privateB64,
};
const signer = protocol.readSignerConfig(settings);
const verifier = protocol.readVerifierConfig(settings);
const now = Date.parse('2026-10-24T12:00:00Z');
const identity = { appId: settings.WECHAT_APP_ID!, openId: 'synthetic-caller', source: 'wx_client' as const };
const prefix = 'WEEGO-CLOUD-LOGIN-V1\nPOST\n/api/v1/auth/cloud-wechat\n';
const signed = () => protocol.createSignedProof(identity, signer, now);
const claims = () => JSON.parse(signed().body) as Record<string, unknown>;
const signBody = (body: string, domain = prefix) => sign(null, Buffer.from(domain + body), pair.privateKey).toString('base64url');
const checkClaims = (value: unknown) => {
  const body = JSON.stringify(value);
  return protocol.verifySignedProof(body, signBody(body), verifier, now);
};
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function nonCanonicalAlias(value: string) {
  const last = alphabet.indexOf(value.at(-1)!);
  return value.slice(0, -1) + alphabet[last + 1];
}
afterEach(() => vi.unstubAllEnvs());

describe('cloud login proof independent security boundaries (generated fixture keys)', () => {
  it('authenticates exact raw bytes, not a reserialized or whitespace-normalized body', () => {
    const proof = signed();
    expect(protocol.verifySignedProof(proof.body, proof.signature, verifier, now).identity).toEqual({ appId: identity.appId, openId: identity.openId });
    expect(() => protocol.verifySignedProof(proof.body + ' ', proof.signature, verifier, now)).toThrow(protocol.CloudProofError);
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(proof.body)).reverse()));
    expect(() => protocol.verifySignedProof(reordered, proof.signature, verifier, now)).toThrow(protocol.CloudProofError);
  });
  it.each([
    'WEEGO-CLOUD-LOGIN-V1\nGET\n/api/v1/auth/cloud-wechat\n',
    'WEEGO-CLOUD-LOGIN-V1\nPOST\n/api/v1/auth/wechat\n',
    'OTHER-PROTOCOL\nPOST\n/api/v1/auth/cloud-wechat\n',
    '',
  ])('rejects signatures for another method/path/protocol: %j', domain => {
    const body = signed().body;
    expect(() => protocol.verifySignedProof(body, signBody(body, domain), verifier, now)).toThrow(protocol.CloudProofError);
  });
  it.each([
    ['version', 2], ['issuer', 'another-service'], ['audience', 'another-api'],
    ['app_id', 'wx1111111111111111'], ['env_id', 'another-env'], ['key_id', 'another-key'],
    ['source', 'http'], ['open_id', ''], ['open_id', ['synthetic-caller']],
  ])('rejects independently signed invalid claim %s=%j', (field, value) => {
    expect(() => checkClaims({ ...claims(), [field]: value })).toThrow(protocol.CloudProofError);
  });
  it('does not accept client-selected algorithms, key locations, or business roles', () => {
    for (const extra of [{ alg: 'none' }, { jku: 'https://invalid.example/key' }, { role: 'manager' }]) {
      expect(() => checkClaims({ ...claims(), ...extra })).toThrow(protocol.CloudProofError);
    }
    const incomplete = claims(); delete incomplete.app_id;
    for (const candidate of [incomplete, null, [], { identity }]) expect(() => checkClaims(candidate)).toThrow(protocol.CloudProofError);
  });
  it('requires real Ed25519 verifier configuration rather than accepting another key type', () => {
    const other = generateKeyPairSync('x25519');
    const encoded = other.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    expect(() => protocol.readVerifierConfig({ ...settings, WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64: encoded })).toThrow(protocol.CloudProofError);
    expect(() => protocol.readVerifierConfig({ ...settings, WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64: undefined })).toThrow(protocol.CloudProofError);
    const proof = signed();
    const wrong = generateKeyPairSync('ed25519');
    expect(() => protocol.verifySignedProof(proof.body, sign(null, Buffer.from(prefix + proof.body), wrong.privateKey).toString('base64url'), verifier, now)).toThrow(protocol.CloudProofError);
  });
  it.each([undefined, 'false', 'TRUE', '1'])('fails closed when the enable flag is %s', enabled => {
    const env = { ...settings, WEEGO_CLOUD_AUTH_ENABLED: enabled };
    expect(() => protocol.readSignerConfig(env)).toThrow(protocol.CloudProofError);
    expect(() => protocol.readVerifierConfig(env)).toThrow(protocol.CloudProofError);
  });
  it('disallows development-tool identity unless explicitly enabled in verifier configuration', () => {
    const toolsSigner = protocol.readSignerConfig({ ...settings, WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS: 'true' });
    const proof = protocol.createSignedProof({ ...identity, source: 'wx_devtools' }, toolsSigner, now);
    expect(() => protocol.verifySignedProof(proof.body, proof.signature, verifier, now)).toThrow(protocol.CloudProofError);
    const toolsVerifier = protocol.readVerifierConfig({ ...settings, WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS: 'true' });
    expect(protocol.verifySignedProof(proof.body, proof.signature, toolsVerifier, now).identity.openId).toBe(identity.openId);
  });
  it('rejects equivalent-byte noncanonical signature and nonce encodings', () => {
    const proof = signed();
    const alias = nonCanonicalAlias(proof.signature);
    expect(Buffer.from(alias, 'base64url')).toEqual(Buffer.from(proof.signature, 'base64url'));
    expect(() => protocol.verifySignedProof(proof.body, alias, verifier, now)).toThrow(protocol.CloudProofError);
    const value = claims();
    const nonceAlias = nonCanonicalAlias(value.nonce as string);
    expect(Buffer.from(nonceAlias, 'base64url')).toEqual(Buffer.from(value.nonce as string, 'base64url'));
    expect(() => checkClaims({ ...value, nonce: nonceAlias })).toThrow(protocol.CloudProofError);
  });
  it.each([
    { issued_at: now / 1000 - 60, expires_at: now / 1000 },
    { issued_at: now / 1000 + 6, expires_at: now / 1000 + 60 },
    { issued_at: now / 1000, expires_at: now / 1000 },
    { issued_at: now / 1000, expires_at: now / 1000 + 61 },
    { issued_at: String(now / 1000), expires_at: now / 1000 + 60 },
    { issued_at: now / 1000, expires_at: now / 1000 + 59.5 },
  ])('rejects expired, future, overlong or nonintegral time claims %j', value => {
    expect(() => checkClaims({ ...claims(), ...value })).toThrow(protocol.CloudProofError);
  });
  it('accepts the defined five-second issuer clock skew while still capping issued lifetime at sixty seconds', () => {
    const value = { ...claims(), issued_at: now / 1000 + 5, expires_at: now / 1000 + 65 };
    expect(checkClaims(value).proof.expiresAt.getTime()).toBe(now + 65_000);
  });
  it('uses fresh one-use identifiers and does not key replay protection by mutable identity fields', () => {
    const first = signed(), second = signed();
    const a = protocol.verifySignedProof(first.body, first.signature, verifier, now);
    const b = protocol.verifySignedProof(second.body, second.signature, verifier, now);
    expect(a.proof.digest).not.toBe(b.proof.digest);
    const changed = { ...JSON.parse(first.body), open_id: 'different-synthetic-caller' };
    expect(checkClaims(changed).proof.digest).toBe(a.proof.digest);
  });
  it('rejects malformed/oversized signed bodies without exposing a key or identity in errors', () => {
    for (const body of ['{', ' '.repeat(protocol.MAX_PROOF_BYTES + 1), JSON.stringify({ ...claims(), extra: '中'.repeat(1000) })]) {
      try { protocol.verifySignedProof(body, signBody(body), verifier, now); expect.fail('Must reject'); }
      catch (error) {
        expect(error).toBeInstanceOf(protocol.CloudProofError);
        const message = String(error);
        expect(message).not.toContain(privateB64); expect(message).not.toContain(identity.openId);
      }
    }
    const proof = signed();
    expect(JSON.stringify(proof)).not.toContain(privateB64);
    expect(JSON.stringify(proof)).not.toContain(publicB64);
  });
});

function platformContext(overrides: Record<string, unknown> = {}, legacy = false) {
  const current = {
    WX_APPID: identity.appId, WX_OPENID: identity.openId, TCB_SOURCE: 'wx_client', TCB_ENV: settings.WEEGO_CLOUD_AUTH_ENV_ID,
    ...overrides,
  };
  return {
    namespace: settings.WEEGO_CLOUD_AUTH_ENV_ID, function_name: 'weegoLogin',
    ...(legacy ? { environ: Object.entries(current).map(([k, value]) => `${k}=${value}`).join(';') } : { environment: JSON.stringify(current) }),
  };
}
const sessionFixture = () => ({ token: randomBytes(32).toString('base64url'), expires_at: new Date(now + 3_600_000).toISOString(), user: { user_id: randomUUID() } });
const functionSettings = { ...settings, WEEGO_API_BASE_URL: 'https://api.weevibe.example' };
function fixtureFunction(reply: unknown = sessionFixture(), status = 200, env: NodeJS.ProcessEnv = functionSettings) {
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(reply), { status, headers: { 'content-type': 'application/json' } }));
  return { request, handler: createLoginHandler({ env, request, now: () => now }) };
}

describe('ordinary cloud-function trust boundary using the installed SDK context parser', () => {
  it.each([false, true])('parses only the current platform context (legacy=%s) and returns only WeeVibe session data', async legacy => {
    const reply = sessionFixture();
    const { handler, request } = fixtureFunction(reply);
    const result = await handler({ open_id: 'forged-event-user', url: 'https://attacker.example' }, platformContext({}, legacy));
    expect(result).toEqual(reply);
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://api.weevibe.example/api/v1/auth/cloud-wechat');
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
    const signature = (options!.headers as Record<string, string>)['x-weego-cloud-signature'];
    expect(protocol.verifySignedProof(options!.body as string, signature, verifier, now).identity.openId).toBe(identity.openId);
    const publicReply = JSON.stringify(result);
    for (const value of [identity.openId, privateB64, signature, options!.body as string]) expect(publicReply).not.toContain(value);
  });
  it('does not inherit the previous warm invocation or process-global identity for missing-context calls', async () => {
    vi.stubEnv('WX_APPID', identity.appId); vi.stubEnv('WX_OPENID', 'stale-process-caller');
    vi.stubEnv('TCB_SOURCE', 'wx_client'); vi.stubEnv('SCF_NAMESPACE', settings.WEEGO_CLOUD_AUTH_ENV_ID!);
    const { handler, request } = fixtureFunction();
    await handler({}, platformContext({ WX_OPENID: 'synthetic-first' }));
    const missing = { namespace: settings.WEEGO_CLOUD_AUTH_ENV_ID, environment: '{}' };
    const rejected = await handler({ WX_APPID: identity.appId, WX_OPENID: 'forged-event-caller', TCB_SOURCE: 'wx_client' }, missing) as { error: { code: string } };
    expect(rejected.error.code).toBe('UNAUTHENTICATED');
    await handler({}, platformContext({ WX_OPENID: 'synthetic-second' }));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([, options]) => JSON.parse(options!.body as string).open_id)).toEqual(['synthetic-first', 'synthetic-second']);
  });
  it.each(['http', 'timer', 'server', 'wx_devtools', 'wx_client,server', undefined])('refuses unapproved or ambiguous platform source %s', async source => {
    const { handler, request } = fixtureFunction();
    const result = await handler({ TCB_SOURCE: 'wx_client' }, platformContext({ TCB_SOURCE: source })) as { error: { code: string } };
    expect(result.error.code).toBe('UNAUTHENTICATED'); expect(request).not.toHaveBeenCalled();
  });
  it('rejects conflicting app/environment metadata and malformed new/legacy values without falling back', async () => {
    const contexts: unknown[] = [
      platformContext({ WX_APPID: 'wx1111111111111111' }), platformContext({ TCB_ENV: 'another-env' }),
      platformContext({ SCF_NAMESPACE: 'another-env' }), platformContext({ WX_OPENID: ['unexpected-array'] }),
      { ...platformContext(), namespace: 'another-env' },
      { ...platformContext({}, true), environment: '{}' },
      { ...platformContext({}, true), environment: '{bad-json' },
      platformContext({ WX_OPENID: 'a,b' }, true),
      null,
    ];
    const { handler, request } = fixtureFunction();
    for (const context of contexts) {
      const result = await handler({ app_id: identity.appId, open_id: identity.openId }, context) as { error: { code: string } };
      expect(result.error.code).toBe('UNAUTHENTICATED');
    }
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    'http://api.weevibe.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
    'https://account:password@api.weevibe.example', 'https://api.weevibe.example/other-path',
    'https://api.weevibe.example?target=other', 'https://api.weevibe.example:8443',
  ])('rejects unsafe upstream configuration %s before sending identity', async base => {
    const { handler, request } = fixtureFunction(sessionFixture(), 200, { ...functionSettings, WEEGO_API_BASE_URL: base });
    const result = await handler({}, platformContext()) as { error: { code: string } };
    expect(result.error.code).toBe('NOT_CONFIGURED'); expect(request).not.toHaveBeenCalled();
  });
  it('does not disclose upstream proofs or identity through error messages or extra success fields', async () => {
    const leaked = { ...sessionFixture(), open_id: identity.openId, secret: privateB64 };
    const success = fixtureFunction(leaked);
    const result = await success.handler({}, platformContext()) as { error: { code: string } };
    expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
    const failure = fixtureFunction({ error: { code: 'DATABASE_UNAVAILABLE', message: privateB64 }, open_id: identity.openId }, 503);
    const rejected = await failure.handler({}, platformContext()) as { error: { code: string } };
    expect(rejected.error.code).toBe('DATABASE_UNAVAILABLE');
    for (const response of [result, rejected]) {
      expect(JSON.stringify(response)).not.toContain(privateB64); expect(JSON.stringify(response)).not.toContain(identity.openId);
    }
  });
  it('rejects expired or malformed upstream sessions rather than returning unchecked tokens', async () => {
    for (const reply of [
      { ...sessionFixture(), expires_at: new Date(now).toISOString() },
      { ...sessionFixture(), token: 'short' },
      { ...sessionFixture(), user: { user_id: randomUUID(), role: 'manager' } },
    ]) {
      const { handler } = fixtureFunction(reply);
      const result = await handler({}, platformContext()) as { error: { code: string } };
      expect(result.error.code).toBe('UPSTREAM_UNAVAILABLE');
    }
  });
});

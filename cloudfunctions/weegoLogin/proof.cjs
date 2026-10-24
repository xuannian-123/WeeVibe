'use strict';

// Server-only protocol. Never import this module into the mini-program bundle.
const { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } = require('node:crypto');
const LOGIN_PATH = '/api/v1/auth/cloud-wechat';
const PREFIX = `WEEGO-CLOUD-LOGIN-V1\nPOST\n${LOGIN_PATH}\n`;
const ISSUER = 'weego-cloud-login';
const AUDIENCE = 'weego-api';
const MAX_PROOF_BYTES = 2048;
const TTL_SECONDS = 60;
const fields = ['version', 'issuer', 'audience', 'key_id', 'app_id', 'env_id', 'source', 'open_id', 'issued_at', 'expires_at', 'nonce'];
const appPattern = /^wx[0-9a-f]{16}$/;
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const openPattern = /^[A-Za-z0-9_-]{1,128}$/;

class CloudProofError extends Error {
  constructor(kind) { super(kind === 'configuration' ? 'Cloud identity is not configured' : 'Cloud identity could not be verified'); this.kind = kind; }
}
function requireConfig(condition) { if (!condition) throw new CloudProofError('configuration'); }
function requireProof(condition) { if (!condition) throw new CloudProofError('identity'); }
function decodeKey(encoded, privateKey) {
  requireConfig(typeof encoded === 'string' && encoded.length < 512 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded));
  try {
    const bytes = Buffer.from(encoded, 'base64');
    requireConfig(bytes.toString('base64') === encoded);
    const key = privateKey
      ? createPrivateKey({ key: bytes, type: 'pkcs8', format: 'der' })
      : createPublicKey({ key: bytes, type: 'spki', format: 'der' });
    requireConfig(key.asymmetricKeyType === 'ed25519');
    return key;
  } catch { throw new CloudProofError('configuration'); }
}
function commonConfig(env) {
  requireConfig(env.WEEGO_CLOUD_AUTH_ENABLED === 'true');
  const appId = env.WECHAT_APP_ID;
  const envId = env.WEEGO_CLOUD_AUTH_ENV_ID;
  const keyId = env.WEEGO_CLOUD_AUTH_KEY_ID;
  requireConfig(typeof appId === 'string' && appPattern.test(appId));
  requireConfig(typeof envId === 'string' && idPattern.test(envId));
  requireConfig(typeof keyId === 'string' && idPattern.test(keyId));
  return { appId, envId, keyId, allowDevtools: env.WEEGO_CLOUD_AUTH_ALLOW_DEVTOOLS === 'true' };
}
function readVerifierConfig(env) {
  return { ...commonConfig(env), publicKey: decodeKey(env.WEEGO_CLOUD_AUTH_PUBLIC_KEY_B64, false) };
}
function readSignerConfig(env) {
  return { ...commonConfig(env), privateKey: decodeKey(env.WEEGO_CLOUD_AUTH_PRIVATE_KEY_B64, true) };
}
function validateClaims(claims, config, nowSeconds) {
  requireProof(claims !== null && typeof claims === 'object' && !Array.isArray(claims));
  requireProof(Object.keys(claims).length === fields.length && fields.every(k => Object.hasOwn(claims, k)));
  requireProof(claims.version === 1 && claims.issuer === ISSUER && claims.audience === AUDIENCE);
  requireProof(claims.key_id === config.keyId && claims.app_id === config.appId && claims.env_id === config.envId);
  requireProof(claims.source === 'wx_client' || (config.allowDevtools && claims.source === 'wx_devtools'));
  requireProof(typeof claims.open_id === 'string' && openPattern.test(claims.open_id));
  requireProof(typeof claims.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(claims.nonce));
  requireProof(Buffer.from(claims.nonce, 'base64url').toString('base64url') === claims.nonce);
  requireProof(Number.isSafeInteger(claims.issued_at) && Number.isSafeInteger(claims.expires_at));
  requireProof(claims.issued_at > 0 && claims.issued_at <= nowSeconds + 5);
  requireProof(claims.expires_at > nowSeconds && claims.expires_at > claims.issued_at && claims.expires_at - claims.issued_at <= TTL_SECONDS);
}
function createSignedProof(identity, config, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const claims = {
    version: 1, issuer: ISSUER, audience: AUDIENCE, key_id: config.keyId,
    app_id: identity.appId, env_id: config.envId, source: identity.source, open_id: identity.openId,
    issued_at: issued, expires_at: issued + TTL_SECONDS, nonce: randomBytes(32).toString('base64url')
  };
  validateClaims(claims, config, issued);
  const body = JSON.stringify(claims);
  return { body, signature: sign(null, Buffer.from(PREFIX + body, 'utf8'), config.privateKey).toString('base64url') };
}
function verifySignedProof(body, signature, config, now = Date.now()) {
  requireProof(typeof body === 'string' && Buffer.byteLength(body, 'utf8') <= MAX_PROOF_BYTES);
  requireProof(typeof signature === 'string' && /^[A-Za-z0-9_-]{86}$/.test(signature));
  const bytes = Buffer.from(signature, 'base64url');
  requireProof(bytes.length === 64 && bytes.toString('base64url') === signature);
  requireProof(verify(null, Buffer.from(PREFIX + body, 'utf8'), config.publicKey, bytes));
  let claims;
  try { claims = JSON.parse(body); } catch { throw new CloudProofError('identity'); }
  validateClaims(claims, config, Math.floor(now / 1000));
  return {
    identity: { appId: claims.app_id, openId: claims.open_id },
    proof: {
      digest: createHash('sha256').update(`${ISSUER}\n${claims.env_id}\n${claims.key_id}\n${claims.nonce}`).digest('hex'),
      expiresAt: new Date(claims.expires_at * 1000)
    }
  };
}
module.exports = { LOGIN_PATH, MAX_PROOF_BYTES, CloudProofError, readSignerConfig, readVerifierConfig, createSignedProof, verifySignedProof };

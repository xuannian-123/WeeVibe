'use strict';

const { randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const { parseContext } = require('@cloudbase/node-sdk');
const { LOGIN_PATH, CloudProofError, readSignerConfig, createSignedProof } = require('./proof.cjs');

function fail(code, message) { return { error: { code, message }, request_id: randomUUID() }; }
function identityFromContext(context, config) {
  // parseContext only; getCloudbaseContext/getWXContext also read process-global
  // dynamic identity variables and can retain a previous caller's identity.
  let parsed;
  try { parsed = parseContext(context); } catch { throw new CloudProofError('identity'); }
  const current = parsed.environment ?? parsed.environ;
  if (!current || typeof current !== 'object' || Array.isArray(current) || parsed.namespace !== config.envId ||
    (current.TCB_ENV !== undefined && current.TCB_ENV !== config.envId) ||
    (current.SCF_NAMESPACE !== undefined && current.SCF_NAMESPACE !== config.envId) ||
    current.WX_APPID !== config.appId || typeof current.WX_OPENID !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(current.WX_OPENID) ||
    !(current.TCB_SOURCE === 'wx_client' || config.allowDevtools && current.TCB_SOURCE === 'wx_devtools')) {
    throw new CloudProofError('identity');
  }
  return { appId: current.WX_APPID, openId: current.WX_OPENID, source: current.TCB_SOURCE };
}
function endpointFromConfig(env) {
  let base;
  try { base = new URL(env.WEEGO_API_BASE_URL); } catch { throw new CloudProofError('configuration'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' ||
    base.hostname === 'localhost' || base.hostname.endsWith('.localhost') || isIP(base.hostname.replace(/^\[|\]$/g, '')) ||
    !base.hostname.includes('.') || base.port && base.port !== '443') throw new CloudProofError('configuration');
  return new URL(LOGIN_PATH, base).toString();
}
async function boundedJson(response) {
  if (Number(response.headers.get('content-length') ?? 0) > 4096) throw new Error('Invalid upstream response');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invalid upstream response');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) throw new Error('Invalid upstream response');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
}
function cleanSession(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 3 ||
    typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token) ||
    typeof value.expires_at !== 'string' || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= now ||
    !value.user || typeof value.user !== 'object' || Object.keys(value.user).length !== 1 ||
    typeof value.user.user_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.user.user_id)) {
    throw new Error('Invalid upstream session');
  }
  // Explicit projection ensures provider identities/proofs never reach the client.
  return { token: value.token, expires_at: value.expires_at, user: { user_id: value.user.user_id } };
}
function createLoginHandler({ env = process.env, request = (...args) => fetch(...args), now = Date.now } = {}) {
  return async (_event, context) => {
    // Ignore event entirely: callers cannot choose an identity, URL, key or claim.
    try {
      const config = readSignerConfig(env);
      const endpoint = endpointFromConfig(env);
      const identity = identityFromContext(context, config);
      const proof = createSignedProof(identity, config, now());
      const response = await request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-weego-cloud-signature': proof.signature },
        body: proof.body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)
      });
      const value = await boundedJson(response);
      if (!response.ok) {
        if (response.status === 401) return fail('UNAUTHENTICATED', '登录未完成，请重新发起');
        if (response.status === 503 && value?.error?.code === 'NOT_CONFIGURED') return fail('NOT_CONFIGURED', '尚未配置微信云身份接入');
        if (response.status === 503 && value?.error?.code === 'DATABASE_UNAVAILABLE') return fail('DATABASE_UNAVAILABLE', '数据库暂时不可用');
        return fail('UPSTREAM_UNAVAILABLE', '登录服务暂时不可用，请稍后重试');
      }
      return cleanSession(value, now());
    } catch (error) {
      if (error instanceof CloudProofError) return error.kind === 'configuration'
        ? fail('NOT_CONFIGURED', '尚未配置微信云身份接入') : fail('UNAUTHENTICATED', '未取得可信微信身份，请从小程序重新登录');
      // Do not log SDK context, signing keys, request/response bodies or exceptions.
      return fail('UPSTREAM_UNAVAILABLE', '登录服务暂时不可用，请稍后重试');
    }
  };
}
exports.createLoginHandler = createLoginHandler;
exports.main = createLoginHandler();

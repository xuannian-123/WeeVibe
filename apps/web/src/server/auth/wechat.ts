import { ServiceError } from '../http';
import type { IdentityVerifier } from './service';
// This is the ordinary HTTPS code-exchange route. Raw platform identity headers
// are intentionally ignored. callContainer needs an independently verified ingress adapter.
export const exchangeWechatCode: IdentityVerifier = async code => {
  const appId = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appId || !secret) throw new ServiceError('NOT_CONFIGURED', 503, '尚未配置服务端微信身份交换');
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');
  let response: Response;
  try { response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000), redirect: 'error' }); }
  catch { throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, '微信身份服务暂时不可用'); }
  if (!response.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, '微信身份服务暂时不可用');
  let data: Record<string, unknown>;
  try { data = await response.json() as Record<string, unknown>; }
  catch { throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, '微信身份响应无法验证'); }
  if (!data || typeof data !== 'object') throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, '微信身份响应无法验证');
  if (data.errcode) throw new ServiceError('UNAUTHENTICATED', 401, '微信登录未成功，请重新登录');
  if (typeof data.openid !== 'string' || !data.openid) throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, '微信身份响应无法验证');
  // session_key and UnionID are neither returned nor stored. No provider body is logged.
  return { appId, openId: data.openid };
};

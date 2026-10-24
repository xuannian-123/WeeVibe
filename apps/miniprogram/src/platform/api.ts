import Taro from '@tarojs/taro';
import { createApiClient, ApiClientError, type Transport } from '@weego/api-client';
import { apiErrorSchema, sessionSchema } from '@weego/contracts';
declare const __WEEGO_API_BASE_URL__: string;
declare const __WEEGO_LOGIN_MODE__: 'code' | 'cloud';
declare const __WEEGO_CLOUD_ENV_ID__: string;
declare const __WEEGO_CLOUD_LOGIN_FUNCTION__: string;
const sessionKey = 'weego_session_v1';
// Stores only the Weego bearer session, never wx.login code, OpenID or session_key.
export function getToken(): string | undefined {
  const value: unknown = Taro.getStorageSync(sessionKey);
  return typeof value === 'string' && value ? value : undefined;
}
export function forgetSession() { Taro.removeStorageSync(sessionKey); }
const transport: Transport = async request => {
  const base = __WEEGO_API_BASE_URL__.replace(/\/$/, '');
  if (!base) throw new ApiClientError('NOT_CONFIGURED', '尚未配置正式 API 地址', 0);
  if (!/^https:\/\//.test(base) && process.env.NODE_ENV === 'production') throw new ApiClientError('NOT_CONFIGURED', '正式 API 必须使用 HTTPS', 0);
  try {
    const response = await Taro.request({ url: base + request.path, method: request.method, header: request.headers, data: request.body, timeout: 10000 });
    return { status: response.statusCode, body: response.data };
  } catch { throw new ApiClientError('NETWORK_ERROR', '网络请求未完成，请检查服务地址与网络', 0); }
};
export const api = createApiClient(transport, getToken);
export async function establishSession() {
  if (__WEEGO_LOGIN_MODE__ === 'cloud') {
    if (!__WEEGO_CLOUD_ENV_ID__ || !__WEEGO_CLOUD_LOGIN_FUNCTION__ || !__WEEGO_API_BASE_URL__) {
      throw new ApiClientError('NOT_CONFIGURED', '尚未配置云登录及业务 API 地址', 0);
    }
    let result: unknown;
    try {
      Taro.cloud.init({ env: __WEEGO_CLOUD_ENV_ID__ });
      const response = await Taro.cloud.callFunction({ name: __WEEGO_CLOUD_LOGIN_FUNCTION__, data: {}, config: { env: __WEEGO_CLOUD_ENV_ID__ } });
      result = response.result;
    } catch { throw new ApiClientError('NETWORK_ERROR', '微信云登录未完成，请稍后重试', 0); }
    const error = apiErrorSchema.safeParse(result);
    if (error.success) throw new ApiClientError(error.data.error.code, error.data.error.message, 0);
    const session = sessionSchema.safeParse(result);
    if (!session.success || !/^[A-Za-z0-9_-]{43}$/.test(session.data.token) || Date.parse(session.data.expires_at) <= Date.now()) {
      throw new ApiClientError('INVALID_RESPONSE', '云登录响应无法验证', 0);
    }
    Taro.setStorageSync(sessionKey, session.data.token);
    return session.data.user;
  }
  const login = await Taro.login();
  if (!login.code) throw new ApiClientError('UNAUTHENTICATED', '微信暂未提供登录凭证', 0);
  const session = await api.login(login.code);
  Taro.setStorageSync(sessionKey, session.token);
  return session.user;
}

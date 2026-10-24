import Taro from '@tarojs/taro';
import { createApiClient, ApiClientError, type Transport } from '@weego/api-client';
declare const __WEEGO_API_BASE_URL__: string;
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
  const login = await Taro.login();
  if (!login.code) throw new ApiClientError('UNAUTHENTICATED', '微信暂未提供登录凭证', 0);
  const session = await api.login(login.code);
  Taro.setStorageSync(sessionKey, session.token);
  return session.user;
}

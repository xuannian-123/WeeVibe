import { ApiClientError } from '@weevibe/api-client';
import { apiErrorSchema } from '@weevibe/contracts';
import { getToken, transport } from './api';
import { unrecognizedResponseMessage } from './response-error';

/** Extension routes use the same configured transport and verified session. */
export async function extensionRequest<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET', body?: unknown): Promise<T> {
  const uuid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  const allowed = path === '/api/v1/account' || path === '/api/v1/account/avatar' || path === '/api/v1/messages' || path === '/api/v1/venues/city' || new RegExp('^/api/v1/activities/' + uuid + '/member-profiles(?:/' + uuid + ')?$').test(path) || new RegExp('^/api/v1/requirements(?:/' + uuid + ')?(?:\\?activity_id=' + uuid + ')?$').test(path) || new RegExp('^/api/v1/activities/' + uuid + '/participation$').test(path);
  const coordinationRead = method === 'GET' && new RegExp('^/api/v1/requirements/' + uuid + '/coordination$').test(path);
  if (!allowed && !coordinationRead) throw new ApiClientError('INVALID_INPUT', '不支持的业务接口', 400);
  const token = getToken();
  if (!token) throw new ApiClientError('UNAUTHENTICATED', '请先登录', 401);
  // POST is intentionally used for updates to retain compatibility with the existing native cloud HTTP adapter.
  const response = await transport({ path, method: method === 'PATCH' ? 'POST' : method, body, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } });
  if (getToken() !== token) throw new ApiClientError('UNAUTHENTICATED', '账号已切换，请重新加载', 401);
  if (response.status < 200 || response.status >= 300) {
    const parsed = apiErrorSchema.safeParse(response.body);
    throw new ApiClientError(parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE', parsed.success ? parsed.data.error.message : unrecognizedResponseMessage(response.status), response.status);
  }
  if (typeof response.body !== 'object' || response.body === null) throw new ApiClientError('INVALID_RESPONSE', unrecognizedResponseMessage(response.status), 500);
  return response.body as T;
}

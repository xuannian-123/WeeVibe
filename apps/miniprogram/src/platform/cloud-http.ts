import { ApiClientError, type TransportRequest } from '@weego/api-client';
import { CLOUD_HTTP_ENVELOPE_HEADER, CLOUD_HTTP_ENVELOPE_VERSION, cloudHttpEnvelopeSchema } from '@weego/contracts';

type CloudHTTPOptions = {
  name: string; config: { env: string }; path: string;
  method: 'get' | 'post' | 'put'; header: Record<string, string>;
  data?: unknown; timeout: number;
  success: (response: unknown) => void; fail: (error: unknown) => void;
};
type NativeCloudHTTP = { initialize: (env: string) => void; callHTTPFunction: (options: CloudHTTPOptions) => unknown };
const initializedClouds = new WeakMap<object, string>();
declare const wx: unknown;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function nativeCloud(): NativeCloudHTTP {
  // Taro's installed types do not yet expose this native API. Never switch transports.
  const platform: unknown = typeof wx === 'undefined' ? undefined : wx;
  if (!isRecord(platform) || !isRecord(platform.cloud) || typeof platform.cloud.init !== 'function' || typeof platform.cloud.callHTTPFunction !== 'function') {
    throw new ApiClientError('NOT_CONFIGURED', '当前微信环境不支持云 HTTP，请使用基础库 3.15.2 或以上版本', 0);
  }
  const cloud = platform.cloud;
  const call = platform.cloud.callHTTPFunction;
  const init = cloud.init as (options: { env: string }) => unknown;
  return {
    initialize: env => {
      // A saved WeeVibe session survives restarts; the native cloud SDK does not.
      // Initialize before the first business request, independently of login.
      if (initializedClouds.get(cloud) === env) return;
      Reflect.apply(init, cloud, [{ env }]);
      initializedClouds.set(cloud, env);
    },
    callHTTPFunction: options => Reflect.apply(call, cloud, [options])
  };
}
export function assertCloudHTTPAvailable() { nativeCloud(); }

export async function callCloudHTTP(request: TransportRequest, env: string, name: string) {
  if (!env || !name) throw new ApiClientError('NOT_CONFIGURED', '尚未配置云 HTTP 业务接口', 0);
  // Only this application's routes may go to the fixed build-time environment/function.
  if (!request.path.startsWith('/api/v1/') || /[\\\r\n#]/.test(request.path) || request.path.includes('..')) {
    throw new ApiClientError('INVALID_REQUEST', '业务接口路径无效', 0);
  }
  const cloud = nativeCloud();
  let result: unknown;
  try {
    cloud.initialize(env);
    result = await new Promise<unknown>((resolve, reject) => {
      cloud.callHTTPFunction({
        name, config: { env }, path: request.path,
        method: request.method.toLowerCase() as 'get' | 'post' | 'put',
        header: { ...request.headers, [CLOUD_HTTP_ENVELOPE_HEADER]: CLOUD_HTTP_ENVELOPE_VERSION }, data: request.body, timeout: 10000,
        success: resolve, fail: reject
      });
    });
  } catch { throw new ApiClientError('NETWORK_ERROR', '云 HTTP 请求未完成，请检查网络与服务配置', 0); }
  if (!isRecord(result) || typeof result.statusCode !== 'number' || !Number.isInteger(result.statusCode) || result.statusCode < 100 || result.statusCode > 599 || !('data' in result)) {
    throw new ApiClientError('INVALID_RESPONSE', '云 HTTP 响应无法验证', 0);
  }
  let body: unknown = result.data;
  if (typeof body === 'string') {
    try { body = JSON.parse(body) as unknown; }
    catch { throw new ApiClientError('INVALID_RESPONSE', '云 HTTP 响应无法验证', result.statusCode); }
  }
  if (isRecord(body) && 'transport' in body) {
    const envelope = cloudHttpEnvelopeSchema.safeParse(body);
    if (result.statusCode !== 200 || !envelope.success) throw new ApiClientError('INVALID_RESPONSE', '云 HTTP 响应无法验证', result.statusCode);
    return { status: envelope.data.status, body: envelope.data.body };
  }
  return { status: result.statusCode, body };
}

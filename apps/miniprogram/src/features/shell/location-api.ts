import Taro from '@tarojs/taro';
import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, apiErrorSchema, cityLookupInputSchema, cityLookupResultSchema, gcj02Schema, type VenueSearchInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { unrecognizedResponseMessage } from '../../platform/response-error';
import { readPreciseLocation, requireLocationPermission } from '../../platform/location-permission';

function boundLocationClient(session: string | undefined, assertCurrent: () => void) {
  const guard = () => {
    assertCurrent();
    if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '定位来源身份已变化，请重新发起。', 401);
  };
  const bound: Transport = async request => {
    guard();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    guard(); return response;
  };
  return { guard, bound, client: createApiClient(bound, () => session) };
}
function safeFailure(error: unknown): never {
  if (error instanceof ApiClientError) throw error;
  throw new ApiClientError('INVALID_RESPONSE', '地点响应无法验证，未使用其中内容。', 200);
}
async function locate(session: string | undefined, assertCurrent: () => void) {
  const api = boundLocationClient(session, assertCurrent);
  // Authenticate before requesting native coordinates; never trust a caller's actor id.
  const identity = await api.client.me(); api.guard();
  const actor = activityIdSchema.parse(identity.user_id);
  await requireLocationPermission(api.guard); api.guard();
  let raw: Taro.getLocation.SuccessCallbackResult;
  try { api.guard(); raw = await readPreciseLocation(); }
  catch (error) {
    api.guard();
    const reason = String((error as { errMsg?: unknown })?.errMsg ?? (error instanceof Error ? error.message : ''));
    if (/auth deny|auth denied|authorize no response|permission denied/i.test(reason)) throw new ApiClientError('LOCATION_PERMISSION_DENIED', '位置权限尚未开启', 0);
    if (/privacy|not.*declar|api.*permission|permission.*api/i.test(reason)) throw new ApiClientError('LOCATION_NOT_CONFIGURED', '定位服务声明尚未完成', 0);
    throw new ApiClientError(/cancel/i.test(reason) ? 'LOCATION_CANCELLED' : 'LOCATION_UNAVAILABLE', '原生定位未完成。', 0);
  }
  api.guard();
  const location = gcj02Schema.parse({ latitude: Number(raw.latitude.toFixed(6)), longitude: Number(raw.longitude.toFixed(6)), crs: 'GCJ-02' });
  return { ...api, actor, location };
}
export async function locateCityForSession(session: string | undefined, assertCurrent: () => void) {
  try {
    const source = await locate(session, assertCurrent); source.guard();
    const response = await source.bound({ method: 'POST', path: '/api/v1/venues/city', headers: { 'Content-Type': 'application/json' }, body: cityLookupInputSchema.parse({ location: source.location }) });
    if (response.status < 200 || response.status >= 300) {
      const error = apiErrorSchema.safeParse(response.body);
      throw new ApiClientError(error.success ? error.data.error.code : 'INVALID_RESPONSE', unrecognizedResponseMessage(response.status), response.status);
    }
    const result = cityLookupResultSchema.parse(response.body); source.guard(); return result;
  } catch (error) { return safeFailure(error); }
}
export async function nearbyForSession(session: string | undefined, keyword: string, assertCurrent: () => void) {
  try {
    const source = await locate(session, assertCurrent); source.guard();
    const result = await source.client.nearbyVenues({ center: source.location, category: 'custom', keyword: keyword.trim() || '休闲', radius_m: 3000, page_size: 10 });
    source.guard(); return result;
  } catch (error) { return safeFailure(error); }
}
export async function searchForSession(session: string | undefined, input: VenueSearchInput, assertCurrent: () => void) {
  try { const api = boundLocationClient(session, assertCurrent); const result = await api.client.searchVenues(input); api.guard(); return result; }
  catch (error) { return safeFailure(error); }
}
export function locationError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'LOCATION_PRECISE_SYSTEM_LIMITED') return '系统当前仅允许微信使用大致位置，请在手机系统设置中为微信开启精确位置；仍可手动选择城市或搜索地点。';
  if (error instanceof ApiClientError && error.code === 'LOCATION_SYSTEM_DISABLED') return '手机定位服务未开启，请在系统设置中打开定位；仍可手动选择城市。';
  if (error instanceof ApiClientError && error.code === 'LOCATION_SYSTEM_DENIED') return '系统未允许微信使用位置，请到手机系统设置中为微信开启位置权限；仍可手动选择城市。';
  if (error instanceof ApiClientError && error.code === 'LOCATION_PERMISSION_DENIED') return '位置权限未开启；可点击下方打开设置，允许后再重试定位。';
  if (error instanceof ApiClientError && error.code === 'LOCATION_NOT_CONFIGURED') return '小程序定位接口或隐私声明尚未配置完成，请联系项目团队；仍可手动选择城市。';
  if (error instanceof ApiClientError && error.code === 'PRIVACY_DECLINED') return '你暂未同意隐私指引，仍可手动选择城市和搜索地点。';
  if (error instanceof ApiClientError && error.code === 'PRIVACY_UNAVAILABLE') return '当前微信暂时无法完成隐私授权，请更新微信或手动选择城市。';
  if (error instanceof ApiClientError && error.code === 'LOCATION_CANCELLED') return '已取消定位，仍可手动选择城市或按城市搜索。';
  if (error instanceof ApiClientError && error.code === 'LOCATION_UNAVAILABLE') return '未能获取位置，可检查定位权限后重试，或继续手动选择城市。';
  return errorText(error) + ' 仍可手动选择城市或按城市搜索。';
}

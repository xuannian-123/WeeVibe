import Taro from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { gcj02Schema, type Gcj02 } from '@weevibe/contracts';
import { requirePrivacyPermission } from './location-permission';

/** A user-selected point, not an AMap POI or merchant verification. */
export type MapPickedPlace = {
  source: 'wechat_choose_location';
  name: string;
  address: string;
  location: Gcj02;
};

let picking = false;

function normalize(value: Taro.chooseLocation.SuccessCallbackResult): MapPickedPlace {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const address = typeof value.address === 'string' ? value.address.trim() : '';
  const location = gcj02Schema.safeParse({
    latitude: Number.isFinite(value.latitude) ? Number(value.latitude.toFixed(6)) : value.latitude,
    longitude: Number.isFinite(value.longitude) ? Number(value.longitude.toFixed(6)) : value.longitude,
    crs: 'GCJ-02',
  });
  if (!name || name.length > 200 || address.length > 500 || !location.success) {
    throw new ApiClientError('MAP_PICKER_INVALID_RESULT', '未能核对所选地点，请重新选择或手动填写', 0);
  }
  return { source: 'wechat_choose_location', name, address, location: location.data };
}

function pickerFailure(error: unknown): ApiClientError | null {
  const native = error as { errMsg?: unknown; errno?: unknown } | null;
  const message = typeof native?.errMsg === 'string' ? native.errMsg : '';
  if (/privacy|declar|requiredPrivateInfos|api.*permission|no permission/i.test(message) || native?.errno === 112) {
    return new ApiClientError('MAP_PICKER_NOT_CONFIGURED', '地图选点暂未配置完成，可继续手动填写', 0);
  }
  if (/auth deny|auth denied|permission denied|system permission/i.test(message)) {
    return new ApiClientError('LOCATION_PERMISSION_DENIED', '位置权限未开启，可手动填写或主动前往设置', 0);
  }
  if (/cancel/i.test(message)) return null;
  return new ApiClientError('MAP_PICKER_FAILED', '暂时无法打开地图，请重试或手动填写', 0);
}

/**
 * Invoke from an explicit user action. Does not read GPS, store coordinates,
 * submit a form, open settings, or call a provider. Cancellation returns null.
 * guard must reject a changed actor, destroyed owner, or superseded request.
 */
export async function chooseMapPlace(options: { guard: () => void; center?: Gcj02 }): Promise<MapPickedPlace | null> {
  options.guard();
  if (picking) throw new ApiClientError('MAP_PICKER_BUSY', '地图选择已打开，请先完成当前选择', 0);
  if (typeof Taro.chooseLocation !== 'function') {
    throw new ApiClientError('MAP_PICKER_UNAVAILABLE', '当前微信暂不支持地图选点，可手动填写', 0);
  }
  const center = options.center === undefined ? undefined : gcj02Schema.safeParse(options.center);
  if (center && !center.success) throw new ApiClientError('MAP_PICKER_INVALID_CENTER', '原地点坐标无效，请重新选择', 0);
  picking = true;
  try {
    await requirePrivacyPermission(options.guard);
    options.guard();
    let result: Taro.chooseLocation.SuccessCallbackResult;
    try {
      result = await new Promise<Taro.chooseLocation.SuccessCallbackResult>((resolve, reject) => {
        const point = center?.success ? center.data : undefined;
        const pending = Taro.chooseLocation({
          ...(point ? { latitude: point.latitude, longitude: point.longitude } : {}),
          success: resolve,
          fail: reject,
        });
        if (pending && typeof pending.then === 'function') void pending.then(resolve, reject);
      });
    } catch (error) {
      options.guard();
      const failure = pickerFailure(error);
      if (failure) throw failure;
      return null;
    }
    options.guard();
    return normalize(result);
  } finally {
    picking = false;
  }
}

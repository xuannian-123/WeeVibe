import Taro from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';

export const LOCATION_SCOPE = 'scope.userLocation' as const;

/** WeChat's native precise API uses callbacks; Taro may also return a promise. */
export function readPreciseLocation(): Promise<Taro.getLocation.SuccessCallbackResult> {
  return new Promise((resolve, reject) => {
    if (typeof Taro.getLocation !== 'function') {
      reject(new ApiClientError('LOCATION_UNAVAILABLE', '当前微信暂不支持精确定位，可更新微信或手动选择城市', 0));
      return;
    }
    const pending = Taro.getLocation({ type: 'gcj02', isHighAccuracy: true, highAccuracyExpireTime: 5000, success: resolve, fail: reject });
    if (pending && typeof pending.then === 'function') void pending.then(resolve, reject);
  });
}

/** Called only after a user's action. Permission does not obtain coordinates. */
export async function requirePrivacyPermission(guard: () => void) {
  guard();
  if (typeof Taro.getPrivacySetting !== 'function') throw new ApiClientError('PRIVACY_UNAVAILABLE', '请更新微信后重试', 0);
  let setting: Taro.getPrivacySetting.SuccessCallbackResult;
  try { setting = await new Promise<Taro.getPrivacySetting.SuccessCallbackResult>((resolve, reject) => Taro.getPrivacySetting({ success: resolve, fail: reject })); }
  catch { guard(); throw new ApiClientError('PRIVACY_UNAVAILABLE', '暂时无法核对隐私授权，请稍后重试', 0); }
  guard();
  if (!setting.needAuthorization) return;
  if (typeof Taro.requirePrivacyAuthorize !== 'function') throw new ApiClientError('PRIVACY_UNAVAILABLE', '当前微信暂不支持隐私授权', 0);
  try { await new Promise<void>((resolve, reject) => Taro.requirePrivacyAuthorize({ success: () => resolve(), fail: reject })); }
  catch { guard(); throw new ApiClientError('PRIVACY_DECLINED', '你暂未同意隐私指引，可以继续使用手动填写和城市选择', 0); }
  guard();
}

export async function requireLocationPermission(guard: () => void) {
  await requirePrivacyPermission(guard); guard();
  if (typeof Taro.getSystemSetting === 'function' && Taro.getSystemSetting().locationEnabled === false) throw new ApiClientError('LOCATION_SYSTEM_DISABLED', '手机定位服务未开启', 0);
  if (typeof Taro.getAppAuthorizeSetting === 'function') {
    const app = Taro.getAppAuthorizeSetting();
    if (app.locationAuthorized === 'denied') throw new ApiClientError('LOCATION_SYSTEM_DENIED', '系统未允许微信使用位置', 0);
    if (app.locationAuthorized === 'authorized' && app.locationReducedAccuracy === true) throw new ApiClientError('LOCATION_PRECISE_SYSTEM_LIMITED', '系统当前仅允许微信使用大致位置', 0);
  }
  guard();
  let setting: Taro.getSetting.SuccessCallbackResult;
  try { setting = await Taro.getSetting(); }
  catch { guard(); throw new ApiClientError('LOCATION_UNAVAILABLE', '暂时无法读取位置权限', 0); }
  guard();
  const granted = setting.authSetting[LOCATION_SCOPE];
  if (granted === false) throw new ApiClientError('LOCATION_PERMISSION_DENIED', '位置权限尚未开启', 0);
  if (granted !== true) {
    try { guard(); await Taro.authorize({ scope: LOCATION_SCOPE }); }
    catch (error) {
      guard();
      const native = error as { errMsg?: string; errno?: number };
      if (native.errno === 112 || /privacy|not.*declar/i.test(native.errMsg || '')) throw new ApiClientError('LOCATION_NOT_CONFIGURED', '小程序尚未完成地理位置隐私声明', 0);
      throw new ApiClientError('LOCATION_PERMISSION_DENIED', '你暂未允许位置权限', 0);
    }
    guard();
  }
}

export function needsLocationSettings(error: unknown) { return error instanceof ApiClientError && error.code === 'LOCATION_PERMISSION_DENIED'; }

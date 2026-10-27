import Taro from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';

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
  if (typeof Taro.getAppAuthorizeSetting === 'function' && Taro.getAppAuthorizeSetting().locationAuthorized === 'denied') throw new ApiClientError('LOCATION_SYSTEM_DENIED', '系统未允许微信使用位置', 0);
  guard();
  let setting: Taro.getSetting.SuccessCallbackResult;
  try { setting = await Taro.getSetting(); }
  catch { guard(); throw new ApiClientError('LOCATION_UNAVAILABLE', '暂时无法读取位置权限', 0); }
  guard();
  if (setting.authSetting['scope.userLocation'] === false) throw new ApiClientError('LOCATION_PERMISSION_DENIED', '位置权限尚未开启', 0);
  if (setting.authSetting['scope.userLocation'] !== true) {
    try { guard(); await Taro.authorize({ scope: 'scope.userLocation' }); }
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

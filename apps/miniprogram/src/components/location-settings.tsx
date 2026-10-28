import { Button, Text, View } from '@tarojs/components';
import { LOCATION_SCOPES, type LocationMode } from '../platform/location-permission';

/** A separate explicit native setting action; never retries or obtains location. */
export function LocationSettings({ current, changed, mode = 'approximate' }: { current: () => boolean; changed: (granted: boolean) => void; mode?: LocationMode }) {
  return <View className="wv-location-help"><Text className="wv-muted">可以在微信设置中允许{mode === 'precise' ? '精确' : '大致'}位置权限，也可以继续手动搜索。</Text><Button className="action action-secondary" openType="openSetting" onOpenSetting={e => { if (current()) changed(e.detail.authSetting[LOCATION_SCOPES[mode]] === true); }}>打开位置权限设置</Button></View>;
}

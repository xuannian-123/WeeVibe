import { Button, Text, View } from '@tarojs/components';

/** A separate explicit native setting action; never retries or obtains location. */
export function LocationSettings({ current, changed }: { current: () => boolean; changed: (granted: boolean) => void }) {
  return <View className="wv-location-help"><Text className="wv-muted">可以在微信设置中允许位置权限，也可以继续手动选择城市。</Text><Button className="action action-secondary" openType="openSetting" onOpenSetting={e => { if (current()) changed(e.detail.authSetting['scope.userLocation'] === true); }}>打开位置权限设置</Button></View>;
}

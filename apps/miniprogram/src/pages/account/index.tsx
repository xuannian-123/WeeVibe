import Taro, { useRouter } from '@tarojs/taro';
import { View } from '@tarojs/components';
import Home from '../index/index';
import { isCAccountPage } from '../../features/design-c/account-navigation';
import { CAction, CNotice } from '../../features/design-c/ui';

export default function AccountPage() {
  const { params } = useRouter();
  if (!isCAccountPage(params.page)) return <View className="c-ui c-shell"><CNotice>入口不完整，请返回“我的”重新打开。</CNotice><CAction onClick={() => void Taro.reLaunch({ url: '/pages/index/index?tab=me' })}>返回我的</CAction></View>;
  const group = params.group === 'managed' || params.group === 'joined' ? params.group : 'all';
  return <Home routePage={params.page} routeGroup={group} />;
}

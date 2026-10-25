import Taro from '@tarojs/taro';
import { Button, Text } from '@tarojs/components';
import { Action, Panel } from '../../components/ui';

// Share metadata is registered once by the activity controller.
export function InvitationPanel({ id, anyBusy }: { id: string; anyBusy: boolean }) {
  return <Panel title="约朋友一起">
      <Text className="activity-muted">分享这份行程，让朋友选择想参加的环节。</Text>
      <Button className="activity-share" openType="share" disabled={anyBusy}>分享给微信好友</Button>
      <Action variant="text" onClick={() => { void Taro.setClipboardData({ data: id }).catch(() => { void Taro.showToast({ title: '复制未完成，请重试', icon: 'none' }); }); }}>复制活动编号</Action>
      <Text className="caption">仅限已获体验资格的成员打开；分享不会赋予管理权限。</Text>
    </Panel>;
}

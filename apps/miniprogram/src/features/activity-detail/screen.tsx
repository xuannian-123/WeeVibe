import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { Action, Notice, Panel } from '../../components/ui';
import { ApprovalPanel, MyParticipationPanel, ApplicationForm } from '../applications/panels';
import { InvitationPanel } from '../invitations';
import { useActivityDetail } from './use-activity-detail';
import { Itinerary } from './itinerary';
import { ActivityMore } from './more';
import './activity.css';

export default function ActivityDetailScreen() {
  const { id, detail, userId, read, login, applications, showMore, setShowMore } = useActivityDetail();
  const { anyBusy } = applications;
  if (!id) return <View className="screen activity-page"><Panel title="没有找到这个活动"><Notice>活动入口不完整，请向朋友重新获取邀请。</Notice><Action onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action></Panel></View>;
  return <View className="screen activity-page">
    <View className="activity-hero">
      <Text className="activity-eyebrow">WEEGO · 一起出发</Text>
      <Text className="activity-title">{detail?.name ?? '活动详情'}</Text>
      {detail && <View className="activity-badges">
        <Text className={`activity-badge ${detail.cancelled_at ? 'activity-badge-muted' : ''}`}>{detail.cancelled_at ? '已取消' : detail.formation_status === 'confirmed' ? '主环节已成局' : '待确认成局'}</Text>
        <Text className="activity-role">{detail.viewer.is_manager ? '你在管理此活动' : userId ? '我的活动' : '朋友的邀请'} · {detail.segments.length}个环节</Text>
      </View>}
      <View className="activity-toolbar">
        <Action variant="text" disabled={anyBusy || read.loading} onClick={() => { void read.refresh(); }}>{read.loading ? '更新中…' : '刷新安排'}</Action>
        {!userId && <Action variant="primary" disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>{login.busy ? '登录中…' : '微信登录'}</Action>}
      </View>
    </View>
    {read.loading && !detail && <Notice>正在加载活动安排…</Notice>}
    {read.error && <Notice>{read.error} 当前内容可能已过时，请刷新后再操作。</Notice>}
    {!detail && !read.loading && !read.error && <Notice>暂时没有取得活动信息，请刷新重试。</Notice>}
    {login.error && <Notice>{login.error}</Notice>}

    {detail && <ApprovalPanel detail={detail} state={applications} />}

    {detail && <MyParticipationPanel detail={detail} state={applications} />}

    {detail && <Itinerary detail={detail} />}

    {detail && <ApplicationForm detail={detail} state={applications} login={login} />}

    {detail && <InvitationPanel id={id} anyBusy={anyBusy} />}

    {detail && <ActivityMore detail={detail} showMore={showMore} setShowMore={setShowMore} login={login} anyBusy={anyBusy} />}
    <Action variant="text" disabled={anyBusy} onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action>
  </View>;
}

import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weego/contracts';
import type { useLogin } from '../../platform/page-state';
import { formatTime } from '../../platform/activities';
import { Action, Panel } from '../../components/ui';
import { applicationLabels } from '../applications/labels';

export function ActivityMore({ detail, showMore, setShowMore, login, anyBusy }: {
  detail: ActivityDetail; showMore: boolean; setShowMore: (update: (value: boolean) => boolean) => void;
  login: Pick<ReturnType<typeof useLogin>, 'busy' | 'login'>; anyBusy: boolean;
}) {
  return <Panel title="活动说明">
      <Action variant="text" onClick={() => setShowMore(value => !value)}>{showMore ? '收起更多信息 ↑' : '查看规则与更多信息 ↓'}</Action>
      {showMore && <View className="activity-more">
        <Text>申请不占位，发起人会整体批准你所选的环节。安排变化后需要重新查看并接受，不会自动减少你的选择。</Text>
        <Text>人数达到最低或满员，不代表活动已成局或场地已预订；各段费用单位可能不同，请分别查看。</Text>
        <Text>当前支持创建、申请和审批。退出、撤回、重新接受、确认成局与管理交接仍待接入。</Text>
        <Text>此处仅显示你自己的参加记录，以及发起人可处理的申请，并非完整成员名册。活动编号只用于找到行程。</Text>
        <Text className="caption">活动时区：{detail.timezone}；页面时间：Asia/Shanghai。更新于 {formatTime(detail.server_time)}，活动版本 {detail.revision}。</Text>
        {detail.segments.map(segment => <Text className="caption" key={segment.segment_id}>{segment.name}：安排版本 {segment.plan_revision}，已接受新安排 {segment.counts.accepted_count}人，待接受 {segment.counts.pending_acceptance_count}人。</Text>)}
        {detail.viewer.is_manager && detail.applications?.filter(a => a.status !== 'pending').map(application => <View className="activity-history" key={application.application_id}><Text>{application.display_name || '一位朋友'} · {applicationLabels[application.status]}</Text><Text className="caption">{application.segments.map(s => `${detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节'}（接受版本${s.plan_revision}）`).join('、')}</Text></View>)}
        <Action disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>重新登录，恢复我的状态</Action>
      </View>}
    </Panel>;
}

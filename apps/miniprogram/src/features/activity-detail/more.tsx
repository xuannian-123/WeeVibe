import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
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
        <Text>当前支持创建、申请、审批及本人按环节退出和晚到登记；本人整份待审批申请仅在全部目标未截止、未开始且未取消时可撤回，不退出已有席位。</Text>
        <Text>主环节开始前支持人工核实与确认／恢复成局；本人版本审阅只接受可核验的完整历史，缺历史不能重新接受，不代表安排修改入口已开放。</Text>
        <Text>当前管理者可在所有环节开始前取消整场活动；开始后新取消尚未启用。本片没有恢复／撤销取消入口，不自动退款、退订或通知他人。</Text>
        <Text>管理交接支持当前管理者邀请符合资格的已加入者，由指定本人接受或拒绝，接受前可撤回；仍需参加至少一个未取消、未结束的有效环节，待重新接受安排不影响交接资格；交接不会代替安排接受，不自动过期，不改变参加状态。</Text>
        <Text>可主动读取各段当前占位名单，只展示公开报名名与已接受／保位待接受状态。待审批、已退出不列入当前占位；取消历史本片暂不展示。接口未提供或超限时不当作无人参加。活动编号只用于找到行程。</Text>
        <Text className="caption">活动时区：{detail.timezone}；页面时间：Asia/Shanghai。更新于 {formatTime(detail.server_time)}，活动版本 {detail.revision}。</Text>
        {detail.segments.map(segment => <Text className="caption" key={segment.segment_id}>{segment.name}：{detail.cancelled_at || segment.cancelled_at
          ? `已取消 · 历史安排版本 ${segment.plan_revision}，原同版接受记录 ${segment.counts.accepted_count}人，原未接受版本记录 ${segment.counts.pending_acceptance_count}人；不表示当前有效同意。`
          : `安排版本 ${segment.plan_revision}，已接受新安排 ${segment.counts.accepted_count}人，待接受 ${segment.counts.pending_acceptance_count}人。`}</Text>)}
        {detail.viewer.is_manager && detail.applications?.filter(a => a.status !== 'pending').map(application => <View className="activity-history" key={application.application_id}><Text>{application.display_name || '一位朋友'} · {applicationLabels[application.status]}</Text><Text className="caption">{application.segments.map(s => `${detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节'}（接受版本${s.plan_revision}）`).join('、')}</Text></View>)}
        <Action disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>重新登录，恢复我的状态</Action>
      </View>}
    </Panel>;
}

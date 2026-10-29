import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import type { InvitationSourceView } from '@weevibe/contracts/src/invitations';
import { Action, Notice } from '../../components/ui';
import { formationProgress } from '../formation/progress';
import { overviewModel, type DetailSection } from './overview-model';
import './invitation-overview.css';

type Props = {
  detail: ActivityDetail; sourceId?: string; source?: InvitationSourceView;
  sourceLoading?: boolean; sourceError?: string; busy: boolean;
  open: (section: DetailSection) => void; retrySource: () => void; refresh: () => void;
};
export function ActivityOverview({ detail, sourceId, source, sourceLoading, sourceError, busy, open, retrySource, refresh }: Props) {
  const model = overviewModel(detail);
  const progress = formationProgress(detail);
  return <View className="invitation-v1">
    <View className="iv-hero">
      <View className="iv-top"><Text className="iv-brand">WeeVibe · 一起出发</Text><Text className="iv-pill">{progress.label}</Text></View>
      <Text className="iv-title">{detail.name}</Text>
      <Text className="iv-muted">{progress.guidance}</Text>
      <View className="iv-summary">
        <View><Text className="iv-summary-number">{model.segmentCount}</Text><Text className="iv-summary-label">{detail.cancelled_at ? '原定环节' : '个活动环节'}</Text></View>
        <View><Text className="iv-summary-number">{model.main?.counts.occupied_count ?? '—'}</Text><Text className="iv-summary-label">{detail.cancelled_at || model.main?.cancelled_at ? '主环节历史占位' : '主环节当前占位'}</Text></View>
        <View><Text className="iv-summary-status">{model.status}</Text><Text className="iv-summary-label">{detail.viewer.is_manager ? '你在管理此活动' : '我的参加状态'}</Text></View>
      </View>
      <Action variant="primary" disabled={busy} onClick={() => open(model.primary.section)}>{model.primary.label}</Action>
      {detail.viewer.is_manager && <Action disabled={busy} onClick={() => open('approval')}>处理参加申请{model.approvals ? `（${model.approvals}）` : ''}</Action>}
      <Action variant="text" disabled={busy} onClick={refresh}>刷新安排</Action>
      <View className="iv-people">
        <Text className="iv-label">原发起人</Text><Text className="iv-muted">当前接口未提供公开资料</Text>
        <Text className="iv-label">当前管理者</Text><Text>{detail.viewer.is_manager ? '你正在负责此活动' : '由当前管理者处理申请与安排'}</Text>
        <Text className="iv-label">邀请分享者</Text>
        {sourceId === undefined ? <Text className="iv-muted">公开活动入口，未附邀请来源</Text>
          : sourceLoading ? <Text className="iv-muted">正在核验邀请来源…</Text>
          : source ? <Text>{source.inviter_display_name || '未提供公开昵称'}<Text className="iv-muted"> · 分享者不一定是原发起人</Text></Text>
          : <View><Notice>{sourceError || '邀请来源尚未核验，暂不能通过此入口申请。'}</Notice><Action disabled={busy} onClick={retrySource}>重新核验邀请来源</Action></View>}
        {source?.cancelled && <Notice>邀请对应活动已取消，请刷新核对当前安排。</Notice>}
      </View>
    </View>
  </View>;
}

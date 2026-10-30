import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../activity-entry/ActivityUI';
import type { ApplicationAttributionsState } from './use-attributions';

export function AttributionPanel({ detail, state }: { detail: ActivityDetail; state: ApplicationAttributionsState }) {
  if (!detail.viewer.user_id) return null;
  const applications = detail.viewer.is_manager ? detail.applications ?? [] : detail.viewer.applications;
  const known = new Map(applications.map(application => [application.application_id, application]));
  return <Panel title={detail.viewer.is_manager ? '申请的邀请入口来源' : '我的申请来源'}>
    <Text className="caption">只记录本次申请使用的公开邀请入口，不验证谁实际转发、双方关系或身份，也不授予席位。</Text>
    {state.status === 'loading' && <Notice>正在核验申请来源…</Notice>}
    {state.error && <Notice>{state.error}</Notice>}
    {!state.available && state.status !== 'loading' && !state.error && <Text className="caption">申请来源尚未核验，未按活动名单推测邀请人。</Text>}
    {state.available && state.data && <View>
      {state.data.entries.length === 0 && <Text>当前可读取范围内还没有申请记录。</Text>}
      {state.data.entries.map(entry => {
        const application = known.get(entry.application_id);
        return <View key={entry.application_id} className="activity-request">
          <Text>{application?.display_name || '未填写报名名'}</Text>
          <Text className="caption">{application?.segments.map(s => detail.segments.find(segment => segment.segment_id === s.segment_id)?.name ?? '历史环节').join(' ＋ ')}</Text>
          {entry.source ? <Text>通过 {entry.source.inviter_display_name || '未公开报名名的邀请人'} 的公开邀请入口申请</Text> : <Text>未记录邀请入口（可能是旧版申请或未携带来源，不能据此判断没有邀请人）。</Text>}
        </View>;
      })}
    </View>}
    <Action variant="text" disabled={state.status === 'loading'} onClick={() => { void state.refresh(); }}>重新读取申请来源</Action>
  </Panel>;
}

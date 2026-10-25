import { Checkbox, CheckboxGroup, Label, Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import type { useLogin } from '../../platform/page-state';
import { feeText } from '../../platform/activities';
import { Action, Field, Notice, Panel } from '../../components/ui';
import type { ApplicationsState } from './use-applications';
import { applicationLabels } from './labels';

type LoginActions = Pick<ReturnType<typeof useLogin>, 'busy' | 'login'>;

export function ApprovalPanel({ detail, state }: { detail: ActivityDetail; state: ApplicationsState }) {
  const { fresh, anyBusy, decisionBlocked, decision, decide } = state;
  if (!detail.viewer.is_manager) return null;
  return <Panel title={`待处理申请 · ${detail.applications?.filter(a => a.status === 'pending').length ?? 0}`}>
      {!detail.applications?.some(a => a.status === 'pending') && <Text className="activity-muted">还没有待处理的申请，邀请朋友来参加吧。</Text>}
      {detail.applications?.filter(a => a.status === 'pending').map(application => <View className="activity-request" key={application.application_id}>
        <Text className="activity-request-name">{application.display_name || '一位朋友'}</Text>
        <Text className="activity-request-segments">{application.segments.map(s => detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节').join(' ＋ ')}</Text>
        {application.segments.some(s => detail.segments.find(v => v.segment_id === s.segment_id)?.plan_revision !== s.plan_revision) && <Notice>这份申请接受的是之前的安排，处理前请核对变化。</Notice>}
        <View className="activity-request-actions">
          <Action variant="primary" disabled={!fresh || anyBusy || decisionBlocked} onClick={() => decide(application.application_id, 'approve')}>全部批准</Action>
          <Action variant="text" disabled={!fresh || anyBusy || decisionBlocked} onClick={() => decide(application.application_id, 'reject')}>不通过</Action>
        </View>
      </View>)}
      {!!detail.applications?.some(a => a.status === 'pending') && <Text className="caption">每份申请的所选环节一起处理，批准后才占用名额。</Text>}
      {decision.message && <Notice>{decision.message}</Notice>}
      {decision.pending && <View><Notice>上次处理结果尚未确认。请先刷新核对，再重试原操作。</Notice><Action disabled={!fresh || anyBusy} onClick={() => { void decision.send(); }}>核对后重试原操作</Action></View>}
    </Panel>;
}

export function MyParticipationPanel({ detail, state }: { detail: ActivityDetail; state: ApplicationsState }) {
  const { userId } = state;
  return <Panel title="我的参加状态">
      {!userId && <Text className="activity-muted">登录后查看自己的席位和申请，当前活动会保留。</Text>}
      {userId && detail.viewer.participations.length === 0 && detail.viewer.applications.length === 0 && <Text className="activity-muted">还没有参加的环节，可以按自己的时间选择。</Text>}
      {detail.viewer.participations.map(participation => <View className="activity-personal-row" key={participation.segment_id}>
        <Text>{detail.segments.find(s => s.segment_id === participation.segment_id)?.name ?? '历史环节'}</Text>
        <Text className={participation.status === 'awaiting_acceptance' ? 'activity-warning' : 'activity-personal-state'}>{participation.status === 'joined' ? '已加入' : participation.status === 'awaiting_acceptance' ? '保留席位 · 待重新接受' : '已退出'}</Text>
      </View>)}
      {detail.viewer.participations.some(p => p.status === 'awaiting_acceptance') && <Notice>安排有变化，你的席位仍保留。重新接受功能尚未开放，请先与发起人确认。</Notice>}
      {detail.viewer.applications.map(application => <View className="activity-personal-row" key={application.application_id}>
        <Text>{application.segments.map(s => detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节').join(' ＋ ')}</Text>
        <Text className="activity-personal-state">{applicationLabels[application.status]}</Text>
      </View>)}
      {detail.viewer.applications.some(a => a.status === 'pending') && <Text className="caption">申请待发起人批准，当前还不占用名额。</Text>}
    </Panel>;
}

export function ApplicationForm({ detail, state, login }: { detail: ActivityDetail; state: ApplicationsState; login: LoginActions }) {
  const { selected, setSelected, nickname, setNickname, accepted, setAccepted, validation,
    apply, anyBusy, applicationBlocked, myOccupied, myPending, available, confirmation, fresh, userId, submit } = state;
  return <Panel title="我想参加">
      <Text className="activity-muted">选适合你的环节，不必全程参加。</Text>
      <CheckboxGroup onChange={e => { setSelected(e.detail.value); setAccepted(''); }}>{detail.segments.map(segment => <Label key={segment.segment_id} className="choice activity-select-row"><Checkbox value={segment.segment_id} checked={selected.includes(segment.segment_id)} disabled={!fresh || anyBusy || applicationBlocked || !userId || (!available(segment.segment_id) && !selected.includes(segment.segment_id))} /><View className="activity-select-content"><Text>{segment.name}</Text><Text className="caption">{myOccupied.has(segment.segment_id) ? '已有席位' : myPending.has(segment.segment_id) ? '申请待处理' : available(segment.segment_id) ? '可以申请' : '暂不可加入'} · {feeText(segment.fee)}</Text></View></Label>)}</CheckboxGroup>
      {selected.length > 0 && <Text className="activity-selected-summary">已选 {selected.map(segmentId => detail.segments.find(s => s.segment_id === segmentId)?.name ?? '已变更环节').join(' ＋ ')}</Text>}
      <Field label="活动昵称（选填）" value={nickname} onChange={setNickname} disabled={anyBusy || applicationBlocked} placeholder="朋友们怎么称呼你" />
      <CheckboxGroup onChange={e => setAccepted(e.detail.value.includes('accept') ? confirmation : '')}><Label className="choice activity-consent"><Checkbox value="accept" checked={selected.length > 0 && accepted === confirmation} disabled={!fresh || !selected.length || anyBusy || applicationBlocked || !userId} /><Text>我已查看并接受所选环节的当前安排及参考费用</Text></Label></CheckboxGroup>
      {validation && <Notice>{validation}</Notice>}{apply.message && <Notice>{apply.message}</Notice>}
      <Action variant="primary" disabled={!fresh || !userId || anyBusy || applicationBlocked || !selected.length || accepted !== confirmation} onClick={submit}>{apply.busy ? '正在提交…' : '申请参加所选环节'}</Action>
      {apply.pending && <View><Notice>上次申请结果尚未确认，请先刷新核对。重试会保留原来的选择，不会重复提交一份新申请。</Notice><Action disabled={anyBusy || !fresh || !userId} onClick={() => { void apply.send(); }}>核对后重试原申请</Action></View>}
      {!userId && <Action disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>先登录，再申请</Action>}
    </Panel>;
}

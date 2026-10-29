import { Checkbox, CheckboxGroup, Label, Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import type { useLogin } from '../../platform/page-state';
import { feeText } from '../../platform/activities';
import { Action, Field, Notice, Panel } from '../../components/ui';
import type { ApplicationsState } from './use-applications';
import { applicationLabels } from './labels';
import { getToken } from '../../platform/api';
import { GatheringProfileBoundary } from '../gatherings/profile-boundary';

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
      {detail.viewer.participations.map(participation => {
        const item = detail.segments.find(s => s.segment_id === participation.segment_id);
        const cancelled = !!detail.cancelled_at || !!item?.cancelled_at;
        const label = participation.status === 'joined' ? '已加入' : participation.status === 'awaiting_acceptance' ? '保留席位 · 待重新接受' : '已退出';
        const historical = participation.status === 'joined' ? '历史已加入记录' : participation.status === 'awaiting_acceptance' ? '历史未接受版本记录' : '历史已退出记录';
        return <View className="activity-personal-row" key={participation.segment_id}>
          <Text>{item?.name ?? '历史环节'}</Text>
          <Text className={!cancelled && participation.status === 'awaiting_acceptance' ? 'activity-warning' : 'activity-personal-state'}>{cancelled ? `已取消 · ${historical}` : label}</Text>
        </View>;
      })}
      {detail.viewer.participations.some(p => detail.cancelled_at || detail.segments.find(s => s.segment_id === p.segment_id)?.cancelled_at) && <Notice>已取消部分仅保留原参加与接受记录，不代表当前有效席位或同意继续参加；未自动退出、退订或退款。</Notice>}
      {detail.viewer.participations.some(p => p.status === 'awaiting_acceptance' && !detail.cancelled_at && !detail.segments.find(s => s.segment_id === p.segment_id)?.cancelled_at) && <Notice>安排有变化，你的席位仍保留。请查看安排版本审阅状态；历史不可核验时不能在线接受，请与发起人确认。管理者修改后仍需本人查看差异并接受。</Notice>}
      {detail.viewer.applications.map(application => <View className="activity-personal-row" key={application.application_id}>
        <Text>{application.segments.map(s => detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节').join(' ＋ ')}</Text>
        <Text className="activity-personal-state">{applicationLabels[application.status]}</Text>
        {(detail.cancelled_at || application.segments.some(t => detail.segments.find(s => s.segment_id === t.segment_id)?.cancelled_at)) && <Text className="caption">含已取消安排；这里保留原申请记录，不代表取消部分仍可参加。</Text>}
      </View>)}
      {detail.viewer.applications.some(a => a.status === 'pending') && <Text className="caption">申请待发起人批准，当前还不占用名额。</Text>}
    </Panel>;
}

export function ApplicationForm({ detail, state, login }: { detail: ActivityDetail; state: ApplicationsState; login: LoginActions }) {
  const { selected, setSelected, nickname, setNickname, accepted, setAccepted, validation,
    apply, anyBusy, applicationBlocked, myOccupied, myPending, available, confirmation, fresh, userId, submit } = state;
  const terminal=!!detail.cancelled_at||detail.segments.every(segment=>!!segment.cancelled_at||segment.has_started||!segment.is_join_open);
  // A closed invitation is a read-only history surface and needs neither profile verification nor native session access.
  if(terminal)return <Panel title="我想参加"><Text className="activity-muted">本次不再开放新申请，原申请与参加记录仍可在“我的参加状态”核对。</Text>{detail.segments.map(segment=><View className="activity-select-row" key={segment.segment_id}><View className="activity-select-content"><Text>{segment.name}</Text><Text className="caption">{detail.cancelled_at||segment.cancelled_at?'已取消 · 不开放加入':segment.has_started?'已开始 · 不开放加入':'报名已结束 · 不开放加入'} · {feeText(segment.fee)}</Text></View></View>)}{apply.message&&<Notice>{apply.message}</Notice>}</Panel>;
  if(!userId)return <Panel title="我想参加"><Text className="activity-muted">使用微信身份后，选择参加环节并接受安排，再提交申请。</Text><Action disabled={login.busy||anyBusy} onClick={()=>{void login.login();}}>先登录，再申请</Action></Panel>;
  return <GatheringProfileBoundary actor={userId} session={getToken()}><Panel title="我想参加">
      <Text className="activity-muted">选适合你的环节，不必全程参加。</Text>
      {state.incomingInvitationId && <Notice>本次新申请会记录当前公开邀请入口，仅说明入口来源，不证明谁实际邀请你，也不保证身份或授予席位。</Notice>}
      {state.attributionBlocked && <Notice>当前服务尚未确认支持邀请归因，请刷新来源记录或联系发起人；不会自动去掉来源提交。已保存的原申请仍可按原内容核对重试。</Notice>}
      <CheckboxGroup onChange={e => { setSelected(e.detail.value); setAccepted(''); }}>{detail.segments.map(segment => <Label key={segment.segment_id} className="choice activity-select-row"><Checkbox value={segment.segment_id} checked={selected.includes(segment.segment_id)} disabled={!fresh || anyBusy || applicationBlocked || !userId || (!available(segment.segment_id) && !selected.includes(segment.segment_id))} /><View className="activity-select-content"><Text>{segment.name}</Text><Text className="caption">{detail.cancelled_at || segment.cancelled_at ? '已取消 · 不开放加入' : myOccupied.has(segment.segment_id) ? '已有席位' : myPending.has(segment.segment_id) ? '申请待处理' : available(segment.segment_id) ? '可以申请' : '暂不可加入'} · {feeText(segment.fee)}</Text></View></Label>)}</CheckboxGroup>
      {selected.length > 0 && <Text className="activity-selected-summary">已选 {selected.map(segmentId => detail.segments.find(s => s.segment_id === segmentId)?.name ?? '已变更环节').join(' ＋ ')}</Text>}
      <Field label="活动昵称（选填）" value={nickname} onChange={setNickname} disabled={anyBusy || applicationBlocked} placeholder="朋友们怎么称呼你" />
      <CheckboxGroup onChange={e => setAccepted(e.detail.value.includes('accept') ? confirmation : '')}><Label className="choice activity-consent"><Checkbox value="accept" checked={selected.length > 0 && accepted === confirmation} disabled={!fresh || !selected.length || anyBusy || applicationBlocked || !userId} /><Text>我已查看并接受所选环节的当前安排及参考费用</Text></Label></CheckboxGroup>
      {validation && <Notice>{validation}</Notice>}{apply.message && <Notice>{apply.message}</Notice>}
      <Action variant="primary" disabled={!fresh || !userId || anyBusy || applicationBlocked || state.attributionBlocked || !selected.length || accepted !== confirmation} onClick={submit}>{apply.busy ? '正在提交…' : '申请参加所选环节'}</Action>
      {apply.pending && <View><Notice>上次申请结果尚未确认，请先刷新核对。重试会保留原来的选择，不会重复提交一份新申请。</Notice><Action disabled={anyBusy || !fresh || !userId} onClick={() => { void apply.send(); }}>核对后重试原申请</Action></View>}
      {!userId && <Action disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>先登录，再申请</Action>}
    </Panel></GatheringProfileBoundary>;
}

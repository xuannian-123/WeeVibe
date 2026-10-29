import { useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import type { useLogin } from '../../platform/page-state';
import { getToken } from '../../platform/api';
import { BRAND_NAME } from '../../brand';
import { Action, Notice, Panel } from '../../components/ui';
import { ApplicationForm, MyParticipationPanel } from '../applications/panels';
import type { ApplicationsState } from '../applications/use-applications';
import { Itinerary } from '../activity-detail/itinerary';
import { RosterPanel } from '../roster/RosterPanel';
import { formatTime } from '../../platform/activities';
import { AnimalPreview } from './AnimalPreview';
import { useInvitationSource } from './use-invitation-source';
import './invitation-overview.css';

type Props = {
  detail: ActivityDetail; session?: string; incomingInvitationId?: string;
  state: ApplicationsState; login: Pick<ReturnType<typeof useLogin>, 'busy' | 'login'>;
  fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>;
};
export function InvitationOverview({ detail, session, incomingInvitationId, state, login, fresh, anyBusy, refresh }: Props) {
  const sourceId = state.incomingInvitationId ?? incomingInvitationId;
  const source = useInvitationSource(detail.activity_id, sourceId, session, fresh);
  const [notice, setNotice] = useState('');
  const [suggestionHelp, setSuggestionHelp] = useState(false);
  const sourceReady = sourceId === undefined || !!source.data && !source.data.cancelled;
  const sameSession = getToken() === session;
  const canWrite = fresh && sameSession && sourceReady && !anyBusy && !login.busy;
  const latest = useRef({ canWrite, id: detail.activity_id, session }); latest.current = { canWrite, id: detail.activity_id, session };
  const current = () => source.isCurrent() && latest.current.id === detail.activity_id && latest.current.session === session && getToken() === session;
  const formState: ApplicationsState = { ...state, fresh: state.fresh && sourceReady && sameSession,
    submit: () => { if (current() && latest.current.canWrite) state.submit(); },
    apply: { ...state.apply, send: async (...args: Parameters<typeof state.apply.send>) => { if (current() && latest.current.canWrite) await state.apply.send(...args); } }
  };
  const main = detail.segments.find(segment => segment.segment_id === detail.main_segment_id);
  const mayReadRoster = !!detail.viewer.user_id && sameSession && !detail.cancelled_at && (detail.viewer.is_manager || detail.viewer.participations.some(p => p.status !== 'exited' && detail.segments.some(s => s.segment_id === p.segment_id && !s.cancelled_at)));
  const terminal = !!detail.cancelled_at || !!source.data?.cancelled || detail.segments.every(segment => !!segment.cancelled_at || segment.has_started || !segment.is_join_open);
  const ownPending = detail.viewer.applications.some(application => application.status === 'pending' && application.segments.some(target => detail.segments.some(segment => segment.segment_id === target.segment_id && !segment.cancelled_at)));
  const ownJoined = detail.viewer.participations.some(participation => participation.status !== 'exited' && detail.segments.some(segment => segment.segment_id === participation.segment_id && !segment.cancelled_at));
  const showStatus = terminal || ownPending || ownJoined;
  const savedNickname = [...detail.viewer.applications].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).find(application => !!application.display_name)?.display_name;
  async function jumpToApplication() {
    if (!current() || anyBusy || login.busy) return;
    if (!detail.viewer.user_id && !terminal) { await login.login(); return; }
    const ticket = source.generation();
    try { await Taro.pageScrollTo({ selector: showStatus ? '#invitation-my-status' : '#invitation-application', duration: 250 }); }
    catch { if (current() && ticket === source.generation()) setNotice('暂时无法定位报名区域，请向下滑动查看；没有提交报名。'); }
  }
  async function openSuggestions() {
    if (!current() || anyBusy || login.busy || !fresh) return;
    const ticket = source.generation();
    try { await Taro.navigateTo({ url: `/pages/requirements/index?activity_id=${encodeURIComponent(detail.activity_id)}` }); }
    catch { if (current() && ticket === source.generation()) setNotice('需求页面暂时无法打开，请重试；没有提交建议或报名。'); }
  }
  return <View className="invitation-v1">
    <View className="iv-hero">
      <View className="iv-top"><Text className="iv-brand">{BRAND_NAME}</Text><Text className="iv-pill">{detail.cancelled_at ? '活动已取消' : source.data?.cancelled ? '邀请对应活动已取消' : source.data ? '邀请来源已核验' : sourceId === undefined ? '公开活动入口' : '邀请来源待核验'}</Text></View>
      <Text className="iv-title">{detail.name}</Text>
      <Text className="iv-muted">{detail.cancelled_at ? '保留历史安排，不再开放新申请。' : detail.formation_status === 'confirmed' ? '主环节已成局，是否可加入仍以各环节状态为准。' : '邀请你一起参加 · 申请获批后才占用名额'}</Text>
      <View className="iv-summary"><View><Text className="iv-summary-number">{detail.cancelled_at ? detail.segments.length : detail.segments.filter(segment => !segment.cancelled_at).length}</Text><Text className="iv-summary-label">{detail.cancelled_at ? '原定环节' : '个活动环节'}</Text></View><View><Text className="iv-summary-number">{main?.counts.occupied_count ?? '—'}</Text><Text className="iv-summary-label">{detail.cancelled_at || main?.cancelled_at ? '主环节历史占位' : '主环节当前占位'}</Text></View><View><Text className="iv-summary-status">{detail.cancelled_at ? '已取消' : ownPending ? '待审批' : ownJoined ? '已有席位' : terminal ? '报名结束' : '等你加入'}</Text><Text className="iv-summary-label">{detail.viewer.is_manager ? '当前组织者视角' : detail.viewer.user_id ? '我的活动状态' : '登录后申请'}</Text></View></View>
      {main && <Text className="iv-main-teaser">{detail.cancelled_at || main.cancelled_at ? '原主环节' : '主环节'} · {main.name}　{formatTime(main.starts_at)}</Text>}
      <Action variant="primary" disabled={anyBusy || login.busy || !fresh} onClick={() => { void jumpToApplication(); }}>{showStatus ? '查看本人报名状态' : detail.viewer.user_id ? '选择参加环节' : '登录并选择参加环节'}</Action>
      <Action variant="text" disabled={anyBusy || login.busy} onClick={() => { void refresh(); }}>刷新安排</Action>
      <View className="iv-people"><Text className="iv-label">发起人</Text><Text>公开资料暂未提供</Text>{detail.viewer.is_manager && <Text className="iv-muted">你是当前管理者；管理身份不等同于原发起人。</Text>}
        <Text className="iv-label">邀请分享者</Text>
        {sourceId === undefined ? <Text className="iv-muted">此入口未提供可核验的分享来源。</Text> : source.loading ? <Text className="iv-muted">正在核验邀请来源…</Text> : source.data ? <Text>{source.data.inviter_display_name || '未提供公开昵称'}<Text className="iv-muted"> · 分享者不一定是发起人</Text></Text> : <Notice tone="error">{source.error || '暂时无法核验来源，尚不能通过此入口申请。'}</Notice>}
        {sourceId !== undefined && !source.data && <Action disabled={source.loading || !fresh || anyBusy} onClick={source.retry}>重新核验邀请来源</Action>}
      </View>
    </View>
    {notice && <Notice tone="error">{notice}</Notice>}
    {source.data?.cancelled && <Notice>邀请对应活动已取消，请刷新核对。仅保留历史，不授予席位。</Notice>}
    <View className="iv-section"><Itinerary detail={detail}/>{detail.segments.length === 0 && <Notice>暂未取得可展示的行程，请刷新重试；当前不开放申请。</Notice>}</View>
    <Panel title="谁会一起参加">
      {main && <Text className="iv-count">主环节{detail.cancelled_at || main.cancelled_at ? '历史记录' : '当前'}：占位 {main.counts.occupied_count} 人 · 已接受 {main.counts.accepted_count} 人 · 待重新接受 {main.counts.pending_acceptance_count} 人</Text>}
      <Text className="iv-muted">同一人可能参加多个环节，分段人数不相加当作活动总人数。</Text>
      {mayReadRoster ? <RosterPanel key={`${detail.activity_id}:${session}`} detail={detail} session={session} fresh={fresh && !anyBusy} refresh={refresh}/> : <Text className="iv-muted">仅当前有权限的组织者和已加入成员可查看名单；游客、待审批或已退出成员仅查看人数。</Text>}
    </Panel>
    <Panel title="我有个好主意" className="iv-suggestions">
      <Text className="iv-muted">想换个时间、地点或玩法？保存需求不会自动报名，也不会修改正式活动。</Text>
      <View className="iv-suggestion-tags"><Text>时间</Text><Text>地点</Text><Text>活动内容</Text></View>
      <Action disabled={!fresh || anyBusy || login.busy} onClick={() => { void openSuggestions(); }}>填写需求与建议</Action>
      <Action variant="text" onClick={() => setSuggestionHelp(value => !value)}>{suggestionHelp ? '收起建议可见范围' : '哪些建议能被组织者看到？'}</Action>
      {suggestionHelp && <View>
      <View className="iv-suggestion"><Text className="iv-label">时间建议</Text><Text>填写“方便的时间”，组织者可按现有权限查看。</Text></View>
      <View className="iv-suggestion"><Text className="iv-label">地点建议</Text><Text>候选地点按投票汇总；自行输入的地点原文仅本人可见。</Text></View>
      <View className="iv-suggestion"><Text className="iv-label">活动内容建议</Text><Text>可选择已有问题选项与兴趣标签；自由内容暂不作为可送达组织者的建议。</Text></View>
      <View className="iv-suggestion"><Text className="iv-label">额外说明</Text><Text>现有私人备注仅本人可见，暂未开放组织者私密留言。</Text></View>
      </View>}
    </Panel>
    <View id="invitation-application"><Text className="iv-section-title">选择参加环节</Text>
      <Text className="iv-muted">活动昵称只用于本次申请，不会修改账号昵称。正式参加仍需接受当前安排和参考费用，并等待组织者审批。</Text>
      {sourceId !== undefined && !sourceReady && <Notice>邀请来源尚不可用，先核验并刷新后再申请；原待核对请求不会丢弃。</Notice>}
      <ApplicationForm detail={detail} state={formState} login={login}/>
      {!!detail.viewer.user_id && sameSession && !terminal && <AnimalPreview key={`${detail.activity_id}:${detail.viewer.user_id}:${session}`} session={session} disabled={!canWrite}/>}
      <View className="iv-private"><Text className="iv-label">联系方式由你掌握</Text><Text className="iv-muted">正式活动尚无受权限保护的联系方式保存接口，本页不会收集微信号、手机号或其他联系方式。</Text></View>
    </View>
    <View id="invitation-my-status">{!detail.cancelled_at && ownPending && <Text className="iv-status-note">申请待审批 · 尚未占位</Text>}{!!detail.viewer.user_id && sameSession && savedNickname && <Text className="iv-saved-name">报名记录昵称：{savedNickname}</Text>}<MyParticipationPanel detail={detail} state={formState}/></View>
  </View>;
}

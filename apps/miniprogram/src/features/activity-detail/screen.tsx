import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { BRAND_NAME } from '../../brand';
import { Action, Notice, Panel } from '../../components/ui';
import { ApprovalPanel, MyParticipationPanel, ApplicationForm } from '../applications/panels';
import { AttributionPanel } from '../application-attribution/AttributionPanel';
import { InvitationPanel } from '../invitations';
import { InvitationTemplatePanel } from '../invitation-template/InvitationTemplatePanel';
import { ActivityShareCard } from '../share-card/ActivityShareCard';
import { useActivityDetail } from './use-activity-detail';
import { RosterPanel } from '../roster/RosterPanel';
import { ActivityOverview } from '../activity-entry/ActivityOverview';
import { useInvitationSource } from '../activity-entry/use-invitation-source';
import { ActivityMore } from './more';
import { ParticipationActions } from '../participation/ParticipationActions';
import { FormationPanel } from '../formation/FormationPanel';
import { formationProgress } from '../formation/progress';
import { ArrangementEditor } from '../arrangement-change/ArrangementEditor';
import { ArrangementPanel } from '../arrangement-change/ArrangementPanel';
import { WithdrawalPanel } from '../applications/WithdrawalPanel';
import { CancellationPanel } from '../cancellation/CancellationPanel';
import { HandoverPanel } from '../handover/HandoverPanel';
import { RebookPanel } from '../rebook/RebookPanel';
import { CapacityPanel } from '../capacity/CapacityPanel';
import { DeadlinePanel } from '../deadline/DeadlinePanel';
import { BookingPanel } from '../booking/BookingPanel';
import { MainSegmentPanel } from '../main-segment/MainSegmentPanel';
import './activity.css';
import '../../design-c.css';

const sectionTitles:Record<string,string>={overview:'这次，一起出发',apply:'选好你能参加的部分',approval:'看看谁想一起参加',participation:'我的参加，我来安排',withdrawal:'撤回这份申请？',formation:'条件齐了，再确认出发',arrangement:'看清变化，再接受',roster:'和你同行的人',edit:'把变化，说清楚',handover:'下一位，由你指定',booking:'核实与预订，分开记录',cancel:'取消后，也保留记录',main:'换一个主要环节',capacity:'人数设置',deadline:'报名截止',invitation:'分享给朋友',rebook:'再约一次',attribution:'邀请来源'};
function normalizeSection(value:unknown){const next=value==='applications'?'approval':value==='activity'?'overview':String(value||'overview');return Object.prototype.hasOwnProperty.call(sectionTitles,next)?next:'overview';}

export default function ActivityDetailScreen() {
  const { id, incomingInvitationId, outgoingInvitationId, setOutgoingInvitationId, detail, userId, read, login, applications, attributions, showMore, setShowMore } = useActivityDetail();
  const initialSection=Taro.getCurrentInstance?.().router?.params.section;
  const sourceId = applications.incomingInvitationId ?? incomingInvitationId;
  const source = useInvitationSource(id, sourceId, read.data?.session, !!detail && !read.error && !read.loading && !login.busy);
  const sourceReady = sourceId === undefined || !!source.data && !source.data.cancelled;
  const [actionsExpanded,setActionsExpanded]=useState(false);
  const [section,setSection]=useState(()=>normalizeSection(initialSection));

  const acknowledgedApplication=useRef<unknown>();
  useEffect(()=>{
    const result=applications.apply.result;
    if(!result||result===acknowledgedApplication.current)return;
    if(!detail||!userId||result.activity_id!==id||result.viewer.user_id!==userId)return;
    acknowledgedApplication.current=result;
    if(section==='apply')setSection('participation');
  },[applications.apply.result,detail,id,userId,section]);
  const [editBusy, setEditBusy] = useState(false);
  const [participationBusy, setParticipationBusy] = useState(false);
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [formationBusy, setFormationBusy] = useState(false);
  const [arrangementBusy, setArrangementBusy] = useState(false);
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [handoverBusy, setHandoverBusy] = useState(false);
  const [rebookBusy, setRebookBusy] = useState(false);
  const [mainSegmentBusy, setMainSegmentBusy] = useState(false);
  const [capacityBusy, setCapacityBusy] = useState(false);
  const [deadlineBusy, setDeadlineBusy] = useState(false);
  const [bookingBusy, setBookingBusy] = useState(false);
  const messageSection=Taro.getCurrentInstance?.().router?.params.section;
  useEffect(()=>{if(!detail||!['applications','arrangement','handover','activity'].includes(String(messageSection)))return;setSection(normalizeSection(messageSection));const timer=setTimeout(()=>{try{void Taro.pageScrollTo?.({selector:`#activity-${messageSection}`,duration:250})?.catch(()=>{});}catch{}},250);return()=>clearTimeout(timer);},[detail?.activity_id,messageSection]);
  const editorPeerBusy = applications.anyBusy || participationBusy || invitationBusy || formationBusy || arrangementBusy || withdrawalBusy || cancellationBusy || handoverBusy || rebookBusy || mainSegmentBusy || capacityBusy || deadlineBusy || bookingBusy;
  const anyBusy = editBusy || editorPeerBusy;
  const otherWriteBusy = editBusy || participationBusy || invitationBusy || formationBusy || arrangementBusy || withdrawalBusy || cancellationBusy || handoverBusy || rebookBusy || mainSegmentBusy || capacityBusy || deadlineBusy || bookingBusy;
  const applicationState = { ...applications, anyBusy, fresh: applications.fresh && !otherWriteBusy,
    submit: () => { if (!otherWriteBusy && sourceReady && source.isCurrent()) applications.submit(); },
    decide: (...args: Parameters<typeof applications.decide>) => { if (!otherWriteBusy) applications.decide(...args); },
    apply: { ...applications.apply, send: async (...args: Parameters<typeof applications.apply.send>) => { if (!otherWriteBusy && sourceReady && source.isCurrent()) await applications.apply.send(...args); } },
    decision: { ...applications.decision, send: async (...args: Parameters<typeof applications.decision.send>) => { if (!otherWriteBusy) await applications.decision.send(...args); } }
  };
  if (!id) return <View id="activity-activity" className="screen activity-page"><Panel title="没有找到这个活动"><Notice>活动入口不完整，请向朋友重新获取邀请。</Notice><Action onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action></Panel></View>;
  return <View id="activity-activity" className={`screen activity-page ${section==='overview'?'activity-invitation-page':''}`}>
    {section!=='overview' && <View className="activity-hero">
      <Text className="activity-eyebrow">{BRAND_NAME} · 一起出发</Text>
      <Text className="activity-title">{detail?sectionTitles[section]||detail.name:'正在读取安排'}</Text>
      {detail && <View className="activity-badges">
        <Text className={`activity-badge ${detail.cancelled_at ? 'activity-badge-muted' : ''}`}>{formationProgress(detail).label}</Text>
        <Text className="activity-role">{detail.viewer.is_manager ? '你在管理此活动' : userId ? '我的活动' : '朋友的邀请'} · {detail.segments.length}个环节</Text>
      </View>}
      <View className="activity-toolbar">
        <Action variant="text" disabled={anyBusy || read.loading} onClick={() => { void read.refresh(); }}>{read.loading ? '更新中…' : '刷新安排'}</Action>
        {!userId && <Action variant="primary" disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>{login.busy ? '登录中…' : '微信登录'}</Action>}
      </View>
    </View>}
    {detail&&section!=='overview'&&<Text className="caption">{detail.name}</Text>}
    {detail&&section!=='overview'&&<Action disabled={anyBusy} onClick={()=>setSection('overview')}>返回活动</Action>}
    {detail && section==='overview' && <ActivityOverview key={`overview:${id}:${userId ?? 'guest'}`} suggest={() => { if(!anyBusy) void Taro.navigateTo({url:`/pages/requirements/index?activity_id=${detail.activity_id}`}).catch(() => { void Taro.showToast?.({title:'暂时无法打开，请重试',icon:'none'}); }); }} detail={detail} sourceId={sourceId} source={source.data} sourceLoading={source.loading} sourceError={source.error} busy={anyBusy || login.busy || read.loading || !!read.error} retrySource={source.retry} refresh={() => { void read.refresh(); }} open={next => { if (!anyBusy && !login.busy) setSection(next); }} />}
    {!detail && !read.loading && <Text className="activity-title">活动邀请</Text>}
    {read.loading && !detail && <Notice>正在加载活动安排…</Notice>}
    {read.error && <Notice>{read.error} 当前内容可能已过时，请刷新后再操作。</Notice>}
    {!detail && !read.loading && !read.error && <Notice>暂时没有取得活动信息，请刷新重试。</Notice>}
    {login.error && <Notice>{login.error}</Notice>}

    <View hidden={section!=='formation'} style={{display:section==='formation'?'':'none'}}>{detail && <FormationPanel key={`formation:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setFormationBusy} />}</View>

    <View hidden={section!=='arrangement'} style={{display:section==='arrangement'?'':'none'}}>{detail && <View id="activity-arrangement"><ArrangementPanel key={`arrangement:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setArrangementBusy} /></View>}</View>

    <View hidden={section!=='attribution'} style={{display:section==='attribution'?'':'none'}}>{detail && attributions && <AttributionPanel detail={detail} state={attributions} />}</View>

    <View hidden={section!=='approval'} style={{display:section==='approval'?'':'none'}}>{detail && <View id="activity-applications"><ApprovalPanel detail={detail} state={applicationState} /></View>}</View>

    <View hidden={section!=='participation'} style={{display:section==='participation'?'':'none'}}>{detail && <MyParticipationPanel detail={detail} state={applicationState} />}</View>

    <View hidden={section!=='withdrawal'} style={{display:section==='withdrawal'?'':'none'}}>{detail && <WithdrawalPanel key={`withdrawal:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setWithdrawalBusy} />}</View>

    {detail&&section==='overview'&&<View className="core-flow-menu">{[['apply','选择参加环节'],['participation','管理我的参加'],['arrangement','查看变化并决定'],['roster','查看成员名单'],['withdrawal','撤回申请'],['invitation','分享邀请'],...(detail.viewer.is_manager?[['approval','处理参加申请'],['formation','核实与确认成局'],['edit','修改活动安排'],['handover','管理交接'],['booking','核实与预订'],['main','更换主要环节'],['capacity','调整人数'],['deadline','调整截止'],['cancel','取消活动']]:[]),['rebook','再约一次']].filter(()=>actionsExpanded).map(([to,label])=><Action key={to} disabled={anyBusy} onClick={()=>setSection(to)}>{label}</Action>)}</View>}
    {detail&&section==='overview'&&<Action variant="text" disabled={anyBusy} onClick={()=>setActionsExpanded(v=>!v)}>{actionsExpanded?'收起更多操作':'更多活动操作'}</Action>}

    <View hidden={section!=='roster'} style={{display:section==='roster'?'':'none'}}>{detail && <RosterPanel key={`roster:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !anyBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} refresh={read.refresh} />}</View>

    <View hidden={section!=='participation'} style={{display:section==='participation'?'':'none'}}>{detail && <ParticipationActions key={`${detail.activity_id}:${userId ?? "guest"}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} refresh={read.refresh} onBusyChange={setParticipationBusy} />}</View>

    {detail && section==='apply' && sourceId !== undefined && !sourceReady && <Notice>{source.loading ? '正在核验邀请来源…' : source.error || '邀请来源未通过核验，请返回活动重新核验。'}</Notice>}
    <View hidden={section!=='apply'} style={{display:section==='apply'?'':'none'}}>{detail && <ApplicationForm detail={detail} state={{...applicationState, fresh: applicationState.fresh && sourceReady}} login={login} />}</View>

    <View hidden={section!=='invitation'} style={{display:section==='invitation'?'':'none'}}>{detail && <InvitationPanel key={`invitation:${id}:${userId ?? "guest"}`} id={id} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} incomingId={incomingInvitationId} outgoingId={outgoingInvitationId} onSourceCreated={setOutgoingInvitationId} anyBusy={anyBusy || login.busy} onBusyChange={setInvitationBusy} />}</View>

    <View hidden={section!=='invitation'} style={{display:section==='invitation'?'':'none'}}>{detail && <InvitationTemplatePanel key={`invitation-template:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !login.busy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} verifiedOutgoingInvitationId={outgoingInvitationId} />}</View>

    <View hidden={section!=='invitation'} style={{display:section==='invitation'?'':'none'}}>{detail && <ActivityShareCard key={`share-card:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !login.busy} anyBusy={anyBusy || login.busy} verifiedOutgoingInvitationId={outgoingInvitationId} />}</View>

    <View hidden={section!=='cancel'} style={{display:section==='cancel'?'':'none'}}>{detail && <CancellationPanel key={`cancellation:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setCancellationBusy} />}</View>

    <View hidden={section!=='handover'} style={{display:section==='handover'?'':'none'}}>{detail && <View id="activity-handover"><HandoverPanel key={`handover:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setHandoverBusy} /></View>}</View>

    <View hidden={section!=='rebook'} style={{display:section==='rebook'?'':'none'}}>{detail && <RebookPanel key={`rebook:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} onBusyChange={setRebookBusy} />}</View>

    <View hidden={section!=='main'} style={{display:section==='main'?'':'none'}}>{detail && <MainSegmentPanel key={`main:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setMainSegmentBusy} />}</View>

    <View hidden={section!=='capacity'} style={{display:section==='capacity'?'':'none'}}>{detail && <CapacityPanel key={`capacity:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setCapacityBusy} />}</View>

    <View hidden={section!=='deadline'} style={{display:section==='deadline'?'':'none'}}>{detail && <DeadlinePanel key={`deadline:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !capacityBusy && !login.busy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setDeadlineBusy} />}</View>

    <View hidden={section!=='booking'} style={{display:section==='booking'?'':'none'}}>{detail && <BookingPanel key={`booking:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!editBusy && !read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !capacityBusy && !deadlineBusy && !login.busy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setBookingBusy} />}</View>

    <View hidden={section!=='edit'} style={{display:section==='edit'?'':'none'}}>{detail && <ArrangementEditor key={`edit:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !capacityBusy && !deadlineBusy && !bookingBusy && !login.busy} anyBusy={editorPeerBusy || login.busy} refresh={read.refresh} onBusyChange={setEditBusy} />}</View>

    <View hidden={section!=='overview'} style={{display:section==='overview'?'':'none'}}>{detail && <ActivityMore detail={detail} showMore={showMore} setShowMore={setShowMore} login={login} anyBusy={anyBusy} />}</View>
    <Action variant="text" disabled={anyBusy} onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action>
  </View>;
}

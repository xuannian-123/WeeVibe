import Taro from '@tarojs/taro';
import { useState } from 'react';
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
import { Itinerary } from './itinerary';
import { ActivityMore } from './more';
import { ParticipationActions } from '../participation/ParticipationActions';
import { FormationPanel } from '../formation/FormationPanel';
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

export default function ActivityDetailScreen() {
  const { id, incomingInvitationId, outgoingInvitationId, setOutgoingInvitationId, detail, userId, read, login, applications, attributions, showMore, setShowMore } = useActivityDetail();
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
  const anyBusy = applications.anyBusy || participationBusy || invitationBusy || formationBusy || arrangementBusy || withdrawalBusy || cancellationBusy || handoverBusy || rebookBusy || mainSegmentBusy || capacityBusy || deadlineBusy || bookingBusy;
  const otherWriteBusy = participationBusy || invitationBusy || formationBusy || arrangementBusy || withdrawalBusy || cancellationBusy || handoverBusy || rebookBusy || mainSegmentBusy || capacityBusy || deadlineBusy || bookingBusy;
  const applicationState = { ...applications, anyBusy, fresh: applications.fresh && !otherWriteBusy,
    submit: () => { if (!otherWriteBusy) applications.submit(); },
    decide: (...args: Parameters<typeof applications.decide>) => { if (!otherWriteBusy) applications.decide(...args); },
    apply: { ...applications.apply, send: async (...args: Parameters<typeof applications.apply.send>) => { if (!otherWriteBusy) await applications.apply.send(...args); } },
    decision: { ...applications.decision, send: async (...args: Parameters<typeof applications.decision.send>) => { if (!otherWriteBusy) await applications.decision.send(...args); } }
  };
  if (!id) return <View className="screen activity-page"><Panel title="没有找到这个活动"><Notice>活动入口不完整，请向朋友重新获取邀请。</Notice><Action onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action></Panel></View>;
  return <View className="screen activity-page">
    <View className="activity-hero">
      <Text className="activity-eyebrow">{BRAND_NAME} · 一起出发</Text>
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

    {detail && <FormationPanel key={`formation:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setFormationBusy} />}

    {detail && <ArrangementPanel key={`arrangement:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setArrangementBusy} />}

    {detail && attributions && <AttributionPanel detail={detail} state={attributions} />}

    {detail && <ApprovalPanel detail={detail} state={applicationState} />}

    {detail && <MyParticipationPanel detail={detail} state={applicationState} />}

    {detail && <WithdrawalPanel key={`withdrawal:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setWithdrawalBusy} />}

    {detail && <Itinerary detail={detail} />}

    {detail && <RosterPanel key={`roster:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !anyBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} refresh={read.refresh} />}

    {detail && <Action onClick={() => { void Taro.navigateTo({ url: `/pages/requirements/index?activity_id=${detail.activity_id}` }); }}>填写／管理需求</Action>}
    {detail && <Text className="caption">填写需求不等于报名获席位，原申请审批流程保留。</Text>}
    {detail && <ParticipationActions key={`${detail.activity_id}:${userId ?? "guest"}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} refresh={read.refresh} onBusyChange={setParticipationBusy} />}

    {detail && <ApplicationForm detail={detail} state={applicationState} login={login} />}

    {detail && <InvitationPanel key={`invitation:${id}:${userId ?? "guest"}`} id={id} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} incomingId={incomingInvitationId} outgoingId={outgoingInvitationId} onSourceCreated={setOutgoingInvitationId} anyBusy={anyBusy || login.busy} onBusyChange={setInvitationBusy} />}

    {detail && <InvitationTemplatePanel key={`invitation-template:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !login.busy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} verifiedOutgoingInvitationId={outgoingInvitationId} />}

    {detail && <ActivityShareCard key={`share-card:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !login.busy} anyBusy={anyBusy || login.busy} verifiedOutgoingInvitationId={outgoingInvitationId} />}

    {detail && <CancellationPanel key={`cancellation:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setCancellationBusy} />}

    {detail && <HandoverPanel key={`handover:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setHandoverBusy} />}

    {detail && <RebookPanel key={`rebook:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !mainSegmentBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} onBusyChange={setRebookBusy} />}

    {detail && <MainSegmentPanel key={`main:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !login.busy && !capacityBusy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setMainSegmentBusy} />}

    {detail && <CapacityPanel key={`capacity:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !login.busy && !deadlineBusy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setCapacityBusy} />}

    {detail && <DeadlinePanel key={`deadline:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !capacityBusy && !login.busy && !bookingBusy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setDeadlineBusy} />}

    {detail && <BookingPanel key={`booking:${id}:${userId ?? 'guest'}`} detail={detail} session={read.data?.session} fresh={!read.error && !read.loading && !applications.anyBusy && !participationBusy && !invitationBusy && !formationBusy && !arrangementBusy && !withdrawalBusy && !cancellationBusy && !handoverBusy && !rebookBusy && !mainSegmentBusy && !capacityBusy && !deadlineBusy && !login.busy} anyBusy={anyBusy || login.busy} refresh={read.refresh} onBusyChange={setBookingBusy} />}

    {detail && <ActivityMore detail={detail} showMore={showMore} setShowMore={setShowMore} login={login} anyBusy={anyBusy} />}
    <Action variant="text" disabled={anyBusy} onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action>
  </View>;
}

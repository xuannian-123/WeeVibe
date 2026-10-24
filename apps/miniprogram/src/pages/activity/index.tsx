import { useEffect, useState } from 'react';
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro';
import { Button, Checkbox, CheckboxGroup, Label, Text, View } from '@tarojs/components';
import { activityIdSchema, applyToActivityInputSchema, decideApplicationInputSchema, type DecideApplicationInput } from '@weego/contracts';
import { api } from '../../platform/api';
import { newKey, useLogin, usePageRead } from '../../platform/page-state';
import { feeText, formatTime, rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';
import { Action, Field, Notice, Panel } from '../../components/ui';
import './activity.css';

type DecisionEnvelope = { applicationId: string; input: DecideApplicationInput };
function parseDecision(raw: unknown): DecisionEnvelope {
  if (!raw || typeof raw !== 'object') throw new Error('无法恢复原审批请求');
  const value = raw as { applicationId?: unknown; input?: unknown };
  return { applicationId: activityIdSchema.parse(value.applicationId), input: decideApplicationInputSchema.parse(value.input) };
}
const applicationLabels = { pending: '等待批准', approved: '已批准', rejected: '未通过', withdrawn: '已撤回' };

export default function Activity() {
  const params = useRouter().params; const parsedId = activityIdSchema.safeParse(params.id);
  const id = parsedId.success ? parsedId.data : '';
  const [selected, setSelected] = useState<string[]>([]); const [nickname, setNickname] = useState('');
  const [accepted, setAccepted] = useState(''); const [validation, setValidation] = useState('');
  const [showMore, setShowMore] = useState(false);
  const read = usePageRead(async () => { const detail = await api.getActivity(id); rememberActivity(detail.viewer.user_id, detail); return detail; }, !!id);
  const login = useLogin(read.refresh); const detail = read.data?.activity_id === id ? read.data : undefined; const userId = detail?.viewer.user_id ?? undefined;
  const apply = useStoredWrite({ storageKey: `weego-apply-pending-v1:${id}:${userId ?? 'guest'}`, userId,
    parse: raw => applyToActivityInputSchema.parse(raw), execute: input => api.applyToActivity(id, input),
    committed: next => { rememberActivity(userId ?? null, next); void read.refresh(); }
  });
  const decision = useStoredWrite({ storageKey: `weego-decision-pending-v1:${id}:${userId ?? 'guest'}`, userId,
    parse: parseDecision, execute: operation => api.decideApplication(id, operation.applicationId, operation.input),
    committed: next => { rememberActivity(userId ?? null, next); void read.refresh(); }
  });
  useEffect(() => { if (apply.result) { setSelected([]); setAccepted(''); } }, [apply.result]);
  const anyBusy = apply.busy || decision.busy;
  const applicationBlocked = apply.blocked || !!apply.pending;
  const decisionBlocked = decision.blocked || !!decision.pending;
  const myOccupied = new Set(detail?.viewer.participations.filter(p => p.status !== 'exited').map(p => p.segment_id));
  const myPending = new Set(detail?.viewer.applications.filter(a => a.status === 'pending').flatMap(a => a.segments.map(s => s.segment_id)));
  const available = (segmentId: string) => {
    const segment = detail?.segments.find(s => s.segment_id === segmentId);
    return !!segment && segment.is_join_open && segment.counts.remaining_capacity > 0 && !myOccupied.has(segmentId) && !myPending.has(segmentId);
  };
  const confirmation = detail ? JSON.stringify({ revision: detail.revision, segments: selected.map(segmentId => ({ segmentId, version: detail.segments.find(s => s.segment_id === segmentId)?.plan_revision })).sort((a, b) => a.segmentId.localeCompare(b.segmentId)) }) : '';
  const fresh = !!detail && !read.error && !read.loading;
  useShareAppMessage(() => ({ title: detail?.name ?? 'Weego 活动', path: id ? `/pages/activity/index?id=${encodeURIComponent(id)}` : '/pages/index/index' }));
  function submit() {
    if (!fresh || !userId || anyBusy || applicationBlocked || selected.length === 0 || accepted !== confirmation) return;
    if (selected.some(segmentId => !available(segmentId))) { setValidation('所选环节已有变化，请重新核对；我们会保留你的选择，不会自动删减。'); return; }
    const result = applyToActivityInputSchema.safeParse({ idempotency_key: newKey(), expected_revision: detail!.revision,
      segments: selected.map(segmentId => ({ segment_id: segmentId, plan_revision: detail!.segments.find(s => s.segment_id === segmentId)!.plan_revision })),
      ...(nickname.trim() ? { display_name: nickname.trim() } : {}) });
    if (!result.success) { setValidation('请核对昵称和所选环节后再提交。'); return; }
    setValidation(''); setAccepted(''); void apply.send(result.data);
  }
  function decide(applicationId: string, choice: 'approve' | 'reject') {
    if (!fresh || !detail?.viewer.is_manager || anyBusy || decisionBlocked) return;
    void decision.send({ applicationId, input: decideApplicationInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, decision: choice }) });
  }
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

    {detail?.viewer.is_manager && <Panel title={`待处理申请 · ${detail.applications?.filter(a => a.status === 'pending').length ?? 0}`}>
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
    </Panel>}

    {detail && <Panel title="我的参加状态">
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
    </Panel>}

    {detail && <View className="activity-section-heading"><Text>这次的行程</Text><Text className="caption">时间均为北京时间</Text></View>}
    {detail?.segments.map((segment, index) => <View className="activity-itinerary" key={segment.segment_id}>
      <View className="activity-itinerary-head"><Text className="activity-step">{String(index + 1).padStart(2, '0')}</Text><Text className="activity-segment-title">{segment.name}</Text>{segment.segment_id === detail.main_segment_id && <Text className="activity-badge">主环节</Text>}</View>
      <Text className="activity-time">{formatTime(segment.starts_at)} — {formatTime(segment.ends_at)}</Text>
      <Text className="activity-place">{segment.location.name}</Text>
      {!!segment.location.address && <Text className="activity-address">{segment.location.address}</Text>}
      <View className="activity-facts"><View><Text className="activity-fact-label">参加人数</Text><Text className="activity-fact-value">{segment.counts.occupied_count} / {segment.capacity}人</Text><Text className="activity-fact-note">{segment.counts.meets_minimum ? '已达最低人数' : `至少${segment.minimum_participants}人`} · {segment.counts.is_full ? '已满员' : `余${segment.counts.remaining_capacity}位`}</Text></View><View><Text className="activity-fact-label">参考费用</Text><Text className="activity-fact-value">{feeText(segment.fee)}</Text></View></View>
      {segment.counts.pending_acceptance_count > 0 && <Text className="activity-warning">{segment.counts.pending_acceptance_count}人待接受新安排，席位保留</Text>}
      <View className="activity-segment-footer"><Text>{segment.cancelled_at ? '本环节已取消' : segment.has_started ? '已开始 · 停止加入' : segment.is_join_open ? `报名截止 ${formatTime(segment.deadline_at)}` : '已截止或暂不开放加入'}</Text><Text>{segment.verification_status === 'manual_checked' ? '人工已核实' : '地点未核实'} · {segment.booking_status === 'manual_booked' ? '人工标记已预订' : '预订未确认'}</Text></View>
      {!!segment.requirements && <Text className="activity-requirements">参加要求：{segment.requirements}</Text>}
    </View>)}

    {detail && <Panel title="我想参加">
      <Text className="activity-muted">选适合你的环节，不必全程参加。</Text>
      <CheckboxGroup onChange={e => { setSelected(e.detail.value); setAccepted(''); }}>{detail.segments.map(segment => <Label key={segment.segment_id} className="choice activity-select-row"><Checkbox value={segment.segment_id} checked={selected.includes(segment.segment_id)} disabled={!fresh || anyBusy || applicationBlocked || !userId || (!available(segment.segment_id) && !selected.includes(segment.segment_id))} /><View className="activity-select-content"><Text>{segment.name}</Text><Text className="caption">{myOccupied.has(segment.segment_id) ? '已有席位' : myPending.has(segment.segment_id) ? '申请待处理' : available(segment.segment_id) ? '可以申请' : '暂不可加入'} · {feeText(segment.fee)}</Text></View></Label>)}</CheckboxGroup>
      {selected.length > 0 && <Text className="activity-selected-summary">已选 {selected.map(segmentId => detail.segments.find(s => s.segment_id === segmentId)?.name ?? '已变更环节').join(' ＋ ')}</Text>}
      <Field label="活动昵称（选填）" value={nickname} onChange={setNickname} disabled={anyBusy || applicationBlocked} placeholder="朋友们怎么称呼你" />
      <CheckboxGroup onChange={e => setAccepted(e.detail.value.includes('accept') ? confirmation : '')}><Label className="choice activity-consent"><Checkbox value="accept" checked={selected.length > 0 && accepted === confirmation} disabled={!fresh || !selected.length || anyBusy || applicationBlocked || !userId} /><Text>我已查看并接受所选环节的当前安排及参考费用</Text></Label></CheckboxGroup>
      {validation && <Notice>{validation}</Notice>}{apply.message && <Notice>{apply.message}</Notice>}
      <Action variant="primary" disabled={!fresh || !userId || anyBusy || applicationBlocked || !selected.length || accepted !== confirmation} onClick={submit}>{apply.busy ? '正在提交…' : '申请参加所选环节'}</Action>
      {apply.pending && <View><Notice>上次申请结果尚未确认，请先刷新核对。重试会保留原来的选择，不会重复提交一份新申请。</Notice><Action disabled={anyBusy || !fresh || !userId} onClick={() => { void apply.send(); }}>核对后重试原申请</Action></View>}
      {!userId && <Action disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>先登录，再申请</Action>}
    </Panel>}

    {detail && <Panel title="约朋友一起">
      <Text className="activity-muted">分享这份行程，让朋友选择想参加的环节。</Text>
      <Button className="activity-share" openType="share" disabled={anyBusy}>分享给微信好友</Button>
      <Action variant="text" onClick={() => { void Taro.setClipboardData({ data: id }).catch(() => { void Taro.showToast({ title: '复制未完成，请重试', icon: 'none' }); }); }}>复制活动编号</Action>
      <Text className="caption">仅限已获体验资格的成员打开；分享不会赋予管理权限。</Text>
    </Panel>}

    {detail && <Panel title="活动说明">
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
    </Panel>}
    <Action variant="text" disabled={anyBusy} onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action>
  </View>;
}

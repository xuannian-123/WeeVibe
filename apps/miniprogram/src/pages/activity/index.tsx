import { useEffect, useState } from 'react';
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro';
import { Checkbox, CheckboxGroup, Label, Text, View } from '@tarojs/components';
import { activityIdSchema, applyToActivityInputSchema, decideApplicationInputSchema, type DecideApplicationInput } from '@weego/contracts';
import { api } from '../../platform/api';
import { newKey, useLogin, usePageRead } from '../../platform/page-state';
import { feeText, formatTime, rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';
import { Action, Field, Notice, Panel } from '../../components/ui';

type DecisionEnvelope = { applicationId: string; input: DecideApplicationInput };
function parseDecision(raw: unknown): DecisionEnvelope {
  if (!raw || typeof raw !== 'object') throw new Error('无法恢复原审批请求');
  const value = raw as { applicationId?: unknown; input?: unknown };
  return { applicationId: activityIdSchema.parse(value.applicationId), input: decideApplicationInputSchema.parse(value.input) };
}
const applicationLabels = { pending: '申请中（不占位）', approved: '已批准', rejected: '未通过', withdrawn: '已撤回' };

export default function Activity() {
  const params = useRouter().params; const parsedId = activityIdSchema.safeParse(params.id);
  const id = parsedId.success ? parsedId.data : '';
  const [selected, setSelected] = useState<string[]>([]); const [nickname, setNickname] = useState('');
  const [accepted, setAccepted] = useState(''); const [validation, setValidation] = useState('');
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
    if (selected.some(segmentId => !available(segmentId))) { setValidation('所选环节已有状态变化，请本人核对组合；本次不会自动减少所选环节。'); return; }
    const result = applyToActivityInputSchema.safeParse({ idempotency_key: newKey(), expected_revision: detail!.revision,
      segments: selected.map(segmentId => ({ segment_id: segmentId, plan_revision: detail!.segments.find(s => s.segment_id === segmentId)!.plan_revision })),
      ...(nickname.trim() ? { display_name: nickname.trim() } : {}) });
    if (!result.success) { setValidation('昵称或所选环节不符合共享契约，请核对。'); return; }
    setValidation(''); setAccepted(''); void apply.send(result.data);
  }
  function decide(applicationId: string, choice: 'approve' | 'reject') {
    if (!fresh || !detail?.viewer.is_manager || anyBusy || decisionBlocked) return;
    void decision.send({ applicationId, input: decideApplicationInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, decision: choice }) });
  }
  if (!id) return <View className="screen"><Panel title="活动入口无效"><Notice>缺少有效活动 ID，请核对活动路径。此处不是微信体验成员资格检查；体验版访问资格由平台另行验证。</Notice><Action onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action></Panel></View>;
  return <View className="screen">
    <Panel title={detail?.name ?? '活动详情'}>
      {read.loading && <Notice>正在读取当前安排与权限……</Notice>}
      {read.error && <Notice>{read.error} 当前保留的内容可能过时；操作已暂停，刷新后再处理。</Notice>}
      {!detail && !read.loading && !read.error && <Notice>尚未取得服务端活动，不展示本地样例。</Notice>}
      {login.error && <Notice>{login.error}</Notice>}
      <Action disabled={login.busy || anyBusy} onClick={() => { void login.login(); }}>微信登录／恢复本人状态（保留此活动目标）</Action>
      <Action disabled={anyBusy} onClick={() => { void read.refresh(); }}>核对最新活动与权限</Action>
      {detail && <View><Text>{detail.cancelled_at ? '活动已取消' : detail.formation_status === 'confirmed' ? '主环节已成局' : '主环节尚未确认成局'} · {detail.viewer.is_manager ? '当前身份有管理权限' : userId ? '本人参与／查看' : '公开行程，尚未确认本人身份'}</Text>
        <Notice>活动时区 {detail.timezone}；以下时间显示为 Asia/Shanghai。更新依据：{formatTime(detail.server_time)}，版本 {detail.revision}。达到最低或满员都不自动代表成局、预订。</Notice>
      </View>}
    </Panel>
    {detail?.segments.map(segment => {
      const mine = detail.viewer.participations.find(p => p.segment_id === segment.segment_id);
      return <Panel key={segment.segment_id} title={`${segment.segment_id === detail.main_segment_id ? '主环节 · ' : ''}${segment.name}`}>
        <View className="row"><Text>{formatTime(segment.starts_at)} 至 {formatTime(segment.ends_at)}</Text></View>
        <View className="row"><Text>报名截止：{formatTime(segment.deadline_at)}</Text></View>
        <View className="row"><Text>地点：{segment.location.name} {segment.location.address ?? ''}（填写资料，不等于核实）</Text></View>
        <View className="row"><Text>{feeText(segment.fee)}</Text></View>
        <View className="row"><Text>参加要求：{segment.requirements || '未填写额外要求'}</Text></View>
        <Notice>占用 {segment.counts.occupied_count}/{segment.capacity}，最少 {segment.minimum_participants}；新版已接受 {segment.counts.accepted_count}，待重新接受 {segment.counts.pending_acceptance_count}；空位 {segment.counts.remaining_capacity}。{segment.counts.meets_minimum ? '人数达到最低' : '人数未达最低'}，{segment.counts.is_full ? '已满员' : '未满员'}。</Notice>
        <Text>{segment.cancelled_at ? '本段已取消，历史保留' : segment.has_started ? '本段已开始，线上加入关闭' : segment.is_join_open ? '本段报名开放' : '本段已截止或当前不开放加入'}</Text>
        <View className="row"><Text>核实：{segment.verification_status === 'manual_checked' ? '人工已核实' : '尚未核实'}；预订：{segment.booking_status === 'manual_booked' ? '人工标记已预订' : '尚无预订证据'}</Text></View>
        {mine && <Notice>本人：{mine.status === 'joined' ? '已加入' : mine.status === 'awaiting_acceptance' ? '席位保留，待重新接受（此轮暂无变更接受操作）' : '已退出'}。其他成员私人身份未由此接口公开。</Notice>}
      </Panel>;
    })}
    {detail && <Panel title="选择本次新增参加环节">
      <Notice>可只选其中一段，不必参加主环节。申请不占位，须当前发起人整体批准；一次所选组合不能只批一部分。各段费用单位不同，以下逐段列明，不虚构人均合计。</Notice>
      <CheckboxGroup onChange={e => { setSelected(e.detail.value); setAccepted(''); }}>{detail.segments.map(segment =>
        <Label key={segment.segment_id} className="choice"><Checkbox value={segment.segment_id} checked={selected.includes(segment.segment_id)} disabled={!fresh || anyBusy || applicationBlocked || !userId || (!available(segment.segment_id) && !selected.includes(segment.segment_id))} />
          <Text>{segment.name} · {myOccupied.has(segment.segment_id) ? '本人已有席位' : myPending.has(segment.segment_id) ? '本人申请待处理' : available(segment.segment_id) ? '可申请' : '不可新加入'} · {feeText(segment.fee)}</Text></Label>)}</CheckboxGroup>
      {selected.length > 0 && <Notice>本次所选：{selected.map(segmentId => detail.segments.find(s => s.segment_id === segmentId)?.name ?? '已变更环节').join('、')}；若版本或所选组合变化，需重新查看并接受。</Notice>}
      <Field label="本人活动昵称（可选，仅用于展示）" value={nickname} onChange={setNickname} disabled={anyBusy || applicationBlocked} />
      <CheckboxGroup onChange={e => setAccepted(e.detail.value.includes('accept') ? confirmation : '')}><Label className="choice"><Checkbox value="accept" checked={selected.length > 0 && accepted === confirmation} disabled={!fresh || !selected.length || anyBusy || applicationBlocked || !userId} /><Text>我已查看并接受本次所选环节当前安排及参考费用</Text></Label></CheckboxGroup>
      {validation && <Notice>{validation}</Notice>}{apply.message && <Notice>{apply.message}</Notice>}
      <Action disabled={!fresh || !userId || anyBusy || applicationBlocked || !selected.length || accepted !== confirmation} onClick={submit}>接受安排并申请加入</Action>
      {apply.pending && <Action disabled={anyBusy || !fresh || !userId} onClick={() => { void apply.send(); }}>已核对，按原申请和同一幂等键重试</Action>}
      <Text className="caption">登录失败不会离开当前目标。平台体验成员资格不等于活动参加／管理权限；无体验资格须由项目统筹核对，不是申请 API 能赋予。</Text>
    </Panel>}
    {detail && <Panel title="本人申请记录">
      {detail.viewer.applications.length === 0 && <Text>{userId ? '当前没有本人申请记录' : '登录后读取本人申请记录'}</Text>}
      {detail.viewer.applications.map(application => <View className="row" key={application.application_id}><Text>{applicationLabels[application.status]}：{application.segments.map(s => detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节').join('、')}</Text></View>)}
      <Text className="caption">此轮仅实现创建、申请、审批／拒绝。退出、撤回、变更接受、成局及交接将在后续对应功能接入，不放置无效成功按钮。</Text>
    </Panel>}
    {detail?.viewer.is_manager && <Panel title="管理者 · 申请整体处理">
      <Notice>管理权由当前服务端快照判定，服务端写入仍会重新核验。处理后刷新最新名单人数与状态；本接口不公开完整成员名册。</Notice>
      {detail.applications?.length === 0 && <Text>当前没有可见申请</Text>}
      {detail.applications?.map(application => <View className="panel" key={application.application_id}>
        <Text>{application.display_name || '未提供昵称的申请者'} · {applicationLabels[application.status]}</Text>
        <View className="row"><Text>本次组合：{application.segments.map(s => `${detail.segments.find(v => v.segment_id === s.segment_id)?.name ?? '历史环节'}（接受版本${s.plan_revision}）`).join('、')}</Text></View>
        {application.status === 'pending' && <View>
          <Action disabled={!fresh || anyBusy || decisionBlocked} onClick={() => decide(application.application_id, 'approve')}>整体批准所选环节</Action>
          <Action disabled={!fresh || anyBusy || decisionBlocked} onClick={() => decide(application.application_id, 'reject')}>拒绝本次申请</Action>
        </View>}
      </View>)}
      {decision.message && <Notice>{decision.message}</Notice>}
      {decision.pending && <View><Notice>原审批请求已保留，请先刷新核对；不会以新的申请或版本替换原请求。</Notice>
        <Action disabled={!fresh || anyBusy} onClick={() => { void decision.send(); }}>按原审批及同一幂等键核对重试</Action></View>}
    </Panel>}
    {detail && <Panel title="邀请入口">
      <Notice>此轮基础入口只定位同一活动 ID，不授权限；邀请人来源归因、报名二维码和图片分享卡尚未接入。可使用右上角转发此活动路径；体验资格须平台单独配置。</Notice>
      <Text selectable>{id}</Text>
      <Action onClick={() => { void Taro.setClipboardData({ data: id }).catch(() => setValidation('复制未完成，可手动记录页面活动 ID。')); }}>复制活动 ID（非管理凭据）</Action>
    </Panel>}
    <Action disabled={anyBusy} onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>返回首页</Action>
  </View>;
}

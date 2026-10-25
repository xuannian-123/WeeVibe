import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { activityIdSchema, createActivityInputSchema, type CreateActivityInput } from '@weevibe/contracts';
import { BRAND_NAME } from '../../brand';
import { api } from '../../platform/api';
import { newKey, readSaved, requireUser, save, useLogin, usePageRead } from '../../platform/page-state';
import { buildCreateInput, createTimingIssue, emptyForm, isActivityForm, type ActivityForm } from './form';
import { feeText, formatTime, rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';
import { ActivityEditor } from './activity-editor';
import { Action, Notice, Panel } from '../../components/ui';
import './activity-create.css';

export default function Editor() {
  const identity = usePageRead(requireUser); const login = useLogin(identity.refresh);
  const userId = identity.data?.user_id; const draftKey = `weego-create-draft-v1:${userId ?? 'guest'}`;
  const completedKey = `weego-created-v1:${userId ?? 'guest'}`;
  const [form, setForm] = useState<ActivityForm>(emptyForm); const [loadedFor, setLoadedFor] = useState('');
  const [validation, setValidation] = useState(''); const [draftMessage, setDraftMessage] = useState('');
  const [review, setReview] = useState<{ userId: string; input: CreateActivityInput }>();
  useEffect(() => {
    if (!userId || loadedFor === userId) return;
    const stored = readSaved<ActivityForm>(draftKey);
    // A different identity must never inherit the previous person's draft.
    setForm(isActivityForm(stored) ? stored : emptyForm());
    setLoadedFor(userId);
  }, [userId, loadedFor, draftKey]);
  useEffect(() => {
    if (!userId || loadedFor !== userId) return;
    try { save(draftKey, form); setDraftMessage('草稿已保存在本设备。'); }
    catch { setDraftMessage('草稿暂时无法保存，请保持当前页面。'); }
  }, [form, userId, loadedFor, draftKey]);
  const write = useStoredWrite({ storageKey: `weego-create-pending-v1:${userId ?? 'guest'}`, userId,
    parse: input => createActivityInputSchema.parse(input), execute: input => api.createActivity(input),
    committed: detail => { save(completedKey, { activityId: detail.activity_id }); rememberActivity(userId ?? null, detail); try { Taro.removeStorageSync(draftKey); } catch { /* confirmed on server */ } }
  });
  const savedCompletion = readSaved<{ activityId: string }>(completedKey);
  const completedId = write.result?.activity_id ?? (activityIdSchema.safeParse(savedCompletion?.activityId).success ? savedCompletion!.activityId : undefined);
  const disabled = write.busy || !!write.pending || write.blocked || !!completedId;
  const preview = review && review.userId === userId ? review.input : undefined;
  // Keep the exact dates visible while an uncertain request stays immutable.
  const displayedPlan = (write.pending && write.pending.userId === userId ? write.pending.input : undefined) ?? preview;
  function prepare() {
    if (disabled || !userId || identity.error) return;
    try { const input = buildCreateInput(form, newKey()); const issue = createTimingIssue(input, Date.now()); if (issue) throw new Error(issue); setValidation(''); setReview({ userId, input }); void Taro.pageScrollTo({ scrollTop: 0, duration: 200 }); }
    catch (error) { setValidation(error instanceof Error ? error.message : '请核对表单'); }
  }
  function submit() {
    if (disabled || !userId || identity.error || !preview) return;
    // Pending requests must reach server replay with their original key, even
    // when the start time has passed since a previous submission.
    const issue = createTimingIssue(preview, Date.now());
    if (issue) { setReview(undefined); setValidation(issue); return; }
    void write.send(preview);
  }
  function startAnother() {
    try { Taro.removeStorageSync(completedKey); write.resetResult(); setReview(undefined); setForm(emptyForm()); setValidation(''); }
    catch { setValidation('暂时无法开始新活动，请先查看已创建的活动。'); }
  }
  if (completedId && !write.pending) return <View className="screen">
    <View className="page-intro"><Text className="page-eyebrow">{BRAND_NAME} / 一起出发</Text><Text className="page-title">这场活动已发起</Text><Text className="page-subtitle">安排已保存，可以进入详情邀请朋友。</Text></View>
    <Panel title="接下来，一起把人约齐">
      <Notice tone="success">服务端已确认保存。达到人数后，仍需你核实安排并确认成局。</Notice>
      <Action variant="primary" onClick={() => { void Taro.redirectTo({ url: `/pages/activity/index?id=${encodeURIComponent(completedId)}` }); }}>查看活动</Action>
      <Action onClick={startAnother}>发起另一场活动</Action>
      {validation && <Notice tone="error">{validation}</Notice>}
    </Panel>
    <Action variant="text" onClick={() => { void Taro.reLaunch({ url: '/pages/index/index' }); }}>回到首页</Action>
  </View>;
  return <View className="screen">
    <View className="page-intro"><Text className="page-eyebrow">{BRAND_NAME} / 发起活动</Text><Text className="page-title">{write.pending ? '先核对上次发起' : preview ? '发出前，再看一眼' : '约一次见面'}</Text><Text className="page-subtitle">{write.pending ? '下面是上次提交的原安排，日期和内容完整保留。' : preview ? '时间、人数和你的参加选择，都以这里为准。' : '把时间、地点和人数说清楚，剩下的一起商量。'}</Text></View>
    {(!userId || identity.error || login.error) && <Panel title="先确认你的微信身份">
      {identity.loading && <Notice>正在确认本人身份……</Notice>}
      {identity.error && <Notice tone="error">{identity.error}</Notice>}{login.error && <Notice tone="error">{login.error}</Notice>}
      {(!userId || identity.error || login.error) && <Action variant="primary" disabled={login.busy || write.busy} onClick={() => { void login.login(); }}>{login.busy ? '正在登录…' : '微信登录'}</Action>}
    </Panel>}
    {displayedPlan ? <View>
      <Panel title={displayedPlan.name}>
        {displayedPlan.segments.map((segment, index) => <View className="review-segment" key={segment.client_ref}>
          <View className="review-title"><Text>{index + 1}. {segment.name}</Text>{displayedPlan.main_segment_ref === segment.client_ref && <Text className="review-badge">主要环节</Text>}</View>
          <Text className="review-line">{formatTime(segment.starts_at)} — {formatTime(segment.ends_at)}</Text>
          <Text className="review-line">{segment.location.name}{segment.location.address ? ` · ${segment.location.address}` : ''}</Text>
          <Text className="review-line">至少 {segment.minimum_participants} 人成行，最多 {segment.capacity} 人</Text>
          <Text className="review-line">{feeText(segment.fee)}</Text>
          <Text className="caption">报名截止：{formatTime(segment.deadline_at)}</Text>
          {!!segment.requirements && <Text className="review-line">参加要求：{segment.requirements}</Text>}
        </View>)}
        <Notice>{displayedPlan.participating_segment_refs.length ? `你参加：${displayedPlan.segments.filter(s => displayedPlan.participating_segment_refs.includes(s.client_ref)).map(s => s.name).join('、')}` : '你只负责组织，不占参加名额。'}</Notice>
        <Text className="caption">发起后朋友可申请加入，由你审批。发布不代表已成局或已预订。</Text>
      </Panel>
    </View> : <ActivityEditor value={form} onChange={setForm} disabled={disabled || !userId || !!identity.error} />}
    {validation && <Notice tone="error">{validation}</Notice>}
    {write.message && <Notice tone="error">{write.message}</Notice>}
    {write.pending && <Panel title="上次创建结果待核对">
      <Notice>发布结果还未确认。原内容已保留，先查看活动记录，或使用同一份内容核对重试。</Notice>
      <Action disabled={write.busy || !!identity.error} onClick={() => { void write.send(); }}>核对并重试发布</Action>
    </Panel>}
    {!write.pending && <Action variant="primary" disabled={disabled || !userId || !!identity.error} onClick={preview ? submit : prepare}>{write.busy ? '正在发起…' : preview ? '确认发起' : '预览活动'}</Action>}
    {preview && !write.pending && <Action disabled={write.busy} onClick={() => setReview(undefined)}>返回修改</Action>}
    {!displayedPlan && <Text className="caption">{draftMessage || '登录后自动保存本机草稿。'}下一步先预览，确认后才发出。</Text>}
    <Action variant="text" onClick={() => { void Taro.navigateBack({ fail: () => { void Taro.reLaunch({ url: '/pages/index/index' }); } }); }}>返回首页</Action>
  </View>;
}

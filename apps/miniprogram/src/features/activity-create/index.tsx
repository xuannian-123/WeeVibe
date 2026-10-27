import { useEffect, useRef, useState } from 'react';
import Taro, { useDidShow, useDidHide, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { Text, View } from '@tarojs/components';
import { activityIdSchema, createActivityInputSchema, type CreateActivityInput } from '@weevibe/contracts';
import { BRAND_NAME } from '../../brand';
import { getToken } from '../../platform/api';
import { createActivityForIdentity, readCreationIdentity } from './api';
import { newKey, readSaved, save, useLogin, usePageRead } from '../../platform/page-state';
import { buildCreateInput, createTimingIssue, emptyForm, isActivityForm, type ActivityForm } from './form';
import { feeText, formatTime, rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';
import { ActivityEditor } from './activity-editor';
import { Action, Notice, Panel } from '../../components/ui';
import './activity-create.css';
import { RebookEditor } from '../rebook/RebookEditor';
import { PreparationEditor } from './preparation-editor';

export default function Editor() {
  const rebook = Taro.getCurrentInstance?.().router?.params.rebook;
  const preparation = Taro.getCurrentInstance?.().router?.params.preparation;
  if (preparation !== undefined) return <PreparationEditor sourceId={preparation} />;
  return rebook === undefined ? <OrdinaryEditor /> : <RebookEditor key={rebook} sourceId={rebook} />;
}
export function OrdinaryEditor({ initialForm, draftSuffix = '' }: { initialForm?: ActivityForm; draftSuffix?: string } = {}) {
  const identity = usePageRead(readCreationIdentity); const login = useLogin(identity.refresh);
  const source = identity.data?.session === getToken() ? identity.data : undefined;
  const userId = source?.user_id; const draftKey = `weego-create-draft-v1:${userId ?? 'guest'}${draftSuffix}`;
  const completedKey = `weego-created-v1:${userId ?? 'guest'}${draftSuffix}`;
  const [form, setForm] = useState<ActivityForm>(() => initialForm ?? emptyForm()); const [loadedFor, setLoadedFor] = useState('');
  const [validation, setValidation] = useState(''); const [draftMessage, setDraftMessage] = useState('');
  const [review, setReview] = useState<{ userId: string; input: CreateActivityInput }>();
  const mounted=useRef(true), visible=useRef(true), epoch=useRef(0);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  const deactivate=()=>{visible.current=false;epoch.current++;};useDidHide(deactivate);useUnload(deactivate);useDidShow(()=>{visible.current=true;});
  const latest=useRef({source,loading:identity.loading,error:identity.error});latest.current={source,loading:identity.loading,error:identity.error};
  const assertSource=()=>{if(!source||getToken()!==source.session)throw new ApiClientError('UNAUTHENTICATED','登录身份已变化，请重新读取；原草稿仍按账号隔离保存。',401);};
  useEffect(() => {
    if (!userId || loadedFor === userId) return;
    const stored = readSaved<ActivityForm>(draftKey);
    // A different identity must never inherit the previous person's draft.
    setForm(isActivityForm(stored) ? stored : initialForm ?? emptyForm());
    setLoadedFor(userId);
  }, [userId, loadedFor, draftKey]);
  useEffect(() => {
    if (!userId || loadedFor !== userId) return;
    try { save(draftKey, form); setDraftMessage('草稿已保存在本设备。'); }
    catch { setDraftMessage('草稿暂时无法保存，请保持当前页面。'); }
  }, [form, userId, loadedFor, draftKey]);
  const write = useStoredWrite({ storageKey: `weego-create-pending-v1:${userId ?? 'guest'}${draftSuffix}`, userId,
    parse: input => createActivityInputSchema.parse(input), execute: input => {
      const ticket=epoch.current;
      const assertCurrent=()=>{const current=latest.current;assertSource();if(!mounted.current||!visible.current||ticket!==epoch.current||current.source?.session!==source?.session||current.source?.user_id!==userId||current.loading||current.error)throw new ApiClientError('INVALID_RESPONSE','页面或身份状态已变化，创建结果未确认，请返回原账号核对；原请求保留。',0);};
      assertCurrent();return createActivityForIdentity(input,source,assertCurrent);
    },
    committed: detail => { save(completedKey, { activityId: detail.activity_id }); rememberActivity(userId ?? null, detail); try { Taro.removeStorageSync(draftKey); } catch { /* confirmed on server */ } }
  });
  const savedCompletion = readSaved<{ activityId: string }>(completedKey);
  const completedId = source ? (write.result && write.result.viewer.user_id === userId ? write.result.activity_id : undefined) ?? (activityIdSchema.safeParse(savedCompletion?.activityId).success ? savedCompletion!.activityId : undefined) : undefined;
  const disabled = write.busy || !!write.pending || write.blocked || !!completedId;
  const preview = review && review.userId === userId ? review.input : undefined;
  // Keep the exact dates visible while an uncertain request stays immutable.
  const displayedPlan = (write.pending && write.pending.userId === userId ? write.pending.input : undefined) ?? preview;
  function prepare() {
    if (disabled || !userId || identity.error || identity.loading) return;
    try { assertSource(); const input = buildCreateInput(form, newKey()); const issue = createTimingIssue(input, Date.now()); if (issue) throw new Error(issue); setValidation(''); setReview({ userId, input }); void Taro.pageScrollTo({ scrollTop: 0, duration: 200 }); }
    catch (error) { setValidation(error instanceof Error ? error.message : '请核对表单'); }
  }
  function submit() {
    if (disabled || !userId || identity.error || identity.loading || !preview) return;
    try { assertSource(); } catch { setValidation('账号已变化，原账号的预览不会提交给新账号。请重新读取身份。'); return; }
    // Pending requests must reach server replay with their original key, even
    // when the start time has passed since a previous submission.
    const issue = createTimingIssue(preview, Date.now());
    if (issue) { setReview(undefined); setValidation(issue); return; }
    void write.send(preview);
  }
  function startAnother() {
    try { assertSource(); Taro.removeStorageSync(completedKey); write.resetResult(); setReview(undefined); setForm(emptyForm()); setValidation(''); }
    catch { setValidation('暂时无法开始新活动，请先查看已创建的活动。'); }
  }
  if (completedId && !write.pending) return <View className="screen">
    <View className="page-intro"><Text className="page-eyebrow">{BRAND_NAME} / 一起出发</Text><Text className="page-title">这场活动已发起</Text><Text className="page-subtitle">安排已保存，可以进入详情邀请朋友。</Text></View>
    <Panel title="接下来，一起把人约齐">
      <Notice tone="success">服务端已确认保存。达到人数后，仍需你核实安排并确认成局。</Notice>
      <Action variant="primary" onClick={() => { try { assertSource(); void Taro.redirectTo({ url: `/pages/activity/index?id=${encodeURIComponent(completedId)}` }); } catch { setValidation('账号已变化，请重新读取本人创建记录。'); } }}>查看活动</Action>
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
    </View> : <ActivityEditor key={userId ?? 'guest'} value={userId && loadedFor === userId ? form : emptyForm()} onChange={next => { try { assertSource(); setForm(next); } catch { setValidation('账号已变化，旧表单已停止编辑，请重新读取身份。'); } }} disabled={disabled || !userId || loadedFor !== userId || !!identity.error} />}
    {validation && <Notice tone="error">{validation}</Notice>}
    {write.message && <Notice tone="error">{write.message}</Notice>}
    {write.pending && <Panel title="上次创建结果待核对">
      <Notice>发布结果还未确认。原内容已保留，先查看活动记录，或使用同一份内容核对重试。</Notice>
      <Action disabled={write.busy || !source || identity.loading || !!identity.error} onClick={() => { try { assertSource(); void write.send(); } catch { setValidation('账号已变化，不会将原请求重放给其他账号。请重新读取身份。'); } }}>核对并重试发布</Action>
    </Panel>}
    {!write.pending && <Action variant="primary" disabled={disabled || !userId || identity.loading || !!identity.error} onClick={preview ? submit : prepare}>{write.busy ? '正在发起…' : preview ? '确认发起' : '预览活动'}</Action>}
    {preview && !write.pending && <Action disabled={write.busy} onClick={() => setReview(undefined)}>返回修改</Action>}
    {!displayedPlan && <Text className="caption">{draftMessage || '登录后自动保存本机草稿。'}下一步先预览，确认后才发出。</Text>}
    <Action variant="text" onClick={() => { void Taro.navigateBack({ fail: () => { void Taro.reLaunch({ url: '/pages/index/index' }); } }); }}>返回首页</Action>
  </View>;
}

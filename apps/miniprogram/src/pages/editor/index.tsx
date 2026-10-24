import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View } from '@tarojs/components';
import { activityIdSchema, createActivityInputSchema } from '@weego/contracts';
import { api } from '../../platform/api';
import { newKey, readSaved, requireUser, save, useLogin, usePageRead } from '../../platform/page-state';
import { emptyForm, isActivityForm, type ActivityForm } from '../../platform/activity-form';
import { buildCreateInput, rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';
import { ActivityEditor } from '../../components/activity-editor';
import { Action, Notice, Panel } from '../../components/ui';

export default function Editor() {
  const identity = usePageRead(requireUser); const login = useLogin(identity.refresh);
  const userId = identity.data?.user_id; const draftKey = `weego-create-draft-v1:${userId ?? 'guest'}`;
  const completedKey = `weego-created-v1:${userId ?? 'guest'}`;
  const [form, setForm] = useState<ActivityForm>(emptyForm); const [loadedFor, setLoadedFor] = useState('');
  const [validation, setValidation] = useState(''); const [draftMessage, setDraftMessage] = useState('');
  useEffect(() => {
    if (!userId || loadedFor === userId) return;
    const stored = readSaved<ActivityForm>(draftKey);
    if (isActivityForm(stored)) setForm(stored);
    setLoadedFor(userId);
  }, [userId, loadedFor, draftKey]);
  useEffect(() => {
    if (!userId || loadedFor !== userId) return;
    try { save(draftKey, form); setDraftMessage('草稿已保留在当前设备；尚未发布。'); }
    catch { setDraftMessage('无法保存本机草稿，请保持页面；提交请求另有保护。'); }
  }, [form, userId, loadedFor, draftKey]);
  const write = useStoredWrite({ storageKey: `weego-create-pending-v1:${userId ?? 'guest'}`, userId,
    parse: input => createActivityInputSchema.parse(input), execute: input => api.createActivity(input),
    committed: detail => { save(completedKey, { activityId: detail.activity_id }); rememberActivity(userId ?? null, detail); try { Taro.removeStorageSync(draftKey); } catch { /* confirmed on server */ } }
  });
  const savedCompletion = readSaved<{ activityId: string }>(completedKey);
  const completedId = write.result?.activity_id ?? (activityIdSchema.safeParse(savedCompletion?.activityId).success ? savedCompletion!.activityId : undefined);
  const disabled = write.busy || !!write.pending || write.blocked || !!completedId;
  function submit() {
    if (disabled || !userId || identity.error) return;
    try { const input = buildCreateInput(form, newKey()); setValidation(''); void write.send(input); }
    catch (error) { setValidation(error instanceof Error ? error.message : '请核对表单'); }
  }
  return <View className="screen">
    <Panel title="创建多环节活动">
      <Notice>唯一主环节决定成局，达到最低人数并满足接受与核实条件后仍须发起人确认。创建成功不等于成局或已预订。</Notice>
      {identity.loading && <Notice>正在确认本人身份……</Notice>}
      {identity.error && <Notice>{identity.error}</Notice>}{login.error && <Notice>{login.error}</Notice>}
      <Action disabled={login.busy || write.busy} onClick={() => { void login.login(); }}>微信登录／恢复本人身份（保留草稿）</Action>
      <Notice>{draftMessage || '请先登录，再填写并保存本人草稿。'}</Notice>
    </Panel>
    <ActivityEditor value={form} onChange={setForm} disabled={disabled || !userId || !!identity.error} />
    {validation && <Notice>{validation}</Notice>}
    {write.message && <Notice>{write.message}</Notice>}
    {write.pending && <Panel title="上次创建结果待核对">
      <Notice>原请求与幂等键已保留，字段暂锁定；不会自动重发。可先回首页核对已记录入口，或主动重试完全相同的请求。</Notice>
      <Action disabled={write.busy || !!identity.error} onClick={() => { void write.send(); }}>以原内容、原幂等键核对重试</Action>
    </Panel>}
    <Action disabled={disabled || !userId || !!identity.error} onClick={submit}>检查字段并发布活动</Action>
    {completedId && <Panel title="此前创建已获服务端确认">
      <Action onClick={() => { void Taro.redirectTo({ url: `/pages/activity/index?id=${encodeURIComponent(completedId)}` }); }}>打开已创建活动</Action>
      <Action disabled={write.busy || !!write.pending} onClick={() => { try { Taro.removeStorageSync(completedKey); write.resetResult(); setForm(emptyForm()); } catch { setValidation('无法清理已完成标记，请先检查设备存储；不会重复发布。'); } }}>明确开始另一场新活动</Action>
    </Panel>}
    <Action onClick={() => { void Taro.navigateBack({ fail: () => { void Taro.reLaunch({ url: '/pages/index/index' }); } }); }}>返回（保留草稿／原请求）</Action>
  </View>;
}

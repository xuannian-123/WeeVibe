import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { View, Text } from '@tarojs/components';
import { activityDetailSchema, editArrangementInputSchema, verifySegmentInputSchema, type ActivityDetail, type ArrangementEditPreview, type EditArrangementInput } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../activity-entry/ActivityUI';
import { ActivityEditor } from '../activity-create/activity-editor';
import { type ActivityForm } from '../activity-create/form';
import { feeText } from '../../platform/activities';
import { formatActivityTime } from '../shell/activity-time';
import { newKey, errorText } from '../../platform/page-state';
import { getToken } from '../../platform/api';
import { useStoredWrite } from '../../platform/write-state';
import { requestSegmentVerification, requestArrangementEdit } from './edit-api';
import { editInputFromForm, formFromArrangement } from './edit-form';

type Props = { detail: ActivityDetail; session?: string; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
export function ArrangementEditor({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined;
  const [form, setForm] = useState<ActivityForm>(), [sourceRevision, setSourceRevision] = useState(0), [preview, setPreview] = useState<{ data: ArrangementEditPreview; input: EditArrangementInput }>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), visible = useRef(true), epoch = useRef(0), mounted = useRef(true);
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  useDidHide(() => { visible.current = false; epoch.current++; }); useUnload(() => { visible.current = false; epoch.current++; });
  useDidShow(() => { visible.current = true; });
  const guardFor = () => { const ticket = epoch.current; return () => {
    const now = latest.current;
    if (!mounted.current || !visible.current || ticket !== epoch.current || !session || getToken() !== session || now.session !== session || !now.fresh
      || now.detail.activity_id !== detail.activity_id || now.detail.viewer.user_id !== actor || !now.detail.viewer.is_manager)
      throw new Error('账号、管理权限或页面已变化，请回到原活动核对');
  }; };
  const state = useStoredWrite({ storageKey: `weevibe-arrangement-edit-v1:${detail.activity_id}:${actor ?? 'guest'}`, userId: actor,
    parse: raw => { const verification = verifySegmentInputSchema.safeParse(raw); return verification.success ? verification.data : editArrangementInputSchema.parse(raw); },
    execute: async input => activityDetailSchema.parse('action' in input ? await requestSegmentVerification(detail.activity_id, actor!, session, input, guardFor()) : await requestArrangementEdit(detail.activity_id, actor!, session, input, false, guardFor())),
    committed: () => { setForm(undefined); setPreview(undefined); void refresh(); } });
  useEffect(() => { onBusyChange?.(busy || state.busy); return () => onBusyChange?.(false); }, [busy, state.busy, onBusyChange]);
  const blocked = !fresh || anyBusy || busy || state.busy || state.blocked || !!state.pending || !!detail.cancelled_at;
  const stale = !!form && sourceRevision !== detail.revision;
  async function inspect() {
    if (blocked || !form || stale || lock.current) return;
    let input: EditArrangementInput;
    try { input = editInputFromForm(detail, form, newKey()); }
    catch (error) {
      // Only this local form conversion is safe to display directly. Transport
      // failures below continue through the fixed, non-sensitive error mapper.
      setPreview(undefined);
      setMessage(error instanceof Error ? error.message : '请核对安排中的字段后再预览');
      return;
    }
    lock.current = true; setBusy(true); setMessage(''); const guard = guardFor();
    try {
      const result = await requestArrangementEdit(detail.activity_id, actor!, session, input, true, guard); guard();
      if (!('viewer_user_id' in result) || result.revision !== latest.current.detail.revision) throw new Error('活动已更新，请重新读取再编辑');
      setPreview({ data: result, input });
    } catch (error) { setMessage(errorText(error)); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function apply() {
    if (blocked || !preview || stale || lock.current) return;
    lock.current = true; setBusy(true); const guard = guardFor();
    try {
      const before = JSON.stringify(preview), revision = detail.revision;
      const answer = await Taro.showModal({ title: '确认应用上述安排修改？', content: '相关成员保留席位并重新接受；新地点／时段须重新核实。不会替别人同意，也不会自动预订、退订或退款。' });
      guard(); if (!answer.confirm) return;
      if (latest.current.detail.revision !== revision || before !== JSON.stringify(preview)) throw new Error('确认期间活动已变化，请重新预览');
      await state.send(preview.input);
    } catch (error) { if (mounted.current) setMessage(errorText(error)); } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function verify(segment: ActivityDetail['segments'][number]) {
    if (blocked || lock.current || form || segment.has_started || segment.cancelled_at) return;
    lock.current = true; setBusy(true); const guard = guardFor(); const revision = detail.revision;
    try {
      const answer = await Taro.showModal({ title: '核实当前环节安排？', content: `请先人工核实「${segment.name}」的当前地点和时段。本声明不等于已预订、不替任何成员接受，也不自动成局。` });
      guard(); if (!answer.confirm) return;
      if (latest.current.detail.revision !== revision) throw new Error('安排已更新，请重新核实');
      await state.send(verifySegmentInputSchema.parse({ action: 'verify-segment', segment_id: segment.segment_id, expected_revision: revision,
        expected_plan_revision: segment.plan_revision, idempotency_key: newKey(), verified: true }));
    } catch (error) { if (mounted.current) setMessage(errorText(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  if (!actor || !detail.viewer.is_manager) return null;
  return <Panel title="修改已发布的安排">
    <Text className="caption">已开始段不可修改；取消段保留历史。修改不改变任何人的参加选择，新增段须另行申请。</Text>
    {!form && detail.segments.filter(s => !s.cancelled_at && !s.has_started && s.verification_status === 'unknown').map(segment => <Action key={segment.segment_id} disabled={blocked} onClick={() => { void verify(segment); }}>人工核实 {segment.name} 的当前安排</Action>)}
    {!form && <Action disabled={blocked} onClick={() => { setForm(formFromArrangement(detail)); setSourceRevision(detail.revision); setMessage(''); }}>编辑当前安排</Action>}
    {form && <View>
      {stale && <Notice>活动已更新，草稿保留但不能提交；请核对并重新读取。旧草稿不会覆盖新安排。</Notice>}
      <ActivityEditor editing value={form} onChange={next => { setForm(next); setPreview(undefined); }} disabled={blocked || stale} />
      <Action disabled={blocked || stale} onClick={() => { void inspect(); }}>检查修改并预览影响</Action>
      <Action disabled={blocked} onClick={() => { setForm(formFromArrangement(detail)); setSourceRevision(detail.revision); setPreview(undefined); }}>放弃草稿并重新读取</Action>
    </View>}
    {preview && <View>
      {preview.data.main_changed && <Notice>主环节将改变，新主环节须重新由管理者确认成局。</Notice>}
      {preview.data.changes.map(change => <View key={change.client_ref}><Text>{change.name} · {change.is_new ? '新增' : change.cancelled ? '取消并保留历史' : '修改'}</Text>
        {change.before && <Text className="caption">原安排：{formatActivityTime(change.before.starts_at, detail.timezone)} 至 {formatActivityTime(change.before.ends_at, detail.timezone)} · {change.before.location.name} · 最低{change.before.minimum_participants}人 · {feeText(change.before.fee)}</Text>}
        <Text className="caption">新安排：{formatActivityTime(change.after.starts_at, detail.timezone)} 至 {formatActivityTime(change.after.ends_at, detail.timezone)} · {change.after.location.name} · 最低{change.after.minimum_participants}人 · {feeText(change.after.fee)}</Text>
        {change.before && <Text className="caption">原上限 {change.before.capacity} 人 · 原截止 {formatActivityTime(change.before.deadline_at, detail.timezone)} · 原要求 {change.before.requirements || '无'}</Text>}
        <Text className="caption">新顺序 {change.after.position + 1} · 上限 {change.after.capacity} 人 · 截止 {formatActivityTime(change.after.deadline_at, detail.timezone)} · 要求 {change.after.requirements || '无'}</Text>
        <Text className="caption">{change.requires_reacceptance ? `${change.affected_count} 个席位保留，相关成员须重新接受` : '不自动新增参加或替成员接受'}{change.resets_verification ? '；新地点／时段待重新核实' : ''}</Text>
      </View>)}
      {preview.data.warnings.map(warning => <Notice key={warning}>{warning}</Notice>)}
      <Action variant="primary" disabled={blocked || stale} onClick={() => { void apply(); }}>确认应用修改</Action>
    </View>}
    {message && <Notice>{message}</Notice>}{state.message && <Notice>{state.message}</Notice>}
    {state.pending && <View><Notice>上次修改结果未确认。先刷新核对，重试保留原请求标识及内容。</Notice><Action disabled={!fresh || busy || state.busy} onClick={() => { void state.send(); }}>核对后重试原修改</Action></View>}
  </Panel>;
}

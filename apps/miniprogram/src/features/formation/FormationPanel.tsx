import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { formationCommandSchema, type ActivityDetail } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { useStoredWrite } from '../../platform/write-state';
import { formationErrorMessage, submitFormation } from './api';

type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
const mainSegment = (detail: ActivityDetail) => detail.segments.find(segment => segment.segment_id === detail.main_segment_id);
const started = (detail: ActivityDetail) => { const main = mainSegment(detail); return !main || main.has_started || Date.parse(detail.server_time) >= Date.parse(main.starts_at); };
const snapshotKey = (detail: ActivityDetail) => JSON.stringify([detail.activity_id, detail.revision, detail.main_segment_id, detail.cancelled_at, detail.viewer.user_id, detail.viewer.is_manager, mainSegment(detail)]);
const canConfirm = (detail: ActivityDetail) => { const main = mainSegment(detail); return !!main && main.counts.meets_minimum && main.counts.pending_acceptance_count === 0 && main.verification_status === 'manual_checked'; };

export function FormationPanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined, main = mainSegment(detail);
  const [confirming, setConfirming] = useState(false), [notice, setNotice] = useState('');
  const resultSession = useRef<string>();
  const confirmLock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0);
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; });
  const active = () => mounted.current && visible.current;
  const state = useStoredWrite({
    storageKey: `weevibe-formation-v1:${detail.activity_id}:${actor ?? 'guest'}`, userId: actor,
    parse: raw => formationCommandSchema.parse(raw),
    execute: async input => {
      const ticket = epoch.current, before = snapshotKey(detail);
      const assertCurrent = () => {
        const current = latest.current;
        if (!active() || epoch.current !== ticket || !session || getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || snapshotKey(current.detail) !== before)
          throw new ApiClientError('INVALID_RESPONSE', '页面或管理身份已变化，结果未确认；请回到原活动核对，原请求保留。', 0);
      };
      try {
        // The server decides whether this key already committed or needs its first execution; it rechecks current conditions for an uncommitted command.
        assertCurrent();
        const result = await submitFormation(detail.activity_id, input, actor ?? '', session, assertCurrent);
        assertCurrent();
        if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '服务端响应早于当前活动状态，结果未确认。', 200);
        resultSession.current = session;
        return result;
      } catch (error) {
        const message = formationErrorMessage(error);
        if (message && active() && epoch.current === ticket) setNotice(message);
        throw error;
      }
    },
    committed: result => { rememberActivity(actor ?? null, result); void refresh(); }
  });
  useEffect(() => { onBusyChange?.(state.busy || confirming); return () => onBusyChange?.(false); }, [state.busy, confirming, onBusyChange]);
  useEffect(() => { setNotice(''); }, [detail.activity_id, actor]);
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  const newBlocked = !fresh || anyBusy || confirming || state.busy || state.blocked || !!pending || !!detail.cancelled_at || !main || !!main.cancelled_at || started(detail);
  async function command(action: 'set-verification' | 'confirm-formation', verified?: boolean) {
    if (!actor || !detail.viewer.is_manager || !main || confirmLock.current || !active() || newBlocked) return;
    if (action === 'confirm-formation' && (!canConfirm(detail) || detail.formation_status === 'confirmed')) return;
    const input = formationCommandSchema.parse({ action, idempotency_key: newKey(), expected_revision: detail.revision, segment_id: main.segment_id, expected_plan_revision: main.plan_revision, ...(action === 'set-verification' ? { verified } : {}) });
    const ticket = epoch.current, before = snapshotKey(detail);
    confirmLock.current = true; setConfirming(true); setNotice('');
    let requested = false;
    try {
      if (!session || getToken() !== session) throw new Error('changed source');
      const answer = await Taro.showModal(action === 'confirm-formation'
        ? { title: '确认／恢复主环节成局？', content: '仅确认当前主环节：最低人数、所有占位成员接受及人工核实须同时满足。不会自动预订、扣费、退款或改变其他环节。' }
        : verified ? { title: '标记当前主环节已人工核实？', content: '请确认你已按实际情况核实当前时间、地点及安排。这是你的人工声明，不代表系统查到可用性，也不等于已经预订或成局。' }
          : { title: '撤销当前主环节人工核实？', content: '将同时清除原主环节成局确认。之后重新核实不会自动恢复成局；预订、费用和成员席位不会自动改变。' });
      if (!answer.confirm || !active() || epoch.current !== ticket) return;
      const current = latest.current;
      if (getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || snapshotKey(current.detail) !== before || started(current.detail) || (action === 'confirm-formation' && !canConfirm(current.detail))) {
        setNotice('确认期间活动、权限或成局条件已变化，请刷新核对；本次未发送。'); return;
      }
      requested = true; state.resetResult(); await state.send(input);
    } catch {
      if (active()) setNotice(requested ? '操作结果未确认，请刷新核对；不会把未知结果当成已成局。' : '确认未完成或账号已变化，本次未发送，可重新核对后重试。');
    } finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (confirmLock.current || !active() || !fresh || anyBusy || state.busy || state.blocked || !pending) return;
    setNotice(''); state.resetResult(); await state.send();
  }
  if (!actor || !detail.viewer.is_manager) return null;
  if (!session || getToken() !== session) return <Notice>登录账号已变化，旧管理操作已隐藏，请重新打开本人活动。</Notice>;
  if (!main) return <Notice>尚未取得当前主环节，请刷新核对。</Notice>;
  const currentResultMain = result && mainSegment(result);
  return <Panel title="主环节核实与成局">
    <Text>{main.name} · 最低 {main.minimum_participants} 人 / 上限 {main.capacity} 人</Text>
    <Text className="caption">占位 {main.counts.occupied_count} 人 · 已接受现版 {main.counts.accepted_count} 人 · 待重新接受 {main.counts.pending_acceptance_count} 人</Text>
    <Text className="caption">人工核实：{main.verification_status === 'manual_checked' ? '已人工核实当前安排' : '待人工核实'} · 预订：{main.booking_status === 'manual_booked' ? '人工记录已预订' : '未确认预订'}</Text>
    <Text className="caption">成局：{detail.formation_status === 'confirmed' ? '主环节已成局' : '待确认／待补位'}。达到最低不自动成局；满员不是必要条件。其他环节状态不因此被确认。</Text>
    <Text className="caption">人数变化须线下重新核实费用，不自动涨价、降低最低人数、退款或退订。</Text>
    {started(detail) && <Notice>主环节已开始：开始后的线上核实／确认规则待确认，本片暂未启用。</Notice>}
    {(detail.cancelled_at || main.cancelled_at) && <Notice>活动或主环节已取消，不能新增本片操作。</Notice>}
    {!main.counts.meets_minimum && <Notice>主环节未达最低人数。按原申请审批补回后，仍须管理者明确确认／恢复。</Notice>}
    {main.counts.pending_acceptance_count > 0 && <Notice>仍有占位成员尚未接受当前安排；保留席位不等于已同意，不能据此成局。</Notice>}
    <Action disabled={newBlocked} onClick={() => { void command('set-verification', main.verification_status !== 'manual_checked'); }}>{main.verification_status === 'manual_checked' ? '撤销人工核实' : '标记已人工核实'}</Action>
    <Action variant="primary" disabled={newBlocked || !canConfirm(detail) || detail.formation_status === 'confirmed'} onClick={() => { void command('confirm-formation'); }}>确认／恢复主环节成局</Action>
    {notice && <Notice>{notice}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result && <Notice>服务器当前状态：{result.formation_status === 'confirmed' ? '主环节已成局' : '主环节尚未成局'}；核实{currentResultMain?.verification_status === 'manual_checked' ? '已记录' : '尚未确认'}。这是当前快照，原请求重放不会重新执行成局。</Notice>}
    {pending && <View><Notice>上次结果未确认。先刷新核对；重试沿用本人原操作和请求标识；若此前未成功，服务端将重新核对条件。</Notice><Action disabled={state.busy || confirming} onClick={() => { void refresh(); }}>刷新成局状态</Action><Action disabled={!fresh || anyBusy || state.busy || state.blocked || confirming} onClick={() => { void retry(); }}>核对并重试原操作</Action></View>}
  </Panel>;
}

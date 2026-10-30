import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { cancelActivityInputSchema, type ActivityDetail } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../activity-entry/ActivityUI';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { useStoredWrite } from '../../platform/write-state';
import { cancelForActor, cancellationErrorMessage } from './api';

type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
function earlyScope(detail: ActivityDetail) {
  const now = Date.parse(detail.server_time);
  const main = detail.segments.find(segment => segment.segment_id === detail.main_segment_id);
  return Number.isFinite(now) && !detail.cancelled_at && !!main && !main.cancelled_at
    && new Set(detail.segments.map(segment => segment.segment_id)).size === detail.segments.length
    && detail.segments.some(segment => !segment.cancelled_at)
    // Cancelled historical segments are deliberately not skipped: their start
    // still determines whether this restricted first-cancellation slice applies.
    && detail.segments.every(segment => [segment.starts_at, segment.ends_at, segment.deadline_at].every(value => Number.isFinite(Date.parse(value)))
      && Date.parse(segment.ends_at) > Date.parse(segment.starts_at) && Date.parse(segment.deadline_at) <= Date.parse(segment.starts_at)
      && !segment.has_started && now < Date.parse(segment.starts_at));
}
function sourceKey(detail: ActivityDetail) {
  return JSON.stringify([detail.activity_id, detail.revision, detail.main_segment_id, detail.viewer.user_id, detail.viewer.is_manager, detail.cancelled_at,
    detail.segments, earlyScope(detail)]);
}
export function CancellationPanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined;
  const [confirming, setConfirming] = useState(false), [notice, setNotice] = useState('');
  const confirmLock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0), resultSession = useRef<string>();
  const completionGuard = useRef<() => void>();
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; });
  const active = () => mounted.current && visible.current;
  const state = useStoredWrite({ storageKey: `weevibe-cancellation-v1:${detail.activity_id}:${actor ?? 'guest'}`, userId: actor,
    parse: raw => cancelActivityInputSchema.parse(raw),
    execute: async input => {
      const ticket = epoch.current, before = sourceKey(detail);
      const assertCurrent = () => {
        const current = latest.current;
        if (!active() || epoch.current !== ticket || !session || getToken() !== session || current.session !== session || !current.fresh
          || !current.detail.viewer.is_manager || sourceKey(current.detail) !== before)
          throw new ApiClientError('INVALID_RESPONSE', '页面、身份或活动状态已变化，取消结果未确认；请回原活动核对，原请求保留。', 0);
      };
      try {
        assertCurrent();
        // Only the server knows whether an old key committed. A processed key
        // may be read-only replayed after start; an uncommitted key is rechecked.
        const result = await cancelForActor(detail.activity_id, input, actor ?? '', session, assertCurrent);
        assertCurrent();
        if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '服务端结果早于当前活动状态，请刷新核对。', 200);
        completionGuard.current = assertCurrent; resultSession.current = session;
        return result;
      } catch (error) {
        const message = cancellationErrorMessage(error);
        if (message && active() && epoch.current === ticket) setNotice(message);
        throw error;
      }
    },
    committed: result => {
      if (!completionGuard.current) throw new ApiClientError('INVALID_RESPONSE', '取消结果未确认，原请求保留。', 0);
      completionGuard.current();
      rememberActivity(actor ?? null, result); void refresh();
    }
  });
  useEffect(() => { onBusyChange?.(state.busy || confirming); return () => onBusyChange?.(false); }, [state.busy, confirming, onBusyChange]);
  useEffect(() => { setNotice(''); }, [detail.activity_id, actor]);
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.viewer.is_manager
    && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  const blocked = !fresh || anyBusy || confirming || state.busy || state.blocked || !!pending || !!result?.cancelled_at || !earlyScope(detail);
  async function cancel() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || blocked) return;
    const input = cancelActivityInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision });
    const ticket = epoch.current, before = sourceKey(detail);
    confirmLock.current = true; setConfirming(true); setNotice(''); let requested = false;
    try {
      if (!session || getToken() !== session) throw new Error('changed source');
      const answer = await Taro.showModal({ title: '确认取消整场活动？', content: `将取消「${detail.name}」的整场活动，关闭继续加入和批准；原行程、申请与参加历史保留。本片没有恢复／撤销取消入口。不会自动退出成员、退款、退订或通知他人；外部预约与费用仍需你人工处理。` });
      if (!answer.confirm || !active() || epoch.current !== ticket) return;
      const current = latest.current;
      if (getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || sourceKey(current.detail) !== before || !earlyScope(current.detail)) {
        setNotice('确认期间管理身份、活动或开始阶段已变化，请刷新核对；本次未发送。'); return;
      }
      requested = true; state.resetResult(); await state.send(input);
    } catch {
      if (active()) setNotice(requested ? '取消结果未确认，请刷新核对，原请求保留。' : '确认未完成或账号已变化，本次未发送，可核对后重试。');
    } finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (confirmLock.current || !active() || !fresh || anyBusy || confirming || state.busy || state.blocked || !pending) return;
    setNotice(''); state.resetResult(); await state.send();
  }
  if (!actor || !detail.viewer.is_manager) return null;
  if (!session || getToken() !== session) return <Notice>账号已变化，旧管理者的取消操作已隐藏，请重新读取本人活动。</Notice>;
  return <Panel title="整场活动取消">
    <Text className="caption">取消整场活动会关闭加入及批准，保留行程、申请和参加历史。不是退出某个环节，不自动退款、退订或通知他人。</Text>
    <Text className="caption">本片没有恢复／撤销取消入口；外部预约和费用须由当前管理者人工处理。</Text>
    {detail.cancelled_at ? <Notice>服务器当前状态：整场活动已取消，历史记录保留。</Notice>
      : !earlyScope(detail) && <Notice>已有环节开始（含已取消的历史环节），或状态无法完整核对；这些情况的新取消规则待确认，本片暂未启用。</Notice>}
    <Action variant="danger" disabled={blocked || !!detail.cancelled_at} onClick={() => { void cancel(); }}>取消整场活动</Action>
    {notice && <Notice>{notice}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result && <Notice>服务端已确认整场活动取消；历史、费用和外部预订不会被自动清除或退款。</Notice>}
    {pending && <View><Notice>上次取消结果未确认。先刷新核对；重试沿用本人的原操作和请求标识，若此前未成功，服务端会重新检查当前条件。</Notice><Action disabled={state.busy || confirming} onClick={() => { void refresh(); }}>刷新取消状态</Action><Action disabled={!fresh || anyBusy || state.busy || state.blocked || confirming} onClick={() => { void retry(); }}>核对并重试原取消</Action></View>}
  </Panel>;
}

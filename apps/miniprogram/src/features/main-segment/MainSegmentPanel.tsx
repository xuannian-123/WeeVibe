import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Label, Radio, RadioGroup, Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { changeMainSegmentInputSchema, type ActivityDetail, type ChangeMainSegmentInput } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { useStoredWrite } from '../../platform/write-state';
import { changeMainForActor, mainSegmentError } from './api';

type Props = { detail: ActivityDetail; session?: string; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
function beforeStart(detail: ActivityDetail, targetId: string) {
  const main = detail.segments.find(s => s.segment_id === detail.main_segment_id), target = detail.segments.find(s => s.segment_id === targetId);
  const now = Math.max(Date.now(), Date.parse(detail.server_time));
  return Number.isFinite(now) && !detail.cancelled_at && !!main && !!target && main.segment_id !== target.segment_id
    && new Set(detail.segments.map(s => s.segment_id)).size === detail.segments.length
    && [main, target].every(s => !s.cancelled_at && !s.has_started && Number.isFinite(Date.parse(s.starts_at)) && now < Date.parse(s.starts_at));
}
function sourceKey(detail: ActivityDetail, targetId: string) {
  return JSON.stringify([detail.activity_id, detail.revision, detail.main_segment_id, detail.cancelled_at, detail.viewer.user_id, detail.viewer.is_manager,
    detail.segments.filter(s => s.segment_id === detail.main_segment_id || s.segment_id === targetId).map(s => [s.segment_id, s.name, s.starts_at, s.cancelled_at, s.has_started])]);
}
function readPending(key: string, actor: string): ChangeMainSegmentInput | undefined {
  const raw: unknown = Taro.getStorageSync(key);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || (raw as { userId?: unknown }).userId !== actor) throw new Error('原请求无法验证');
  return changeMainSegmentInputSchema.parse((raw as { input?: unknown }).input);
}
export function MainSegmentPanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined, owner = `${detail.activity_id}:${actor ?? 'guest'}`, storageKey = `weevibe-main-segment-v1:${owner}`;
  const [selection, setSelection] = useState<{ owner: string; id: string }>(); const selected = selection?.owner === owner ? selection.id : '';
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const [confirming, setConfirming] = useState(false), [notice, setNotice] = useState(''), [pendingIssue, setPendingIssue] = useState('');
  const confirmLock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0), resultSession = useRef<string>();
  const completionGuard = useRef<() => void>(), firstKey = useRef<string>();
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; });
  const active = () => mounted.current && visible.current;
  useEffect(() => {
    setNotice(''); setPendingIssue('');
    if (actor) try { readPending(storageKey, actor); } catch { setPendingIssue('本机原换主请求无法读取或验证，不会覆盖；请先核对活动记录。'); }
  }, [storageKey, actor]);
  const state = useStoredWrite({ storageKey, userId: actor, parse: raw => changeMainSegmentInputSchema.parse(raw),
    execute: async input => {
      const ticket = epoch.current, before = sourceKey(detail, input.target_segment_id), first = firstKey.current === input.idempotency_key; firstKey.current = undefined;
      const assertCurrent = () => {
        const current = latest.current;
        if (!active() || ticket !== epoch.current || !session || getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || sourceKey(current.detail, input.target_segment_id) !== before)
          throw new ApiClientError('INVALID_RESPONSE', '页面、管理身份或活动快照已变化，原换主请求保留，请重新核对。', 0);
        // The shared writer owns the original key, not a later local record.
        // Recheck after every await and before acknowledgement/removal as well.
        assertPending(input);
      };
      try {
        assertCurrent();
        const result = await changeMainForActor(detail.activity_id, input, actor ?? '', session, assertCurrent, first ? () => {
          if (!beforeStart(latest.current.detail, input.target_segment_id)) {
            setNotice('首次发送前原主或目标已开始或状态不可核对，本片暂未启用；本次没有发送换主请求，选择保留。');
            throw new ApiClientError('INVALID_INPUT', '首次换主发送前阶段已变化', 400);
          }
        } : undefined);
        assertCurrent(); if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '响应早于当前活动快照，结果未确认。', 200);
        completionGuard.current = assertCurrent; resultSession.current = session; return result;
      } catch (error) { assertCurrent(); const message = mainSegmentError(error); if (message && active() && ticket === epoch.current) setNotice(message); throw error; }
    },
    committed: result => { if (!completionGuard.current) throw new ApiClientError('INVALID_RESPONSE', '换主结果尚未核对。', 0); completionGuard.current(); rememberActivity(actor ?? null, result); void refresh(); },
  });
  useEffect(() => { onBusyChange?.(confirming || state.busy); return () => onBusyChange?.(false); }, [confirming, state.busy, onBusyChange]);
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.viewer.is_manager && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  function assertPending(expected?: ChangeMainSegmentInput) {
    try { if (!actor || JSON.stringify(readPending(storageKey, actor)) !== JSON.stringify(expected)) throw new Error('原请求变化'); }
    catch { setPendingIssue('原换主请求无法验证或已经变化，未覆盖原记录；请重新进入恢复。'); throw new ApiClientError('INVALID_RESPONSE', '原请求无法核对', 0); }
  }
  const blocked = !fresh || anyBusy || confirming || state.busy || state.blocked || !!pending || !!pendingIssue;
  async function change() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || blocked || !beforeStart(detail, selected)) return;
    const chosen = selected, ticket = epoch.current, before = sourceKey(detail, chosen);
    const input = changeMainSegmentInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, expected_main_segment_id: detail.main_segment_id, target_segment_id: chosen });
    confirmLock.current = true; setConfirming(true); setNotice(''); let requested = false;
    try {
      if (!session || getToken() !== session) throw new Error('source changed'); assertPending();
      const target = detail.segments.find(s => s.segment_id === chosen)!;
      const answer = await Taro.showModal({ title: '更换本活动主环节？', content: `改为「${target.name}」后，活动须由当前管理者重新明确确认成局。不会变更任何人的参加选择、席位、已接受安排、时间地点、费用、人工核实或预订，也不会强迫成员参加新主环节。` });
      if (!answer.confirm || !active() || ticket !== epoch.current) return;
      const current = latest.current;
      if (getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || selectedRef.current !== chosen || sourceKey(current.detail, chosen) !== before || !beforeStart(current.detail, chosen)) {
        setNotice('确认期间目标、管理权限或开始阶段已变化，本次未发送，请重新核对。'); return;
      }
      assertPending(); firstKey.current = input.idempotency_key; requested = true; state.resetResult(); await state.send(input);
    } catch { if (active()) setNotice(requested ? '换主结果尚未确认，请保留原请求并核对。' : '确认未完成或来源已变化，本次未发送；可重新核对后重试。'); }
    finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || !fresh || anyBusy || state.busy || state.blocked || pendingIssue || !pending) return;
    confirmLock.current = true; setConfirming(true); setNotice('');
    try {
      if (!session || getToken() !== session) throw new Error('source changed');
      assertPending(pending.input); firstKey.current = undefined; state.resetResult(); await state.send();
    } catch { if (active()) setNotice('原请求尚未核对，不会换成新的请求标识或目标。'); }
    finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  if (!actor || !detail.viewer.is_manager) return null;
  if (!session || getToken() !== session) return <Notice>身份已变化，旧管理者的换主目标与原请求已隐藏，请重新读取。</Notice>;
  const main = detail.segments.find(s => s.segment_id === detail.main_segment_id), candidates = detail.segments.filter(s => s.segment_id !== detail.main_segment_id);
  return <Panel title="更换主环节">
    <Text>当前主环节：{main?.name ?? '尚未核对'}</Text>
    <Text className="caption">本片仅支持原主和目标均未取消、均未开始的直接换主；报名截止不等于开始。旧主已开始等其它范围暂未启用，不代表永久禁止。</Text>
    <Text className="caption">只改唯一主环节，不改成员参加或各段安排、接受、核实和预订；切换后不会自动成局，仍需当前管理者明确确认。</Text>
    <RadioGroup onChange={event => { if (!confirmLock.current && !blocked && active() && getToken() === session && beforeStart(detail, event.detail.value)) setSelection({ owner, id: event.detail.value }); }}>
      {candidates.map(s => <Label key={s.segment_id}><Radio value={s.segment_id} checked={selected === s.segment_id} disabled={blocked || !beforeStart(detail, s.segment_id)} /><Text>{s.name}{beforeStart(detail, s.segment_id) ? '' : '（当前范围未启用）'}</Text></Label>)}
    </RadioGroup>
    {!candidates.some(s => beforeStart(detail, s.segment_id)) && <Notice>没有可核对的开始前目标，或原主阶段超出本片范围；不会自动改选其它环节。</Notice>}
    <Action disabled={blocked || !beforeStart(detail, selected)} onClick={() => { void change(); }}>确认更换主环节</Action>
    {notice && <Notice>{notice}</Notice>}{pendingIssue && <Notice>{pendingIssue}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result && <Notice>原请求已核对。服务器当前主环节：{result.segments.find(s => s.segment_id === result.main_segment_id)?.name ?? '待重新读取'}；当前{result.formation_status === 'confirmed' ? '已成局' : '未成局'}。这是当前事实，不代表再次执行原目标切换。</Notice>}
    {pending && <View><Notice>原结果未知。刷新查看后可用同一原请求标识手动核对；已处理的旧键可能返回后续主环节，不会自动再次切换。</Notice><Action disabled={confirming || state.busy} onClick={() => { void refresh(); }}>刷新主环节状态</Action><Action disabled={!fresh || anyBusy || confirming || state.busy || state.blocked || !!pendingIssue} onClick={() => { void retry(); }}>核对并重试原换主</Action></View>}
  </Panel>;
}

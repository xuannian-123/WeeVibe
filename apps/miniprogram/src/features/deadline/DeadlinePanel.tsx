import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Label, Radio, RadioGroup, Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, extendDeadlineInputSchema, type ActivityDetail, type ExtendDeadlineInput } from '@weevibe/contracts';
import { Action, Field, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { useStoredWrite } from '../../platform/write-state';
import { extendDeadlineForActor, deadlineError } from './api';
import { formatActivityTime } from '../shell/activity-time';

type Props = { detail: ActivityDetail; session?: string; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
type Operation = { segment_id: string; command: ExtendDeadlineInput };
function parseOperation(raw: unknown): Operation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || !('segment_id' in raw) || !('command' in raw)) throw new Error('原请求无法验证');
  return { segment_id: activityIdSchema.parse(raw.segment_id), command: extendDeadlineInputSchema.parse(raw.command) };
}
function beforeStart(detail: ActivityDetail, targetId: string) {
  const target = detail.segments.find(s => s.segment_id === targetId), now = Math.max(Date.now(), Date.parse(detail.server_time));
  return Number.isFinite(now) && !detail.cancelled_at && !!target && new Set(detail.segments.map(s => s.segment_id)).size === detail.segments.length
    && !target.cancelled_at && !target.has_started && Number.isFinite(Date.parse(target.deadline_at)) && Number.isFinite(Date.parse(target.starts_at)) && now < Date.parse(target.starts_at);
}
function sourceKey(detail: ActivityDetail, targetId: string) {
  return JSON.stringify([detail.activity_id, detail.revision, detail.cancelled_at, detail.viewer.user_id, detail.viewer.is_manager,
    detail.segments.filter(s => s.segment_id === targetId).map(s => [s.segment_id, s.name, s.starts_at, s.deadline_at, s.cancelled_at, s.has_started, s.capacity, s.minimum_participants, s.counts.occupied_count, s.counts.pending_acceptance_count, s.plan_revision, s.fee, s.requirements])]);
}
/** Fields a deadline-only mutation is not authorized to alter. Time-derived flags
 * may legitimately change while a response is in flight, but the agreed plan may not. */
function protectedState(detail: ActivityDetail, targetId: string) {
  return JSON.stringify([detail.name, detail.timezone, detail.main_segment_id, detail.cancelled_at, detail.formation_status,
    detail.segments.map(s => [s.segment_id, s.client_ref, s.position, s.type, s.name, s.starts_at, s.ends_at, s.segment_id === targetId ? null : s.deadline_at,
      s.minimum_participants, s.capacity, s.plan_revision, s.location, s.fee, s.requirements,
      s.cancelled_at, s.verification_status, s.booking_status, s.counts.occupied_count, s.counts.accepted_count,
      s.counts.pending_acceptance_count, s.counts.meets_minimum]), detail.viewer.participations]);
}
function readPending(key: string, actor: string): Operation | undefined {
  const raw: unknown = Taro.getStorageSync(key);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || (raw as { userId?: unknown }).userId !== actor) throw new Error('原请求无法验证');
  return parseOperation((raw as { input?: unknown }).input);
}
function validDeadline(detail: ActivityDetail, targetId: string, text: string): string | undefined {
  const target = detail.segments.find(s => s.segment_id === targetId);
  if (!target) return undefined;
  const parsed = extendDeadlineInputSchema.safeParse({ idempotency_key: 'validation-only-key', expected_revision: detail.revision,
    expected_deadline_at: target.deadline_at, deadline_at: text });
  if (!parsed.success) return undefined;
  const next = Date.parse(parsed.data.deadline_at), now = Math.max(Date.now(), Date.parse(detail.server_time));
  return Number.isFinite(now) && now < next && next <= Date.parse(target.starts_at) ? parsed.data.deadline_at : undefined;
}
export function DeadlinePanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined, owner = `${detail.activity_id}:${actor ?? 'guest'}`, storageKey = `weevibe-deadline-v1:${owner}`;
  const [draft, setDraft] = useState<{ owner: string; segment: string; deadline: string }>();
  const selected = draft?.owner === owner ? draft.segment : '', text = draft?.owner === owner ? draft.deadline : '';
  const draftRef = useRef({ selected, text }); draftRef.current = { selected, text };
  const [confirming, setConfirming] = useState(false), [notice, setNotice] = useState(''), [pendingIssue, setPendingIssue] = useState('');
  const confirmLock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0), resultSession = useRef<string>();
  const completionGuard = useRef<() => void>(), firstKey = useRef<string>(), resultTarget = useRef<string>();
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  // Observed A→B→A is still a different operation epoch. Equality with the
  // latest snapshot alone cannot revive an old modal, identity lookup or result.
  // Deliberately omit server_time and our own busy feedback; clock-only refreshes
  // and the parent reflecting this writer's busy state must not self-cancel.
  const observedSource = JSON.stringify([session, fresh, detail.activity_id, detail.revision, actor, detail.viewer.is_manager,
    protectedState(detail, ''), detail.segments.map(s => [s.segment_id, s.has_started])]);
  const observed = useRef(observedSource);
  if (observed.current !== observedSource) { observed.current = observedSource; epoch.current++; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; });
  const active = () => mounted.current && visible.current;
  useEffect(() => {
    setNotice(''); setPendingIssue('');
    if (actor) try { readPending(storageKey, actor); } catch { setPendingIssue('本机原报名截止请求无法读取或验证，不会覆盖；请先核对活动记录。'); }
  }, [storageKey, actor]);
  const state = useStoredWrite({ storageKey, userId: actor, parse: parseOperation,
    execute: async operation => {
      const { segment_id, command } = operation, ticket = epoch.current, before = sourceKey(detail, segment_id), first = firstKey.current === command.idempotency_key; firstKey.current = undefined;
      const assertCurrent = () => {
        const current = latest.current;
        if (!active() || ticket !== epoch.current || !session || getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || sourceKey(current.detail, segment_id) !== before)
          throw new ApiClientError('INVALID_RESPONSE', '页面、管理身份或活动快照已变化，原报名截止请求保留，请重新核对。', 0);
        assertPending(operation);
      };
      try {
        assertCurrent();
        const result = await extendDeadlineForActor(detail.activity_id, segment_id, command, actor ?? '', session, assertCurrent, first ? () => {
          if (!beforeStart(latest.current.detail, segment_id) || validDeadline(latest.current.detail, segment_id, command.deadline_at) === undefined) {
            setNotice('首次发送前本段已开始、新截止已到或状态不可核对；本次没有发送延期请求，输入保留。');
            throw new ApiClientError('INVALID_INPUT', '首次延期发送前阶段已变化', 400);
          }
        } : undefined);
        assertCurrent(); if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '响应早于当前活动快照，结果未确认。', 200);
        if (result.revision === command.expected_revision + 1 && protectedState(result, segment_id) !== protectedState(detail, segment_id))
          throw new ApiClientError('INVALID_RESPONSE', '报名截止响应包含其他安排或成员状态变化，结果尚未确认。', 200);
        completionGuard.current = assertCurrent; resultSession.current = session; resultTarget.current = segment_id; return result;
      } catch (error) { assertCurrent(); const message = deadlineError(error); if (message && active() && ticket === epoch.current) setNotice(message); throw error; }
    },
    committed: result => { if (!completionGuard.current) throw new ApiClientError('INVALID_RESPONSE', '报名截止结果尚未核对。', 0); completionGuard.current(); rememberActivity(actor ?? null, result); void refresh(); },
  });
  useEffect(() => { onBusyChange?.(confirming || state.busy); return () => onBusyChange?.(false); }, [confirming, state.busy, onBusyChange]);
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.viewer.is_manager && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  function assertPending(expected?: Operation) {
    try { if (!actor || JSON.stringify(readPending(storageKey, actor)) !== JSON.stringify(expected)) throw new Error('原请求变化'); }
    catch { setPendingIssue('原报名截止请求无法验证或已经变化，未覆盖原记录；请重新进入恢复。'); throw new ApiClientError('INVALID_RESPONSE', '原请求无法核对', 0); }
  }
  const blocked = !fresh || anyBusy || confirming || state.busy || state.blocked || !!pending || !!pendingIssue;
  const deadline = validDeadline(detail, selected, text);
  async function change() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || blocked || !beforeStart(detail, selected) || deadline === undefined) return;
    const chosen = selected, chosenText = text, ticket = epoch.current, before = sourceKey(detail, chosen), target = detail.segments.find(s => s.segment_id === chosen)!;
    const operation: Operation = { segment_id: chosen, command: extendDeadlineInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, expected_deadline_at: target.deadline_at, deadline_at: deadline }) };
    confirmLock.current = true; setConfirming(true); setNotice(''); let requested = false;
    try {
      if (!session || getToken() !== session) throw new Error('source changed'); assertPending();
      const answer = await Taro.showModal({ title: '延长本段报名截止？', content: `「${target.name}」报名截止从 ${formatActivityTime(target.deadline_at, detail.timezone)} 延至 ${formatActivityTime(deadline, detail.timezone)}。原开始时间 ${formatActivityTime(target.starts_at, detail.timezone)} 不变。仅延长新人申请与批准的窗口；不自动批准、不代成员接受、不改人数、费用、核实、预订或成局，也不修改需求问卷截止。` });
      if (!answer.confirm || !active() || ticket !== epoch.current) return;
      const current = latest.current;
      if (getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || draftRef.current.selected !== chosen || draftRef.current.text !== chosenText || sourceKey(current.detail, chosen) !== before || !beforeStart(current.detail, chosen) || validDeadline(current.detail, chosen, chosenText) === undefined) {
        setNotice('确认期间目标、输入、管理权限或开始阶段已变化，本次未发送，请重新核对。'); return;
      }
      assertPending(); firstKey.current = operation.command.idempotency_key; requested = true; state.resetResult(); await state.send(operation);
    } catch { if (active()) setNotice(requested ? '报名截止结果尚未确认，请保留原请求并核对。' : '确认未完成或来源已变化，本次未发送；可重新核对后重试。'); }
    finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || !fresh || anyBusy || state.busy || state.blocked || pendingIssue || !pending) return;
    confirmLock.current = true; setConfirming(true); setNotice('');
    try {
      if (!session || getToken() !== session) throw new Error('source changed');
      assertPending(pending.input); firstKey.current = undefined; state.resetResult(); await state.send();
    } catch { if (active()) setNotice('原请求尚未核对，不会换成新的请求标识、目标环节或报名截止。'); }
    finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  if (!actor || !detail.viewer.is_manager) return null;
  if (!session || getToken() !== session) return <Notice>身份已变化，旧管理者的报名截止输入与原请求已隐藏，请重新读取。</Notice>;
  const target = detail.segments.find(s => s.segment_id === selected), currentResult = result?.segments.find(s => s.segment_id === resultTarget.current);
  return <Panel title="延长报名截止">
    <Text className="caption">仅由当前管理者延长未取消、未开始环节的报名截止；新截止须晚于原截止和当前时间，且不晚于原开始时间。已过原截止仍可明确延期，不能绕过开始或取消限制。</Text>
    <Text className="caption">只改变新人申请与批准窗口，不自动批准、不改变席位或参加条件，不代成员接受，也不修改需求问卷截止、核实、预订或成局。</Text>
    <RadioGroup onChange={event => { if (!confirmLock.current && !blocked && active() && getToken() === session && beforeStart(detail, event.detail.value)) { const s = detail.segments.find(s => s.segment_id === event.detail.value)!; setDraft({ owner, segment: s.segment_id, deadline: new Date(s.deadline_at).toISOString() }); } }}>
      {detail.segments.map((s, index) => <Label key={`${s.segment_id}:${index}`}><Radio value={s.segment_id} checked={selected === s.segment_id} disabled={blocked || !beforeStart(detail, s.segment_id)} /><Text>{s.name} · 原截止 {formatActivityTime(s.deadline_at, detail.timezone)}{beforeStart(detail, s.segment_id) ? '' : '（已开始、已取消或状态待核对）'}</Text></Label>)}
    </RadioGroup>
    {target && <Text>原开始：{formatActivityTime(target.starts_at, detail.timezone)}。只延长报名截止，原开始、结束时间不变。</Text>}
    <Field label="新报名截止（含时区）" value={text} disabled={blocked || !beforeStart(detail, selected)} onChange={value => { if (!confirmLock.current && !blocked && active() && getToken() === session && beforeStart(detail, selected)) setDraft({ owner, segment: selected, deadline: value }); }} placeholder="例如 2030-01-02T18:00:00+08:00" hint="完整日期、时间和时区必填；Z 表示 UTC，+08:00 表示 UTC+8。不会按设备时区猜测。" />
    {target && text && deadline === undefined && <Notice>请填写带时区的有效时间，须晚于原截止和当前时间，且不晚于原开始；这里只延长，不缩短。</Notice>}
    <Action disabled={blocked || !beforeStart(detail, selected) || deadline === undefined} onClick={() => { void change(); }}>确认延长报名截止</Action>
    {notice && <Notice>{notice}</Notice>}{pendingIssue && <Notice>{pendingIssue}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result && currentResult && <Notice>原请求已核对。服务器当前「{currentResult.name}」报名截止：{formatActivityTime(currentResult.deadline_at, detail.timezone)}。这是当前事实，不代表再次执行原延期。</Notice>}
    {pending && <View><Notice>原「{detail.segments.find(s => s.segment_id === pending.input.segment_id)?.name ?? '目标环节'}」延至 {formatActivityTime(pending.input.command.deadline_at, detail.timezone)} 的结果未知。刷新后可用同一原请求手动核对；若此前未执行，服务端会重新检查，不保证所有重试均为只读。</Notice><Action disabled={confirming || state.busy} onClick={() => { void refresh(); }}>刷新截止状态</Action><Action disabled={!fresh || anyBusy || confirming || state.busy || state.blocked || !!pendingIssue} onClick={() => { void retry(); }}>核对并重试原延期</Action></View>}
  </Panel>;
}

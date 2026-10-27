import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Label, Radio, RadioGroup, Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, BOOKING_HISTORY_LIMIT, declareBookingInputSchema, type ActivityDetail, type DeclareBookingInput, type BookingHistory } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { useStoredWrite } from '../../platform/write-state';
import { errorText } from '../../platform/page-state';
import { declareBookingForActor, readBookingHistoryForActor, bookingError } from './api';
import { formatActivityTime } from '../shell/activity-time';

type Props = { detail: ActivityDetail; session?: string; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
type Operation = { segment_id: string; command: DeclareBookingInput };
function parseOperation(raw: unknown): Operation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || !('segment_id' in raw) || !('command' in raw)) throw new Error('原请求无法验证');
  return { segment_id: activityIdSchema.parse(raw.segment_id), command: declareBookingInputSchema.parse(raw.command) };
}
function beforeStart(detail: ActivityDetail, targetId: string) {
  const target = detail.segments.find(s => s.segment_id === targetId), now = Math.max(Date.now(), Date.parse(detail.server_time));
  return Number.isFinite(now) && !detail.cancelled_at && !!target && new Set(detail.segments.map(s => s.segment_id)).size === detail.segments.length
    && !target.cancelled_at && !target.has_started && target.booking_status === 'unknown' && Number.isFinite(Date.parse(target.starts_at)) && now < Date.parse(target.starts_at);
}
function sourceKey(detail: ActivityDetail, targetId: string) {
  return JSON.stringify([detail.activity_id, detail.revision, detail.cancelled_at, detail.viewer.user_id, detail.viewer.is_manager,
    detail.segments.filter(s => s.segment_id === targetId).map(s => [s.segment_id, s.name, s.starts_at, s.deadline_at, s.cancelled_at, s.has_started, s.capacity, s.minimum_participants, s.counts.occupied_count, s.counts.pending_acceptance_count, s.plan_revision, s.location, s.ends_at, s.booking_status, s.fee, s.requirements])]);
}
/** Fields a booking-only declaration is not authorized to alter. Time-derived flags
 * may legitimately change while a response is in flight, but the agreed plan may not. */
function protectedState(detail: ActivityDetail, targetId: string) {
  return JSON.stringify([detail.name, detail.timezone, detail.main_segment_id, detail.cancelled_at, detail.formation_status,
    detail.segments.map(s => [s.segment_id, s.client_ref, s.position, s.type, s.name, s.starts_at, s.ends_at, s.deadline_at,
      s.minimum_participants, s.capacity, s.plan_revision, s.location, s.fee, s.requirements,
      s.cancelled_at, s.verification_status, s.segment_id === targetId ? null : s.booking_status, s.counts.occupied_count, s.counts.accepted_count,
      s.counts.pending_acceptance_count, s.counts.meets_minimum]), detail.viewer.participations, detail.viewer.applications, detail.applications]);
}
function readPending(key: string, actor: string): Operation | undefined {
  const raw: unknown = Taro.getStorageSync(key);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 || (raw as { userId?: unknown }).userId !== actor) throw new Error('原请求无法验证');
  return parseOperation((raw as { input?: unknown }).input);
}
export function BookingPanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined, owner = `${detail.activity_id}:${actor ?? 'guest'}`, storageKey = `weevibe-booking-v1:${owner}`;
  const [draft, setDraft] = useState<{ owner: string; segment: string }>();
  const selected = draft?.owner === owner ? draft.segment : '';
  const draftRef = useRef(selected); draftRef.current = selected;
  const [reading, setReading] = useState(false), [historyState, setHistory] = useState<{ data: BookingHistory; source: string; session: string; epoch: number }>();
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
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; setHistory(undefined); });
  const active = () => mounted.current && visible.current;
  useEffect(() => {
    setNotice(''); setPendingIssue('');
    if (actor) try { readPending(storageKey, actor); } catch { setPendingIssue('本机原人工预订声明请求无法读取或验证，不会覆盖；请先核对活动记录。'); }
  }, [storageKey, actor]);
  const state = useStoredWrite({ storageKey, userId: actor, parse: parseOperation,
    execute: async operation => {
      const { segment_id, command } = operation, ticket = epoch.current, before = sourceKey(detail, segment_id), first = firstKey.current === command.idempotency_key; firstKey.current = undefined;
      const assertCurrent = () => {
        const current = latest.current;
        if (!active() || ticket !== epoch.current || !session || getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || sourceKey(current.detail, segment_id) !== before)
          throw new ApiClientError('INVALID_RESPONSE', '页面、管理身份或活动快照已变化，原人工预订声明请求保留，请重新核对。', 0);
        assertPending(operation);
      };
      try {
        assertCurrent();
        const result = await declareBookingForActor(detail.activity_id, segment_id, command, actor ?? '', session, assertCurrent, first ? () => {
          if (!beforeStart(latest.current.detail, segment_id) ) {
            setNotice('首次发送前本段已开始、已有标记或状态不可核对；本次没有发送人工声明请求，输入保留。');
            throw new ApiClientError('INVALID_INPUT', '首次人工声明发送前阶段已变化', 400);
          }
        } : undefined);
        assertCurrent(); if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '响应早于当前活动快照，结果未确认。', 200);
        if (result.revision === command.expected_revision + 1 && protectedState(result, segment_id) !== protectedState(detail, segment_id))
          throw new ApiClientError('INVALID_RESPONSE', '人工预订声明响应包含其他安排或成员状态变化，结果尚未确认。', 200);
        completionGuard.current = assertCurrent; resultSession.current = session; resultTarget.current = segment_id; return result;
      } catch (error) { assertCurrent(); const message = bookingError(error); if (message && active() && ticket === epoch.current) setNotice(message); throw error; }
    },
    committed: result => { if (!completionGuard.current) throw new ApiClientError('INVALID_RESPONSE', '人工预订声明结果尚未核对。', 0); completionGuard.current(); setHistory(undefined); rememberActivity(actor ?? null, result); void refresh(); },
  });
  useEffect(() => { onBusyChange?.(confirming || reading || state.busy); return () => onBusyChange?.(false); }, [confirming, reading, state.busy, onBusyChange]);
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.viewer.is_manager && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  function assertPending(expected?: Operation) {
    try { if (!actor || JSON.stringify(readPending(storageKey, actor)) !== JSON.stringify(expected)) throw new Error('原请求变化'); }
    catch { setPendingIssue('原人工预订声明请求无法验证或已经变化，未覆盖原记录；请重新进入恢复。'); throw new ApiClientError('INVALID_RESPONSE', '原请求无法核对', 0); }
  }
  const selectionBusy = !fresh || anyBusy || reading || confirming || state.busy;
  const blocked = selectionBusy || state.blocked || !!pending || !!pendingIssue;
  async function change() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || blocked || !beforeStart(detail, selected)) return;
    const chosen = selected, ticket = epoch.current, before = sourceKey(detail, chosen), target = detail.segments.find(s => s.segment_id === chosen)!;
    const operation: Operation = { segment_id: chosen, command: declareBookingInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, expected_plan_revision: target.plan_revision, expected_booking_status: 'unknown' }) };
    confirmLock.current = true; setConfirming(true); setNotice(''); let requested = false;
    try {
      if (!session || getToken() !== session) throw new Error('source changed'); assertPending();
      const answer = await Taro.showModal({ title: '记录人工预订声明？', content: `「${target.name}」场馆：${target.location.name}${target.location.address ? ' · ' + target.location.address : ''}。时段：${formatActivityTime(target.starts_at, detail.timezone)} 至 ${formatActivityTime(target.ends_at, detail.timezone)}。确认表示：我已自行在系统外核对该场馆与时段的预订，现在只记录人工声明。这不是下单、付款或商家API核验，不代表地点已核实或成局；本片不提供撤回、订正、退订或退款。` });
      if (!answer.confirm || !active() || ticket !== epoch.current) return;
      const current = latest.current;
      if (getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || draftRef.current !== chosen || sourceKey(current.detail, chosen) !== before || !beforeStart(current.detail, chosen)) {
        setNotice('确认期间目标、输入、管理权限或开始阶段已变化，本次未发送，请重新核对。'); return;
      }
      assertPending(); firstKey.current = operation.command.idempotency_key; requested = true; state.resetResult(); await state.send(operation);
    } catch { if (active()) setNotice(requested ? '人工预订声明结果尚未确认，请保留原请求并核对。' : '确认未完成或来源已变化，本次未发送；可重新核对后重试。'); }
    finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || !fresh || anyBusy || reading || state.busy || state.blocked || pendingIssue || !pending) return;
    confirmLock.current = true; setConfirming(true); setNotice('');
    try {
      if (!session || getToken() !== session) throw new Error('source changed');
      assertPending(pending.input); firstKey.current = undefined; state.resetResult(); await state.send();
    } catch { if (active()) setNotice('原请求尚未核对，不会换成新的请求标识、目标环节或人工预订声明。'); }
    finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  const history = historyState?.source === sourceKey(detail, selected) && historyState.session === session && historyState.epoch === epoch.current ? historyState.data : undefined;
  async function loadHistory() {
    if (!actor || !detail.viewer.is_manager || confirmLock.current || !active() || !fresh || anyBusy || reading || confirming || state.busy || !selected) return;
    const ticket = epoch.current, before = sourceKey(detail, selected), chosen = selected;
    const assertCurrent = () => {
      const current = latest.current;
      if (!active() || ticket !== epoch.current || !session || getToken() !== session || current.session !== session || !current.fresh || !current.detail.viewer.is_manager || sourceKey(current.detail, chosen) !== before)
        throw new ApiClientError('INVALID_RESPONSE', '历史来源或管理身份已变化，请重新读取。', 0);
    };
    confirmLock.current = true; setReading(true); setNotice(''); setHistory(undefined);
    try {
      assertCurrent(); const data = await readBookingHistoryForActor(detail.activity_id, chosen, actor, session, assertCurrent); assertCurrent();
      const target = latest.current.detail.segments.find(s => s.segment_id === chosen);
      if (!target || data.revision !== latest.current.detail.revision || data.current_plan_revision !== target.plan_revision || data.current_booking_status !== target.booking_status
        || data.current.location.name !== target.location.name || data.current.location.address !== target.location.address
        || data.current.timezone !== latest.current.detail.timezone || Date.parse(data.current.starts_at) !== Date.parse(target.starts_at) || Date.parse(data.current.ends_at) !== Date.parse(target.ends_at))
        throw new ApiClientError('INVALID_RESPONSE', '历史响应与当前场馆、时段或版本不符，请刷新后重读。', 200);
      setHistory({ data, source: before, session: session!, epoch: ticket });
    } catch (error) { if (active() && ticket === epoch.current) setNotice(bookingError(error) ?? errorText(error)); }
    finally { confirmLock.current = false; if (mounted.current) setReading(false); }
  }
  if (!actor || !detail.viewer.is_manager) return null;
  if (!session || getToken() !== session) return <Notice>身份已变化，旧管理者的人工预订声明与历史已隐藏，请重新读取。</Notice>;
  const target = detail.segments.find(s => s.segment_id === selected), currentResult = result?.segments.find(s => s.segment_id === resultTarget.current);
  return <Panel title="人工记录预订">
    <Text className="caption">仅由当前管理者，按当前公开场馆和时段记录自己在系统外核对的预订；这是人工声明，不是系统下单、付款或商家API核验，也不等于地点核实或成局。</Text>
    <Text className="caption">本片只开放未取消且未开始段的首次人工标记，不受报名截止限制；开始后的新记录、撤回与订正尚未启用，也不代退订退款。既有未知请求可核对原结果。</Text>
    <Text className="caption">历史每次最多完整核验 {BOOKING_HISTORY_LIMIT} 条专属人工声明；超限或记录不可核验时明确不可用，不静默截断成完整历史。</Text>
    <RadioGroup onChange={event => { if (!confirmLock.current && !selectionBusy && active() && getToken() === session && detail.segments.some(s => s.segment_id === event.detail.value)) { setDraft({ owner, segment: event.detail.value }); setHistory(undefined); setNotice(''); } }}>
      {detail.segments.map((s, index) => <Label key={`${s.segment_id}:${index}`}><Radio value={s.segment_id} checked={selected === s.segment_id} disabled={selectionBusy} /><Text>{s.name} · {s.booking_status === 'manual_booked' ? '人工标记已预订' : '尚未人工标记'}{detail.cancelled_at || s.cancelled_at ? '（已取消，仅历史查看）' : ''}</Text></Label>)}
    </RadioGroup>
    {target && <View><Text>当前公开场馆：{target.location.name}{target.location.address ? ' · ' + target.location.address : ''}</Text><Text>当前时段：{formatActivityTime(target.starts_at, detail.timezone)} 至 {formatActivityTime(target.ends_at, detail.timezone)}</Text><Text>当前参加条件版本 {target.plan_revision} · 活动版本 {detail.revision}</Text></View>}
    {target?.booking_status === 'manual_booked' && <Notice>当前已有人工预订标记；本片不重复声明、不提供撤回或订正。请主动查看历史核对原场馆与时段，标记本身不是商家确认或付款凭证。</Notice>}
    <Action disabled={blocked || !beforeStart(detail, selected)} onClick={() => { void change(); }}>确认记录人工预订</Action>
    <Action disabled={!fresh || anyBusy || reading || confirming || state.busy || !target} onClick={() => { void loadHistory(); }}>{reading ? '正在读取声明历史…' : '查看本段声明历史'}</Action>
    {history?.state === 'verified' && <View><Notice>以下为可验证的系统内人工声明记录，仅关联当时公开场馆和时段，不是商家订单凭证。</Notice>{history.items.map(item => <View key={item.activity_revision}><Text>人工声明 · {formatActivityTime(item.declared_at, item.timezone)} · 活动记录 {item.activity_revision} / 参加条件版本 {item.plan_revision}</Text><Text>当时场馆：{item.location.name}{item.location.address ? ' · ' + item.location.address : ''}</Text><Text>当时时段：{formatActivityTime(item.starts_at, item.timezone)} 至 {formatActivityTime(item.ends_at, item.timezone)}</Text><Text>{item.matches_current_venue_time ? '所存场馆与时段和当前字段相同（不是供应商有效性核验）' : '所存场馆或时段不同于当前安排；请人工核对旧预约，不据此为新安排盖章。'}</Text></View>)}</View>}
    {history?.state === 'not_recorded' && <Notice>未查到此段可验证的系统内人工声明记录；不代表未发生系统外预订，也不会自动改变当前标记。</Notice>}
    {history?.state === 'legacy_unverified' && <Notice>当前为旧人工预订标记，但声明历史未提供；不会用当前场馆与时段补造旧预约记录。</Notice>}
    {history?.state === 'unavailable' && <Notice>声明历史暂不可完整核验（格式或规模边界）；不展示截断记录，也不将其说成零历史，请线下核对并刷新。</Notice>}
    {notice && <Notice>{notice}</Notice>}{pendingIssue && <Notice>{pendingIssue}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result && currentResult && <Notice>原请求已核对。服务器当前「{currentResult.name}」为{currentResult.booking_status === 'manual_booked' ? '人工标记已预订' : '尚未人工标记'}；这不是系统下单或付款成功，不代表再次执行原声明。已刷新活动，请主动读取本段历史。</Notice>}
    {pending && <View><Notice>原「{detail.segments.find(s => s.segment_id === pending.input.segment_id)?.name ?? '目标环节'}」人工预订声明结果未知。核对沿用原目标、计划版本与请求标识；若此前未执行，服务端会重新核验，不保证所有重试只读。</Notice><Action disabled={reading || confirming || state.busy} onClick={() => { void refresh(); }}>刷新当前预订状态</Action><Action disabled={!fresh || anyBusy || reading || confirming || state.busy || state.blocked || !!pendingIssue} onClick={() => { void retry(); }}>核对并重试原人工声明</Action></View>}
  </Panel>;
}

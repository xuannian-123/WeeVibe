import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { createHandoverInputSchema, handoverCommandSchema, type ActivityDetail, type HandoverOffer, type HandoverState } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { errorText } from '../../platform/page-state';
import { useStoredWrite } from '../../platform/write-state';
import { handoverErrorMessage, offerIdentity, parseHandoverOperation, readHandover, readHandovers, submitHandover, type HandoverOperation, type OfferIdentity } from './api';

type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
const sourceKey = (detail: ActivityDetail) => JSON.stringify([detail.activity_id, detail.revision, detail.main_segment_id, detail.viewer.user_id, detail.viewer.is_manager, detail.cancelled_at, detail.segments, detail.viewer.participations]);
const stateKey = (state: HandoverState) => JSON.stringify([state.management_revision, state.can_create, state.candidates, state.pending, state.offer, state.activity.revision, state.activity.viewer.user_id, state.activity.viewer.is_manager, state.activity.cancelled_at]);
const statusText = { pending: '等待指定接任人处理', accepted: '此交接历史已接受', rejected: '此交接已被拒绝', withdrawn: '此交接已撤回', invalidated: '此交接已失效' };
function blockedText(offer: HandoverOffer) {
  if (offer.blocked_reason === 'activity_cancelled') return '活动已取消，待接交接不能生效；历史与已生效管理归属保留。';
  if (offer.blocked_reason === 'management_changed') return '管理归属已有变化，请刷新核对；旧交接不会恢复旧管理权。';
  if (offer.blocked_reason === 'recipient_scope_unavailable') return '接任人当前没有符合资格的有效参加环节，暂不能接受；待接记录仍保留，本人可拒绝，当前管理者可撤回。';
  return offer.status === 'pending' && !offer.can_accept && !offer.can_reject && !offer.can_withdraw ? '当前状态无法执行本片交接动作，请刷新核对。' : '';
}
export function HandoverPanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined, source = sourceKey(detail);
  const [viewState, setView] = useState<{ data: HandoverState; source: string; session: string; epoch: number }>();
  const [selected, setSelected] = useState(''), [reading, setReading] = useState(false), [confirming, setConfirming] = useState(false), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0), resultSession = useRef<string>();
  const automaticRead = useRef<string>();
  const completionGuard = useRef<() => void>();
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  const latestView = useRef(viewState); latestView.current = viewState;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; setView(undefined); void load(); });
  const active = () => mounted.current && visible.current;
  function guard(ticket: number, before: string, viewFingerprint?: string) {
    const current = latest.current, currentView = latestView.current;
    if (!active() || ticket !== epoch.current || !session || getToken() !== session || current.session !== session || !current.fresh
      || sourceKey(current.detail) !== before || (viewFingerprint !== undefined && (!currentView || currentView.source !== before
        || currentView.session !== session || currentView.epoch !== ticket || stateKey(currentView.data) !== viewFingerprint)))
      throw new ApiClientError('INVALID_RESPONSE', '交接来源、账号或页面已变化，结果未确认；请刷新原活动核对，原请求保留。', 0);
  }
  const state = useStoredWrite({ storageKey: `weevibe-handover-v1:${detail.activity_id}:${actor ?? 'guest'}`, userId: actor,
    parse: parseHandoverOperation,
    execute: async operation => {
      const ticket = epoch.current, before = sourceKey(detail), loaded = latestView.current;
      if (!loaded || loaded.source !== before || loaded.session !== session || loaded.epoch !== ticket)
        throw new ApiClientError('INVALID_RESPONSE', '请先读取当前交接状态，原请求保留。', 0);
      const fingerprint = stateKey(loaded.data), assertCurrent = () => guard(ticket, before, fingerprint);
      try {
        assertCurrent();
        const result = await submitHandover(detail.activity_id, operation, actor ?? '', session, assertCurrent);
        assertCurrent();
        if (result.activity.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '交接结果早于当前活动，请刷新核对。', 200);
        completionGuard.current = assertCurrent; resultSession.current = session; return result;
      } catch (error) { if (active() && ticket === epoch.current) setNotice(handoverErrorMessage(error) ?? ''); throw error; }
    }, committed: result => {
      if (!completionGuard.current) throw new ApiClientError('INVALID_RESPONSE', '交接结果未确认，原请求保留。', 0);
      completionGuard.current(); rememberActivity(actor ?? null, result.activity); setView(undefined); void refresh();
    }
  });
  const view = viewState?.source === source && viewState.session === session && viewState.epoch === epoch.current ? viewState.data : undefined;
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity.activity_id === detail.activity_id && state.result.activity.viewer.user_id === actor && state.result.activity.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  const busy = anyBusy || reading || confirming || state.busy;
  const currentOffer = view?.offer ?? view?.pending;
  const target = view?.candidates.find(candidate => candidate.user_id === selected);
  useEffect(() => { onBusyChange?.(reading || confirming || state.busy); return () => onBusyChange?.(false); }, [reading, confirming, state.busy, onBusyChange]);
  useEffect(() => { setSelected(''); setNotice(''); }, [detail.activity_id, actor]);
  useEffect(() => {
    const identity = `${session ?? ''}:${source}:${epoch.current}`;
    // A source change that arrives while another action is busy must be read
    // once the action settles. Failed reads are NOT automatically loop-retried.
    if (actor && session && fresh && !busy && !lock.current && automaticRead.current !== identity) void load();
  }, [source, session, fresh, anyBusy, reading, confirming, state.busy]);
  async function load(history?: OfferIdentity) {
    if (lock.current || !active() || !fresh || busy || !actor || !session) return;
    if (!history) automaticRead.current = `${session}:${sourceKey(detail)}:${epoch.current}`;
    lock.current = true; setReading(true); setNotice(''); setView(undefined);
    const ticket = epoch.current, before = sourceKey(detail);
    try {
      const assertCurrent = () => guard(ticket, before);
      const data = history ? await readHandover(detail.activity_id, history, actor, session, assertCurrent) : await readHandovers(detail.activity_id, actor, session, assertCurrent);
      assertCurrent();
      if (data.activity.revision !== detail.revision || data.activity.viewer.is_manager !== detail.viewer.is_manager || data.activity.cancelled_at !== detail.cancelled_at)
        throw new ApiClientError('VERSION_CONFLICT', '活动已经变化，请先刷新活动，再读取交接状态。', 409);
      setView({ data, source: before, session, epoch: ticket });
    } catch (error) { if (active() && ticket === epoch.current) setNotice(handoverErrorMessage(error) ?? errorText(error)); }
    finally { lock.current = false; if (mounted.current) setReading(false); }
  }
  async function confirm(action: 'create' | 'accept' | 'reject' | 'withdraw') {
    if (lock.current || !active() || !fresh || busy || state.blocked || pending || !view || !actor) return;
    if (action === 'create' ? !detail.viewer.is_manager || !view.can_create || !target : !currentOffer || !currentOffer[`can_${action}`]) return;
    const common = { expected_revision: view.activity.revision, expected_management_revision: view.management_revision, idempotency_key: newKey() };
    const operation: HandoverOperation = action === 'create'
      ? { kind: 'create', input: createHandoverInputSchema.parse({ ...common, target_user_id: target!.user_id }) }
      : { kind: 'command', offer: offerIdentity(currentOffer!), input: handoverCommandSchema.parse({ ...common, action }) };
    const ticket = epoch.current, before = sourceKey(detail), fingerprint = stateKey(view);
    const dialogs = {
      create: { title: '邀请指定成员接任管理？', content: `接任人：${target?.display_name || '所选参与者'}。对方本人接受后才切换唯一管理者；等待或拒绝期间仍由你管理。没有自动过期，不替任何人加入、退出或接受安排。` },
      accept: { title: '接受管理权交接？', content: '服务端将复验你仍有符合本片资格的参加环节与当前管理归属。成功后成为同一活动的唯一管理者；原管理者失去管理权限，双方参加状态、原安排、费用和预订不变。' },
      reject: { title: '拒绝这份管理交接？', content: '只拒绝这份交接，原管理者继续管理；不会退出你参加的任何环节，也不会改动活动安排。' },
      withdraw: { title: '撤回这份管理交接？', content: '只撤回仍待接受的交接，当前管理权和参加状态不变。对方已接受成功的交接不能通过本操作撤销。' }
    };
    lock.current = true; setConfirming(true); setNotice('');
    try {
      guard(ticket, before, fingerprint);
      const answer = await Taro.showModal(dialogs[action]);
      if (!answer.confirm) return;
      guard(ticket, before, fingerprint);
      state.resetResult(); await state.send(operation);
    } catch { if (active() && ticket === epoch.current) setNotice('确认未完成或交接来源已变化；请重新核对，本次未继续提交。'); }
    finally { lock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (lock.current || !active() || !fresh || busy || state.blocked || !pending || !view) return;
    if ((pending.input.kind === 'create' || pending.input.input.action === 'withdraw') && !detail.viewer.is_manager) return;
    lock.current = true; setNotice(''); state.resetResult();
    try { await state.send(); } finally { lock.current = false; }
  }
  if (!actor) return null;
  if (!session || getToken() !== session) return <Notice>账号已变化，原账号的交接内容已隐藏，请重新读取本人活动。</Notice>;
  const retryRole = !!pending && (pending.input.kind === 'command' && pending.input.input.action !== 'withdraw' || detail.viewer.is_manager);
  const operationBlocked = !fresh || busy || state.blocked || !!pending || !view;
  return <Panel title="管理权交接">
    <Text className="caption">同一活动只有一位当前管理者、至多一份待接交接；指定本人接受后才生效，没有自动过期。管理与参加独立，原链接、名单和安排保留。</Text>
    <Text className="caption">接任资格：仍参加至少一个未取消、尚未结束的有效环节。正在进行或保位待重新接受的参加也可接任；交接不会代替安排接受。报名截止不单独阻止交接。</Text>
    <Action disabled={!fresh || busy} onClick={() => { void load(); }}>{reading ? '正在读取交接…' : '读取交接与接任候选'}</Action>
    {!view && !reading && <Notice>尚未取得可用的交接状态；不会把读取失败当作没有邀请或伪造成员候选。</Notice>}
    {view && <View>
      <Text className="caption">服务器当前权限：{view.activity.viewer.is_manager ? '你是当前管理者' : '你不是当前管理者'}。</Text>
      {view.activity.viewer.is_manager && !currentOffer && <View>
        {!view.candidates.length && <Notice>当前没有服务端返回的本片合格接任候选；不是完整成员名册。</Notice>}
        {view.candidates.map((candidate, index) => <Action key={candidate.user_id} disabled={operationBlocked} onClick={() => {
          try { guard(epoch.current, source, stateKey(view)); if (!lock.current && !busy) setSelected(candidate.user_id); } catch { /* A stale candidate never becomes a new selection. */ }
        }}>{candidate.user_id === target?.user_id ? '已选：' : '选择：'}{candidate.display_name || `参与者 ${index + 1}`}</Action>)}
        <Action variant="primary" disabled={operationBlocked || !view.can_create || !target} onClick={() => { void confirm('create'); }}>发起管理交接</Action>
      </View>}
      {!view.activity.viewer.is_manager && !currentOffer && <Notice>当前没有服务端返回的发给本人的待接交接。</Notice>}
      {currentOffer && <View>
        <Notice>{statusText[currentOffer.status]}。{currentOffer.status === 'pending' ? '等待期间仍由原管理者负责。' : '这是该条交接历史，不代表当前管理权再次变化。'}</Notice>
        {blockedText(currentOffer) && <Notice>{blockedText(currentOffer)}</Notice>}
        {currentOffer.can_accept && <Action variant="primary" disabled={operationBlocked} onClick={() => { void confirm('accept'); }}>接受管理交接</Action>}
        {currentOffer.can_reject && <Action disabled={operationBlocked} onClick={() => { void confirm('reject'); }}>拒绝管理交接</Action>}
        {currentOffer.can_withdraw && <Action variant="danger" disabled={operationBlocked} onClick={() => { void confirm('withdraw'); }}>撤回管理交接</Action>}
        {currentOffer.status === 'accepted' && <Notice>此交接历史已接受；当前{view.activity.viewer.is_manager ? '你是管理者' : '你不是管理者'}，不会因查看历史恢复旧权限。</Notice>}
        {view.pending && view.offer && view.pending.handover_id !== view.offer.handover_id && <Notice>另有一份当前待接交接，请读取最新交接状态查看，不会用历史记录代替。</Notice>}
        {currentOffer.status !== 'pending' && view.can_create && <Action disabled={!fresh || busy} onClick={() => { void load(); }}>返回接任候选</Action>}
      </View>}
      {view.activity.cancelled_at && <Notice>整场活动已取消，待接交接不能生效；已接受的管理归属不会因此回到原创建者。</Notice>}
    </View>}
    {notice && <Notice>{notice}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result?.offer && <Notice>服务端结果：{statusText[result.offer.status]}；服务器当前{result.activity.viewer.is_manager ? '你是管理者' : '你不是管理者'}。以当前权限为准，不重复切换或恢复旧管理权。</Notice>}
    {pending && <View><Notice>上次交接结果未确认。先刷新并读取交接，重试沿用本人原内容和请求标识；若此前未成功，服务端仍会复验条件。</Notice>
      <Action disabled={busy} onClick={() => { void refresh(); }}>刷新活动核对</Action>
      {pending.input.kind === 'command' && <Action disabled={!fresh || busy} onClick={() => { if (pending.input.kind === 'command') void load(pending.input.offer); }}>查看原交接记录</Action>}
      {!retryRole && <Notice>当前已无发起／撤回的管理权限，原请求保留，但不会以旧管理身份重放。</Notice>}
      <Action disabled={!fresh || busy || state.blocked || !view || !retryRole} onClick={() => { void retry(); }}>核对并重试原交接操作</Action>
    </View>}
  </Panel>;
}

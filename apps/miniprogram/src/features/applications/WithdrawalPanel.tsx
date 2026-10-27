import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, withdrawApplicationInputSchema, type ActivityDetail, type WithdrawApplicationInput } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { useStoredWrite } from '../../platform/write-state';
import { withdrawalErrorMessage, withdrawForActor } from './withdrawal-api';

type Operation = { applicationId: string; input: WithdrawApplicationInput };
type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
function parseOperation(raw: unknown): Operation {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).some(key => key !== 'applicationId' && key !== 'input')) throw new Error('无法恢复原撤回请求');
  const value = raw as { applicationId?: unknown; input?: unknown };
  return { applicationId: activityIdSchema.parse(value.applicationId), input: withdrawApplicationInputSchema.parse(value.input) };
}
function ownApplication(detail: ActivityDetail, id: string) {
  return detail.viewer.applications.find(application => application.application_id === id && application.applicant_user_id === detail.viewer.user_id);
}
function earlyScope(detail: ActivityDetail, id: string) {
  const application = ownApplication(detail, id), now = Date.parse(detail.server_time);
  return !!application && application.status === 'pending' && application.segments.length > 0 && !detail.cancelled_at
    && application.segments.every(target => {
      const segment = detail.segments.find(value => value.segment_id === target.segment_id);
      // Capacity is irrelevant: withdrawing an unapproved request does not release a seat.
      return !!segment && !segment.cancelled_at && !segment.has_started && now < Date.parse(segment.starts_at) && now < Date.parse(segment.deadline_at);
    });
}
function sourceKey(detail: ActivityDetail, id: string) {
  const application = ownApplication(detail, id);
  return JSON.stringify([detail.activity_id, detail.revision, detail.viewer.user_id, detail.cancelled_at, application,
    application?.segments.map(target => detail.segments.find(segment => segment.segment_id === target.segment_id)), earlyScope(detail, id)]);
}

export function WithdrawalPanel({ detail, session, fresh, anyBusy, refresh, onBusyChange }: Props) {
  const actor = detail.viewer.user_id ?? undefined;
  const [confirming, setConfirming] = useState(false), [notice, setNotice] = useState('');
  const confirmLock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0), resultSession = useRef<string>();
  const acknowledgement = useRef<{ ticket: number; session: string; applicationId: string; source: string }>();
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; });
  const active = () => mounted.current && visible.current;
  const state = useStoredWrite({ storageKey: `weevibe-withdrawal-v1:${detail.activity_id}:${actor ?? 'guest'}`, userId: actor,
    parse: parseOperation,
    execute: async operation => {
      const ticket = epoch.current, before = sourceKey(detail, operation.applicationId);
      const assertCurrent = () => {
        const current = latest.current;
        if (!active() || epoch.current !== ticket || !session || getToken() !== session || current.session !== session || !current.fresh
          || !ownApplication(current.detail, operation.applicationId) || sourceKey(current.detail, operation.applicationId) !== before)
          throw new ApiClientError('INVALID_RESPONSE', '页面、身份或申请状态已变化，结果未确认；请回到原活动核对，原请求保留。', 0);
      };
      try {
        assertCurrent();
        // Replays may reach the server after the early phase. Only a server-recorded
        // successful key is a read-only replay; an uncommitted command is rechecked.
        const result = await withdrawForActor(detail.activity_id, operation.applicationId, operation.input, actor ?? '', session, assertCurrent);
        assertCurrent();
        if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '服务端结果早于当前申请状态，请刷新核对。', 200);
        resultSession.current = session;
        acknowledgement.current = { ticket, session: session!, applicationId: operation.applicationId, source: before };
        return result;
      } catch (error) {
        const message = withdrawalErrorMessage(error);
        if (message && active() && epoch.current === ticket) setNotice(message);
        throw error;
      }
    },
    committed: result => {
      const ack = acknowledgement.current, current = latest.current;
      if (!ack || !active() || epoch.current !== ack.ticket || getToken() !== ack.session || current.session !== ack.session
        || current.detail.activity_id !== result.activity_id || current.detail.viewer.user_id !== result.viewer.user_id
        || !current.fresh || sourceKey(current.detail, ack.applicationId) !== ack.source)
        throw new ApiClientError('INVALID_RESPONSE', '页面已变化，已发请求可能提交；请回原活动核对，原请求保留。', 0);
      rememberActivity(actor ?? null, result); void refresh();
    }
  });
  useEffect(() => { onBusyChange?.(state.busy || confirming); return () => onBusyChange?.(false); }, [state.busy, confirming, onBusyChange]);
  useEffect(() => { setNotice(''); }, [detail.activity_id, actor]);
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  const applications = detail.viewer.applications.filter(application => application.status === 'pending' && application.applicant_user_id === actor);
  const blocked = !fresh || anyBusy || confirming || state.busy || state.blocked || !!pending;
  async function withdraw(applicationId: string) {
    if (!actor || confirmLock.current || !active() || blocked || !earlyScope(detail, applicationId)) return;
    const application = ownApplication(detail, applicationId)!;
    const operation: Operation = { applicationId, input: withdrawApplicationInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision }) };
    const ticket = epoch.current, before = sourceKey(detail, applicationId);
    confirmLock.current = true; setConfirming(true); setNotice(''); let requested = false;
    try {
      if (!session || getToken() !== session) throw new Error('changed source');
      const answer = await Taro.showModal({ title: '撤回这整份待审批申请？', content: `${application.segments.map(target => detail.segments.find(segment => segment.segment_id === target.segment_id)?.name ?? '历史环节').join(' ＋ ')}。只撤回这份尚未获批的申请；不会退出已有席位，不改变已有安排接受、费用或预订。重新申请仍需本人接受当前安排并由发起人批准。` });
      if (!answer.confirm || !active() || epoch.current !== ticket) return;
      const current = latest.current;
      if (getToken() !== session || current.session !== session || !current.fresh || sourceKey(current.detail, applicationId) !== before || !earlyScope(current.detail, applicationId)) {
        setNotice('确认期间身份、申请或活动阶段已变化，请刷新核对；本次未发送。'); return;
      }
      requested = true; state.resetResult(); await state.send(operation);
    } catch {
      if (active()) setNotice(requested ? '撤回结果未确认，请刷新核对，原请求仍保留。' : '确认未完成或账号已变化，本次未发送，可核对后重试。');
    } finally { confirmLock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (confirmLock.current || !active() || !fresh || anyBusy || confirming || state.busy || state.blocked || !pending) return;
    setNotice(''); state.resetResult(); await state.send();
  }
  if (!actor) return null;
  if (!session || getToken() !== session) return <Notice>账号已变化，原账号的撤回操作已隐藏，请重新读取本人申请。</Notice>;
  if (!applications.length && !pending && !result) return null;
  return <Panel title="撤回待审批申请">
    <Text className="caption">申请尚未获批，不占席位。撤回申请与退出已参加环节不是一回事；已有席位和接受记录保留。</Text>
    {applications.map(application => <View key={application.application_id} className="activity-request">
      <Text>{application.segments.map(target => detail.segments.find(segment => segment.segment_id === target.segment_id)?.name ?? '历史环节').join(' ＋ ')}</Text>
      <Action variant="danger" disabled={blocked || !earlyScope(detail, application.application_id)} onClick={() => { void withdraw(application.application_id); }}>撤回这份申请</Action>
      {!earlyScope(detail, application.application_id) && <Notice>相关活动或环节已截止、开始、取消，或状态尚不完整；这些阶段的新撤回规则待确认，本片暂未启用。已有席位不会退出。</Notice>}
    </View>)}
    {notice && <Notice>{notice}</Notice>}{state.message && (!state.result || result) && <Notice>{state.message}</Notice>}
    {result && <Notice>服务端已确认这份申请已撤回；已有参加记录不会因撤回而退出。</Notice>}
    {pending && <View><Notice>上次撤回结果未确认。先刷新核对；重试沿用本人的原申请和请求标识，若此前未成功，服务端会重新检查当前条件。</Notice><Action disabled={state.busy || confirming} onClick={() => { void refresh(); }}>刷新申请状态</Action><Action disabled={!fresh || anyBusy || state.busy || state.blocked || confirming} onClick={() => { void retry(); }}>核对并重试原撤回</Action></View>}
  </Panel>;
}

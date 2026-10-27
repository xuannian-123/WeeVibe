import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, applyToActivityInputSchema, decideApplicationInputSchema, type ActivityDetail, type DecideApplicationInput } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { applyForActor, decideForActor } from './api';
import { newKey } from '../../platform/page-state';
import { rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';

type DecisionEnvelope = { applicationId: string; input: DecideApplicationInput };
function parseDecision(raw: unknown): DecisionEnvelope {
  if (!raw || typeof raw !== 'object') throw new Error('无法恢复原审批请求');
  const value = raw as { applicationId?: unknown; input?: unknown };
  return { applicationId: activityIdSchema.parse(value.applicationId), input: decideApplicationInputSchema.parse(value.input) };
}

export function useApplications({ id, detail, session, fresh, refresh, incomingInvitationId, attributionAvailable = false }: {
  id: string; detail: ActivityDetail | undefined; session: string | undefined; fresh: boolean; refresh: () => Promise<void>; incomingInvitationId?: string; attributionAvailable?: boolean;
}) {
  const userId = detail?.viewer.user_id ?? undefined;
  // Public source is provenance only. It never grants membership or proves who sent a link.
  const source = incomingInvitationId === undefined ? undefined : activityIdSchema.safeParse(incomingInvitationId);
  const sourceId = source?.success ? source.data : undefined;
  const attributionBlocked = incomingInvitationId !== undefined && (!source?.success || !attributionAvailable);
  const observedKey = JSON.stringify([id, userId, session, incomingInvitationId, detail?.revision]);
  const observed = useRef(observedKey), epoch = useRef(0), alive = useRef(true), visible = useRef(true);
  if (observed.current !== observedKey) { observed.current = observedKey; epoch.current++; }
  const renderEpoch = epoch.current;
  const latest = useRef({ id, userId, session, fresh }); latest.current = { id, userId, session, fresh };
  useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; }; }, []);
  const hide = () => { visible.current = false; epoch.current++; };
  useDidHide(hide); useUnload(hide); useDidShow(() => { visible.current = true; });
  function sourceWriteGuard() {
    const ticket = renderEpoch, target = observedKey;
    return () => {
      if (!alive.current || !visible.current || ticket !== epoch.current || observed.current !== target || !latest.current.fresh ||
        latest.current.id !== id || latest.current.userId !== userId || latest.current.session !== session || !session || getToken() !== session)
        throw new ApiClientError('INVALID_RESPONSE', '原邀请申请的页面或账号已变化，结果未确认；请返回本人活动核对原请求。', 0);
    };
  }
  const owner = `${id}:${userId ?? 'guest'}`;
  const empty = () => ({ owner, selected: [] as string[], nickname: '', accepted: '', validation: '' });
  const [draft, setDraft] = useState(empty);
  const bound = !userId || (!!session && session === getToken());
  const shown = draft.owner === owner && bound ? draft : empty();
  const { selected, nickname, accepted, validation } = shown;
  const setField = <K extends 'selected' | 'nickname' | 'accepted' | 'validation'>(key: K, value: typeof draft[K]) => {
    if (!bound) return;
    setDraft(current => ({ ...(current.owner === owner ? current : empty()), [key]: value }));
  };
  const setSelected = (value: string[]) => setField('selected', value);
  const setNickname = (value: string) => setField('nickname', value);
  const setAccepted = (value: string) => setField('accepted', value);
  const setValidation = (value: string) => setField('validation', value);
  // Hide old input synchronously above; clear it once the displayed actor/target changes.
  // A refresh for the same actor keeps unsaved input and its persisted pending key.
  useEffect(() => { setDraft(current => current.owner === owner ? current : empty()); }, [owner]);
  const apply = useStoredWrite({ storageKey: `weego-apply-pending-v1:${id}:${userId ?? 'guest'}`, userId,
    parse: raw => applyToActivityInputSchema.parse(raw), execute: input => applyForActor(id, input, userId ?? '', session, input.invitation_source_id ? sourceWriteGuard() : undefined),
    committed: next => { rememberActivity(userId ?? null, next); void refresh(); }
  });
  const decision = useStoredWrite({ storageKey: `weego-decision-pending-v1:${id}:${userId ?? 'guest'}`, userId,
    parse: parseDecision, execute: operation => decideForActor(id, operation.applicationId, operation.input, userId ?? '', session),
    committed: next => { rememberActivity(userId ?? null, next); void refresh(); }
  });
  useEffect(() => { if (apply.result) { setSelected([]); setAccepted(''); } }, [apply.result]);
  const anyBusy = apply.busy || decision.busy;
  const applicationBlocked = apply.blocked || !!apply.pending;
  const decisionBlocked = decision.blocked || !!decision.pending;
  const myOccupied = new Set(detail?.viewer.participations.filter(p => p.status !== 'exited').map(p => p.segment_id));
  const myPending = new Set(detail?.viewer.applications.filter(a => a.status === 'pending').flatMap(a => a.segments.map(s => s.segment_id)));
  const available = (segmentId: string) => {
    const segment = detail?.segments.find(s => s.segment_id === segmentId);
    return !!segment && segment.is_join_open && segment.counts.remaining_capacity > 0 && !myOccupied.has(segmentId) && !myPending.has(segmentId);
  };
  const confirmation = detail ? JSON.stringify({ revision: detail.revision, ...(incomingInvitationId !== undefined ? { invitation_source_id: incomingInvitationId } : {}), segments: selected.map(segmentId => ({ segmentId, version: detail.segments.find(s => s.segment_id === segmentId)?.plan_revision })).sort((a, b) => a.segmentId.localeCompare(b.segmentId)) }) : '';
  function submit() {
    if (!fresh || !bound || !userId || anyBusy || applicationBlocked || attributionBlocked || selected.length === 0 || accepted !== confirmation) return;
    if (selected.some(segmentId => !available(segmentId))) { setValidation('所选环节已有变化，请重新核对；我们会保留你的选择，不会自动删减。'); return; }
    const result = applyToActivityInputSchema.safeParse({ idempotency_key: newKey(), expected_revision: detail!.revision,
      segments: selected.map(segmentId => ({ segment_id: segmentId, plan_revision: detail!.segments.find(s => s.segment_id === segmentId)!.plan_revision })),
      ...(nickname.trim() ? { display_name: nickname.trim() } : {}),
      ...(sourceId ? { invitation_source_id: sourceId } : {}) });
    if (!result.success) { setValidation('请核对昵称和所选环节后再提交。'); return; }
    setValidation(''); setAccepted(''); void apply.send(result.data);
  }
  function decide(applicationId: string, choice: 'approve' | 'reject') {
    if (!fresh || !bound || !detail?.viewer.is_manager || anyBusy || decisionBlocked) return;
    void decision.send({ applicationId, input: decideApplicationInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, decision: choice }) });
  }
  return { selected, setSelected, nickname, setNickname, accepted, setAccepted, validation,
    apply, decision, anyBusy, applicationBlocked, decisionBlocked, myOccupied, myPending,
    available, confirmation, fresh, userId, submit, decide, incomingInvitationId, attributionBlocked };
}
export type ApplicationsState = ReturnType<typeof useApplications>;

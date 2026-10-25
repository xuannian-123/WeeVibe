import { useEffect, useState } from 'react';
import { activityIdSchema, applyToActivityInputSchema, decideApplicationInputSchema, type ActivityDetail, type DecideApplicationInput } from '@weevibe/contracts';
import { api } from '../../platform/api';
import { newKey } from '../../platform/page-state';
import { rememberActivity } from '../../platform/activities';
import { useStoredWrite } from '../../platform/write-state';

type DecisionEnvelope = { applicationId: string; input: DecideApplicationInput };
function parseDecision(raw: unknown): DecisionEnvelope {
  if (!raw || typeof raw !== 'object') throw new Error('无法恢复原审批请求');
  const value = raw as { applicationId?: unknown; input?: unknown };
  return { applicationId: activityIdSchema.parse(value.applicationId), input: decideApplicationInputSchema.parse(value.input) };
}

export function useApplications({ id, detail, fresh, refresh }: {
  id: string; detail: ActivityDetail | undefined; fresh: boolean; refresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]); const [nickname, setNickname] = useState('');
  const [accepted, setAccepted] = useState(''); const [validation, setValidation] = useState('');
  const userId = detail?.viewer.user_id ?? undefined;
  const apply = useStoredWrite({ storageKey: `weego-apply-pending-v1:${id}:${userId ?? 'guest'}`, userId,
    parse: raw => applyToActivityInputSchema.parse(raw), execute: input => api.applyToActivity(id, input),
    committed: next => { rememberActivity(userId ?? null, next); void refresh(); }
  });
  const decision = useStoredWrite({ storageKey: `weego-decision-pending-v1:${id}:${userId ?? 'guest'}`, userId,
    parse: parseDecision, execute: operation => api.decideApplication(id, operation.applicationId, operation.input),
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
  const confirmation = detail ? JSON.stringify({ revision: detail.revision, segments: selected.map(segmentId => ({ segmentId, version: detail.segments.find(s => s.segment_id === segmentId)?.plan_revision })).sort((a, b) => a.segmentId.localeCompare(b.segmentId)) }) : '';
  function submit() {
    if (!fresh || !userId || anyBusy || applicationBlocked || selected.length === 0 || accepted !== confirmation) return;
    if (selected.some(segmentId => !available(segmentId))) { setValidation('所选环节已有变化，请重新核对；我们会保留你的选择，不会自动删减。'); return; }
    const result = applyToActivityInputSchema.safeParse({ idempotency_key: newKey(), expected_revision: detail!.revision,
      segments: selected.map(segmentId => ({ segment_id: segmentId, plan_revision: detail!.segments.find(s => s.segment_id === segmentId)!.plan_revision })),
      ...(nickname.trim() ? { display_name: nickname.trim() } : {}) });
    if (!result.success) { setValidation('请核对昵称和所选环节后再提交。'); return; }
    setValidation(''); setAccepted(''); void apply.send(result.data);
  }
  function decide(applicationId: string, choice: 'approve' | 'reject') {
    if (!fresh || !detail?.viewer.is_manager || anyBusy || decisionBlocked) return;
    void decision.send({ applicationId, input: decideApplicationInputSchema.parse({ idempotency_key: newKey(), expected_revision: detail.revision, decision: choice }) });
  }
  return { selected, setSelected, nickname, setNickname, accepted, setAccepted, validation,
    apply, decision, anyBusy, applicationBlocked, decisionBlocked, myOccupied, myPending,
    available, confirmation, fresh, userId, submit, decide };
}
export type ApplicationsState = ReturnType<typeof useApplications>;

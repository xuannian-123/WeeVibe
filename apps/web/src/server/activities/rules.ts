import { createHash } from 'node:crypto';
import type { ApplyToActivityInput, CreateActivityInput } from '@weego/contracts';
import { ServiceError } from '../http';

export type SegmentRuleState = {
  id: string; planRevision: number; capacity: number; minimumParticipants: number;
  startsAt: Date; deadlineAt: Date; cancelledAt: Date | null;
  participations: Array<{ userId: string; status: 'joined' | 'exited'; acceptedPlanRevision: number | null }>;
};
export function checkManager(managerId: string, actorId: string) {
  if (managerId !== actorId) throw new ServiceError('FORBIDDEN', 403, '仅当前发起人可以处理此操作');
}
export function checkRevision(actual: number, expected: number) {
  if (actual !== expected) throw new ServiceError('VERSION_CONFLICT', 409, '活动已更新，请刷新后重试');
}
export function checkNotCancelled(cancelledAt: Date | null) {
  if (cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '活动已取消');
}
export function checkJoinOpen(segment: Pick<SegmentRuleState, 'cancelledAt' | 'deadlineAt' | 'startsAt'>, now: Date) {
  if (segment.cancelledAt || now >= segment.deadlineAt || now >= segment.startsAt) throw new ServiceError('SEGMENT_APPLICATION_CLOSED', 409, '所选环节已关闭报名或已开始');
}
export function segmentCounts(segment: SegmentRuleState) {
  const joined = segment.participations.filter(p => p.status === 'joined');
  const accepted = joined.filter(p => p.acceptedPlanRevision === segment.planRevision).length;
  return {
    occupied_count: joined.length, accepted_count: accepted,
    pending_acceptance_count: joined.length - accepted,
    remaining_capacity: Math.max(0, segment.capacity - joined.length),
    meets_minimum: joined.length >= segment.minimumParticipants,
    is_full: joined.length >= segment.capacity
  };
}
export function checkSelectedSegments(segments: SegmentRuleState[], selected: ApplyToActivityInput['segments'], userId: string, now: Date) {
  for (const target of selected) {
    const segment = segments.find(s => s.id === target.segment_id);
    if (!segment) throw new ServiceError('INVALID_INPUT', 400, '所选环节不属于此活动');
    checkJoinOpen(segment, now);
    if (target.plan_revision !== segment.planRevision) throw new ServiceError('ARRANGEMENT_STALE', 409, '环节安排已变化，请重新查看并接受');
    if (segment.participations.some(p => p.userId === userId && p.status === 'joined')) throw new ServiceError('ALREADY_JOINED', 409, '已参加所选环节，请只申请新增环节');
    if (segmentCounts(segment).remaining_capacity === 0) throw new ServiceError('CAPACITY_FULL', 409, '所选环节已满，未批准本次申请');
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function requestFingerprint(actorId: string, scope: string, input: Record<string, unknown>) {
  const { idempotency_key: _key, ...semantic } = input;
  // Selected segment order is immaterial for applications; activity order is not.
  if (scope.startsWith('apply:') && Array.isArray(semantic.segments)) semantic.segments = [...semantic.segments].sort((a, b) => String(a.segment_id).localeCompare(String(b.segment_id)));
  if (scope === 'create') {
    const create = input as unknown as CreateActivityInput;
    semantic.participating_segment_refs = [...create.participating_segment_refs].sort();
    semantic.segments = create.segments.map(s => ({ ...s, starts_at: new Date(s.starts_at).toISOString(), ends_at: new Date(s.ends_at).toISOString(), deadline_at: new Date(s.deadline_at).toISOString() }));
  }
  return createHash('sha256').update(canonical({ actorId, scope, semantic })).digest('hex');
}
export function verifyReplay(record: { scope: string; requestHash: string }, scope: string, fingerprint: string) {
  if (record.scope !== scope || record.requestHash !== fingerprint) throw new ServiceError('IDEMPOTENCY_CONFLICT', 409, '此重试标识已用于其他请求，请勿复用');
}
export function applicationVisibility<T extends { applicant_user_id: string }>(applications: T[], actorId: string | null, managerId: string) {
  return {
    own_applications: applications.filter(a => a.applicant_user_id === actorId),
    ...(actorId === managerId ? { applications } : {})
  };
}

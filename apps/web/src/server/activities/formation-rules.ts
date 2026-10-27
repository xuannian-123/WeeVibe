import type { FormationCommand } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { segmentCounts, type SegmentRuleState } from './rules';
export type FormationSegment = SegmentRuleState & { verificationStatus: 'unknown' | 'manual_checked' };
export function checkFormationTarget(activity: { mainSegmentId: string | null; segments: FormationSegment[] }, input: FormationCommand, now: Date) {
  if (activity.mainSegmentId !== input.segment_id) throw new ServiceError('INVALID_INPUT', 400, '本次只支持当前主环节，请刷新后重新选择');
  const segment = activity.segments.find(value => value.id === input.segment_id);
  if (!segment) throw new ServiceError('INVALID_INPUT', 400, '主环节记录不存在或已变化');
  if (segment.cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '当前主环节已取消，不能核实或确认成局');
  if (segment.planRevision !== input.expected_plan_revision) throw new ServiceError('ARRANGEMENT_STALE', 409, '主环节安排已变化，请重新核对');
  // Capability boundary, not a claim that the user's eventual rule forbids it.
  // The application deadline does NOT govern these manager commands.
  if (now >= segment.startsAt) throw new ServiceError('FORMATION_RULE_UNCONFIRMED', 409, '主环节开始后的线上核实、确认或恢复规则待确认，暂未启用；不会改变现有状态');
  return segment;
}
export function checkFormationReady(segment: FormationSegment) {
  const counts = segmentCounts(segment);
  if (!counts.meets_minimum) throw new ServiceError('FORMATION_NOT_READY', 409, '主环节人数尚未达到最低成行人数，不能确认成局');
  if (counts.pending_acceptance_count !== 0) throw new ServiceError('FORMATION_NOT_READY', 409, '主环节仍有保留席位的成员尚未接受当前安排，不能确认成局');
  if (segment.verificationStatus !== 'manual_checked') throw new ServiceError('FORMATION_NOT_READY', 409, '请先人工核实当前主环节安排；预订标记不能替代核实');
  return counts;
}

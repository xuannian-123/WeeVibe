import type { ParticipationAction } from '@weevibe/contracts/src/participation-actions';
import { ServiceError } from '../http';

type ParticipationSegment = {
  id: string; startsAt: Date; endsAt: Date; cancelledAt: Date | null;
  participations: Array<{ userId: string; status: 'joined' | 'exited' }>;
};
/** Requirement deadlines intentionally do not close these separate participation actions. */
export function checkParticipationAction<T extends ParticipationSegment>(segments: T[], actorId: string, input: ParticipationAction, now: Date): T[] {
  const selected = input.segment_ids.map(id => {
    const segment = segments.find(s => s.id === id);
    if (!segment) throw new ServiceError('INVALID_INPUT', 400, '所选环节不属于此活动');
    if (segment.cancelledAt || now >= segment.endsAt) throw new ServiceError('INVALID_INPUT', 409, '已取消或已结束的环节不能变更参加状态');
    if (!segment.participations.some(p => p.userId === actorId && p.status === 'joined')) throw new ServiceError('FORBIDDEN', 403, '只能变更本人当前已参加的环节');
    if (input.action === 'late') {
      const eta = new Date(input.estimated_arrival_at);
      if (eta <= now || eta <= segment.startsAt || eta >= segment.endsAt) throw new ServiceError('INVALID_INPUT', 400, '预计到达须晚于当前时间及环节开始，并早于环节结束；不会自动退出任何环节');
    }
    return segment;
  });
  return selected;
}

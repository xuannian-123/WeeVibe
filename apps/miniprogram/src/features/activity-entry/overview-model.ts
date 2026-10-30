import type { ActivityDetail } from '@weevibe/contracts';

export type DetailSection = 'apply' | 'participation' | 'arrangement' | 'approval' | 'invitation' | 'roster' | 'formation';
/** Activity state comes from the server snapshot; segment counts are never summed. */
export function overviewModel(detail: ActivityDetail) {
  const live = detail.segments.filter(s => !s.cancelled_at);
  const pending = detail.viewer.applications.filter(a => a.status === 'pending' && a.segments.some(t => live.some(s => s.segment_id === t.segment_id)));
  const joined = detail.viewer.participations.filter(p => p.status !== 'exited' && live.some(s => s.segment_id === p.segment_id));
  const needsAcceptance = joined.some(p => p.status === 'awaiting_acceptance');
  const open = !detail.cancelled_at && live.some(s => s.is_join_open && !s.has_started);
  const approvals = detail.viewer.is_manager ? (detail.applications ?? []).filter(a => a.status === 'pending').length : 0;
  const primary: { section: DetailSection; label: string } = needsAcceptance && !detail.cancelled_at
    ? { section: 'arrangement', label: '查看变化并决定' }
    : pending.length || joined.length ? { section: 'participation', label: '查看本人报名状态' }
    : open ? { section: 'apply', label: detail.viewer.user_id ? '选择参加环节' : '登录并选择参加环节' }
    : { section: 'participation', label: '查看本人报名状态' };
  return {
    primary, approvals, open, joined, pending,
    status: detail.cancelled_at ? '活动已取消' : needsAcceptance ? '安排变更待接受' : pending.length ? '申请待审批' : joined.length ? '已加入活动' : open ? '等你加入' : '当前不开放报名',
    main: detail.segments.find(s => s.segment_id === detail.main_segment_id),
    segmentCount: detail.cancelled_at ? detail.segments.length : live.length,
  };
}

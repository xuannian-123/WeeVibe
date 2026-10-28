import type { ActivityDetail } from '@weevibe/contracts';

/** Presentation of the authoritative snapshot only; never grants write permission. */
export function formationProgress(detail: ActivityDetail): { label: string; guidance: string } {
  const main = detail.segments.find(segment => segment.segment_id === detail.main_segment_id);
  if (detail.cancelled_at || main?.cancelled_at) return { label: '已取消', guidance: '仅保留原安排及参加记录，不开放补位。' };
  if (!main) return { label: '待刷新安排', guidance: '尚未取得主环节，请刷新后查看。' };
  if (detail.formation_status === 'confirmed') return { label: '主环节已成局', guidance: '其他环节分别显示状态；成局不代表已经预订。' };
  const started = main.has_started || Date.parse(detail.server_time) >= Date.parse(main.starts_at);
  const deficit = Math.max(0, main.minimum_participants - main.counts.occupied_count);
  if (deficit > 0) return {
    label: '主环节待补位',
    guidance: started ? `主环节还差 ${deficit} 人，已开始，停止线上补位，请联系发起人现场处理。`
      : main.is_join_open ? `主环节还差 ${deficit} 人达到最低人数。朋友可只申请这一段；补齐后由发起人确认恢复，原成员不用重报。`
        : `主环节还差 ${deficit} 人，报名已关闭。发起人须在开始前明确延期，才可继续申请和审批。`
  };
  if (main.counts.pending_acceptance_count > 0) return {
    label: '主环节待重新接受', guidance: `${main.counts.pending_acceptance_count} 人保留席位、尚未接受当前安排；未回复不等于同意，也不释放席位。`
  };
  if (started) return { label: '主环节待现场处理', guidance: '主环节已开始，未确认成局。后续未开始且仍开放的环节仍可单独申请。' };
  if (main.verification_status !== 'manual_checked') return { label: '主环节待核实', guidance: '已达到最低人数，仍需发起人人工核实当前安排，再明确确认成局。' };
  return { label: '主环节待确认成局', guidance: '人数与当前安排接受条件已满足；由发起人确认／恢复成局，不因补齐人数自动成局。' };
}

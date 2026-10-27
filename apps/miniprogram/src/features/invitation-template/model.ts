import { activityDetailSchema, activityIdSchema, type ActivityDetail } from '@weevibe/contracts';

export const MAX_TEMPLATE_SEGMENTS = 64;
// Match the editor/native maxlength boundary: JavaScript UTF-16 code units, not Unicode code points.
export const MAX_TEMPLATE_CHARACTERS = 12_000;
export class InvitationTemplateError extends Error {
  constructor(readonly code: 'INVALID_PUBLIC_SNAPSHOT' | 'TEMPLATE_TOO_LARGE') {
    super(code); this.name = 'InvitationTemplateError';
  }
}

const segmentSchema = activityDetailSchema.shape.segments.element.pick({
  segment_id: true, position: true, name: true, starts_at: true, ends_at: true, deadline_at: true,
  minimum_participants: true, capacity: true, plan_revision: true, cancelled_at: true,
  has_started: true, is_join_open: true, verification_status: true, booking_status: true, counts: true,
}).extend({ location: activityDetailSchema.shape.segments.element.shape.location.pick({ name: true, address: true }),
  fee: activityDetailSchema.shape.segments.element.shape.fee });
const publicSchema = activityDetailSchema.pick({ activity_id: true, name: true, revision: true,
  server_time: true, main_segment_id: true, cancelled_at: true }).extend({ segments: segmentSchema.array().min(1) });
const invalid = () => { throw new InvitationTemplateError('INVALID_PUBLIC_SNAPSHOT'); };
// Public strings remain literal text. Collapse layout controls so a user-entered name cannot insert a new template line.
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').trim();
const instant = (value: string) => new Date(value).toISOString();
const time = (value: string) => instant(value).replace('T', ' ').replace(/\.000Z$/, ' UTC').replace(/Z$/, ' UTC');
type Phase = 'activity_cancelled' | 'segment_cancelled' | 'ended' | 'started' | 'closed' | 'full' | 'open';

/** Local fixed template, not AI output. Caller must verify any outgoing invitation against this activity first.
 * Only selected public fields are read: never viewer, applications, member names, requirements or source_url.
 * sourceKey is a public equality key (not a privacy/anonymity hash); it deliberately excludes clock-only refreshes.
 */
export function invitationTemplateModel(detail: ActivityDetail, verifiedOutgoingInvitationId?: string) {
  try {
    if (!Array.isArray(detail.segments)) return invalid();
    if (detail.segments.length > MAX_TEMPLATE_SEGMENTS) throw new InvitationTemplateError('TEMPLATE_TOO_LARGE');
    const value = publicSchema.parse({
      activity_id: detail.activity_id, name: detail.name, revision: detail.revision, server_time: detail.server_time,
      main_segment_id: detail.main_segment_id, cancelled_at: detail.cancelled_at,
      segments: detail.segments.map(s => ({
        segment_id: s.segment_id, position: s.position, name: s.name, starts_at: s.starts_at, ends_at: s.ends_at,
        deadline_at: s.deadline_at, minimum_participants: s.minimum_participants, capacity: s.capacity,
        plan_revision: s.plan_revision, cancelled_at: s.cancelled_at, has_started: s.has_started, is_join_open: s.is_join_open,
        verification_status: s.verification_status, booking_status: s.booking_status,
        counts: { occupied_count: s.counts.occupied_count, accepted_count: s.counts.accepted_count,
          pending_acceptance_count: s.counts.pending_acceptance_count, remaining_capacity: s.counts.remaining_capacity,
          meets_minimum: s.counts.meets_minimum, is_full: s.counts.is_full },
        location: { name: s.location.name, address: s.location.address },
        fee: { kind: s.fee.kind, amount_cents: s.fee.amount_cents, currency: s.fee.currency, note: s.fee.note },
      })),
    });
    const invitation = verifiedOutgoingInvitationId === undefined ? undefined : activityIdSchema.parse(verifiedOutgoingInvitationId);
    const now = Date.parse(value.server_time), name = clean(value.name);
    if (!name || value.segments.some(s => !clean(s.name) || !clean(s.location.name))
      || new Set(value.segments.map(s => s.segment_id)).size !== value.segments.length
      || new Set(value.segments.map(s => s.position)).size !== value.segments.length
      || !value.segments.some(s => s.segment_id === value.main_segment_id)) return invalid();
    const boundaries: number[] = [];
    const segments = value.segments.slice().sort((a, b) => a.position - b.position).map(s => {
      const start = Date.parse(s.starts_at), end = Date.parse(s.ends_at), deadline = Date.parse(s.deadline_at), c = s.counts;
      const cancelled = !!value.cancelled_at || !!s.cancelled_at;
      const expectedOpen = !cancelled && now < start && now < deadline && c.remaining_capacity > 0;
      if (start >= end || deadline > start || s.minimum_participants > s.capacity
        || ![c.occupied_count, c.accepted_count, c.pending_acceptance_count, c.remaining_capacity].every(Number.isSafeInteger)
        || c.occupied_count + c.remaining_capacity !== s.capacity
        || c.accepted_count + c.pending_acceptance_count !== c.occupied_count
        || c.meets_minimum !== (c.occupied_count >= s.minimum_participants)
        || c.is_full !== (c.occupied_count >= s.capacity)
        || s.has_started !== (now >= start) || s.is_join_open !== expectedOpen) return invalid();
      const phase: Phase = value.cancelled_at ? 'activity_cancelled' : s.cancelled_at ? 'segment_cancelled'
        : now >= end ? 'ended' : now >= start ? 'started' : now >= deadline ? 'closed' : c.is_full ? 'full' : 'open';
      if (!cancelled) boundaries.push(...[deadline, start, end].filter(t => t > now));
      return { ...s, name: clean(s.name), starts_at: instant(s.starts_at), ends_at: instant(s.ends_at),
        deadline_at: instant(s.deadline_at), cancelled_at: s.cancelled_at ? instant(s.cancelled_at) : null,
        location: { name: clean(s.location.name), address: s.location.address === null ? null : clean(s.location.address) },
        fee: { ...s.fee, note: clean(s.fee.note) }, phase };
    });
    const path = `/pages/activity/index?id=${value.activity_id}${invitation ? `&invitation_id=${invitation}` : ''}`;
    const lines = ['WeeVibe · 邀请 / 补位固定模板', '本入口未接 AI 文案服务；以下固定模板由程序按公开快照整理，可自行编辑。',
      `活动：${name}`, value.cancelled_at ? '活动状态：已取消；以下仅为历史安排，不开放报名。' : '报名须经活动内申请与组织者审批，不会因点开或转发而占位。',
      '以下所有时段与截止均为 UTC（不是设备本地时区）。'];
    const labels = { activity_cancelled: '活动已取消，不开放报名；人数仅为历史记录',
      segment_cancelled: '环节已取消，不开放报名；人数仅为历史记录', ended: '环节已结束，不开放报名',
      started: '环节已开始，不开放报名', closed: '报名已截止，不开放报名', full: '人数已满，不开放报名', open: '快照时可申请' };
    const units = { per_person: '每人', total: '环节总价', per_hour: '每小时' };
    for (const [index, s] of segments.entries()) {
      const c = s.counts;
      const historical = s.phase === 'activity_cancelled' || s.phase === 'segment_cancelled';
      lines.push('', `${index + 1}. ${s.name}${s.segment_id === value.main_segment_id ? '（主环节）' : ''}`,
        `时段：${time(s.starts_at)} 至 ${time(s.ends_at)}`, `报名截止：${time(s.deadline_at)}`,
        `公共地点：${s.location.name}${s.location.address ? ` · ${s.location.address}` : ''}`,
        s.fee.kind === 'unknown' ? '费用：待确认（不是免费）'
          : `费用参考：¥${(s.fee.amount_cents! / 100).toFixed(2)} / ${units[s.fee.kind]}（非订单价，非已付款）`,
        ...(s.fee.note ? [`费用说明：${s.fee.note}`] : []),
        `状态：${labels[s.phase]}`,
        historical
          ? `历史人数记录：原占位 ${c.occupied_count} / 原上限 ${s.capacity}；原同版接受 ${c.accepted_count}，原未接受 ${c.pending_acceptance_count}；原最低人数 ${s.minimum_participants}（不代表当前保位或待接受）`
          : `人数快照：占位 ${c.occupied_count} / 上限 ${s.capacity}；其中已接受本版 ${c.accepted_count}，保位待接受 ${c.pending_acceptance_count}；最低人数 ${s.minimum_participants}`,
        ...(s.phase === 'open' ? [`快照余位：${c.remaining_capacity}（不是实时余位或占位承诺）`] : []),
        s.verification_status === 'manual_checked' ? '地点核实：人工标记已核实（不是供应商实时核验）' : '地点核实：尚未人工标记核实',
        s.booking_status === 'manual_booked' ? '预订：人工标记已预订（不等于供应商确认或付款凭证）' : '预订：未确认',
        `环节安排版本：${s.plan_revision}`);
    }
    const snapshotAt = instant(value.server_time);
    lines.push('', `活动版本：${value.revision} · 快照时点：${time(snapshotAt)}`,
      '请通过小程序原生分享的活动入口查看最新安排并申请报名。复制这段文字不会自动分享或报名。',
      '本模板不保证实时空位、成局、最新报价或预订；取消、变更和是否可加入，以活动内最新状态为准。');
    const text = lines.join('\n');
    if (text.length > MAX_TEMPLATE_CHARACTERS) throw new InvitationTemplateError('TEMPLATE_TOO_LARGE');
    return { mode: 'fixed_template' as const, activityId: value.activity_id, revision: value.revision,
      sourceKey: JSON.stringify({ activity_id: value.activity_id, name, revision: value.revision,
        main_segment_id: value.main_segment_id, cancelled_at: value.cancelled_at ? instant(value.cancelled_at) : null,
        segments, path }), text, path, snapshotAt,
      nextBoundaryAt: boundaries.length ? new Date(Math.min(...boundaries)).toISOString() : null };
  } catch (error) {
    if (error instanceof InvitationTemplateError) throw error;
    // Never propagate raw schema/provider/native values, getters or private fields in UI errors.
    throw new InvitationTemplateError('INVALID_PUBLIC_SNAPSHOT');
  }
}
export type InvitationTemplateModel = ReturnType<typeof invitationTemplateModel>;

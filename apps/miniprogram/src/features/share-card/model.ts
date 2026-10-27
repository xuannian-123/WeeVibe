import { activityIdSchema, type ActivityDetail } from '@weevibe/contracts';

export const QR_UNAVAILABLE = '报名二维码暂不可用，请使用原生分享链接';
export const MAX_CARD_HEIGHT = 5000;
const clean = (value: string, max: number) => {
  const chars = Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim());
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join('');
};
function time(value: string) {
  const date = new Date(Date.parse(value) + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_PUBLIC_SNAPSHOT');
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
function fee(value: ActivityDetail['segments'][number]['fee']) {
  if (value.kind === 'unknown' || value.amount_cents === null) return '费用待确认（不是免费）';
  const units = { per_person: '每人', total: '环节总价', per_hour: '每小时' };
  return `参考 ¥${(value.amount_cents / 100).toFixed(2)} / ${units[value.kind]}（非已付款）`;
}
/** Explicit field selection only. Never serialize detail, viewer, answers, roster, or provider URLs. */
export function activityCardModel(detail: ActivityDetail, invitationId?: string) {
  const id = activityIdSchema.parse(detail.activity_id);
  const source = invitationId === undefined ? undefined : activityIdSchema.parse(invitationId);
  return {
    activityId: id, name: clean(detail.name, 100), revision: detail.revision,
    capturedAt: time(detail.server_time), cancelled: !!detail.cancelled_at,
    invitationId: source,
    path: `/pages/activity/index?id=${encodeURIComponent(id)}${source ? `&invitation_id=${encodeURIComponent(source)}` : ''}`,
    qrStatus: 'NOT_CONFIGURED' as const,
    segments: detail.segments.map(segment => ({
      name: clean(segment.name, 60), main: segment.segment_id === detail.main_segment_id,
      startsAt: time(segment.starts_at), endsAt: time(segment.ends_at), deadlineAt: time(segment.deadline_at),
      location: clean(segment.location.name, 80), address: clean(segment.location.address ?? '', 100),
      fee: fee(segment.fee), feeNote: clean(segment.fee.note, 100),
      cancelled: !!segment.cancelled_at,
      verification: segment.verification_status === 'manual_checked' ? '人工标记已核实' : '地点未核实',
      booking: segment.booking_status === 'manual_booked' ? '人工标记已预订' : '预订未确认',
    })),
  };
}
export type ActivityCardModel = ReturnType<typeof activityCardModel>;
export type CardLine = { text: string; y: number; size: number; color: string };
/** Conservative Unicode wrapping; no segment is silently omitted to make the card fit. */
export function cardLayout(card: ActivityCardModel) {
  const lines: CardLine[] = []; let y = 52;
  function paragraph(value: string, size = 24, color = '#33473c') {
    const max = 654 / size; let line = '', units = 0;
    for (const char of Array.from(value)) {
      const width = /[\x20-\x7e]/.test(char) ? 0.65 : 1.1;
      if (units + width > max && line) { lines.push({ text: line, y, size, color }); y += size + 12; line = ''; units = 0; }
      line += char; units += width;
    }
    if (line) { lines.push({ text: line, y, size, color }); y += size + 12; }
  }
  paragraph('WeeVibe · 活动行程快照', 24, '#66816e');
  paragraph(card.name, 36, '#182f24');
  paragraph(card.cancelled ? '活动已取消 · 请勿按旧图报名' : '最新安排以链接为准', 26, card.cancelled ? '#a33535' : '#216d49');
  paragraph(`版本 ${card.revision} · 快照 ${card.capturedAt}`, 20, '#68776f');
  paragraph('以下时间均为北京时间 UTC+8', 20, '#68776f');
  card.segments.forEach((segment, index) => {
    y += 20;
    paragraph(`${index + 1}. ${segment.name}${segment.main ? ' · 主环节' : ''}${segment.cancelled ? ' · 已取消' : ''}`, 28, segment.cancelled ? '#a33535' : '#182f24');
    paragraph(`${segment.startsAt} 至 ${segment.endsAt}`);
    paragraph(`报名截止 ${segment.deadlineAt}`, 20, '#68776f');
    paragraph(`地点 ${segment.location}${segment.address ? ' · ' + segment.address : ''}`);
    paragraph(segment.fee);
    if (segment.feeNote) paragraph(`费用说明 ${segment.feeNote}`, 20, '#68776f');
    paragraph(`${segment.verification} · ${segment.booking}`, 20, '#68776f');
  });
  y += 24;
  paragraph(QR_UNAVAILABLE, 26, '#a0522d');
  paragraph('图片不是报名凭证，不代表实时空位、成局或当前报价。', 20, '#68776f');
  paragraph('取消、变更及是否可加入，以链接内最新状态为准。', 20, '#68776f');
  paragraph('活动编号 ' + card.activityId, 18, '#68776f');
  if (card.invitationId) paragraph('公开邀请来源 ' + card.invitationId, 18, '#68776f');
  const height = y + 24;
  if (!card.segments.length || height > MAX_CARD_HEIGHT) throw new Error('CARD_TOO_LARGE');
  return { width: 750, height, lines };
}

import { editArrangementInputSchema, type ActivityDetail, type EditArrangementInput } from '@weevibe/contracts';
import { buildCreateInput, emptySegment, type ActivityForm } from '../activity-create/form';
const parts = (iso: string) => new Date(Date.parse(iso) + 8 * 3_600_000).toISOString().slice(0, 16).split('T');
export function formFromArrangement(detail: ActivityDetail): ActivityForm {
  return { name: detail.name, nickname: '', mainRef: detail.segments.find(s => s.segment_id === detail.main_segment_id)!.client_ref, attending: [],
    segments: detail.segments.filter(s => !s.cancelled_at).map(s => ({ ...emptySegment(), ref: s.client_ref, name: s.name, type: s.type,
      startDate: parts(s.starts_at)[0], startTime: parts(s.starts_at)[1], endDate: parts(s.ends_at)[0], endTime: parts(s.ends_at)[1],
      deadlineDate: parts(s.deadline_at)[0], deadlineTime: parts(s.deadline_at)[1], minimum: String(s.minimum_participants), capacity: String(s.capacity),
      place: s.location.name, address: s.location.address ?? '', feeUnit: s.fee.kind, amount: s.fee.amount_cents === null ? '' : (s.fee.amount_cents / 100).toFixed(2), feeNote: s.fee.note, requirements: s.requirements })) };
}
export function editInputFromForm(detail: ActivityDetail, form: ActivityForm, key: string): EditArrangementInput {
  if (detail.timezone !== 'Asia/Shanghai') throw new Error('当前编辑表单按北京时间，请在匹配时区的入口修改');
  const prepared = buildCreateInput({ ...form, attending: [], nickname: '' }, key);
  const fields = (s: ActivityDetail['segments'][number]) => ({ client_ref: s.client_ref, type: s.type, name: s.name, starts_at: s.starts_at, ends_at: s.ends_at, deadline_at: s.deadline_at,
    minimum_participants: s.minimum_participants, capacity: s.capacity, location: s.location, fee: s.fee, requirements: s.requirements, segment_id: s.segment_id, cancelled: true });
  const active = prepared.segments.map(s => {
    const old = detail.segments.find(o => o.client_ref === s.client_ref);
    const exactTime = (field: 'starts_at' | 'ends_at' | 'deadline_at') => old && parts(old[field]).join('T') === parts(s[field]).join('T') ? old[field] : s[field];
    return { ...s, starts_at: exactTime('starts_at'), ends_at: exactTime('ends_at'), deadline_at: exactTime('deadline_at'), ...(old ? { segment_id: old.segment_id } : {}), cancelled: false,
      location: old && !form.segments.find(item => item.ref === s.client_ref)?.venue && old.location.name === s.location.name && old.location.address === s.location.address ? old.location : s.location };
  });
  // Removed published segments become explicit cancellations at their old slots.
  const removed = detail.segments.filter(s => !active.some(next => next.client_ref === s.client_ref));
  const result: EditArrangementInput['segments'] = [];
  let index = 0;
  for (let position = 0; position < active.length + removed.length; position++) {
    const cancelled = removed.find(s => s.position === position);
    result.push(cancelled ? fields(cancelled) : active[index++]);
  }
  return editArrangementInputSchema.parse({ idempotency_key: key, expected_revision: detail.revision, main_segment_ref: prepared.main_segment_ref, segments: result });
}

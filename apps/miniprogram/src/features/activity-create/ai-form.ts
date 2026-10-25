import type { AiCreationDraft } from '@weevibe/contracts';
import { emptySegment, type ActivityForm } from './form';

export function hasActivityDraftEdits(form: ActivityForm): boolean {
  return !!form.name || form.attending.length > 0 || form.segments.length > 1 || form.segments.some(segment =>
    segment.type !== 'custom' || segment.feeUnit !== 'unknown' || Object.entries(segment).some(([key, value]) =>
      !['ref', 'type', 'feeUnit'].includes(key) && value !== undefined && value !== ''));
}

function dateTime(value: string | null) {
  if (!value) return { date: '', time: '' };
  const local = new Date(Date.parse(value) + 8 * 3600000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}
export function formFromAiDraft(draft: AiCreationDraft, nickname: string): ActivityForm {
  const references = new Map<string, string>();
  const segments = draft.segments.map(s => {
    const base = emptySegment(); references.set(s.ref, base.ref);
    const start = dateTime(s.starts_at), end = dateTime(s.ends_at), deadline = dateTime(s.deadline_at);
    return { ...base, name: s.name ?? '', type: s.type,
      startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time,
      deadlineDate: deadline.date, deadlineTime: deadline.time, place: s.location?.label ?? '',
      minimum: s.minimum === null ? '' : String(s.minimum), capacity: s.capacity === null ? '' : String(s.capacity) };
  });
  return { name: draft.name ?? '', nickname, segments,
    mainRef: segments.length === 1 ? segments[0].ref : references.get(draft.primary_segment_ref ?? '') ?? '', attending: [] };
}
export function aiMissingSummary(draft: AiCreationDraft) {
  const missing: string[] = [];
  if (!draft.name) missing.push('活动名称');
  if (!draft.primary_segment_ref && draft.segments.length > 1) missing.push('主要环节');
  draft.segments.forEach((s, i) => {
    const fields = [!s.name && '名称', !s.starts_at && '开始时间', !s.ends_at && '结束时间', !s.location && '地点', s.minimum === null && '最低人数', s.capacity === null && '人数上限'].filter(Boolean);
    if (fields.length) missing.push(`安排${i + 1}：${fields.join('、')}`);
  });
  return missing;
}

import type { RequirementSnapshot } from '@weevibe/contracts';
import { emptyForm, type ActivityForm } from './form';
import { beijingDateParts } from '../requirements/answer-state';

/** Suggestions only. No old seats, consents, prices, minimums or reservations. */
export function formFromPreparation(snapshot: RequirementSnapshot): ActivityForm {
  if (!snapshot.viewer.is_manager || snapshot.collection.status !== 'finalized' || snapshot.collection.activity_id) throw new Error('请由筹备组织者确认方案后创建正式活动');
  const form = emptyForm(), selection = snapshot.collection.final_selection;
  if (!selection) throw new Error('筹备方案尚未确认');
  const selected = snapshot.collection.draft.locations.find(x => x.id === selection.location_id);
  const start = beijingDateParts(snapshot.collection.draft.starts_at);
  return { ...form, name: snapshot.collection.draft.title,
    segments: [{ ...form.segments[0], name: snapshot.collection.draft.title,
      place: selected?.label || selection.location_other || '', address: selected?.venue?.address || '',
      startDate: start.date, startTime: start.time, endDate: start.date }],
    attending: [], nickname: '' };
}

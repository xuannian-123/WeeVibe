import type { RequirementAnswer, RequirementQuestion } from '@weevibe/contracts';
export type AnswerDraft = { option_ids: string[]; other_selected: boolean; other_text: string };
export type AnswerMap = Record<string, AnswerDraft>;
export const emptyAnswer = (): AnswerDraft => ({ option_ids: [], other_selected: false, other_text: '' });
export function answerFromSaved(answer: RequirementAnswer): AnswerDraft {
  return { option_ids: [...answer.option_ids], other_selected: answer.other !== null, other_text: answer.other ?? '' };
}
export function toggleAnswerOption(question: RequirementQuestion, current: AnswerDraft, optionId: string): AnswerDraft {
  if (!question.options.some(option => option.id === optionId)) return current;
  if (question.multiple) return { ...current, option_ids: current.option_ids.includes(optionId) ? current.option_ids.filter(id => id !== optionId) : [...current.option_ids, optionId] };
  return { option_ids: current.option_ids.includes(optionId) ? [] : [optionId], other_selected: false, other_text: '' };
}
export function toggleOther(question: RequirementQuestion, current: AnswerDraft): AnswerDraft {
  if (current.other_selected) return { ...current, other_selected: false, other_text: '' };
  return { option_ids: question.multiple ? [...current.option_ids] : [], other_selected: true, other_text: '' };
}
export function relevantQuestions(questions: RequirementQuestion[], selectedSegmentIds: string[]) {
  return questions.filter(q => q.segment_id === null || selectedSegmentIds.includes(q.segment_id));
}
/** Serialize only visible questions and only explicitly selected 'other' text. */
export function serializeAnswers(questions: RequirementQuestion[], selectedSegmentIds: string[], answers: AnswerMap): RequirementAnswer[] {
  return relevantQuestions(questions, selectedSegmentIds).flatMap(question => {
    const answer = answers[question.id] ?? emptyAnswer();
    const selected = answer.option_ids.filter(id => question.options.some(option => option.id === id));
    if (answer.other_selected && (!answer.other_text.trim() || answer.other_text.length > 500)) throw new Error(`“${question.title}”选择其他后，请填写 1–500 字的说明。`);
    if (question.required && selected.length === 0 && !answer.other_selected) throw new Error(`请回答必答题：“${question.title}”。`);
    if (!question.required && selected.length === 0 && !answer.other_selected) return [];
    return [{ question_id: question.id, option_ids: selected, other: answer.other_selected ? answer.other_text.trim() : null }];
  });
}
/** Canonical display and editing values use Asia/Shanghai, not device timezone. */
export function beijingDateParts(value: string): { date: string; time: string } {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return { date: '', time: '' };
  const shifted = new Date(stamp + 8 * 60 * 60 * 1000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}
export function beijingLabel(value: string | null | undefined): string {
  if (!value) return '时间待定';
  const parts = beijingDateParts(value);
  return parts.date ? `${parts.date} ${parts.time}（北京时间 UTC+8）` : '时间待定';
}

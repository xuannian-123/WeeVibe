import {
  RequirementError, validateTeamDraft, saveRequirementResponse, requirementStatistics,
  requirementDraftSchema, requirementResponseInputSchema, requirementFinalSelectionSchema,
  type TeamDraft, type RequirementResponseInput, type RequirementFinalSelection, type PublicRequirementResponse
} from '@weevibe/contracts';
import { ServiceError } from '../http';
export type SurveyState = { kind: string; status: string; deadlineAt: Date | null; closedAt: Date | null; revision: number; activityId?: string | null };
export type SurveySegment = { id: string; cancelledAt: Date | null; startsAt: Date };
export function inputError(message = '需求内容格式不正确') { return new ServiceError('INVALID_INPUT', 400, message); }
export function parseDraft(raw: unknown): TeamDraft {
  const parsed = requirementDraftSchema.safeParse(raw);
  if (!parsed.success) throw inputError();
  return parsed.data;
}
export function effectiveSurveyStatus(survey: SurveyState, now: Date): 'draft' | 'open' | 'closed' | 'finalized' {
  if (survey.status === 'finalized') return 'finalized';
  if (survey.status === 'draft') return 'draft';
  if (survey.status === 'closed' || survey.closedAt || !survey.deadlineAt || now >= survey.deadlineAt) return 'closed';
  return 'open';
}
export function assertSurveyManager(isManager: boolean) {
  if (!isManager) throw new ServiceError('FORBIDDEN', 403, '仅当前管理者可以操作需求收集');
}
export function assertRevision(survey: SurveyState, expected: number) {
  if (survey.revision !== expected) throw new ServiceError('VERSION_CONFLICT', 409, '需求收集状态已变化，请刷新后重试');
}
export function assertSegmentOwnership(draft: TeamDraft, segments: SurveySegment[], kind: string) {
  const ids = new Set(segments.filter(s => !s.cancelledAt).map(s => s.id));
  for (const question of draft.questions) {
    if (question.segment_id !== null && (kind !== 'friend' || !ids.has(question.segment_id))) throw inputError('题目关联的环节不属于当前有效活动');
  }
}
export function assertPublishable(survey: SurveyState, draft: TeamDraft, segments: SurveySegment[], now: Date) {
  if (survey.status !== 'draft') throw new ServiceError('VERSION_CONFLICT', 409, '已发布的收集不能重新发布或改写题目');
  const preparation = survey.activityId === null;
  try { validateTeamDraft(draft, now.getTime(), preparation); }
  catch (error) { if (error instanceof RequirementError) throw inputError(error.message); throw inputError(); }
  assertSegmentOwnership(draft, segments, survey.kind);
  if (preparation) return;
  const valid = segments.filter(s => !s.cancelledAt);
  if (!valid.length) throw inputError('活动已无有效环节');
  if (Date.parse(draft.deadline_at) > Math.min(...valid.map(s => s.startsAt.getTime()))) throw inputError('填写截止时间不能晚于活动最早有效环节开始');
}
export function normalizeSubmission(survey: SurveyState, draft: TeamDraft, actorId: string, input: RequirementResponseInput, segments: SurveySegment[], now: Date) {
  if (effectiveSurveyStatus(survey, now) !== 'open') throw new ServiceError('SEGMENT_APPLICATION_CLOSED', 409, '需求收集已截止或尚未开放，未保存本次输入');
  const parsed = requirementResponseInputSchema.safeParse(input);
  if (!parsed.success) throw inputError();
  const data = parsed.data;
  const validSegments = new Set(segments.filter(s => !s.cancelledAt).map(s => s.id));
  if (data.selected_segment_ids.some(id => !validSegments.has(id))) throw inputError('所选环节不属于当前有效活动');
  assertSegmentOwnership(draft, segments, survey.kind);
  let answers;
  try {
    answers = saveRequirementResponse({ revision: survey.revision, deadline_at: survey.deadlineAt!.toISOString(), closed_at: survey.closedAt?.toISOString() ?? null, questions: draft.questions, group_access_required: false }, [], actorId,
      { revision: survey.revision, selected_segment_ids: data.selected_segment_ids, answers: data.answers }, now.getTime())[0];
  } catch (error) {
    if (error instanceof RequirementError) throw inputError(error.message);
    throw inputError();
  }
  if (new Set(data.location_ids).size !== data.location_ids.length || data.location_ids.some(id => !draft.locations.some(l => l.id === id))) throw inputError('候选地点选择无效');
  if (data.location_other !== null && !data.location_other.trim()) throw inputError('选择其他地点后请填写有效文字');
  const publicAnswers = {
    selected_segment_ids: answers.selected_segment_ids, answers: answers.answers,
    location_ids: [...data.location_ids], location_other: data.location_other?.trim() ?? null,
    time_preferences: data.time_preferences.trim(), budget_note: data.budget_note.trim(), preferences: data.preferences.trim(),
    ...(data.budget_max_yuan !== undefined ? { budget_max_yuan: data.budget_max_yuan } : {}),
    ...(data.preference_tags !== undefined ? { preference_tags: data.preference_tags } : {}),
    ...(data.constraint_tags !== undefined ? { constraint_tags: data.constraint_tags } : {})
  };
  // Explicit allowlist: no private origin can enter the public/manager JSON field.
  return { publicAnswers, privateOrigin: data.private_origin ?? null };
}
export function normalizeFinalSelection(draft: TeamDraft, input: RequirementFinalSelection) {
  const result = requirementFinalSelectionSchema.safeParse(input);
  if (!result.success) throw inputError();
  const value = result.data;
  if (value.location_id !== null && !draft.locations.some(l => l.id === value.location_id)) throw inputError('最终地点不属于候选地点');
  if (value.location_id !== null && value.location_other !== null) throw inputError('候选地点和其他地点不能同时定案');
  if (value.location_other !== null && !value.location_other.trim()) throw inputError('请填写其他地点');
  if (!value.location_id && !value.location_other?.trim() && !value.note.trim()) throw inputError('请明确填写最终选择或说明');
  return { location_id: value.location_id, location_other: value.location_other?.trim() ?? null, note: value.note.trim() };
}
export function surveyStatistics(draft: TeamDraft, responses: PublicRequirementResponse[]) {
  return {
    respondent_count: responses.length,
    questions: requirementStatistics(draft.questions, responses),
    locations: draft.locations.map(l => ({ option_id: l.id, count: responses.filter(r => r.location_ids.includes(l.id)).length })),
    location_other_count: responses.filter(r => r.location_other !== null).length
  };
}

import { preferenceTagSchema, constraintTagSchema, type PublicRequirementResponse, type RequirementAggregate, type TeamDraft } from '@weevibe/contracts';
import { surveyStatistics } from './rules';

/** Manager may coordinate named times/segments. All other raw fields stay own-only.
 * Empty legacy fields preserve DTO shape, not access to the underlying answers. */
export function managerResponse(response: PublicRequirementResponse): PublicRequirementResponse {
  return { user_id: response.user_id, nickname: response.nickname, revision: response.revision, updated_at: response.updated_at,
    selected_segment_ids: [...response.selected_segment_ids], time_preferences: response.time_preferences,
    answers: [], location_ids: [], location_other: null, budget_note: '', preferences: '' };
}

/** No free text, IDs of people, or per-response rows can enter shared aggregation.
 * Do not parse old budget prose into assumed prices or echo disguised raw answers. */
export function aggregateResponses(draft: TeamDraft, rows: PublicRequirementResponse[]): RequirementAggregate {
  const budgets = rows.flatMap(r => typeof r.budget_max_yuan === 'number' ? [r.budget_max_yuan] : []);
  const segmentIds = [...new Set(rows.flatMap(r => r.selected_segment_ids))];
  return { ...surveyStatistics(draft, rows),
    time_respondent_count: rows.filter(r => r.time_preferences.trim()).length,
    budget: { structured_count: budgets.length, text_count: rows.filter(r => r.budget_note.trim()).length,
      min_max_yuan: budgets.length ? Math.min(...budgets) : null, max_max_yuan: budgets.length ? Math.max(...budgets) : null },
    preferences: preferenceTagSchema.options.map(label => ({ label, count: rows.filter(r => r.preference_tags?.includes(label)).length })),
    constraints: constraintTagSchema.options.map(label => ({ label, count: rows.filter(r => r.constraint_tags?.includes(label)).length })),
    private_text_count: rows.filter(r => r.preferences.trim() || r.answers.some(a => a.other !== null)).length,
    segments: segmentIds.map(segment_id => ({ segment_id, count: rows.filter(r => r.selected_segment_ids.includes(segment_id)).length }))
  };
}

import type { OwnRequirementResponse, RequirementResponseInput } from '@weevibe/contracts';
/** Revision alone does not change when a participant updates their one answer. */
export function responseVersion(response: OwnRequirementResponse | null | undefined): string {
  if (!response) return 'not-submitted';
  // Kept only in component memory; never logged, shared, or used in a route.
  const { user_id: _actor, nickname: _nickname, ...answer } = response;
  return JSON.stringify(answer);
}
export function responseInputFromSaved(response: OwnRequirementResponse | null | undefined): RequirementResponseInput {
  if (!response) return { selected_segment_ids: [], answers: [], location_ids: [], location_other: null, time_preferences: '', budget_note: '', preferences: '', private_origin: null };
  return {
    selected_segment_ids: [...response.selected_segment_ids],
    answers: response.answers.map(answer => ({ ...answer, option_ids: [...answer.option_ids] })),
    location_ids: [...response.location_ids], location_other: response.location_other,
    time_preferences: response.time_preferences, budget_note: response.budget_note, preferences: response.preferences,
    ...(response.budget_max_yuan !== undefined ? { budget_max_yuan: response.budget_max_yuan } : {}),
    ...(response.preference_tags !== undefined ? { preference_tags: [...response.preference_tags] } : {}),
    ...(response.constraint_tags !== undefined ? { constraint_tags: [...response.constraint_tags] } : {}),
    private_origin: response.private_origin ? { ...response.private_origin } : null
  };
}

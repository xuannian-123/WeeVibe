import type { RequirementSnapshot, TeamDraft } from '@weevibe/contracts';
export function needsDraftRecovery(current: RequirementSnapshot | undefined, incoming: RequirementSnapshot | undefined): boolean {
  return !!current && !!incoming && current.collection.id === incoming.collection.id && current.collection.revision !== incoming.collection.revision;
}
/** Call only after explicit user confirmation. Never silently overwrite dirty input. */
export function adoptServerDraft(snapshot: RequirementSnapshot): { snapshot: RequirementSnapshot; draft: TeamDraft } {
  return { snapshot, draft: { ...snapshot.collection.draft, locations: snapshot.collection.draft.locations.map(item=>({...item})), questions: snapshot.collection.draft.questions.map(question=>({...question,options:question.options.map(option=>({...option}))})) } };
}

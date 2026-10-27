import type { RequirementSnapshot } from '@weevibe/contracts';
import { beijingLabel } from './answer-state';
/** Deliberate allowlist: never accepts private origin, answer rows, profiles, or tokens. */
export function requirementShareSummary(snapshot: RequirementSnapshot) {
  return {
    title: snapshot.collection.draft.title.slice(0, 100),
    kind: snapshot.collection.kind === 'friend' ? '朋友聚会' : '大型团建',
    description: snapshot.collection.draft.description.slice(0, 120),
    date: beijingLabel(snapshot.collection.draft.starts_at),
    deadline: beijingLabel(snapshot.collection.draft.deadline_at),
    organizer: snapshot.collection.organizer_nickname || '活动发起人',
    path: `/pages/requirements/index?id=${encodeURIComponent(snapshot.collection.id)}`,
  };
}

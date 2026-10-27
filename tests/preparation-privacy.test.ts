import { describe, expect, it } from 'vitest';
import { requirementCreateSchema, requirementResponseInputSchema, validateTeamDraft, type PublicRequirementResponse, type RequirementSnapshot, type TeamDraft } from '../packages/contracts/src';
import { aggregateResponses, managerResponse } from '../apps/web/src/server/requirements/privacy';
import { assertPublishable, normalizeSubmission } from '../apps/web/src/server/requirements/rules';
import { formFromPreparation } from '../apps/miniprogram/src/features/activity-create/preparation-form';
import { responseInputFromSaved } from '../apps/miniprogram/src/features/requirements/response-recovery';

const actor = '00000000-0000-4000-8000-000000000001';
const now = new Date('2030-01-01T00:00:00Z');
const draft: TeamDraft = { title: '周末一起出去玩', description: '', starts_at: '', deadline_at: '2030-01-02T00:00:00Z', timezone: 'Asia/Shanghai', locations: [], questions: [] };
function answer(user_id = actor, budget_max_yuan = 80): PublicRequirementResponse {
  return { user_id, revision: 1, updated_at: now.toISOString(), nickname: 'PRIVATE_PERSON', selected_segment_ids: [], answers: [],
    location_ids: [], location_other: 'PRIVATE_LOCATION', time_preferences: '周六下午', budget_note: 'PRIVATE_BUDGET_REASON', preferences: 'PRIVATE_REASON',
    budget_max_yuan, preference_tags: ['桌游'], constraint_tags: ['不安排酒精'] };
}
describe('confirmed v38 integration privacy and idea-first preparation rules', () => {
  it.each(['friend', 'team'] as const)('publishes a %s preparation without a formal activity, start time or place', kind => {
    expect(requirementCreateSchema.parse({ action: 'create', kind, draft, idempotency_key: 'fixture-preparation' }).activity_id).toBeUndefined();
    expect(() => assertPublishable({ kind, activityId: null, status: 'draft', revision: 1, deadlineAt: null, closedAt: null }, draft, [], now)).not.toThrow();
  });
  it('still needs a future response cutoff and rejects forged activity segment questions', () => {
    expect(() => validateTeamDraft({ ...draft, deadline_at: '' }, now.getTime(), true)).toThrow();
    expect(() => validateTeamDraft({ ...draft, deadline_at: now.toISOString() }, now.getTime(), true)).toThrow();
    expect(() => assertPublishable({ kind: 'friend', activityId: null, status: 'draft', revision: 1, deadlineAt: null, closedAt: null }, { ...draft, questions: [{ id: 'q', title: 'test', segment_id: actor, multiple: false, required: false, options: [{ id: 'yes', label: 'yes' }] }] }, [], now)).toThrow('环节');
  });
  it('permits logged-in team answers without client group claims and preserves own structured data', () => {
    const { user_id, revision, updated_at, nickname, ...raw } = answer();
    const input = requirementResponseInputSchema.parse(raw);
    expect(input.budget_max_yuan).toBe(80);
  });
  it('returns only named time/segment intent to the organizer', () => {
    const original = answer(), projected = managerResponse(original);
    expect(projected.user_id).toBe(actor); expect(projected.time_preferences).toBe('周六下午');
    expect(JSON.stringify(projected)).not.toMatch(/PRIVATE_BUDGET|PRIVATE_REASON|PRIVATE_LOCATION|budget_max_yuan|preference_tags|constraint_tags/);
    expect(projected.budget_note).toBe(''); expect(projected.answers).toEqual([]);
    expect(original.preferences).toBe('PRIVATE_REASON');
  });
  it('shares numeric budget ranges and categorical counts, never person IDs or free text', () => {
    const result = aggregateResponses(draft, [answer(), answer('00000000-0000-4000-8000-000000000002', 120)]);
    expect(result.budget).toMatchObject({ min_max_yuan: 80, max_max_yuan: 120, structured_count: 2, text_count: 2 });
    expect(result.preferences.find(x => x.label === '桌游')?.count).toBe(2);
    expect(result.constraints.find(x => x.label === '不安排酒精')?.count).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|user_id|nickname|00000000/);
  });
  it('does not infer a price from old private budget prose', () => {
    const row = answer(); delete row.budget_max_yuan;
    expect(aggregateResponses(draft, [row]).budget).toEqual({ min_max_yuan: null, max_max_yuan: null, structured_count: 0, text_count: 1 });
  });
  it('validates and saves team response tags without ever acquiring a seat', () => {
    const { user_id, revision, updated_at, nickname, ...input } = answer();
    const result = normalizeSubmission({ kind: 'team', activityId: null, status: 'open', revision: 1, deadlineAt: new Date(draft.deadline_at), closedAt: null }, draft, actor, input, [], now);
    expect(result.publicAnswers.budget_max_yuan).toBe(80); expect(result.publicAnswers.constraint_tags).toEqual(['不安排酒精']);
    expect(result.publicAnswers).not.toHaveProperty('private_origin');
  });
  it('invalid budget and uncontrolled preference/reason strings cannot enter public summary tags', () => {
    const { user_id, revision, updated_at, nickname, ...input } = answer();
    expect(requirementResponseInputSchema.safeParse({ ...input, budget_max_yuan: -1 }).success).toBe(false);
    expect(requirementResponseInputSchema.safeParse({ ...input, preference_tags: ['PRIVATE_REASON'] }).success).toBe(false);
    expect(requirementResponseInputSchema.safeParse({ ...input, constraint_tags: ['PRIVATE_REASON'] }).success).toBe(false);
  });
  it('turns the organizer confirmed preparation into editable form without carrying private answers or consent', () => {
    const snapshot = { viewer: { is_manager: true }, collection: { activity_id: null, status: 'finalized', draft: { ...draft, locations: [{ id: 'park', label: '计划公园' }] }, final_selection: { location_id: 'park', location_other: null, note: 'PRIVATE_NOTE_NOT_FOR_FORM' } } } as unknown as RequirementSnapshot;
    const form = formFromPreparation(snapshot);
    expect(form.name).toBe(draft.title); expect(form.segments[0].place).toBe('计划公园');
    expect(form.attending).toEqual([]); expect(form.nickname).toBe(''); expect(form.segments[0].minimum).toBe(''); expect(form.segments[0].startTime).toBe('');
    expect(JSON.stringify(form)).not.toContain('PRIVATE_NOTE');
    expect(() => formFromPreparation({ ...snapshot, viewer: { ...snapshot.viewer, is_manager: false } })).toThrow();
  });
  it('own answer recovery retains all three structured privacy-safe input fields', () => {
    const own = { ...answer(), response_version: 1, private_origin: null };
    expect(responseInputFromSaved(own)).toMatchObject({ budget_max_yuan: 80, preference_tags: ['桌游'], constraint_tags: ['不安排酒精'] });
  });
});

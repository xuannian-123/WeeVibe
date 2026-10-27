import { z } from 'zod';
import { venueSelectionSchema, type VenueSelection } from './venues';
/** Pure requirement rules. Persistence adapters MUST lock the activity and use server time. */
export type RequirementOption = { id: string; label: string };
export type RequirementLocation = RequirementOption & { venue?: VenueSelection };
export type RequirementQuestion = { id: string; title: string; multiple: boolean; required: boolean; segment_id: string | null; options: RequirementOption[] };
export type TeamDraft = { title: string; description: string; starts_at: string; deadline_at: string; timezone: 'Asia/Shanghai'; locations: RequirementLocation[]; questions: RequirementQuestion[] };
export type RequirementAnswer = { question_id: string; option_ids: string[]; other: string | null };
export type RequirementCollection = { revision: number; deadline_at: string; closed_at: string | null; questions: RequirementQuestion[]; group_access_required: boolean };
export type RequirementResponse = { user_id: string; revision: number; selected_segment_ids: string[]; answers: RequirementAnswer[]; updated_at: string };
export class RequirementError extends Error { constructor(public code: string, message: string) { super(message); } }
function assert(ok: unknown, message: string, code = 'INVALID_INPUT'): asserts ok { if (!ok) throw new RequirementError(code, message); }
const unique = (values: string[]) => new Set(values).size === values.length;
const validText = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const validId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export function validateQuestions(questions: RequirementQuestion[]) {
  assert(Array.isArray(questions) && questions.length <= 20, '最多 20 个问题');
  assert(unique(questions.map(q => q.id)), '问题 ID 不能重复');
  for (const q of questions) {
    assert(validId(q.id) && validText(q.title, 200), '请填写有效题目');
    assert(q.segment_id === null || validId(q.segment_id), '环节关联无效');
    assert(typeof q.multiple === 'boolean' && typeof q.required === 'boolean', '问题类型无效');
    assert(q.options.length >= 1 && q.options.length <= 20, '每题需要 1 至 20 个普通选项，另含其他输入');
    assert(unique(q.options.map(o => o.id)) && unique(q.options.map(o => o.label.trim())), '选项不得重复');
    for (const o of q.options) assert(validId(o.id) && validText(o.label, 100), '请填写有效选项');
  }
}
export function validateTeamDraft(draft: TeamDraft, serverNow: number) {
  assert(validText(draft.title, 100) && typeof draft.description === 'string' && draft.description.length <= 1000, '标题或说明无效');
  assert(draft.timezone === 'Asia/Shanghai', '当前支持北京时间');
  const timestamp = z.iso.datetime({ offset: true });
  assert(timestamp.safeParse(draft.starts_at).success && timestamp.safeParse(draft.deadline_at).success, '时间必须包含明确时区（Z 或 +08:00）');
  const start = Date.parse(draft.starts_at), deadline = Date.parse(draft.deadline_at);
  assert(Number.isFinite(start) && Number.isFinite(deadline) && deadline > serverNow && deadline <= start, '截止时间须晚于当前时间且不晚于活动开始');
  assert(draft.locations.length >= 1 && draft.locations.length <= 20, '请至少添加一个候选地点');
  assert(unique(draft.locations.map(l => l.id)) && unique(draft.locations.map(l => l.label.trim())), '候选地点不能重复');
  for (const location of draft.locations) {
    assert(validId(location.id) && validText(location.label, 200), '候选地点无效');
    if (location.venue !== undefined) assert(venueSelectionSchema.safeParse(location.venue).success && location.label === location.venue.name, '地图候选名称与来源不一致；编辑名称后请重新选点或改为自定义');
  }
  validateQuestions(draft.questions);
  return draft;
}
/** No approval is required merely to answer; this never grants activity seats. */
export function saveRequirementResponse(collection: RequirementCollection, responses: RequirementResponse[], actorId: string, input: Omit<RequirementResponse, 'user_id' | 'updated_at'>, serverNow: number, verifiedGroupAccess = false): RequirementResponse[] {
  assert(validId(actorId), '必须登录', 'UNAUTHENTICATED');
  assert(Number.isFinite(serverNow), '服务端时间无效');
  assert(!collection.closed_at && serverNow < Date.parse(collection.deadline_at), '需求收集已截止', 'COLLECTION_CLOSED');
  assert(!collection.group_access_required || verifiedGroupAccess, '尚未验证填写权限', 'FORBIDDEN');
  assert(input.revision === collection.revision, '问题版本已变化', 'VERSION_CONFLICT');
  validateQuestions(collection.questions);
  assert(input.selected_segment_ids.length <= 50 && unique(input.selected_segment_ids) && input.selected_segment_ids.every(validId), '环节选择无效');
  assert(unique(input.answers.map(a => a.question_id)), '同一题不能提交两次');
  const relevant = collection.questions.filter(q => q.segment_id === null || input.selected_segment_ids.includes(q.segment_id));
  for (const answer of input.answers) {
    const q = relevant.find(item => item.id === answer.question_id);
    assert(q, '包含不适用的问题');
    assert(Array.isArray(answer.option_ids) && unique(answer.option_ids) && answer.option_ids.every(id => q.options.some(o => o.id === id)), '选项不属于当前问题');
    assert(answer.other === null || validText(answer.other, 500), '选择其他后请填写有效内容');
    const count = answer.option_ids.length + (answer.other === null ? 0 : 1);
    assert(q.multiple || count <= 1, '单选题不能同时选择普通选项和其他');
    assert(!q.required || count > 0, '请回答必答问题');
  }
  for (const q of relevant.filter(q => q.required)) assert(input.answers.some(a => a.question_id === q.id), '请回答必答问题');
  const own: RequirementResponse = { user_id: actorId, revision: collection.revision, selected_segment_ids: [...input.selected_segment_ids], answers: input.answers.map(a => ({ question_id: a.question_id, option_ids: [...a.option_ids], other: a.other === null ? null : a.other.trim() })), updated_at: new Date(serverNow).toISOString() };
  return [...responses.filter(r => r.user_id !== actorId), own];
}
export function assertQuestionStructureEditable(responseCount: number) { assert(responseCount === 0, '已有答卷，不能修改题目与选项含义', 'STRUCTURE_FROZEN'); }
export function requirementStatistics(questions: RequirementQuestion[], responses: RequirementResponse[]) {
  return questions.map(q => ({ question_id: q.id, respondent_count: responses.filter(r => r.answers.some(a => a.question_id === q.id)).length, options: q.options.map(o => ({ option_id: o.id, count: responses.filter(r => r.answers.some(a => a.question_id === q.id && a.option_ids.includes(o.id))).length })), other_count: responses.filter(r => r.answers.some(a => a.question_id === q.id && a.other !== null)).length }));
}
/** Manager projection deliberately has no departure location, routes, or profile fields. */
export function managerRequirementView(response: RequirementResponse) {
  return { user_id: response.user_id, revision: response.revision, answers: response.answers.map(a => ({ question_id: a.question_id, option_ids: [...a.option_ids], other: a.other })), updated_at: response.updated_at };
}

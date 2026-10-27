import { z } from 'zod';
import type { TeamDraft } from './requirements';
import type { AvatarAsset } from './avatar';
import { venueSelectionSchema } from './venues';
const text = (max: number) => z.string().max(max).refine(s => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(s), '文字格式无效');
const stableId = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const requirementOptionSchema = z.object({ id: stableId, label: text(200) }).strict();
export const requirementLocationSchema = requirementOptionSchema.extend({ venue: venueSelectionSchema.optional() }).strict().refine(v => v.venue === undefined || v.label === v.venue.name, '地图候选名称须与所选地点一致');
export const requirementQuestionSchema = z.object({ id: stableId, title: text(200), multiple: z.boolean(), required: z.boolean(), segment_id: z.uuid().nullable(), options: z.array(requirementOptionSchema).max(20) }).strict();
/** Drafts may be incomplete. Publishing uses validateTeamDraft with server time. */
export const requirementDraftSchema = z.object({ title: text(100), description: text(1000), starts_at: text(40), deadline_at: text(40), timezone: z.literal('Asia/Shanghai'), locations: z.array(requirementLocationSchema).max(20), questions: z.array(requirementQuestionSchema).max(20) }).strict();
export const privateOriginSchema = z.object({ label: text(200).optional(), longitude: z.number().finite().min(-180).max(180).optional(), latitude: z.number().finite().min(-90).max(90).optional(), crs: z.literal('GCJ-02').optional() }).strict()
  .refine(v => Boolean(v.label?.trim()) || (v.longitude !== undefined && v.latitude !== undefined && v.crs === 'GCJ-02'), '请填写出发地点或有效坐标')
  .refine(v => (v.longitude === undefined) === (v.latitude === undefined) && (v.longitude === undefined || v.crs === 'GCJ-02'), '经纬度与坐标系须完整');
export const requirementAnswerSchema = z.object({ question_id: stableId, option_ids: z.array(stableId).max(20), other: text(500).nullable() }).strict();
export const preferenceTagSchema = z.enum(['运动', '聚餐', '桌游', '唱歌', '散步', '看展']);
export const constraintTagSchema = z.enum(['避免剧烈运动', '需无障碍通行', '不安排酒精', '饮食限制需另行确认']);
export const requirementResponseInputSchema = z.object({
  selected_segment_ids: z.array(z.uuid()).max(50), answers: z.array(requirementAnswerSchema).max(20),
  location_ids: z.array(stableId).max(20), location_other: text(500).nullable(),
  time_preferences: text(1000), budget_note: text(500), preferences: text(1000),
  budget_max_yuan: z.number().finite().min(0).max(1000000).nullable().optional(),
  preference_tags: z.array(preferenceTagSchema).max(6).refine(v => new Set(v).size === v.length).optional(),
  constraint_tags: z.array(constraintTagSchema).max(4).refine(v => new Set(v).size === v.length).optional(),
  private_origin: privateOriginSchema.nullable().optional()
}).strict();
export const requirementFinalSelectionSchema = z.object({ location_id: stableId.nullable(), location_other: text(500).nullable(), note: text(1000) }).strict();
export const requirementCreateSchema = z.object({ action: z.literal('create'), kind: z.enum(['friend', 'team']), activity_id: z.uuid().optional(), idempotency_key: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/), draft: requirementDraftSchema }).strict()
 .refine(v => v.kind !== 'team' || v.activity_id === undefined, '团建筹备不绑定其他活动');
const expected = z.number().int().positive();
// For respond, an omitted answer precondition is parsed only to return an explicit
// upgrade conflict. The service never permits a write without it. 0 means no saved answer.
export const requirementCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('save-draft'), expected_revision: expected, draft: requirementDraftSchema }).strict(),
  z.object({ action: z.literal('publish'), expected_revision: expected }).strict(),
  z.object({ action: z.literal('respond'), expected_revision: expected, expected_response_version: z.number().int().min(0).max(2147483646).optional(), response: requirementResponseInputSchema }).strict(),
  z.object({ action: z.literal('close'), expected_revision: expected }).strict(),
  z.object({ action: z.literal('finalize'), expected_revision: expected, final_selection: requirementFinalSelectionSchema }).strict()
]);
export type RequirementResponseInput = z.infer<typeof requirementResponseInputSchema>;
export type RequirementCreateInput = z.infer<typeof requirementCreateSchema>;
export type RequirementCommand = z.infer<typeof requirementCommandSchema>;
export type RequirementFinalSelection = z.infer<typeof requirementFinalSelectionSchema>;
export type PublicRequirementResponse = Omit<RequirementResponseInput, 'private_origin'> & { user_id: string; revision: number; updated_at: string; nickname: string };
export type OwnRequirementResponse = PublicRequirementResponse & { response_version: number; private_origin: z.infer<typeof privateOriginSchema> | null };
export type RequirementSummary = { id: string; kind: 'friend' | 'team'; activity_id: string | null; title: string; status: 'draft' | 'open' | 'closed' | 'finalized'; deadline_at: string | null; revision: number; is_manager: boolean; has_responded: boolean; updated_at: string };
const aggregateCount = z.number().int().nonnegative();
export const requirementAggregateSchema = z.object({
  respondent_count: aggregateCount, time_respondent_count: aggregateCount,
  budget: z.object({ structured_count: aggregateCount, text_count: aggregateCount, min_max_yuan: z.number().nonnegative().nullable(), max_max_yuan: z.number().nonnegative().nullable() }).strict(),
  preferences: z.array(z.object({ label: preferenceTagSchema, count: aggregateCount }).strict()),
  constraints: z.array(z.object({ label: constraintTagSchema, count: aggregateCount }).strict()),
  private_text_count: aggregateCount,
  segments: z.array(z.object({ segment_id: z.uuid(), count: aggregateCount }).strict()),
  questions: z.array(z.object({ question_id: stableId, respondent_count: aggregateCount, options: z.array(z.object({ option_id: stableId, count: aggregateCount }).strict()), other_count: aggregateCount }).strict()),
  locations: z.array(z.object({ option_id: stableId, count: aggregateCount }).strict()), location_other_count: aggregateCount
}).strict();
export type RequirementAggregate = z.infer<typeof requirementAggregateSchema>;
export type RequirementSnapshot = {
  collection: RequirementSummary & { draft: TeamDraft; closed_at: string | null; final_selection: RequirementFinalSelection | null; organizer_nickname: string; organizer_avatar?: AvatarAsset | null };
  viewer: { is_manager: boolean; can_respond: boolean; can_edit: boolean; can_publish: boolean; can_close: boolean; can_finalize: boolean; blocked_reason: string | null };
  segments: { id: string; name: string; starts_at: string; ends_at: string; cancelled_at: string | null }[];
  own_response: OwnRequirementResponse | null;
  aggregate?: RequirementAggregate;
  manager: null | { responses: PublicRequirementResponse[]; respondent_count: number; questions: { question_id: string; respondent_count: number; options: { option_id: string; count: number }[]; other_count: number }[]; locations: { option_id: string; count: number }[]; location_other_count: number };
  server_time: string;
};
export type RequirementList = { collections: RequirementSummary[]; server_time: string; limit: number };

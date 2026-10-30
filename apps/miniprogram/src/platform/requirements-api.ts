import { z } from 'zod';
import {
  avatarAssetSchema, privateOriginSchema, requirementDraftSchema, requirementAggregateSchema,
  requirementFinalSelectionSchema, requirementResponseInputSchema,
  type RequirementList, type RequirementSnapshot,
} from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { extensionRequest } from './extension-api';

// These are response shapes, not new business rules. Draft dates may be incomplete;
// only server timestamps must be valid. Unknown response fields are not retained.
const time = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
const version = z.number().int().positive().max(2147483647);
const summary = z.object({
  id: z.uuid(), kind: z.literal('friend'), activity_id: z.uuid().nullable(),
  title: z.string(), status: z.enum(['draft', 'open', 'closed', 'finalized']),
  deadline_at: time.nullable(), revision: version, is_manager: z.boolean(),
  has_responded: z.boolean(), updated_at: time,
});
const publicAnswer = requirementResponseInputSchema.omit({ private_origin: true }).strip().extend({
  user_id: z.uuid(), revision: version, updated_at: time, nickname: z.string(),
});
const optionCount = z.object({ option_id: z.string(), count });
const snapshotSchema = z.object({
  collection: summary.extend({
    draft: requirementDraftSchema.strip(), closed_at: time.nullable(),
    final_selection: requirementFinalSelectionSchema.strip().nullable(),
    organizer_nickname: z.string(), organizer_avatar: avatarAssetSchema.nullable().optional(),
  }),
  viewer: z.object({
    is_manager: z.boolean(), can_respond: z.boolean(), can_edit: z.boolean(),
    can_publish: z.boolean(), can_close: z.boolean(), can_finalize: z.boolean(),
    blocked_reason: z.string().nullable(),
  }),
  segments: z.array(z.object({ id: z.uuid(), name: z.string(), starts_at: time, ends_at: time, cancelled_at: time.nullable() })),
  own_response: publicAnswer.extend({ response_version: version, private_origin: privateOriginSchema.nullable() }).nullable(),
  aggregate: requirementAggregateSchema.optional(),
  manager: z.object({
    responses: z.array(publicAnswer.refine(r => r.budget_note === '' && r.preferences === '' && r.answers.length === 0 && r.location_ids.length === 0 && r.location_other === null && r.budget_max_yuan === undefined && r.preference_tags === undefined && r.constraint_tags === undefined, '当前后端尚未采用分字段隐私投影')), respondent_count: count,
    questions: z.array(z.object({ question_id: z.string(), respondent_count: count, options: z.array(optionCount), other_count: count })),
    locations: z.array(optionCount), location_other_count: count,
  }).nullable(),
  server_time: time,
});
const listSchema = z.object({ collections: z.array(summary), server_time: time, limit: z.number().int().positive() });
const absentSchema = z.object({ collection: z.null() });
function invalidResponse(): never {
  // Never expose Zod diagnostics or raw response values (which may contain private data).
  throw new ApiClientError('INVALID_RESPONSE', '需求服务响应与当前版本不匹配，结果未确认。请保留输入和原请求，核对前后端版本并刷新状态；不会显示保存成功。', 200);
}
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  return result.success ? result.data : invalidResponse();
}
const sameUuid = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Only successful requirement payloads are checked here; transport errors retain their semantics. */
export async function requestRequirement(path: string, method?: 'GET' | 'POST', body?: unknown): Promise<RequirementSnapshot> {
  const result = parse(snapshotSchema, await extensionRequest<unknown>(path, method, body));
  const id = /^\/api\/v1\/requirements\/([^/?]+)$/.exec(path)?.[1];
  if (id && !sameUuid(result.collection.id, id)) invalidResponse();
  if (path === '/api/v1/requirements' && method === 'POST' && body && typeof body === 'object' && 'action' in body && body.action === 'create') {
    const input = body as { kind?: unknown; activity_id?: unknown };
    if (result.collection.kind !== input.kind) invalidResponse();
    if (typeof input.activity_id === 'string' ? result.collection.activity_id === null || !sameUuid(result.collection.activity_id, input.activity_id)
      : result.collection.activity_id !== null) invalidResponse();
    // A replay may legitimately return an updated draft/status. Do not compare them.
  }
  return result;
}
export async function listRequirements(): Promise<RequirementList> {
  const raw=await extensionRequest<unknown>('/api/v1/requirements');
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
  return parse(listSchema,value&&Array.isArray(value.collections)?{...value,collections:value.collections.filter(row=>!row||typeof row!=='object'||row.kind!=='team')}:raw);
}
export async function requirementForActivity(activityId: string): Promise<RequirementSnapshot | { collection: null }> {
  const result = parse(z.union([snapshotSchema, absentSchema]), await extensionRequest<unknown>(`/api/v1/requirements?activity_id=${activityId}`));
  if (result.collection && (result.collection.activity_id === null || !sameUuid(result.collection.activity_id, activityId))) invalidResponse();
  return result;
}

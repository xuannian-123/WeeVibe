import { z } from 'zod';
import { activityDetailSchema, activityIdSchema, createActivitySegmentSchema, idempotencyKeySchema } from './activities';
import { arrangementPlanSchema } from './arrangement';
const version = z.number().int().min(1).max(2_147_483_647);
export const editArrangementSegmentSchema = createActivitySegmentSchema.safeExtend({ segment_id: activityIdSchema.optional(), cancelled: z.boolean() });
export const editArrangementInputSchema = z.object({
  idempotency_key: idempotencyKeySchema, expected_revision: version,
  main_segment_ref: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  segments: z.array(editArrangementSegmentSchema).min(1).max(50)
}).strict().superRefine((input, ctx) => {
  const refs = input.segments.map(s => s.client_ref), ids = input.segments.flatMap(s => s.segment_id ? [s.segment_id] : []);
  if (new Set(refs).size !== refs.length || new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: '环节标识不能重复' });
  if (!input.segments.some(s => s.client_ref === input.main_segment_ref && !s.cancelled)) ctx.addIssue({ code: 'custom', message: '必须保留唯一有效主环节' });
  const active = input.segments.filter(s => !s.cancelled);
  if (active.some((s, i) => i > 0 && Date.parse(s.starts_at) < Date.parse(active[i - 1].starts_at))) ctx.addIssue({ code: 'custom', message: '环节顺序须与实际开始时间一致' });
});
export type EditArrangementInput = z.infer<typeof editArrangementInputSchema>;
export const arrangementEditPreviewSchema = z.object({
  activity_id: activityIdSchema, viewer_user_id: activityIdSchema, revision: version,
  main_changed: z.boolean(), warnings: z.array(z.string()),
  changes: z.array(z.object({ client_ref: z.string(), name: z.string(), before: arrangementPlanSchema.nullable(), after: arrangementPlanSchema,
    cancelled: z.boolean(), is_new: z.boolean(), requires_reacceptance: z.boolean(), resets_verification: z.boolean(), affected_count: z.number().int().nonnegative() }).strict())
}).strict();
export type ArrangementEditPreview = z.infer<typeof arrangementEditPreviewSchema>;
export const editArrangementResultSchema = activityDetailSchema;
/** A new, explicit human statement about the current segment version. */
export const verifySegmentInputSchema = z.object({ action: z.literal('verify-segment'), segment_id: activityIdSchema,
  idempotency_key: idempotencyKeySchema, expected_revision: version, expected_plan_revision: version, verified: z.boolean() }).strict();
export type VerifySegmentInput = z.infer<typeof verifySegmentInputSchema>;

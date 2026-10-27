import { z } from 'zod';
import { activityIdSchema } from './activities';
export const APPLICATION_ATTRIBUTION_LIMIT = 2000;
/** Public entry provenance is not evidence of the real sender or of a person's identity. */
export const applicationAttributionSourceSchema = z.object({
  invitation_id: activityIdSchema,
  inviter_display_name: z.string().max(40).nullable(),
  source_only: z.literal(true)
}).strict();
export const applicationAttributionEntrySchema = z.object({
  application_id: activityIdSchema,
  // NULL includes legacy and unrecorded entry sources, not a verified "direct application".
  source: applicationAttributionSourceSchema.nullable()
}).strict();
export const applicationAttributionsSchema = z.object({
  schema_version: z.literal(1), activity_id: activityIdSchema,
  revision: z.number().int().min(1).max(2_147_483_647),
  viewer_user_id: activityIdSchema, is_manager: z.boolean(),
  complete: z.literal(true), limit: z.literal(APPLICATION_ATTRIBUTION_LIMIT),
  entries: z.array(applicationAttributionEntrySchema).max(APPLICATION_ATTRIBUTION_LIMIT)
}).strict().refine(v => new Set(v.entries.map(e => e.application_id)).size === v.entries.length, '申请来源记录重复');
export type ApplicationAttributions = z.infer<typeof applicationAttributionsSchema>;
export type ApplicationAttributionEntry = z.infer<typeof applicationAttributionEntrySchema>;

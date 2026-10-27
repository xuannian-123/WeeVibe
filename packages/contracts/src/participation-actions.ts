import { z } from 'zod';
import { activityDetailSchema, activityIdSchema, idempotencyKeySchema } from './activities';

const common = {
  idempotency_key: idempotencyKeySchema,
  expected_revision: z.number().int().min(1).max(2_147_483_647),
  segment_ids: z.array(activityIdSchema).min(1).max(50)
    .refine(ids => new Set(ids).size === ids.length, '不得重复选择环节')
};
/** No user ID, requirement answers, budget, departure or preferences are accepted here. */
export const participationActionSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('exit') }).strict(),
  z.object({ ...common, action: z.literal('late'), estimated_arrival_at: z.iso.datetime({ offset: true }) }).strict()
]);
export type ParticipationAction = z.infer<typeof participationActionSchema>;
export const participationActionResultSchema = z.object({
  activity: activityDetailSchema,
  notice: z.string(),
  fee_recheck_required: z.boolean()
}).strict();
export type ParticipationActionResult = z.infer<typeof participationActionResultSchema>;

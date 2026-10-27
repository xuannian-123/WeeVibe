import { z } from 'zod';
import { activityIdSchema, idempotencyKeySchema } from './activities';
const version = z.number().int().min(1).max(2_147_483_647);
const common = {
  idempotency_key: idempotencyKeySchema,
  expected_revision: version,
  segment_id: activityIdSchema,
  expected_plan_revision: version,
};
/** Current-main-only manager commands; no client actor, counts, bookings or answers. */
export const formationCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('set-verification'), verified: z.boolean() }).strict(),
  z.object({ ...common, action: z.literal('confirm-formation') }).strict(),
]);
export type FormationCommand = z.infer<typeof formationCommandSchema>;

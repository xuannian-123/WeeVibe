import { z } from 'zod';
import { idempotencyKeySchema } from './activities';
const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
/** Only extending the application/approval window; no arrangement acceptance changes. */
export const extendDeadlineInputSchema = z.object({
  idempotency_key: idempotencyKeySchema,
  expected_revision: z.number().int().min(1).max(2_147_483_647),
  expected_deadline_at: instant,
  deadline_at: instant
}).strict().refine(input => Date.parse(input.deadline_at) > Date.parse(input.expected_deadline_at), '只能延长报名截止时间');
export type ExtendDeadlineInput = z.infer<typeof extendDeadlineInputSchema>;

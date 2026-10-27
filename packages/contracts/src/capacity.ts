import { z } from 'zod';
import { idempotencyKeySchema } from './activities';
const positiveInt = z.number().int().min(1).max(2_147_483_647);
/** Capacity alone: minimum, price, requirements and arrangement acceptance are never inputs. */
export const changeCapacityInputSchema = z.object({
  idempotency_key: idempotencyKeySchema,
  expected_revision: positiveInt,
  expected_capacity: positiveInt,
  capacity: positiveInt
}).strict().refine(input => input.expected_capacity !== input.capacity, '人数上限没有变化');
export type ChangeCapacityInput = z.infer<typeof changeCapacityInputSchema>;

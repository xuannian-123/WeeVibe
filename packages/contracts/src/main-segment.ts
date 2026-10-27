import { z } from 'zod';
import { activityIdSchema,activityDetailSchema,idempotencyKeySchema } from './activities';
/** Direct main choice only. Does not change a segment's arrangement or members. */
export const changeMainSegmentInputSchema=z.object({
 idempotency_key:idempotencyKeySchema,
 expected_revision:activityDetailSchema.shape.revision,
 expected_main_segment_id:activityIdSchema,
 target_segment_id:activityIdSchema
}).strict().refine(x=>x.expected_main_segment_id!==x.target_segment_id,'必须选择不同的有效环节，不用重复选择清除成局确认');
export type ChangeMainSegmentInput=z.infer<typeof changeMainSegmentInputSchema>;

import {z} from 'zod';
import {idempotencyKeySchema} from './activities';
const id=z.uuid(),key=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),note=z.string().trim().max(300),version=z.number().int().nonnegative();
export const gatheringSelectionSchema=z.object({version,plan_ids:z.array(key).max(3),note}).strict();
export const gatheringConfirmationSchema=z.object({version,proposal_version:version,decision:z.enum(['accept','reject']),note}).strict();
export const gatheringWorkflowStateSchema=z.object({generation_id:id,source_hash:z.string().regex(/^[a-f0-9]{64}$/),phase:z.enum(['selecting','confirming','adjusting','completed']),proposal_plan_id:key.nullable(),proposal_version:version,coordination_note:note,selections:z.record(id,gatheringSelectionSchema),confirmations:z.record(id,gatheringConfirmationSchema)}).strict();
const common={idempotency_key:idempotencyKeySchema,generation_id:id};
export const gatheringWorkflowCommandSchema=z.discriminatedUnion('action',[
 z.object({...common,action:z.literal('select'),expected_version:version,plan_ids:z.array(key).max(3).refine(v=>new Set(v).size===v.length),note}).strict(),
 z.object({...common,action:z.literal('propose'),expected_version:version,plan_id:key,note}).strict(),
 z.object({...common,action:z.literal('respond'),expected_version:version,proposal_version:version,decision:z.enum(['accept','reject']),note}).strict(),
]);
export type GatheringWorkflowState=z.infer<typeof gatheringWorkflowStateSchema>;
export type GatheringWorkflowCommand=z.infer<typeof gatheringWorkflowCommandSchema>;

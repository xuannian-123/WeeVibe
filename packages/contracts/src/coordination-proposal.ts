import { z } from 'zod';
import { aiCoordinationProposalSchema } from './ai';

/** Public projection of the existing proposal contract, not a second planning format.
 * Member aliases, model prose and model-written unknown descriptions never leave this boundary. */
export const coordinationSuggestionSchema = z.object({
  source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  source_validated_at: z.iso.datetime({ offset: true }),
  can_apply: z.literal(false),
  validation_scope: z.literal('program_time_checks_only'),
  candidate: aiCoordinationProposalSchema.omit({ affected_member_ids: true, explanation: true, unknowns: true }).extend({
    affected_member_count: z.number().int().nonnegative(),
    unknowns: z.array(aiCoordinationProposalSchema.shape.unknowns.element.omit({ detail: true })),
    explanation: z.enum([
      '仅通过限定时间规则检查，未应用；转场、可用性和未结构化偏好仍需人工核对。',
      '当前信息不足，未产生可应用安排；未自动省略任何人的需求。',
      '未找到建议不代表不存在可行安排；未改变活动或排除任何人。'
    ])
  }).strict()
}).strict();
export type CoordinationSuggestion = z.infer<typeof coordinationSuggestionSchema>;

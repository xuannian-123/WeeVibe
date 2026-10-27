import { z } from 'zod';

/** Relationship badges are independent from calendar phase; none grants seats or permissions. */
export const accountActivityRecordSchema = z.object({
  activity_id: z.uuid(), title: z.string(), timezone: z.string(),
  starts_at: z.iso.datetime().nullable(), ends_at: z.iso.datetime().nullable(),
  phase: z.enum(['upcoming', 'ongoing', 'ended', 'undated']),
  time_scope: z.enum(['participation', 'activity']), location: z.string(),
  cancelled: z.boolean(), participation_cancelled: z.boolean(),
  is_manager: z.boolean(), joined_segment_count: z.number().int().nonnegative(),
  exited_segment_count: z.number().int().nonnegative(), pending_application_count: z.number().int().nonnegative(),
  awaiting_acceptance: z.boolean()
}).strict();
export type AccountActivityRecord = z.infer<typeof accountActivityRecordSchema>;

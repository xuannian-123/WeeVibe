import { z } from 'zod';
import { activityIdSchema } from './activities';

// Public activity signup names, not account/profile identity or attendance history.
export const PUBLIC_ROSTER_LIMIT = 2000 as const;
const positiveInt = z.number().int().min(1).max(2_147_483_647);
const count = z.number().int().min(0).max(PUBLIC_ROSTER_LIMIT);
const memberSchema = z.object({
  display_name: z.string().max(40).nullable(),
  status: z.enum(['joined', 'awaiting_acceptance'])
}).strict();
const segmentSchema = z.object({
  segment_id: activityIdSchema,
  name: z.string().min(1).max(100).refine(value => value.trim().length > 0, '环节名称不可为空白'),
  position: z.number().int().min(0).max(2_147_483_647),
  plan_revision: positiveInt,
  cancelled: z.boolean(),
  availability: z.enum(['available', 'counts_only', 'cancelled_history_not_exposed']),
  members: z.array(memberSchema).max(PUBLIC_ROSTER_LIMIT).nullable(),
  counts: z.object({ occupied_count: count, accepted_count: count, pending_acceptance_count: count }).strict().nullable()
}).strict();
export const publicRosterSnapshotSchema = z.object({
  activity_id: activityIdSchema,
  activity_revision: positiveInt,
  server_time: z.iso.datetime({ offset: true }),
  cancelled: z.boolean(),
  complete: z.literal(true),
  limit: z.literal(PUBLIC_ROSTER_LIMIT),
  segments: z.array(segmentSchema).min(1).max(PUBLIC_ROSTER_LIMIT)
}).strict().superRefine((snapshot, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (new Set(snapshot.segments.map(s => s.segment_id)).size !== snapshot.segments.length) issue('环节标识重复');
  if (new Set(snapshot.segments.map(s => s.position)).size !== snapshot.segments.length) issue('环节位置重复');
  let total = 0;
  for (let i = 0; i < snapshot.segments.length; i++) {
    const segment = snapshot.segments[i];
    if (i > 0 && snapshot.segments[i - 1].position >= segment.position) issue('环节顺序不正确');
    const hidden = snapshot.cancelled || segment.cancelled;
    if (hidden) {
      if (segment.availability !== 'cancelled_history_not_exposed' || segment.members !== null || segment.counts !== null) issue('已取消历史名册当前未提供');
      continue;
    }
    if (segment.availability === 'counts_only') {
      if (segment.members !== null || segment.counts === null) { issue('人数投影不得包含姓名'); continue; }
      if (segment.counts.occupied_count !== segment.counts.accepted_count + segment.counts.pending_acceptance_count) issue('人数不一致');
      total += segment.counts.occupied_count;
      continue;
    }
    if (segment.availability !== 'available' || segment.members === null || segment.counts === null) { issue('当前名册不完整'); continue; }
    total += segment.members.length;
    const accepted = segment.members.filter(member => member.status === 'joined').length;
    if (segment.counts.occupied_count !== segment.members.length || segment.counts.accepted_count !== accepted || segment.counts.pending_acceptance_count !== segment.members.length - accepted) issue('名册与人数不一致');
  }
  if (total > PUBLIC_ROSTER_LIMIT) issue('当前名册超过完整读取上限');
});
export type PublicRosterSnapshot = z.infer<typeof publicRosterSnapshotSchema>;

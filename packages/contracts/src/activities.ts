import { z } from 'zod';

const positiveInt = z.number().int().min(1).max(2_147_483_647);
const instant = z.iso.datetime({ offset: true });
const ref = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
export const activityIdSchema = z.uuid().transform(id => id.toLowerCase());
export const idempotencyKeySchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9:_-]+$/);
export const activitySegmentTypeSchema = z.enum(['sport', 'dinner', 'karaoke', 'drinks', 'board_game', 'custom']);
export const activityLocationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).nullable(),
  source_url: z.url({ protocol: /^https?$/ }).max(1000).nullable()
}).strict();
export const activityFeeSchema = z.object({
  kind: z.enum(['unknown', 'per_person', 'total', 'per_hour']),
  amount_cents: z.number().int().min(0).max(2_147_483_647).nullable(),
  currency: z.literal('CNY'), note: z.string().trim().max(500)
}).strict().refine(f => f.kind === 'unknown' ? f.amount_cents === null : f.amount_cents !== null, '费用未知必须为null，已知费用必须提供分单位金额');

export const createActivitySegmentSchema = z.object({
  client_ref: ref, type: activitySegmentTypeSchema, name: z.string().trim().min(1).max(100),
  starts_at: instant, ends_at: instant, deadline_at: instant,
  minimum_participants: positiveInt, capacity: positiveInt,
  location: activityLocationSchema, fee: activityFeeSchema,
  requirements: z.string().trim().max(1000)
}).strict().superRefine((s, ctx) => {
  if (s.minimum_participants > s.capacity) ctx.addIssue({ code: 'custom', message: '最低人数不能超过上限' });
  if (Date.parse(s.starts_at) >= Date.parse(s.ends_at)) ctx.addIssue({ code: 'custom', message: '结束必须晚于开始' });
  if (Date.parse(s.deadline_at) > Date.parse(s.starts_at)) ctx.addIssue({ code: 'custom', message: '报名截止不能晚于开始' });
});
export const createActivityInputSchema = z.object({
  idempotency_key: idempotencyKeySchema,
  name: z.string().trim().min(1).max(100), timezone: z.string().trim().min(1).max(64).refine(value => {
    // The mini-program form uses this known IANA zone; it must also validate in
    // JS runtimes without Intl time-zone data. Other zones use server Intl.
    if (value === 'Asia/Shanghai' || value === 'UTC') return true;
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }, '时区无效'),
  main_segment_ref: ref, segments: z.array(createActivitySegmentSchema).min(1),
  participating_segment_refs: z.array(ref),
  display_name: z.string().trim().min(1).max(40).optional()
}).strict().superRefine((a, ctx) => {
  const ids = new Set(a.segments.map(s => s.client_ref));
  if (ids.size !== a.segments.length) ctx.addIssue({ code: 'custom', message: '环节引用重复' });
  if (!ids.has(a.main_segment_ref)) ctx.addIssue({ code: 'custom', message: '必须指定唯一有效主环节' });
  if (new Set(a.participating_segment_refs).size !== a.participating_segment_refs.length || a.participating_segment_refs.some(id => !ids.has(id))) ctx.addIssue({ code: 'custom', message: '本人参加选择无效' });
  for (let i = 1; i < a.segments.length; i++) {
    if (Date.parse(a.segments[i].starts_at) < Date.parse(a.segments[i - 1].starts_at)) ctx.addIssue({ code: 'custom', message: '环节顺序须与开始时间一致' });
  }
});

export const selectedSegmentVersionSchema = z.object({ segment_id: activityIdSchema, plan_revision: positiveInt }).strict();
export const applyToActivityInputSchema = z.object({
  idempotency_key: idempotencyKeySchema, expected_revision: positiveInt,
  segments: z.array(selectedSegmentVersionSchema).min(1),
  display_name: z.string().trim().min(1).max(40).optional()
}).strict().refine(a => new Set(a.segments.map(s => s.segment_id)).size === a.segments.length, '不得重复选择环节');
export const decideApplicationInputSchema = z.object({
  idempotency_key: idempotencyKeySchema, expected_revision: positiveInt,
  decision: z.enum(['approve', 'reject'])
}).strict();

export const activityApplicationSchema = z.object({
  application_id: activityIdSchema, applicant_user_id: activityIdSchema,
  display_name: z.string().nullable(), status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']),
  segments: z.array(selectedSegmentVersionSchema), created_at: instant, decided_at: instant.nullable()
}).strict();
export const activityDetailSchema = z.object({
  activity_id: activityIdSchema, name: z.string(), timezone: z.string(), revision: positiveInt,
  server_time: instant, main_segment_id: activityIdSchema, cancelled_at: instant.nullable(),
  formation_status: z.enum(['not_confirmed', 'confirmed']),
  segments: z.array(z.object({
    segment_id: activityIdSchema, client_ref: ref, position: z.number().int().nonnegative(),
    type: activitySegmentTypeSchema, name: z.string(), starts_at: instant, ends_at: instant, deadline_at: instant,
    minimum_participants: positiveInt, capacity: positiveInt, plan_revision: positiveInt,
    location: activityLocationSchema, fee: activityFeeSchema, requirements: z.string(),
    cancelled_at: instant.nullable(), has_started: z.boolean(), is_join_open: z.boolean(),
    verification_status: z.enum(['unknown', 'manual_checked']), booking_status: z.enum(['unknown', 'manual_booked']),
    counts: z.object({ occupied_count: z.number().int().nonnegative(), accepted_count: z.number().int().nonnegative(), pending_acceptance_count: z.number().int().nonnegative(), remaining_capacity: z.number().int().nonnegative(), meets_minimum: z.boolean(), is_full: z.boolean() }).strict()
  }).strict()),
  viewer: z.object({
    user_id: activityIdSchema.nullable(), is_manager: z.boolean(),
    participations: z.array(z.object({ segment_id: activityIdSchema, status: z.enum(['joined', 'awaiting_acceptance', 'exited']), accepted_plan_revision: positiveInt.nullable() }).strict()),
    applications: z.array(activityApplicationSchema)
  }).strict(),
  // All applications are omitted for non-managers, including anonymous viewers.
  applications: z.array(activityApplicationSchema).optional()
}).strict();

export type CreateActivityInput = z.infer<typeof createActivityInputSchema>;
export type ApplyToActivityInput = z.infer<typeof applyToActivityInputSchema>;
export type DecideApplicationInput = z.infer<typeof decideApplicationInputSchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;

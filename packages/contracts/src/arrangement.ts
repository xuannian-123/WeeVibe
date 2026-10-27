import { z } from 'zod';
import { activityIdSchema, activitySegmentTypeSchema, activityLocationSchema, activityFeeSchema, idempotencyKeySchema } from './activities';
const version = z.number().int().min(1).max(2_147_483_647);
const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
const digest = z.string().regex(/^[a-f0-9]{64}$/);

/** Public agreed segment data only; never a DB row or a private requirement answer. */
export const arrangementPlanSchema = z.object({
  segment_id: activityIdSchema, client_ref: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  position: z.number().int().min(0).max(2_147_483_647), type: activitySegmentTypeSchema,
  name: z.string().min(1).max(100), starts_at: instant, ends_at: instant, deadline_at: instant,
  minimum_participants: version, capacity: version, location: activityLocationSchema,
  fee: activityFeeSchema, requirements: z.string().max(1000)
}).strict().superRefine((plan, ctx) => {
  if (plan.minimum_participants > plan.capacity) ctx.addIssue({ code: 'custom', message: '最低人数不能超过上限' });
  if (Date.parse(plan.starts_at) >= Date.parse(plan.ends_at) || Date.parse(plan.deadline_at) > Date.parse(plan.starts_at)) ctx.addIssue({ code: 'custom', message: '安排时间无效' });
});
export type ArrangementPlan = z.infer<typeof arrangementPlanSchema>;

/** Consumable server event format. This slice deliberately exposes NO change writer. */
export const arrangementChangeEventSchema = z.object({
  schema_version: z.literal(1), segment_id: activityIdSchema,
  from_plan_revision: version, to_plan_revision: version,
  before: arrangementPlanSchema, after: arrangementPlanSchema
}).strict().superRefine((event, ctx) => {
  if (event.to_plan_revision !== event.from_plan_revision + 1 || event.before.segment_id !== event.segment_id || event.after.segment_id !== event.segment_id) ctx.addIssue({ code: 'custom', message: '变更版本或目标无效' });
  const { minimum_participants: beforeMinimum, ...before } = event.before;
  const { minimum_participants: afterMinimum, ...after } = event.after;
  // Schema parsing fixes property order before comparison; only minimum may differ.
  if (beforeMinimum === afterMinimum || JSON.stringify(before) !== JSON.stringify(after)) ctx.addIssue({ code: 'custom', message: '本片仅识别最低人数实质变化历史' });
});
export type ArrangementChangeEvent = z.infer<typeof arrangementChangeEventSchema>;
export const ARRANGEMENT_CHANGE_EVENT_TYPE = 'segment_arrangement_changed';
export const ARRANGEMENT_HISTORY_LIMIT = 500;
const changeSchema = z.object({
  from_plan_revision: version, to_plan_revision: version, changed_at: instant,
  before: arrangementPlanSchema, after: arrangementPlanSchema
}).strict();
export const arrangementReviewV1Schema = z.object({
  activity_id: activityIdSchema, segment_id: activityIdSchema, viewer_user_id: activityIdSchema,
  revision: version, current_plan_revision: version, accepted_plan_revision: version.nullable(), server_time: instant,
  state: z.enum(['up_to_date', 'ready', 'unavailable']), can_reaccept: z.boolean(),
  reason: z.enum(['UP_TO_DATE', 'HISTORY_UNAVAILABLE', 'CANCELLED', 'SEGMENT_STARTED']).nullable(),
  current_plan: arrangementPlanSchema, accepted_plan: arrangementPlanSchema.nullable(),
  history_digest: digest.nullable(), changes: z.array(changeSchema).max(ARRANGEMENT_HISTORY_LIMIT)
}).strict().superRefine((review, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: '安排差异响应不一致' });
  if (review.current_plan.segment_id !== review.segment_id) invalid();
  if (review.state === 'unavailable') {
    if (review.can_reaccept || review.reason !== 'HISTORY_UNAVAILABLE' || review.history_digest !== null || review.accepted_plan !== null || review.changes.length) invalid();
  } else if (review.state === 'up_to_date') {
    if (review.accepted_plan_revision !== review.current_plan_revision || review.can_reaccept || review.reason !== 'UP_TO_DATE' || review.history_digest !== null || review.changes.length || JSON.stringify(review.accepted_plan) !== JSON.stringify(review.current_plan)) invalid();
  } else {
    if (review.accepted_plan_revision === null || review.accepted_plan_revision >= review.current_plan_revision || !review.accepted_plan || !review.history_digest || !review.changes.length || review.can_reaccept !== (review.reason === null) || (review.reason !== null && review.reason !== 'CANCELLED' && review.reason !== 'SEGMENT_STARTED')) invalid();
    let previous = review.accepted_plan, revision = review.accepted_plan_revision;
    for (const change of review.changes) {
      const event = arrangementChangeEventSchema.safeParse({ schema_version: 1, segment_id: review.segment_id, from_plan_revision: change.from_plan_revision, to_plan_revision: change.to_plan_revision, before: change.before, after: change.after });
      if (change.from_plan_revision !== revision || !event.success) invalid();
      if (JSON.stringify(previous) !== JSON.stringify(change.before)) invalid();
      previous = change.after; revision = change.to_plan_revision;
    }
    if (revision !== review.current_plan_revision || JSON.stringify(previous) !== JSON.stringify(review.current_plan)) invalid();
  }
});
export type ArrangementReviewV1 = z.infer<typeof arrangementReviewV1Schema>;
export const reacceptArrangementCommandSchema = z.object({
  action: z.literal('reaccept'), idempotency_key: idempotencyKeySchema,
  expected_revision: version, expected_plan_revision: version,
  from_accepted_plan_revision: version, history_digest: digest
}).strict();
export type ReacceptArrangementCommand = z.infer<typeof reacceptArrangementCommandSchema>;

/** Capacity operations preserve plan revision and immutable agreed conditions. */
export const CAPACITY_CHANGE_EVENT_TYPE = 'segment_capacity_changed';
export const capacityChangeEventSchema = z.object({
  schema_version: z.literal(1), segment_id: activityIdSchema, plan_revision: version,
  before: arrangementPlanSchema, after: arrangementPlanSchema,
  occupied_count: z.number().int().min(0).max(2_147_483_647)
}).strict().superRefine((event, ctx) => {
  const { capacity: beforeCapacity, ...before } = event.before, { capacity: afterCapacity, ...after } = event.after;
  if (event.segment_id !== event.before.segment_id || event.segment_id !== event.after.segment_id || beforeCapacity === afterCapacity
    || JSON.stringify(before) !== JSON.stringify(after) || event.occupied_count > beforeCapacity || event.occupied_count > afterCapacity)
    ctx.addIssue({ code: 'custom', message: '容量事件必须只改变上限、保留原安排与占位' });
});
export type CapacityChangeEvent = z.infer<typeof capacityChangeEventSchema>;

// Capacity is operational metadata, NOT a claim about the member's acceptance-time promise.
const { capacity: _capacity, ...agreementShape } = arrangementPlanSchema.shape;
export const arrangementAgreementSchema = z.object(agreementShape).strict().superRefine((plan, ctx) => {
  if (Date.parse(plan.starts_at) >= Date.parse(plan.ends_at) || Date.parse(plan.deadline_at) > Date.parse(plan.starts_at)) ctx.addIssue({ code: 'custom', message: '安排时间无效' });
});
export type ArrangementAgreement = z.infer<typeof arrangementAgreementSchema>;
export function arrangementAgreement(plan: ArrangementPlan): ArrangementAgreement {
  const { capacity: _capacity, ...conditions } = plan;
  return arrangementAgreementSchema.parse(conditions);
}
const requirementChangeV2Schema = z.object({
  kind: z.literal('requirements'), activity_revision: version, capacity_at_change: version,
  from_plan_revision: version, to_plan_revision: version, changed_at: instant,
  before: arrangementAgreementSchema, after: arrangementAgreementSchema
}).strict().superRefine((change, ctx) => {
  const { minimum_participants: beforeMinimum, ...before } = change.before, { minimum_participants: afterMinimum, ...after } = change.after;
  if (change.to_plan_revision !== change.from_plan_revision + 1 || beforeMinimum === afterMinimum || JSON.stringify(before) !== JSON.stringify(after)
    || beforeMinimum > change.capacity_at_change || afterMinimum > change.capacity_at_change) ctx.addIssue({ code: 'custom', message: '参加要求历史不一致' });
});
const capacityChangeV2Schema = z.object({ activity_revision: version, plan_revision: version, changed_at: instant, before_capacity: version, capacity: version }).strict()
  .refine(change => change.before_capacity !== change.capacity, '容量没有变化');
export const arrangementReviewV2Schema = z.object({
  ...arrangementReviewV1Schema.shape,
  schema_version: z.literal(2), history_format: z.literal('verified_v2'),
  accepted_plan: arrangementAgreementSchema.nullable(),
  // Before-snapshot of the first recorded event, never a member acceptance-time assertion.
  history_anchor: z.object({ activity_revision: version, plan_revision: version, capacity: version }).strict().nullable(),
  changes: z.array(requirementChangeV2Schema).max(ARRANGEMENT_HISTORY_LIMIT),
  capacity_changes: z.array(capacityChangeV2Schema).max(ARRANGEMENT_HISTORY_LIMIT)
}).strict().superRefine((review, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'v2安排与容量历史不一致' });
  if (review.current_plan.segment_id !== review.segment_id) invalid();
  if (review.state === 'unavailable') {
    if (review.can_reaccept || review.reason !== 'HISTORY_UNAVAILABLE' || review.accepted_plan !== null || review.history_digest !== null || review.history_anchor !== null || review.changes.length || review.capacity_changes.length) invalid();
    return;
  }
  if (!review.accepted_plan || review.accepted_plan.segment_id !== review.segment_id || review.accepted_plan_revision === null) { invalid(); return; }
  if (review.state === 'up_to_date') {
    if (review.accepted_plan_revision !== review.current_plan_revision || review.can_reaccept || review.reason !== 'UP_TO_DATE' || review.history_digest !== null || review.changes.length) invalid();
  } else if (review.accepted_plan_revision >= review.current_plan_revision || !review.history_digest || !review.changes.length
    || review.can_reaccept !== (review.reason === null) || (review.reason !== null && review.reason !== 'CANCELLED' && review.reason !== 'SEGMENT_STARTED')) invalid();
  if ([review.changes, review.capacity_changes].some(rows => rows.some((row, i) => i > 0 && row.activity_revision <= rows[i - 1].activity_revision))) invalid();
  const all = [...review.changes.map(item => ({ kind: 'requirements' as const, item })), ...review.capacity_changes.map(item => ({ kind: 'capacity' as const, item }))].sort((a, b) => a.item.activity_revision - b.item.activity_revision);
  if (all.length > ARRANGEMENT_HISTORY_LIMIT || new Set(all.map(row => row.item.activity_revision)).size !== all.length) invalid();
  if (all.length ? !review.history_anchor || review.history_anchor.activity_revision !== all[0].item.activity_revision || review.history_anchor.plan_revision !== review.accepted_plan_revision : review.history_anchor !== null) invalid();
  let previous = review.accepted_plan, revision = review.accepted_plan_revision;
  let capacity = review.history_anchor?.capacity ?? review.current_plan.capacity;
  if (capacity < previous.minimum_participants) invalid();
  for (const row of all) {
    if (row.item.activity_revision > review.revision || Date.parse(row.item.changed_at) > Date.parse(review.server_time)) invalid();
    if (row.kind === 'requirements') {
      const change = row.item;
      if (change.from_plan_revision !== revision || change.capacity_at_change !== capacity || JSON.stringify(change.before) !== JSON.stringify(previous)) invalid();
      previous = change.after; revision = change.to_plan_revision;
    } else {
      const change = row.item;
      if (change.plan_revision !== revision || change.before_capacity !== capacity || change.before_capacity < previous.minimum_participants || change.capacity < previous.minimum_participants) invalid();
      capacity = change.capacity;
    }
  }
  if (revision !== review.current_plan_revision || capacity !== review.current_plan.capacity || JSON.stringify(previous) !== JSON.stringify(arrangementAgreement(review.current_plan))) invalid();
});
export type ArrangementReviewV2 = z.infer<typeof arrangementReviewV2Schema>;

/** v3: deadline is operational metadata too; v1/v2 parsers above remain unchanged. */
export const DEADLINE_EXTENSION_EVENT_TYPE = 'segment_deadline_extended';
export const deadlineExtensionEventSchema = z.object({
  schema_version: z.literal(1), segment_id: activityIdSchema, plan_revision: version,
  before: arrangementPlanSchema, after: arrangementPlanSchema
}).strict().superRefine((event, ctx) => {
  const { deadline_at: beforeDeadline, ...before } = event.before, { deadline_at: afterDeadline, ...after } = event.after;
  if (event.segment_id !== event.before.segment_id || event.segment_id !== event.after.segment_id
    || Date.parse(afterDeadline) <= Date.parse(beforeDeadline) || JSON.stringify(before) !== JSON.stringify(after))
    ctx.addIssue({ code: 'custom', message: '延期事件必须仅延长报名截止并保留原安排' });
});
export type DeadlineExtensionEvent = z.infer<typeof deadlineExtensionEventSchema>;
const { deadline_at: _deadline, ...agreementV3Shape } = arrangementAgreementSchema.shape;
export const arrangementAgreementV3Schema = z.object(agreementV3Shape).strict().superRefine((plan, ctx) => {
  if (Date.parse(plan.starts_at) >= Date.parse(plan.ends_at)) ctx.addIssue({ code: 'custom', message: '安排时间无效' });
});
export type ArrangementAgreementV3 = z.infer<typeof arrangementAgreementV3Schema>;
export function arrangementAgreementV3(plan: ArrangementPlan | ArrangementAgreement): ArrangementAgreementV3 {
  const { deadline_at: _deadline, ...withoutDeadline } = plan;
  const { capacity: _capacity, ...conditions } = withoutDeadline as typeof withoutDeadline & { capacity?: number };
  return arrangementAgreementV3Schema.parse(conditions);
}
const requirementChangeV3Schema = z.object({
  kind: z.literal('requirements'), activity_revision: version, capacity_at_change: version, deadline_at_change: instant,
  from_plan_revision: version, to_plan_revision: version, changed_at: instant,
  before: arrangementAgreementV3Schema, after: arrangementAgreementV3Schema
}).strict().superRefine((change, ctx) => {
  const { minimum_participants: a, ...before } = change.before, { minimum_participants: b, ...after } = change.after;
  if (change.to_plan_revision !== change.from_plan_revision + 1 || a === b || JSON.stringify(before) !== JSON.stringify(after)
    || a > change.capacity_at_change || b > change.capacity_at_change || Date.parse(change.deadline_at_change) > Date.parse(change.before.starts_at))
    ctx.addIssue({ code: 'custom', message: '参加要求历史不一致' });
});
const capacityChangeV3Schema = capacityChangeV2Schema.safeExtend({ deadline_at_change: instant });
const deadlineChangeV3Schema = z.object({ activity_revision: version, plan_revision: version, changed_at: instant,
  capacity_at_change: version, before_deadline_at: instant, deadline_at: instant }).strict()
  .refine(change => Date.parse(change.deadline_at) > Date.parse(change.before_deadline_at), '延期必须延长截止');
export const arrangementReviewV3Schema = z.object({
  ...arrangementReviewV1Schema.shape, schema_version: z.literal(3), history_format: z.literal('verified_v3'),
  accepted_plan: arrangementAgreementV3Schema.nullable(),
  history_anchor: z.object({ activity_revision: version, plan_revision: version, capacity: version, deadline_at: instant }).strict().nullable(),
  changes: z.array(requirementChangeV3Schema).max(ARRANGEMENT_HISTORY_LIMIT),
  capacity_changes: z.array(capacityChangeV3Schema).max(ARRANGEMENT_HISTORY_LIMIT),
  deadline_changes: z.array(deadlineChangeV3Schema).max(ARRANGEMENT_HISTORY_LIMIT)
}).strict().superRefine((review, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'v3安排与运营历史不一致' });
  if (review.current_plan.segment_id !== review.segment_id) invalid();
  if (review.state === 'unavailable') {
    if (review.can_reaccept || review.reason !== 'HISTORY_UNAVAILABLE' || review.accepted_plan !== null || review.history_digest !== null || review.history_anchor !== null || review.changes.length || review.capacity_changes.length || review.deadline_changes.length) invalid();
    return;
  }
  if (!review.accepted_plan || review.accepted_plan.segment_id !== review.segment_id || review.accepted_plan_revision === null) { invalid(); return; }
  if (review.state === 'up_to_date') {
    if (review.accepted_plan_revision !== review.current_plan_revision || review.can_reaccept || review.reason !== 'UP_TO_DATE' || review.history_digest !== null
      || review.history_anchor !== null || review.changes.length || review.capacity_changes.length || review.deadline_changes.length) invalid();
  } else if (review.accepted_plan_revision >= review.current_plan_revision || !review.history_digest || !review.changes.length
    || review.can_reaccept !== (review.reason === null) || (review.reason !== null && review.reason !== 'CANCELLED' && review.reason !== 'SEGMENT_STARTED')) invalid();
  if ([review.changes, review.capacity_changes, review.deadline_changes].some(rows => rows.some((row, i) => i > 0 && row.activity_revision <= rows[i - 1].activity_revision))) invalid();
  const all = [...review.changes.map(item => ({ kind: 'requirements' as const, item })), ...review.capacity_changes.map(item => ({ kind: 'capacity' as const, item })), ...review.deadline_changes.map(item => ({ kind: 'deadline' as const, item }))].sort((a, b) => a.item.activity_revision - b.item.activity_revision);
  if (all.length > ARRANGEMENT_HISTORY_LIMIT || new Set(all.map(row => row.item.activity_revision)).size !== all.length) invalid();
  if (all.length ? !review.history_anchor || review.history_anchor.activity_revision !== all[0].item.activity_revision || review.history_anchor.plan_revision !== review.accepted_plan_revision : review.history_anchor !== null) invalid();
  let previous = review.accepted_plan, revision = review.accepted_plan_revision;
  let capacity = review.history_anchor?.capacity ?? review.current_plan.capacity, deadline = review.history_anchor?.deadline_at ?? review.current_plan.deadline_at;
  if (capacity < previous.minimum_participants || Date.parse(deadline) > Date.parse(previous.starts_at)) invalid();
  for (const row of all) {
    if (row.item.activity_revision > review.revision || Date.parse(row.item.changed_at) > Date.parse(review.server_time)) invalid();
    if (row.kind === 'requirements') {
      const change = row.item;
      if (change.from_plan_revision !== revision || change.capacity_at_change !== capacity || change.deadline_at_change !== deadline || JSON.stringify(change.before) !== JSON.stringify(previous)) invalid();
      previous = change.after; revision = change.to_plan_revision;
    } else if (row.kind === 'capacity') {
      const change = row.item;
      if (change.plan_revision !== revision || change.before_capacity !== capacity || change.deadline_at_change !== deadline || change.before_capacity < previous.minimum_participants || change.capacity < previous.minimum_participants) invalid();
      capacity = change.capacity;
    } else {
      const change = row.item;
      if (change.plan_revision !== revision || change.capacity_at_change !== capacity || change.before_deadline_at !== deadline || Date.parse(change.deadline_at) > Date.parse(previous.starts_at)
        || Date.parse(change.changed_at) >= Date.parse(change.deadline_at) || Date.parse(change.changed_at) >= Date.parse(previous.starts_at)) invalid();
      deadline = change.deadline_at;
    }
  }
  if (revision !== review.current_plan_revision || capacity !== review.current_plan.capacity || deadline !== review.current_plan.deadline_at || JSON.stringify(previous) !== JSON.stringify(arrangementAgreementV3(review.current_plan))) invalid();
});
export type ArrangementReviewV3 = z.infer<typeof arrangementReviewV3Schema>;
/** Strict alternatives: unknown/versioned payloads cannot fall back into a legacy exact object. */
export const arrangementReviewSchema = z.union([arrangementReviewV3Schema, arrangementReviewV2Schema, arrangementReviewV1Schema]);
export type ArrangementReview = z.infer<typeof arrangementReviewSchema>;
export type ArrangementReviewView = Omit<ArrangementReviewV3, 'history_format' | 'changes' | 'capacity_changes' | 'history_anchor'> & {
  history_format: 'verified_v3' | 'legacy_v2' | 'legacy_v1';
  history_anchor: ArrangementReviewV3['history_anchor'];
  changes: Array<Omit<ArrangementReviewV3['changes'][number], 'activity_revision' | 'capacity_at_change' | 'deadline_at_change'> & { activity_revision: number | null; capacity_at_change: number | null; deadline_at_change: string | null }>;
  capacity_changes: Array<Omit<ArrangementReviewV3['capacity_changes'][number], 'deadline_at_change'> & { deadline_at_change: string | null }>;
};
/** Legacy payloads are fully validated first. Normalization never fabricates an independent deadline log. */
export function normalizeArrangementReview(raw: unknown): ArrangementReviewView {
  const parsed = arrangementReviewSchema.parse(raw);
  if ('schema_version' in parsed && parsed.schema_version === 3) return parsed;
  if ('schema_version' in parsed) return { ...parsed, schema_version: 3, history_format: 'legacy_v2', history_anchor: null,
    accepted_plan: parsed.accepted_plan ? arrangementAgreementV3(parsed.accepted_plan) : null,
    changes: parsed.changes.map(change => ({ ...change, deadline_at_change: change.before.deadline_at, before: arrangementAgreementV3(change.before), after: arrangementAgreementV3(change.after) })),
    capacity_changes: parsed.capacity_changes.map(change => ({ ...change, deadline_at_change: null })), deadline_changes: [] };
  return { ...parsed, schema_version: 3, history_format: 'legacy_v1', history_anchor: null,
    accepted_plan: parsed.accepted_plan ? arrangementAgreementV3(parsed.accepted_plan) : null,
    changes: parsed.changes.map(change => ({ ...change, kind: 'requirements', activity_revision: null, capacity_at_change: null, deadline_at_change: change.before.deadline_at, before: arrangementAgreementV3(change.before), after: arrangementAgreementV3(change.after) })), capacity_changes: [], deadline_changes: [] };
}

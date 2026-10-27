import { z } from 'zod';
import { activityIdSchema, idempotencyKeySchema, createActivityInputSchema } from './activities';
const version = z.number().int().min(1).max(2_147_483_647);
const instant = z.iso.datetime({ offset: true }).transform(value => new Date(value).toISOString());
export const BOOKING_DECLARATION_EVENT_TYPE = 'segment_booking_declared';
export const BOOKING_HISTORY_LIMIT = 50;
export const BOOKING_DECLARATION_SOURCE = 'manager_manual_declaration' as const;
export const declareBookingInputSchema = z.object({
  idempotency_key: idempotencyKeySchema, expected_revision: version, expected_plan_revision: version,
  expected_booking_status: z.literal('unknown')
}).strict();
export type DeclareBookingInput = z.infer<typeof declareBookingInputSchema>;
export const bookingVenueTimeSchema = z.object({
  location: z.object({ name: z.string().min(1).max(200), address: z.string().max(500).nullable() }).strict(),
  starts_at: instant, ends_at: instant, timezone: createActivityInputSchema.shape.timezone
}).strict().refine(value => Date.parse(value.starts_at) < Date.parse(value.ends_at), '预订关联时段不正确');
export type BookingVenueTime = z.infer<typeof bookingVenueTimeSchema>;
export function bookingVenueTimeMatches(a: BookingVenueTime, b: BookingVenueTime): boolean {
  return a.location.name === b.location.name && a.location.address === b.location.address && a.starts_at === b.starts_at && a.ends_at === b.ends_at && a.timezone === b.timezone;
}
export const bookingDeclarationEventSchema = z.object({
  ...bookingVenueTimeSchema.shape, schema_version: z.literal(1), activity_id: activityIdSchema, segment_id: activityIdSchema,
  activity_revision: version, plan_revision: version, declared_at: instant, source: z.literal(BOOKING_DECLARATION_SOURCE),
  before_status: z.literal('unknown'), after_status: z.literal('manual_booked')
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.starts_at) >= Date.parse(value.ends_at) || Date.parse(value.declared_at) >= Date.parse(value.starts_at)) ctx.addIssue({ code: 'custom', message: '声明时段或时间不正确' });
});
export type BookingDeclarationEvent = z.infer<typeof bookingDeclarationEventSchema>;
const bookingHistoryItemSchema = z.object({
  ...bookingVenueTimeSchema.shape, activity_revision: version, plan_revision: version, declared_at: instant,
  source: z.literal(BOOKING_DECLARATION_SOURCE), before_status: z.literal('unknown'), after_status: z.literal('manual_booked'),
  matches_current_venue_time: z.boolean()
}).strict().superRefine((value, ctx) => {
  if (Date.parse(value.starts_at) >= Date.parse(value.ends_at) || Date.parse(value.declared_at) >= Date.parse(value.starts_at)) ctx.addIssue({ code: 'custom', message: '声明历史时间不正确' });
});
export const bookingHistorySchema = z.object({
  schema_version: z.literal(1), activity_id: activityIdSchema, segment_id: activityIdSchema, viewer_user_id: activityIdSchema,
  revision: version, current_plan_revision: version, server_time: instant, current_booking_status: z.enum(['unknown', 'manual_booked']),
  current: bookingVenueTimeSchema, state: z.enum(['verified', 'not_recorded', 'legacy_unverified', 'unavailable']),
  items: z.array(bookingHistoryItemSchema).max(BOOKING_HISTORY_LIMIT)
}).strict().superRefine((value, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: '预订声明历史响应不一致' });
  if (value.state === 'verified' ? value.items.length === 0 : value.items.length !== 0) invalid();
  if (value.state === 'not_recorded' && value.current_booking_status !== 'unknown') invalid();
  if (value.state === 'legacy_unverified' && value.current_booking_status !== 'manual_booked') invalid();
  let revision = 0;
  for (const item of value.items) {
    if (item.activity_revision <= revision || item.activity_revision > value.revision || item.plan_revision > value.current_plan_revision
      || Date.parse(item.declared_at) > Date.parse(value.server_time) || item.matches_current_venue_time !== bookingVenueTimeMatches(item, value.current)) invalid();
    revision = item.activity_revision;
  }
});
export type BookingHistory = z.infer<typeof bookingHistorySchema>;

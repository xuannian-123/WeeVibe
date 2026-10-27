import { Prisma } from '@prisma/client';
import { activityIdSchema, bookingDeclarationEventSchema, bookingHistorySchema, bookingVenueTimeSchema, bookingVenueTimeMatches,
  declareBookingInputSchema, BOOKING_DECLARATION_EVENT_TYPE, BOOKING_DECLARATION_SOURCE, BOOKING_HISTORY_LIMIT,
  type ActivityDetail, type BookingHistory, type BookingVenueTime, type DeclareBookingInput } from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { lockActivity } from './state';
import { mutation } from './mutation';
import { replay, remember } from './idempotency';
import { activitySnapshot } from './snapshot';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint } from './rules';
const positiveInt = (value: number) => Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647;
function unavailable(): never { throw new ServiceError('BOOKING_SCOPE_UNAVAILABLE', 409, '当前环节或预订声明来源无法完整核对，请刷新；没有确认外部预订'); }
function identifiers(activity: string, segment: string, actor: string) {
  const a = activityIdSchema.safeParse(activity), s = activityIdSchema.safeParse(segment), u = activityIdSchema.safeParse(actor);
  if (!a.success || !s.success || !u.success) throw new ServiceError('INVALID_INPUT', 400, '预订声明标识不正确');
  return { activityId: a.data, segmentId: s.data, actorId: u.data };
}
function venueTime(timezone: string, segment: { location: Prisma.JsonValue; startsAt: Date; endsAt: Date }): BookingVenueTime {
  const location = segment.location;
  if (!location || typeof location !== 'object' || Array.isArray(location) || !(segment.startsAt instanceof Date) || !(segment.endsAt instanceof Date)
    || !Number.isFinite(segment.startsAt.getTime()) || !Number.isFinite(segment.endsAt.getTime())) unavailable();
  const parsed = bookingVenueTimeSchema.safeParse({ timezone, starts_at: segment.startsAt.toISOString(), ends_at: segment.endsAt.toISOString(), location: { name: location.name, address: location.address } });
  if (!parsed.success) unavailable();
  return parsed.data;
}
/** Records a human declaration about this public venue/time; no merchant/payment calls. */
export function declareBooking(rawActivity: string, rawSegment: string, rawActor: string, raw: DeclareBookingInput): Promise<ActivityDetail> {
  const { activityId, segmentId, actorId } = identifiers(rawActivity, rawSegment, rawActor), parsed = declareBookingInputSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError('INVALID_INPUT', 400, '本片仅支持当前未确认状态的人工预订声明');
  const input = parsed.data, scope = `booking:${activityId}:${segmentId}`, fingerprint = requestFingerprint(actorId, scope, input);
  return mutation(async tx => {
    const activity = await lockActivity(tx, activityId);
    checkManager(activity.currentManagerId, actorId);
    if (await replay(tx, actorId, input.idempotency_key, scope, fingerprint)) return activitySnapshot(tx, activityId, actorId);
    checkNotCancelled(activity.cancelledAt); checkRevision(activity.revision, input.expected_revision);
    if (!positiveInt(activity.revision) || activity.revision === 2_147_483_647 || new Set(activity.segments.map(s => s.id)).size !== activity.segments.length) unavailable();
    const segment = activity.segments.find(s => s.id === segmentId);
    if (!segment) throw new ServiceError('NOT_FOUND', 404, '未找到此活动环节');
    if (segment.activityId !== activityId || !positiveInt(segment.planRevision) || !['unknown', 'manual_booked'].includes(segment.bookingStatus)) unavailable();
    if (segment.planRevision !== input.expected_plan_revision || segment.bookingStatus !== input.expected_booking_status) throw new ServiceError('VERSION_CONFLICT', 409, '安排版本或预订状态已变化，请刷新后核对；未重复创建声明');
    if (segment.cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '此环节已取消；仍可查看历史并自行处理外部预订');
    const source = venueTime(activity.timezone, segment);
    const checkTime = () => { const now = new Date(); if (now >= segment.startsAt) throw new ServiceError('BOOKING_DECLARATION_CLOSED', 409, '此环节已开始，本片新的预订声明尚未启用；仍可查看历史'); return now; };
    checkTime(); // Enrollment cutoff is not this operation's cutoff.
    const changed = await tx.activity.updateMany({ where: { id: activityId, currentManagerId: actorId, revision: activity.revision, cancelledAt: null }, data: { revision: { increment: 1 } } });
    if (changed.count !== 1) throw new ServiceError('CONCURRENT_MODIFICATION', 409, '当前管理权限或活动状态已变化，请刷新重试');
    const declaredAt = checkTime();
    const event = bookingDeclarationEventSchema.parse({ schema_version: 1, activity_id: activityId, segment_id: segmentId, activity_revision: activity.revision + 1,
      plan_revision: segment.planRevision, declared_at: declaredAt.toISOString(), source: BOOKING_DECLARATION_SOURCE,
      before_status: 'unknown', after_status: 'manual_booked', ...source });
    const segmentChanged = await tx.segment.updateMany({ where: { id: segmentId, activityId, planRevision: segment.planRevision, bookingStatus: 'unknown', cancelledAt: null }, data: { bookingStatus: 'manual_booked' } });
    if (segmentChanged.count !== 1) throw new ServiceError('CONCURRENT_MODIFICATION', 409, '此环节安排或预订状态已变化，请刷新重试');
    await tx.activityEvent.create({ data: { activityId, actorUserId: actorId, type: BOOKING_DECLARATION_EVENT_TYPE, revision: activity.revision + 1, createdAt: declaredAt, detail: event } });
    await remember(tx, actorId, input.idempotency_key, scope, fingerprint, activityId);
    return activitySnapshot(tx, activityId, actorId);
  });
}
/** Current-manager-only, bounded RR projection; never selects participants/profile/answers. */
export function readBookingHistory(rawActivity: string, rawSegment: string, rawActor: string): Promise<BookingHistory> {
  const { activityId, segmentId, actorId } = identifiers(rawActivity, rawSegment, rawActor);
  return withDb(db => db.$transaction(async tx => {
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, currentManagerId: true, revision: true, timezone: true } });
    if (!activity) throw new ServiceError('NOT_FOUND', 404, '未找到此活动');
    checkManager(activity.currentManagerId, actorId);
    const segment = await tx.segment.findFirst({ where: { id: segmentId, activityId }, select: { id: true, activityId: true, planRevision: true, bookingStatus: true, location: true, startsAt: true, endsAt: true } });
    if (!segment) throw new ServiceError('NOT_FOUND', 404, '未找到此活动环节');
    if (segment.id !== segmentId || segment.activityId !== activityId || !positiveInt(activity.revision) || !positiveInt(segment.planRevision) || !['unknown', 'manual_booked'].includes(segment.bookingStatus)) unavailable();
    const current = venueTime(activity.timezone, segment);
    const rows = await tx.activityEvent.findMany({ where: { activityId, type: BOOKING_DECLARATION_EVENT_TYPE, detail: { path: ['segment_id'], equals: segmentId } },
      select: { activityId: true, revision: true, createdAt: true, detail: true }, orderBy: [{ revision: 'asc' }, { id: 'asc' }], take: BOOKING_HISTORY_LIMIT + 1 });
    const base = { schema_version: 1 as const, activity_id: activityId, segment_id: segmentId, viewer_user_id: actorId, revision: activity.revision, current_plan_revision: segment.planRevision,
      current_booking_status: segment.bookingStatus, current, server_time: new Date().toISOString() };
    const bad = () => bookingHistorySchema.parse({ ...base, state: 'unavailable', items: [] });
    if (rows.length > BOOKING_HISTORY_LIMIT) return bad();
    const items: BookingHistory['items'] = [];
    let previousRevision = 0;
    for (const row of rows) {
      const parsed = bookingDeclarationEventSchema.safeParse(row.detail);
      if (!parsed.success || row.activityId !== activityId || !positiveInt(row.revision) || row.revision <= previousRevision || row.revision > activity.revision
        || !(row.createdAt instanceof Date) || !Number.isFinite(row.createdAt.getTime())) return bad();
      const e = parsed.data;
      if (e.activity_id !== activityId || e.segment_id !== segmentId || e.activity_revision !== row.revision || e.plan_revision > segment.planRevision
        || e.declared_at !== row.createdAt.toISOString() || Date.parse(e.declared_at) > Date.parse(base.server_time)) return bad();
      const { schema_version: _schema, activity_id: _activity, segment_id: _segment, ...item } = e;
      items.push({ ...item, matches_current_venue_time: bookingVenueTimeMatches(e, current) });
      previousRevision = row.revision;
    }
    return bookingHistorySchema.parse({ ...base, state: items.length ? 'verified' : segment.bookingStatus === 'manual_booked' ? 'legacy_unverified' : 'not_recorded', items });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

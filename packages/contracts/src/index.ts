import { z } from 'zod';

export const errorCodes = ['INVALID_INPUT', 'NOT_CONFIGURED', 'UNAUTHENTICATED', 'UPSTREAM_UNAVAILABLE', 'DATABASE_UNAVAILABLE', 'INTERNAL_ERROR', 'NOT_FOUND', 'FORBIDDEN', 'VERSION_CONFLICT', 'ARRANGEMENT_STALE', 'CAPACITY_FULL', 'SEGMENT_APPLICATION_CLOSED', 'ACTIVITY_CANCELLED', 'ALREADY_JOINED', 'APPLICATION_ALREADY_PENDING', 'APPLICATION_ALREADY_DECIDED', 'IDEMPOTENCY_CONFLICT', 'CONCURRENT_MODIFICATION', 'FORMATION_NOT_READY', 'FORMATION_RULE_UNCONFIRMED', 'ARRANGEMENT_HISTORY_UNAVAILABLE', 'ARRANGEMENT_ACCEPTANCE_CLOSED', 'WITHDRAWAL_RULE_UNCONFIRMED', 'CANCELLATION_RULE_UNCONFIRMED', 'HANDOVER_SCOPE_UNAVAILABLE', 'HANDOVER_ALREADY_PENDING', 'HANDOVER_ALREADY_RESOLVED', 'REBOOK_SCOPE_UNAVAILABLE', 'TODOS_SNAPSHOT_CHANGED', 'MAIN_SEGMENT_SCOPE_UNAVAILABLE', 'ROSTER_LIMIT_EXCEEDED', 'ROSTER_UNAVAILABLE', 'CAPACITY_BELOW_OCCUPIED', 'CAPACITY_BELOW_MINIMUM', 'CAPACITY_CHANGE_CLOSED', 'CAPACITY_SCOPE_UNAVAILABLE', 'DEADLINE_SCOPE_UNAVAILABLE', 'DEADLINE_EXTENSION_CLOSED', 'DEADLINE_OUT_OF_RANGE', 'BOOKING_SCOPE_UNAVAILABLE', 'BOOKING_DECLARATION_CLOSED'] as const;
export const apiErrorSchema = z.object({ error: z.object({ code: z.enum(errorCodes), message: z.string() }), request_id: z.string() });
export type ErrorCode = typeof errorCodes[number];
export const healthSchema = z.object({
  service: z.literal('weego-api'), version: z.literal('0.0.1'), status: z.literal('alive'), server_time: z.iso.datetime(),
  database: z.literal('not_checked'), identity: z.literal('not_checked')
});
export type Health = z.infer<typeof healthSchema>;
export const loginRequestSchema = z.object({ code: z.string().min(1).max(256) }).strict();
export const userSchema = z.object({ user_id: z.uuid() });
export const sessionSchema = z.object({ token: z.string().min(32), expires_at: z.iso.datetime(), user: userSchema });
export const testRecordInputSchema = z.object({ value: z.string().min(1).max(200) }).strict();
export const testRecordSchema = z.object({ value: z.string().nullable(), updated_at: z.iso.datetime().nullable() });

// Legacy compact drafts retained for existing consumers/tests. Formal WG-02/03
// request/response schemas are in activities.ts, re-exported below.
export const segmentTypeSchema = z.enum(['sport', 'dinner', 'karaoke', 'drinks', 'board_game', 'custom']);
export const segmentDraftSchema = z.object({
  client_ref: z.string().min(1), type: segmentTypeSchema, name: z.string().min(1),
  starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }),
  deadline_at: z.iso.datetime({ offset: true }), minimum_participants: z.number().int().positive(), capacity: z.number().int().positive()
}).refine(s => s.minimum_participants <= s.capacity, 'minimum exceeds capacity')
  .refine(s => Date.parse(s.starts_at) < Date.parse(s.ends_at), 'invalid time interval');
export const activityDraftSchema = z.object({ name: z.string().min(1), main_segment_ref: z.string(), segments: z.array(segmentDraftSchema).min(1) })
  .refine(a => new Set(a.segments.map(s => s.client_ref)).size === a.segments.length, 'duplicate segment reference')
  .refine(a => a.segments.some(s => s.client_ref === a.main_segment_ref), 'main segment missing');
export const applicationDraftSchema = z.object({
  target_segment_ids: z.array(z.uuid()).min(1), accepted_versions: z.record(z.string(), z.number().int().positive())
}).refine(a => new Set(a.target_segment_ids).size === a.target_segment_ids.length && a.target_segment_ids.every(id => a.accepted_versions[id] !== undefined), 'invalid selected segment versions');
export const segmentCountsSchema = z.object({ occupied_count: z.number().int().nonnegative(), accepted_count: z.number().int().nonnegative(), pending_acceptance_count: z.number().int().nonnegative() });
/** @deprecated WG-01 placeholder. Use aiCreationDraftSchema and server validation. */
export const aiDraftSchema = z.object({
  segments: z.array(z.object({ client_ref: z.string(), type: segmentTypeSchema, name: z.string(), fields: z.record(z.string(), z.unknown()), missing_fields: z.array(z.string()) })),
  main_segment_ref: z.string().nullable(), ambiguities: z.array(z.string())
});
export type AiDraft = z.infer<typeof aiDraftSchema>;
export * from './activities';
export * from './venues';
export * from './ai';
export * from './ai-creation';
export * from './limits';
export * from './cloud-http';

export * from './requirements';

export * from "./requirements-api";

export * from './city';

export * from './avatar';
export * from './participation-actions';
export * from './account-activities';

export * from './formation';

export * from './arrangement';

export * from './coordination-source';

export * from './handover';

export * from './rebook';

export * from './todos';

export * from './main-segment';

export * from './roster';

export * from './capacity';

export * from './deadline';

export * from './booking';

export * from './navigation';

export * from './gatherings';
export * from './gathering-avatars';
export * from './gathering-reference';
export * from './gathering-rules';
export * from './arrangement-edit';

export * from './inspiration';
export * from './inspiration-seed';

export * from './gathering-workflow';

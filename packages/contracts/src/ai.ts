import { z } from 'zod';

// Standalone module: deliberately not re-exported by index.ts yet.
const id = z.string().min(1).max(200);
const revision = z.number().int().positive();
const timestamp = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();
export const aiLocationSchema = z.object({ id, label: z.string().min(1).max(500) }).strict();
export const aiTimeLocationSchema = z.object({ starts_at: timestamp, ends_at: timestamp, location: aiLocationSchema }).strict();
const unknownSchema = z.object({
  code: z.enum(['transfer_unknown', 'availability_unknown', 'missing_information']),
  segment_id: id.nullable(), detail: z.string().min(1).max(2000)
}).strict();
export const aiSegmentSnapshotSchema = z.object({
  id, revision, status: z.enum(['planned', 'started', 'cancelled']),
  starts_at: timestamp, ends_at: timestamp, deadline_at: timestamp,
  location: aiLocationSchema, locked: z.boolean(), location_locked: z.boolean(),
  minimum: z.number().int().positive(), capacity: z.number().int().positive(),
  occupied: count, accepted: count, pending_acceptance: count,
  member_ids: z.array(id), fee_minor: count.nullable(),
  verified: z.boolean(), booked: z.boolean()
}).strict().superRefine((s, ctx) => {
  if (Date.parse(s.starts_at) >= Date.parse(s.ends_at)) ctx.addIssue({ code: 'custom', message: 'invalid segment interval' });
  if (s.minimum > s.capacity || s.occupied > s.capacity) ctx.addIssue({ code: 'custom', message: 'invalid capacity' });
  if (s.accepted + s.pending_acceptance !== s.occupied) ctx.addIssue({ code: 'custom', message: 'inconsistent occupancy' });
  if (new Set(s.member_ids).size !== s.member_ids.length || s.member_ids.length !== s.occupied) ctx.addIssue({ code: 'custom', message: 'inconsistent members' });
});
export const aiSnapshotSchema = z.object({
  activity_id: id, revision, now: timestamp, manager_id: id,
  status: z.enum(['active', 'cancelled']), primary_segment_id: id, primary_formed: z.boolean(),
  segments: z.array(aiSegmentSnapshotSchema).min(1),
  transfers: z.array(z.object({ from: id, to: id, minutes: count.nullable() }).strict()),
  time_constraints: z.array(z.object({
    segment_id: id, fixed_start: timestamp.nullable(), fixed_end: timestamp.nullable(),
    earliest_start: timestamp.nullable(), latest_end: timestamp.nullable(),
    minimum_duration_minutes: z.number().positive().nullable()
  }).strict())
}).strict().superRefine((s, ctx) => {
  const ids = s.segments.map(x => x.id);
  if (new Set(ids).size !== ids.length || !ids.includes(s.primary_segment_id)) ctx.addIssue({ code: 'custom', message: 'invalid segment identities' });
  const active = s.segments.filter(x => x.status !== 'cancelled');
  if (!active.some(x => x.id === s.primary_segment_id)) ctx.addIssue({ code: 'custom', message: 'cancelled primary' });
  const primary = active.find(x => x.id === s.primary_segment_id);
  if (s.primary_formed && primary && (primary.occupied < primary.minimum || primary.accepted !== primary.occupied || !primary.verified)) ctx.addIssue({ code: 'custom', message: 'inconsistent formation' });
  const edges = new Set<string>();
  for (const t of s.transfers) {
    const key = `${t.from}\u0000${t.to}`;
    if (!ids.includes(t.from) || !ids.includes(t.to) || t.from === t.to || edges.has(key)) ctx.addIssue({ code: 'custom', message: 'invalid transfer' });
    edges.add(key);
  }
  if (new Set(s.time_constraints.map(x => x.segment_id)).size !== s.time_constraints.length || s.time_constraints.some(x => !ids.includes(x.segment_id))) ctx.addIssue({ code: 'custom', message: 'invalid time constraints' });
});
const bound = {
  activity_id: id, base_revision: revision,
  segment_versions: z.record(id, revision), apply_intent: z.literal(false)
};
export const aiCoordinationProposalSchema = z.object({
  ...bound, status: z.enum(['proposed', 'needs_info', 'no_solution']),
  feasibility: z.enum(['feasible', 'unknown', 'not_feasible']),
  changes: z.array(z.object({
    segment_id: id, segment_revision: revision,
    before: aiTimeLocationSchema, after: aiTimeLocationSchema
  }).strict()),
  affected_member_ids: z.array(id), unknowns: z.array(unknownSchema),
  explanation: z.string().min(1).max(6000)
}).strict();

// Null means missing, never a publishable default; no open-ended fields bag.
export const aiCreationDraftSchema = z.object({
  source_revision: revision, apply_intent: z.literal(false), publishable: z.literal(false),
  name: z.string().min(1).nullable(), primary_segment_ref: id.nullable(),
  segments: z.array(z.object({
    ref: id, type: z.enum(['sport', 'dinner', 'karaoke', 'drinks', 'board_game', 'custom']),
    name: z.string().min(1).nullable(), starts_at: timestamp.nullable(), ends_at: timestamp.nullable(),
    deadline_at: timestamp.nullable(), location: aiLocationSchema.nullable(),
    minimum: z.number().int().positive().nullable(), capacity: z.number().int().positive().nullable(),
    fee_minor: count.nullable()
  }).strict()).min(1),
  missing_fields: z.array(z.string().min(1)), unknowns: z.array(unknownSchema)
}).strict();

export const aiInvitationSchema = z.object({
  ...bound,
  // Facts only. Final prose/URLs must be rendered from this validated data by a trusted formatter.
  facts: z.array(z.object({
    segment_id: id, segment_revision: revision, starts_at: timestamp, ends_at: timestamp,
    location: aiLocationSchema, occupied: count, free_seats: count, minimum_gap: count,
    fee_minor: count.nullable(), deadline_at: timestamp, open: z.boolean(),
    formed: z.boolean(), verified: z.boolean(), booked: z.boolean()
  }).strict()),
  unknowns: z.array(unknownSchema)
}).strict();
export type AiSnapshot = z.infer<typeof aiSnapshotSchema>;
export type AiCoordinationProposal = z.infer<typeof aiCoordinationProposalSchema>;
export type AiCreationDraft = z.infer<typeof aiCreationDraftSchema>;
export type AiInvitation = z.infer<typeof aiInvitationSchema>;

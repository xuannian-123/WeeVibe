import { z } from 'zod';
import { activityIdSchema } from './activities';
export const createInvitationSourceSchema = z.object({ action: z.literal('create') }).strict();
export const saveInvitationSchema = z.object({ action: z.literal('save'), activity_id: activityIdSchema }).strict();
/** invitation_id identifies public provenance only. It is never a session or an access credential. */
export const invitationSourceSchema = z.object({
  invitation_id: activityIdSchema, activity_id: activityIdSchema, title: z.string(),
  inviter_display_name: z.string().nullable(), inviter_avatar_url: z.string().nullable(),
  starts_at: z.iso.datetime().nullable(), ends_at: z.iso.datetime().nullable(),
  timezone: z.string(), cancelled: z.boolean(), source_only: z.literal(true)
}).strict();
export const savedInvitationSchema = z.object({ invitation: invitationSourceSchema, saved: z.literal(true), saved_at: z.iso.datetime() }).strict();
export type InvitationSourceView = z.infer<typeof invitationSourceSchema>;

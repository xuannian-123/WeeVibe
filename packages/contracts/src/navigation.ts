import { z } from 'zod';

export const profileImageSchema = z.object({ base64: z.string().max(56000).regex(/^[A-Za-z0-9+/]*={0,2}$/), content_type: z.literal('image/jpeg'), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const profileVisibilitySchema = z.object({ bio: z.boolean().default(false), interests: z.boolean().default(false), mbti: z.boolean().default(false), zodiac: z.boolean().default(false) }).strict();
export const profilePresentationSchema = z.object({
  bio: z.string().trim().max(140).default(''),
  interests: z.array(z.string().trim().min(1).max(12)).max(6).refine(a => new Set(a).size === a.length).default([]),
  cover_style: z.enum(['peach', 'mint', 'lilac', 'custom']).default('mint'),
  cover_image: profileImageSchema.nullable().default(null),
  visibility: profileVisibilitySchema.default({ bio: false, interests: false, mbti: false, zodiac: false }),
});
export const memberProfileSchema = z.object({
  user_id: z.uuid(), nickname: z.string().max(32),
  avatar: profileImageSchema.nullable(), cover_style: z.enum(['peach', 'mint', 'lilac', 'custom']), cover_image: profileImageSchema.nullable(),
  bio: z.string().max(140).optional(), interests: z.array(z.string().max(12)).max(6).optional(), mbti: z.string().max(4).optional(), zodiac: z.string().max(8).optional(),
}).strict();
export type MemberProfile = z.infer<typeof memberProfileSchema>;
export const memberDirectorySchema = z.object({ members: z.array(z.object({ user_id: z.uuid(), display_name: z.string().max(40).nullable() }).strict()).max(2000).refine(a => new Set(a.map(m => m.user_id)).size === a.length) }).strict();

export const inboxMessageSchema = z.object({
  id: z.string().min(1).max(180), activity_id: z.uuid().nullable(), requirement_id: z.uuid().optional(), gathering_id:z.uuid().optional(),
  title: z.string().max(200), summary: z.string().max(300), created_at: z.iso.datetime({ offset: true }),
  read: z.boolean(), pending: z.boolean(), status: z.string().max(30),
  section: z.enum(['applications', 'arrangement', 'handover', 'activity', 'requirement','gathering']),
}).strict().superRefine((value,ctx)=>{
  if(value.section==='gathering'?(!value.gathering_id||value.activity_id!==null||value.requirement_id!==undefined):value.gathering_id!==undefined)ctx.addIssue({code:'custom',message:'筹备消息来源不一致'});
});
export const inboxSchema = z.object({ messages: z.array(inboxMessageSchema).max(100), unread_count: z.number().int().min(0), pending_count: z.number().int().min(0), server_time: z.iso.datetime({ offset: true }), limit: z.literal(100) }).superRefine((v, ctx) => {
  if (new Set(v.messages.map(m => m.id)).size !== v.messages.length || v.unread_count !== v.messages.filter(m => !m.read).length || v.pending_count !== v.messages.filter(m => m.pending).length) ctx.addIssue({ code: 'custom', message: '消息数量与当前列表不一致' });
});
export type InboxMessage = z.infer<typeof inboxMessageSchema>;
export type InboxSnapshot = z.infer<typeof inboxSchema>;

import { z } from 'zod';
import { accountActivityRecordSchema, venueSchema } from '@weevibe/contracts';
import { invitationSourceSchema } from '@weevibe/contracts/src/invitations';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from './api';
import { extensionRequest } from './extension-api';

// Read boundary only: permit omitted optional profile values and older additive fields.
// Avatar paths are produced by the separate verified avatar adapter, never trusted here.
const profile = z.object({
  nickname: z.string().max(32).optional(), birthday: z.string().max(10).optional(),
  gender: z.string().max(8).optional(), zodiac: z.string().max(8).optional(),
  mbti: z.string().max(4).optional(), signature: z.string().max(100).optional(),
  introduction: z.string().max(500).optional(),
});
const time = z.iso.datetime({ offset: true });
const activity = z.object({
  activity_id: z.uuid(), title: z.string(), starts_at: time.nullable(), ends_at: time.nullable(),
  timezone: z.string(), status: z.string(), location: z.string(), awaiting_acceptance: z.boolean().optional(),
});
const accountSchema = z.object({
  profile, favorites: z.array(venueSchema), activities: z.array(activity),
  activity_records: z.array(accountActivityRecordSchema.strip()).optional(),
  invitations: z.array(invitationSourceSchema.strip().extend({ saved_at: time, status: z.string(), location: z.string() })),
  messages: z.array(z.object({ id: z.string(), activity_id: z.uuid().nullable(), requirement_id: z.uuid().optional(), title: z.string(), created_at: time, read: z.boolean() })),
  capabilities: z.object({ invitations: z.boolean(), avatar_upload: z.boolean() }).optional(),
  limit: z.number().int().positive().optional(), server_time: time.optional(),
});
export type AccountProfile = z.infer<typeof profile> & { avatar_url?: string };
export type AccountSnapshot = Omit<z.infer<typeof accountSchema>, 'profile'> & { profile: AccountProfile };

/** Bind every account operation to the session that owns the displayed inputs/state. */
export async function requestAccount(expectedSession: string | undefined, method: 'GET' | 'PATCH' = 'GET', body?: unknown): Promise<AccountSnapshot> {
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新打开；未向新账号重放原操作。', 401);
  };
  assertSession();
  const value = await extensionRequest<unknown>('/api/v1/account', method, body);
  assertSession();
  const parsed = accountSchema.safeParse(value);
  if (!parsed.success) throw new ApiClientError('INVALID_RESPONSE', '账户服务响应与当前版本不匹配，结果未确认。请保留输入并核对服务器状态；不会显示保存成功。', 200);
  return parsed.data;
}

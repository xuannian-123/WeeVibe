import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, apiErrorSchema } from '@weevibe/contracts';
import { invitationSourceSchema, savedInvitationSchema } from '@weevibe/contracts/src/invitations';
import { api, getToken, transport } from '../../platform/api';
function invalid(): never { throw new ApiClientError('INVALID_RESPONSE', '邀请响应与原操作目标不一致，结果未确认，请刷新核对。', 200); }
async function request(path: string, body?: unknown, expectedActorId?: string, expectedSession?: string, assertCanSend: () => void = () => {}) {
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人活动，不会向新账号重放原操作。', 401);
  };
  if (body !== undefined) {
    assertSession(); assertCanSend();
    const actor = await api.me();
    assertSession();
    if (!expectedActorId || activityIdSchema.parse(actor.user_id) !== activityIdSchema.parse(expectedActorId)) throw new ApiClientError('UNAUTHENTICATED', '当前身份与活动页面不一致，请重新读取。', 401);
    // No await between lifecycle/session preflight and the actual mutation transport.
    assertCanSend(); assertSession();
  }
  const response = await transport({ path, method: body === undefined ? 'GET' : 'POST', body, headers: { 'Content-Type': 'application/json', ...(body !== undefined ? { Authorization: `Bearer ${expectedSession}` } : {}) } });
  if (body !== undefined) assertSession();
  if (response.status < 200 || response.status >= 300) {
    const parsed = apiErrorSchema.safeParse(response.body);
    throw new ApiClientError(parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE', parsed.success ? parsed.data.error.message : '邀请响应无法识别', response.status);
  }
  return response.body;
}
export async function readInvitationSource(id: string) {
  const target = activityIdSchema.parse(id);
  const parsed = invitationSourceSchema.safeParse(await request(`/api/v1/invitations/${target}`));
  if (!parsed.success || parsed.data.invitation_id !== target) invalid();
  return parsed.data;
}
export async function createInvitationSource(activityId: string, expectedActorId: string, expectedSession: string | undefined, assertCanSend: () => void = () => {}) {
  const target = activityIdSchema.parse(activityId);
  const parsed = invitationSourceSchema.safeParse(await request(`/api/v1/activities/${target}/invitations`, { action: 'create' }, expectedActorId, expectedSession, assertCanSend));
  if (!parsed.success || parsed.data.activity_id !== target) invalid();
  return parsed.data;
}
export async function saveInvitationSource(invitationId: string, activityId: string, expectedActorId: string, expectedSession: string | undefined, assertCanSend: () => void = () => {}) {
  const target = activityIdSchema.parse(invitationId), activity = activityIdSchema.parse(activityId);
  const parsed = savedInvitationSchema.safeParse(await request(`/api/v1/invitations/${target}`, { action: 'save', activity_id: activity }, expectedActorId, expectedSession, assertCanSend));
  if (!parsed.success || parsed.data.invitation.invitation_id !== target || parsed.data.invitation.activity_id !== activity) invalid();
  return parsed.data;
}

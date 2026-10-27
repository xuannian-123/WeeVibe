import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, type CreateActivityInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';
export type CreationIdentity = { user_id: string; session: string };
function boundClient(session: string | undefined, assertCanSend: () => void = () => {}, beforeCreateSend?: () => void) {
  const assertSession = () => {
    if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新确认本人身份；原安排不会提交给新账号。', 401);
  };
  const boundTransport: Transport = async request => {
    // Final synchronous preflight; never reread a different bearer after /me.
    assertCanSend(); assertSession();
    // Optional caller-specific first-dispatch checks run only before create POST,
    // never after a response or on the identity GET. Ordinary creation omits it.
    if (request.method === 'POST' && request.path === '/api/v1/activities') beforeCreateSend?.();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertSession();
    return response;
  };
  return { client: createApiClient(boundTransport, () => session), assertSession };
}
export async function readCreationIdentity(): Promise<CreationIdentity> {
  const session = getToken();
  try {
    const { client, assertSession } = boundClient(session);
    const actor = await client.me(); assertSession();
    return { user_id: activityIdSchema.parse(actor.user_id), session: session! };
  } catch (error) {
    // A stale identity read must not make the generic read hook log out a newer session.
    if (getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '读取期间账号已变化，请重新核对身份。', 0);
    throw error;
  }
}
export async function createActivityForIdentity(input: CreateActivityInput, identity: CreationIdentity | undefined, assertCanSend: () => void, beforeCreateSend?: () => void) {
  if (!identity) throw new ApiClientError('UNAUTHENTICATED', '请先确认本人的登录身份', 401);
  const actorId = activityIdSchema.parse(identity.user_id);
  const { client, assertSession } = boundClient(identity.session, assertCanSend, beforeCreateSend);
  const actor = await client.me(); assertSession();
  if (activityIdSchema.parse(actor.user_id) !== actorId) throw new ApiClientError('UNAUTHENTICATED', '当前身份与草稿所属账号不一致，请重新读取。', 401);
  const result = await client.createActivity(input); assertSession(); assertCanSend();
  // New activity IDs are server-assigned; replay may return a later activity revision.
  // The public DTO has no immutable creator ID, so bind the verified viewer, not a guessed ID or mutable role.
  if (result.viewer.user_id !== actorId) throw new ApiClientError('INVALID_RESPONSE', '创建响应与原账号不一致，结果未确认，请保留原请求并核对。', 200);
  return result;
}

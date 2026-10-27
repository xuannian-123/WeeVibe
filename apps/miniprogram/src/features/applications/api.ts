import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, type ActivityDetail, type ApplyToActivityInput, type DecideApplicationInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** The displayed snapshot supplies provenance; this is not authority to bypass server permissions. */
async function executeBound(activityId: string, expectedActorId: string, expectedSession: string | undefined, run: (client: ReturnType<typeof createApiClient>) => Promise<ActivityDetail>, assertCanSend: () => void = () => {}) {
  const id = activityIdSchema.parse(activityId);
  const actorId = activityIdSchema.parse(expectedActorId);
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人活动；原请求不会提交给其他账号。', 401);
  };
  assertSession(); assertCanSend();
  const boundTransport: Transport = async request => {
    // No await between the final preflight and transport invocation. Never rebuild
    // Authorization from a newer token after identity verification has awaited.
    assertSession(); if (request.method === 'POST') assertCanSend();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${expectedSession}` } });
    assertSession();
    return response;
  };
  const client = createApiClient(boundTransport, () => expectedSession);
  const actor = await client.me();
  assertSession();
  if (activityIdSchema.parse(actor.user_id) !== actorId) throw new ApiClientError('UNAUTHENTICATED', '当前身份与页面中的活动身份不一致，请重新读取。', 401);
  const result = await run(client);
  assertSession(); assertCanSend();
  if (result.activity_id !== id || result.viewer.user_id !== actorId) throw new ApiClientError('INVALID_RESPONSE', '活动响应与原操作目标不一致，结果未确认；请保留原请求并刷新核对。', 200);
  return result;
}
export async function applyForActor(id: string, input: ApplyToActivityInput, actorId: string, session: string | undefined, assertCanSend: () => void = () => {}) {
  try { return await executeBound(id, actorId, session, client => client.applyToActivity(id, input), assertCanSend); }
  catch (error) {
    // An older writer may reject this field before consulting an already committed key.
    // Never silently strip source provenance or discard the original unknown request.
    if (input.invitation_source_id && error instanceof ApiClientError &&
      ((error.status === 400 && error.code === 'INVALID_INPUT') || error.status === 404 || error.status === 405))
      throw new ApiClientError('INVALID_RESPONSE', '邀请归因接口版本尚未确认，请保留原申请并核对匹配后端。', error.status);
    throw error;
  }
}
export function decideForActor(id: string, applicationId: string, input: DecideApplicationInput, actorId: string, session: string | undefined) {
  return executeBound(id, actorId, session, client => client.decideApplication(id, applicationId, input));
}

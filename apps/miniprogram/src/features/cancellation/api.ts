import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, cancelActivityInputSchema, type CancelActivityInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** Source identity only; the server always rechecks the CURRENT manager. */
export async function cancelForActor(activityId: string, raw: CancelActivityInput, actorId: string,
  expectedSession: string | undefined, assertCanSend: () => void) {
  const id = activityIdSchema.parse(activityId), actor = activityIdSchema.parse(actorId), input = cancelActivityInputSchema.parse(raw);
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人管理的活动；原取消请求不会提交给新账号。', 401);
  };
  const boundTransport: Transport = async request => {
    // The checks and dispatch remain synchronous, including after awaiting /me.
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${expectedSession}` } });
    assertSession();
    return response;
  };
  const client = createApiClient(boundTransport, () => expectedSession);
  const identity = await client.me(); assertSession();
  if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '当前身份与管理页面来源不一致，请重新读取。', 401);
  let value: unknown;
  try { value = await client.cancelActivity(id, input); }
  catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '取消结果无法确认，请保留原请求并刷新核对。', 200);
  }
  assertCanSend(); assertSession();
  const parsed = activityDetailSchema.safeParse(value);
  if (!parsed.success || parsed.data.activity_id !== id || parsed.data.viewer.user_id !== actor || !parsed.data.viewer.is_manager
    || !parsed.data.cancelled_at || parsed.data.revision <= input.expected_revision)
    throw new ApiClientError('INVALID_RESPONSE', '响应与原活动、管理身份或取消状态不一致，结果未确认，请保留原请求并刷新。', 200);
  return parsed.data;
}
export function cancellationErrorMessage(error: unknown) {
  return error instanceof ApiClientError && error.code === 'CANCELLATION_RULE_UNCONFIRMED'
    ? '已有环节开始，或活动状态无法完整核对；这些情况的新取消规则待确认，本片暂未启用，不会以未知结果当作已取消。'
    : undefined;
}

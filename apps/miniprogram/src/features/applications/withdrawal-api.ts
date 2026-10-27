import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, withdrawApplicationInputSchema, type WithdrawApplicationInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** actorId/session describe the displayed source, never backend authorization. */
export async function withdrawForActor(activityId: string, applicationId: string, raw: WithdrawApplicationInput,
  actorId: string, expectedSession: string | undefined, assertCanSend: () => void) {
  const id = activityIdSchema.parse(activityId), target = activityIdSchema.parse(applicationId), actor = activityIdSchema.parse(actorId);
  const input = withdrawApplicationInputSchema.parse(raw);
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人的申请；原请求不会提交给新账号。', 401);
  };
  const boundTransport: Transport = async request => {
    // No await may separate these final lifecycle/session checks and dispatch.
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${expectedSession}` } });
    assertSession();
    return response;
  };
  const client = createApiClient(boundTransport, () => expectedSession);
  const identity = await client.me(); assertSession();
  if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '当前身份与申请来源不一致，请重新读取。', 401);
  let value: unknown;
  try { value = await client.withdrawApplication(id, target, input); }
  catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '撤回结果无法确认，请保留原请求并刷新核对。', 200);
  }
  assertCanSend(); assertSession();
  const parsed = activityDetailSchema.safeParse(value);
  const own = parsed.success ? parsed.data.viewer.applications.find(application => application.application_id === target) : undefined;
  if (!parsed.success || parsed.data.activity_id !== id || parsed.data.viewer.user_id !== actor
    || parsed.data.viewer.applications.some(application => application.applicant_user_id !== actor)
    || !own || own.applicant_user_id !== actor || own.status !== 'withdrawn' || parsed.data.revision <= input.expected_revision)
    throw new ApiClientError('INVALID_RESPONSE', '响应与本人原申请或撤回状态不一致，结果未确认，请保留原请求并刷新。', 200);
  return parsed.data;
}

export function withdrawalErrorMessage(error: unknown) {
  return error instanceof ApiClientError && error.code === 'WITHDRAWAL_RULE_UNCONFIRMED'
    ? '此阶段的新撤回规则待确认，或申请状态无法完整核对；本片暂未启用此操作。已有席位不会因此退出。'
    : undefined;
}

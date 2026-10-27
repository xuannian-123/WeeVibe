import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, apiErrorSchema, formationCommandSchema, type FormationCommand } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** Actor is display provenance only; the backend still verifies current management. */
export async function submitFormation(activityId: string, raw: FormationCommand, actorId: string, expectedSession: string | undefined, assertCanSend: () => void) {
  const id = activityIdSchema.parse(activityId), actor = activityIdSchema.parse(actorId);
  const input = formationCommandSchema.parse(raw);
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人管理的活动；原请求不会提交给新账号。', 401);
  };
  const boundTransport: Transport = async request => {
    // The lifecycle/session guard and dispatch are synchronous, including after /me.
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${expectedSession}` } });
    assertSession();
    return response;
  };
  const client = createApiClient(boundTransport, () => expectedSession);
  const identity = await client.me(); assertSession();
  if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '当前身份与活动页面不一致，请重新读取。', 401);
  const response = await boundTransport({ method: 'POST', path: `/api/v1/activities/${id}/formation`, headers: { 'Content-Type': 'application/json' }, body: input });
  assertCanSend(); assertSession();
  if (response.status < 200 || response.status >= 300) {
    const parsed = apiErrorSchema.safeParse(response.body);
    throw new ApiClientError(parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE', parsed.success ? parsed.data.error.message : '成局操作结果无法确认，请保留原请求并核对。', response.status);
  }
  const parsed = activityDetailSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.activity_id !== id || parsed.data.viewer.user_id !== actor) throw new ApiClientError('INVALID_RESPONSE', '成局响应与原活动或身份不一致，结果未确认，请保留原请求并刷新。', 200);
  // A replay can return a changed current main/role/status. Do not reapply the original command.
  return parsed.data;
}

export function formationErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === 'FORMATION_NOT_READY') return '当前主环节尚不满足成局条件：请核对最低人数、全部占位成员的现版接受及人工核实状态。';
  if (error.code === 'FORMATION_RULE_UNCONFIRMED') return '主环节已开始；开始后的线上核实／确认规则待确认，本片暂未启用，不会新增成局确认。';
  return undefined;
}

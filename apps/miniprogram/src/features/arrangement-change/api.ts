import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, apiErrorSchema, arrangementReviewSchema, reacceptArrangementCommandSchema, type ReacceptArrangementCommand } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

async function actorTransport(actorId: string, expectedSession: string | undefined, assertCanSend: () => void) {
  const actor = activityIdSchema.parse(actorId);
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人安排；不会把原请求提交给新账号。', 401);
  };
  const bound: Transport = async request => {
    // Final synchronous preflight also runs after the identity lookup, immediately before dispatch.
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${expectedSession}` } });
    assertCanSend(); assertSession();
    return response;
  };
  const identity = await createApiClient(bound, () => expectedSession).me();
  assertCanSend(); assertSession();
  if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '本人安排与当前登录身份不一致，请重新读取。', 401);
  return { actor, bound };
}
function responseError(status: number, body: unknown) {
  const parsed = apiErrorSchema.safeParse(body);
  return new ApiClientError(parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE', parsed.success ? parsed.data.error.message : '安排接口响应无法确认，请刷新核对并保留原请求。', status);
}
export async function readArrangement(activityId: string, segmentId: string, actorId: string, expectedSession: string | undefined, assertCanSend: () => void) {
  const id = activityIdSchema.parse(activityId), segment = activityIdSchema.parse(segmentId);
  const { actor, bound } = await actorTransport(actorId, expectedSession, assertCanSend);
  const response = await bound({ method: 'GET', path: `/api/v1/activities/${id}/arrangements/${segment}`, headers: {} });
  if (response.status < 200 || response.status >= 300) throw responseError(response.status, response.body);
  const parsed = arrangementReviewSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.activity_id !== id || parsed.data.segment_id !== segment || parsed.data.viewer_user_id !== actor)
    throw new ApiClientError('INVALID_RESPONSE', '安排差异与本人活动或环节不一致，不能据此接受。', 200);
  return parsed.data;
}
export async function reacceptArrangement(activityId: string, segmentId: string, raw: ReacceptArrangementCommand, actorId: string, expectedSession: string | undefined, assertCanSend: () => void) {
  const id = activityIdSchema.parse(activityId), segment = activityIdSchema.parse(segmentId), input = reacceptArrangementCommandSchema.parse(raw);
  const { actor, bound } = await actorTransport(actorId, expectedSession, assertCanSend);
  const response = await bound({ method: 'POST', path: `/api/v1/activities/${id}/arrangements/${segment}`, headers: { 'Content-Type': 'application/json' }, body: input });
  if (response.status < 200 || response.status >= 300) throw responseError(response.status, response.body);
  const parsed = activityDetailSchema.safeParse(response.body);
  if (!parsed.success || parsed.data.activity_id !== id || parsed.data.viewer.user_id !== actor || !parsed.data.segments.some(item => item.segment_id === segment))
    throw new ApiClientError('INVALID_RESPONSE', '接受结果与本人活动或环节不一致，请保留原请求并刷新核对。', 200);
  // An already committed key returns the CURRENT snapshot, not necessarily an accepted current version.
  return parsed.data;
}
export function arrangementErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === 'ARRANGEMENT_HISTORY_UNAVAILABLE') return '缺少连续、可信的安排版本记录，暂不能核验或重新接受；不会根据当前安排猜测旧版本。';
  if (error.code === 'ARRANGEMENT_ACCEPTANCE_CLOSED') return '活动或环节已取消，或该环节已开始，不能新增重新接受。请刷新核对当前状态。';
  return undefined;
}

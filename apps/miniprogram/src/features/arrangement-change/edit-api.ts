import { createApiClient, ApiClientError, type Transport } from '@weevibe/api-client';
import { activityIdSchema, activityDetailSchema, apiErrorSchema, arrangementEditPreviewSchema, editArrangementInputSchema, type EditArrangementInput } from '@weevibe/contracts';
import { transport, getToken } from '../../platform/api';
export async function requestArrangementEdit(id: string, actor: string, session: string | undefined, raw: EditArrangementInput, preview: boolean, guard: () => void) {
  activityIdSchema.parse(id); activityIdSchema.parse(actor); const input = editArrangementInputSchema.parse(raw);
  const bound: Transport = async request => {
    guard(); if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取活动', 401);
    const result = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    guard(); if (getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '账号已变化，原操作结果请返回原活动核对', 0);
    return result;
  };
  const identity = await createApiClient(bound, () => session).me();
  if (identity.user_id !== actor) throw new ApiClientError('UNAUTHENTICATED', '管理身份与页面不一致', 401);
  const result = await bound({ method: 'POST', path: `/api/v1/activities/${id}/arrangement-edit${preview ? '?preview=1' : ''}`, body: input, headers: { 'Content-Type': 'application/json' } });
  if (result.status < 200 || result.status >= 300) {
    const error = apiErrorSchema.safeParse(result.body);
    throw new ApiClientError(error.success ? error.data.error.code : 'INVALID_RESPONSE', error.success ? error.data.error.message : '无法确认安排修改结果', result.status);
  }
  const parsed = preview ? arrangementEditPreviewSchema.parse(result.body) : activityDetailSchema.parse(result.body);
  if (parsed.activity_id !== id || ('viewer_user_id' in parsed ? parsed.viewer_user_id : parsed.viewer.user_id) !== actor)
    throw new ApiClientError('INVALID_RESPONSE', '响应与本人活动不一致', 200);
  return parsed;
}

export async function requestSegmentVerification(id: string, actor: string, session: string | undefined, raw: import('@weevibe/contracts').VerifySegmentInput, guard: () => void) {
  const { verifySegmentInputSchema } = await import('@weevibe/contracts');
  const input = verifySegmentInputSchema.parse(raw); activityIdSchema.parse(id); activityIdSchema.parse(actor);
  const bound: Transport = async request => {
    guard(); if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化', 401);
    const result = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    guard(); if (getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '账号已变化，核实结果未确认', 0);
    return result;
  };
  if ((await createApiClient(bound, () => session).me()).user_id !== actor) throw new ApiClientError('UNAUTHENTICATED', '本人管理身份不一致', 401);
  const response = await bound({ method: 'POST', path: `/api/v1/activities/${id}/segments/${input.segment_id}/verification`, body: input, headers: { 'Content-Type': 'application/json' } });
  if (response.status < 200 || response.status >= 300) { const error = apiErrorSchema.safeParse(response.body); throw new ApiClientError(error.success ? error.data.error.code : 'INVALID_RESPONSE', error.success ? error.data.error.message : '无法核对核实结果', response.status); }
  const detail = activityDetailSchema.parse(response.body);
  if (detail.activity_id !== id || detail.viewer.user_id !== actor) throw new ApiClientError('INVALID_RESPONSE', '核实响应与本人活动不一致', 200);
  return detail;
}

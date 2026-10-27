import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, extendDeadlineInputSchema, type ExtendDeadlineInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** Preserve one actor, segment and command through identity verification and final dispatch. */
export async function extendDeadlineForActor(activityId: string, segmentId: string, raw: ExtendDeadlineInput, actorId: string,
  session: string | undefined, assertCanSend: () => void, beforeFirstPost?: () => void) {
  const id = activityIdSchema.parse(activityId), segment = activityIdSchema.parse(segmentId), actor = activityIdSchema.parse(actorId), input = extendDeadlineInputSchema.parse(raw);
  const assertSession = () => { if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，原延期请求不会提交给其他账号。', 401); };
  const bound: Transport = async request => {
    assertCanSend(); assertSession();
    if (request.method === 'POST') beforeFirstPost?.();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertSession(); return response;
  };
  try {
    const client = createApiClient(bound, () => session), identity = await client.me(); assertSession();
    if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '管理页面与当前身份来源不同，请重新读取。', 401);
    const result = activityDetailSchema.parse(await client.extendDeadline(id, segment, input)); assertSession(); assertCanSend();
    const target = result.segments.find(s => s.segment_id === segment), main = result.segments.find(s => s.segment_id === result.main_segment_id);
    if (result.activity_id !== id || result.viewer.user_id !== actor || !result.viewer.is_manager || result.revision <= input.expected_revision
      || new Set(result.segments.map(s => s.segment_id)).size !== result.segments.length || !target || !main
      || (!result.cancelled_at && main.cancelled_at !== null)
      || (result.revision === input.expected_revision + 1 && (Date.parse(target.deadline_at) !== Date.parse(input.deadline_at) || target.cancelled_at !== null || result.cancelled_at !== null)))
      throw new ApiClientError('INVALID_RESPONSE', '响应无法匹配原活动、目标环节、管理身份和有效版本，结果尚未确认。', 200);
    // Success-key replay returns CURRENT facts, possibly after a later extension or cancellation.
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '报名截止响应无法验证，请保留原请求并刷新核对。', 200);
  }
}
export function deadlineError(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === 'DEADLINE_EXTENSION_CLOSED') return '本段已开始，本片的开始后延期尚未启用；尚未开始的其他环节仍按各自截止判断。';
  if (error.code === 'DEADLINE_OUT_OF_RANGE') return '新截止须晚于服务端当前时间，且不得晚于该段原开始时间；请重新核对。';
  if (error.code === 'DEADLINE_SCOPE_UNAVAILABLE') return '当前环节来源或时间无法完整核对，暂不能延期；请刷新查看。';
  return undefined;
}

import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, changeMainSegmentInputSchema, type ChangeMainSegmentInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

export async function changeMainForActor(activityId: string, raw: ChangeMainSegmentInput, actorId: string, session: string | undefined, assertCanSend: () => void, beforeFirstPost?: () => void) {
  const id = activityIdSchema.parse(activityId), actor = activityIdSchema.parse(actorId), input = changeMainSegmentInputSchema.parse(raw);
  const assertSession = () => { if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，原换主请求不会提交给其他账号。', 401); };
  const bound: Transport = async request => {
    assertCanSend(); assertSession();
    if (request.method === 'POST') beforeFirstPost?.();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertSession(); return response;
  };
  try {
    const client = createApiClient(bound, () => session), identity = await client.me(); assertSession();
    if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '管理页面与当前身份来源不同，请重新读取。', 401);
    const result = activityDetailSchema.parse(await client.changeMainSegment(id, input)); assertSession(); assertCanSend();
    const currentMain = result.segments.find(s => s.segment_id === result.main_segment_id);
    if (result.activity_id !== id || result.viewer.user_id !== actor || !result.viewer.is_manager || result.revision <= input.expected_revision
      || new Set(result.segments.map(s => s.segment_id)).size !== result.segments.length
      || !currentMain || (!result.cancelled_at && currentMain.cancelled_at !== null) || !result.segments.some(s => s.segment_id === input.target_segment_id)
      || (result.revision === input.expected_revision + 1 && (result.main_segment_id !== input.target_segment_id || result.formation_status !== 'not_confirmed' || result.cancelled_at !== null)))
      throw new ApiClientError('INVALID_RESPONSE', '响应无法匹配原活动、管理身份和有效版本，结果尚未确认。', 200);
    // A successful original key may now refer to a later main/formation state.
    // Do not require result.main_segment_id === input.target_segment_id.
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '换主响应无法验证，请保留原请求并刷新核对。', 200);
  }
}
export function mainSegmentError(error: unknown): string | undefined {
  if (error instanceof ApiClientError && error.code === 'MAIN_SEGMENT_SCOPE_UNAVAILABLE') return '原主环节或目标已开始、已取消或状态无法完整核对；这些范围的直接换主规则本片暂未启用，请刷新查看，不是代替产品规则作永久禁止。';
  return undefined;
}

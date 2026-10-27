import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, changeCapacityInputSchema, type ChangeCapacityInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** Binds both URL identifiers and the original command to the verified current actor. */
export async function changeCapacityForActor(activityId: string, segmentId: string, raw: ChangeCapacityInput, actorId: string, session: string | undefined, assertCanSend: () => void, beforeFirstPost?: () => void) {
  const id = activityIdSchema.parse(activityId), segment = activityIdSchema.parse(segmentId), actor = activityIdSchema.parse(actorId), input = changeCapacityInputSchema.parse(raw);
  const assertSession = () => { if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，原人数上限请求不会提交给其他账号。', 401); };
  const bound: Transport = async request => {
    assertCanSend(); assertSession();
    if (request.method === 'POST') beforeFirstPost?.();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertSession(); return response;
  };
  try {
    const client = createApiClient(bound, () => session), identity = await client.me(); assertSession();
    if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '管理页面与当前身份来源不同，请重新读取。', 401);
    const result = activityDetailSchema.parse(await client.changeCapacity(id, segment, input)); assertSession(); assertCanSend();
    const target = result.segments.find(s => s.segment_id === segment), main = result.segments.find(s => s.segment_id === result.main_segment_id);
    if (result.activity_id !== id || result.viewer.user_id !== actor || !result.viewer.is_manager || result.revision <= input.expected_revision
      || new Set(result.segments.map(s => s.segment_id)).size !== result.segments.length || !target || !main
      || (!result.cancelled_at && main.cancelled_at !== null)
      || (result.revision === input.expected_revision + 1 && (target.capacity !== input.capacity || target.cancelled_at !== null || result.cancelled_at !== null)))
      throw new ApiClientError('INVALID_RESPONSE', '响应无法匹配原活动、目标环节、管理身份和有效版本，结果尚未确认。', 200);
    // Processed keys return CURRENT facts; later capacity changes are not replayed backwards.
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '人数上限响应无法验证，请保留原请求并刷新核对。', 200);
  }
}
export function capacityError(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === 'CAPACITY_BELOW_OCCUPIED') return '新上限不能低于当前占用人数，待重新接受的保留席位也计入；不会通过降上限移除成员。';
  if (error.code === 'CAPACITY_BELOW_MINIMUM') return '新上限不能低于本段最低人数；此处不会修改最低人数。';
  if (error.code === 'CAPACITY_CHANGE_CLOSED') return '本段已开始或已取消，不能再线上修改人数上限；尚未开始的其他环节仍可单独调整。';
  if (error.code === 'CAPACITY_SCOPE_UNAVAILABLE') return '当前环节来源或人数状态无法完整核对，本次未修改；请刷新查看。';
  return undefined;
}

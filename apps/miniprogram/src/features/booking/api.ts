import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityDetailSchema, activityIdSchema, bookingHistorySchema, declareBookingInputSchema, type DeclareBookingInput } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

async function boundClient(actorId: string, session: string | undefined, assertCanSend: () => void, beforeFirstPost?: () => void) {
  const actor = activityIdSchema.parse(actorId);
  const assertSession = () => { if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，原人工预订声明与历史不会提交给其他账号。', 401); };
  const bound: Transport = async request => {
    assertCanSend(); assertSession();
    if (request.method === 'POST') beforeFirstPost?.();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertCanSend(); assertSession(); return response;
  };
  const client = createApiClient(bound, () => session), identity = await client.me(); assertSession(); assertCanSend();
  if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '管理页面与当前身份来源不同，请重新读取。', 401);
  return { actor, client, assertSession };
}
export async function declareBookingForActor(activityId: string, segmentId: string, raw: DeclareBookingInput, actorId: string,
  session: string | undefined, assertCanSend: () => void, beforeFirstPost?: () => void) {
  const id = activityIdSchema.parse(activityId), segment = activityIdSchema.parse(segmentId), input = declareBookingInputSchema.parse(raw);
  try {
    const { actor, client, assertSession } = await boundClient(actorId, session, assertCanSend, beforeFirstPost);
    const result = activityDetailSchema.parse(await client.declareBooking(id, segment, input)); assertSession(); assertCanSend();
    const target = result.segments.find(s => s.segment_id === segment), main = result.segments.find(s => s.segment_id === result.main_segment_id);
    if (result.activity_id !== id || result.viewer.user_id !== actor || !result.viewer.is_manager || result.revision <= input.expected_revision
      || new Set(result.segments.map(s => s.segment_id)).size !== result.segments.length || !target || !main
      || (!result.cancelled_at && main.cancelled_at !== null)
      || (result.revision === input.expected_revision + 1 && (target.booking_status !== 'manual_booked' || target.plan_revision !== input.expected_plan_revision || target.cancelled_at !== null || result.cancelled_at !== null)))
      throw new ApiClientError('INVALID_RESPONSE', '响应无法匹配原活动、目标环节、管理身份与人工声明版本，结果尚未确认。', 200);
    // Successful historical keys return CURRENT facts, not a replayed booking status.
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '人工预订声明响应无法验证，请保留原请求并刷新核对。', 200);
  }
}
export async function readBookingHistoryForActor(activityId: string, segmentId: string, actorId: string, session: string | undefined, assertCanSend: () => void) {
  const id = activityIdSchema.parse(activityId), segment = activityIdSchema.parse(segmentId);
  try {
    const { actor, client, assertSession } = await boundClient(actorId, session, assertCanSend);
    const result = bookingHistorySchema.parse(await client.readBookingHistory(id, segment)); assertSession(); assertCanSend();
    if (result.activity_id !== id || result.segment_id !== segment || result.viewer_user_id !== actor)
      throw new ApiClientError('INVALID_RESPONSE', '声明历史与当前管理身份或目标不一致，请重新读取。', 200);
    return result;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '声明历史无法核验，不会将未知记录显示为零历史。', 200);
  }
}
export function bookingError(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.code === 'BOOKING_DECLARATION_CLOSED') return '本段已开始，本片的开始后人工预订记录尚未启用；当前管理者仍可主动查看声明历史。';
  if (error.code === 'BOOKING_SCOPE_UNAVAILABLE') return '当前安排或人工声明来源无法完整核对，暂不能记录；请刷新后核对场馆与时段。';
  return undefined;
}

import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, apiErrorSchema } from '@weevibe/contracts';
import { participationActionSchema, participationActionResultSchema, type ParticipationAction } from '@weevibe/contracts/src/participation-actions';
import { api, getToken, transport } from '../../platform/api';
export async function submitParticipation(activityId: string, raw: ParticipationAction, expectedActorId: string, assertCanSend: () => void = () => {}) {
  const id = activityIdSchema.parse(activityId);
  const input = participationActionSchema.parse(raw);
  const expectedActor = activityIdSchema.parse(expectedActorId);
  const token = getToken();
  if (!token) throw new ApiClientError('UNAUTHENTICATED','请先登录',401);
  // A restored write belongs to the displayed actor, not whichever session happens to be current.
  assertCanSend();
  const actor = await api.me();
  if (getToken() !== token || actor.user_id !== expectedActor) throw new ApiClientError('UNAUTHENTICATED','账号已切换，请重新加载本人参加记录',401);
  // This lifecycle check is synchronous and immediately before the mutation transport.
  // Hiding/unmounting during the identity read must not start a new write.
  assertCanSend();
  if (getToken() !== token) throw new ApiClientError('UNAUTHENTICATED','账号已切换，请重新加载',401);
  const response = await transport({path:`/api/v1/activities/${id}/participation`,method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:input});
  if (getToken() !== token) throw new ApiClientError('UNAUTHENTICATED','账号已切换，请重新加载',401);
  if(response.status<200||response.status>=300){const parsed=apiErrorSchema.safeParse(response.body);throw new ApiClientError(parsed.success?parsed.data.error.code:'INVALID_RESPONSE',parsed.success?parsed.data.error.message:'参加状态响应无法识别',response.status);}
  const parsed=participationActionResultSchema.safeParse(response.body);if(!parsed.success)throw new ApiClientError('INVALID_RESPONSE','参加状态响应无法识别',500);return parsed.data;
}

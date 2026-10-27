import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, rebookSourceSchema, type RebookSource } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';
import { errorText } from '../../platform/page-state';

export async function readRebookSource(activityId: string, actorId: string, revision: number, session: string | undefined, assertCanSend: () => void): Promise<RebookSource> {
  const id = activityIdSchema.parse(activityId), actor = activityIdSchema.parse(actorId);
  const assertSession = () => { if (!session || getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '读取期间账号已变化，请重新核对身份。', 0); };
  const bound: Transport = async request => {
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertSession(); assertCanSend(); return response;
  };
  try {
    const client = createApiClient(bound, () => session);
    const identity = await client.me(); assertSession(); assertCanSend();
    if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '来源账号与当前身份不一致。', 401);
    const source = rebookSourceSchema.parse(await client.getRebookSource(id)); assertSession(); assertCanSend();
    if (source.source_activity_id !== id || source.actor_id !== actor || source.source_revision !== revision) throw new ApiClientError('INVALID_RESPONSE', '来源快照无法匹配，请刷新原活动后重试。', 200);
    return source;
  } catch (error) {
    if (getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '读取期间账号已变化，请重新核对身份。', 0);
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '再约来源响应无法验证，未复制到本机草稿。', 200);
  }
}
export function rebookError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'REBOOK_SCOPE_UNAVAILABLE') return '本片仅开放当前管理者从未整场取消、全部环节已结束的活动再约；其它来源范围暂未启用。';
  return errorText(error);
}

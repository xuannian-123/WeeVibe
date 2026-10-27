import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, todoPageSchema, type TodoActivity, type TodoPage } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

export type TodoIdentity = { actor_id: string; session: string };
export async function readTodoPage(identity: TodoIdentity, assertCanSend: () => void, previous?: TodoPage): Promise<TodoPage> {
  const actor = activityIdSchema.parse(identity.actor_id), session = identity.session;
  const assertSession = () => { if (!session || getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '待办读取期间身份已变化，请重新读取。', 0); };
  const bound: Transport = async request => {
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    assertSession(); assertCanSend(); return response;
  };
  try {
    if (previous && (previous.actor_id !== actor || !previous.page.has_more || !previous.page.next_cursor)) throw new ApiClientError('INVALID_RESPONSE', '上一页来源无效，请重新读取第一页。', 0);
    const client = createApiClient(bound, () => session), me = await client.me(); assertSession(); assertCanSend();
    if (activityIdSchema.parse(me.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '待办来源与当前登录身份不一致。', 401);
    const data = todoPageSchema.parse(await client.getTodos(previous?.page.next_cursor ?? undefined)); assertSession(); assertCanSend();
    if (data.actor_id !== actor) throw new ApiClientError('INVALID_RESPONSE', '待办响应来源无法验证。', 200);
    if (previous) {
      if (data.page.offset !== previous.page.offset + previous.page.candidate_count || data.page.snapshot_fingerprint !== previous.page.snapshot_fingerprint || data.page.valid_until !== previous.page.valid_until) throw new ApiClientError('TODOS_SNAPSHOT_CHANGED', '待办来源已变化，请重新读取第一页。', 409);
      if (data.page.next_cursor !== null && data.page.next_cursor === previous.page.next_cursor) throw new ApiClientError('INVALID_RESPONSE', '待办翻页响应无法验证。', 200);
    } else if (data.page.offset !== 0) throw new ApiClientError('INVALID_RESPONSE', '待办第一页响应无法验证。', 200);
    return data;
  } catch (error) {
    if (getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '待办读取期间身份已变化，请重新读取。', 0);
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '待办响应无法验证，不能视为空列表。', 200);
  }
}
export function mergeTodoActivities(previous: TodoActivity[], incoming: TodoActivity[]): TodoActivity[] {
  const result = new Map(previous.map(item => [item.activity_id, item]));
  const facts = (item: TodoActivity) => JSON.stringify([...item.items].sort((a, b) => `${a.kind}:${a.role}`.localeCompare(`${b.kind}:${b.role}`)));
  for (const item of incoming) {
    const old = result.get(item.activity_id);
    if (old && (old.revision !== item.revision || old.title !== item.title || old.path !== item.path || facts(old) !== facts(item))) throw new ApiClientError('TODOS_SNAPSHOT_CHANGED', '活动来源已变化，请重新读取第一页。', 409);
    // Stable candidate pages cannot change one activity's facts halfway through.
    // Deduplicate an identical card; never synthesize a union of different states.
    if (!old) result.set(item.activity_id, item);
  }
  return [...result.values()];
}
export function todoError(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '待办读取未完成，不能把未知结果当作没有待办。';
  if (error.code === 'TODOS_SNAPSHOT_CHANGED') return '待办来源或有效时点已变化，旧分页已清除，请重新读取第一页。';
  if (error.code === 'NOT_CONFIGURED' || error.status === 503) return '待办接口尚未配置、所需数据结构未就绪或候选规模超出当前支持范围；尚未取得待办，账户列表不受此错误影响。';
  if (error.status === 404 || error.status === 405) return '当前后端未提供匹配的待办接口，请更新对应后端后重试；不能当作零待办。';
  if (error.code === 'UNAUTHENTICATED') return '待办身份验证未通过，请重新确认登录身份后读取。';
  if (error.code === 'INVALID_RESPONSE') return '待办响应或来源无法验证，未使用其中内容；请重新读取，不能视为没有待办。';
  return '待办暂时读取失败；已显示的内容若有也仅是此前快照，请重新核对。';
}

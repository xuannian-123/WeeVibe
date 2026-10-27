import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, publicRosterSnapshotSchema, type ActivityDetail, type PublicRosterSnapshot } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

/** Public signup names only. Session is still bound so a late A read cannot populate B's page. */
export async function readActivityRoster(detail: ActivityDetail, session: string | undefined, assertCanSend: () => void): Promise<PublicRosterSnapshot> {
  const id = activityIdSchema.parse(detail.activity_id);
  const check = () => {
    if (getToken() !== session) throw new ApiClientError('INVALID_RESPONSE', '身份已变化，请重新打开名单。', 0);
    assertCanSend();
  };
  const bound: Transport = async request => {
    check(); // No await between the source/session guard and the transport invocation.
    const response = await transport(request); check(); return response;
  };
  try {
    check();
    const data = publicRosterSnapshotSchema.parse(await createApiClient(bound, () => session).getActivityRoster(id)); check();
    if (data.activity_id !== id) throw new Error('mismatched activity');
    if (data.activity_revision !== detail.revision) throw new ApiClientError('VERSION_CONFLICT', '活动已更新，请先刷新安排，再读取名单。', 409);
    if (data.cancelled !== Boolean(detail.cancelled_at) || data.segments.length !== detail.segments.length) throw new Error('mismatched snapshot');
    const expected = new Map(detail.segments.map(s => [activityIdSchema.parse(s.segment_id), s]));
    for (const segment of data.segments) {
      const source = expected.get(segment.segment_id);
      if (!source || segment.name !== source.name || segment.position !== source.position || segment.plan_revision !== source.plan_revision || segment.cancelled !== Boolean(source.cancelled_at)) throw new Error('mismatched segment');
      if (segment.counts && (segment.counts.occupied_count !== source.counts.occupied_count || segment.counts.accepted_count !== source.counts.accepted_count || segment.counts.pending_acceptance_count !== source.counts.pending_acceptance_count)) throw new Error('mismatched counts');
    }
    return data;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError('INVALID_RESPONSE', '名单响应无法验证，未将人数推算为姓名。', 200);
  }
}

export function rosterError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404 || error.status === 405) return '活动或名单接口暂时无法读取，请核对活动入口及后端版本；这不代表没有参加者。';
    if (error.code === 'VERSION_CONFLICT') return '活动已更新，请先刷新安排，再读取名单。';
    if (error.code === 'ROSTER_LIMIT_EXCEEDED') return '名单超过本片完整读取上限（2000 个占位），暂不可用；没有截断成不完整名单。';
    if (error.code === 'UNAUTHENTICATED') return '当前会话未获验证，请重新核对登录状态；未显示旧名单。';
    if (error.code === 'NOT_CONFIGURED' || error.code === 'ROSTER_UNAVAILABLE' || error.status === 503) return '名单服务暂不可用，请核对后端配置或稍后重试；这不代表没有参加者。';
  }
  return '名单未能完整读取或响应无法验证，请刷新后重试；未按人数补造姓名。';
}

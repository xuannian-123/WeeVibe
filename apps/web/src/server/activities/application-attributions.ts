import { Prisma } from '@prisma/client';
import { activityIdSchema } from '@weevibe/contracts';
import { APPLICATION_ATTRIBUTION_LIMIT, applicationAttributionsSchema, type ApplicationAttributions } from '@weevibe/contracts/src/application-attributions';
import { withDb } from '../db';
import { ServiceError } from '../http';
function unavailable(): never { throw new ServiceError('DATABASE_UNAVAILABLE', 503, '申请来源记录暂不可用，请刷新后重试'); }
function parseId(value: string) {
  const result = activityIdSchema.safeParse(value);
  if (!result.success) throw new ServiceError('INVALID_INPUT', 400, '活动或用户标识无效');
  return result.data;
}
/** Same RR snapshot for current-manager permission, application ownership and public provenance. */
export function getApplicationAttributions(rawActivityId: string, rawActorId: string): Promise<ApplicationAttributions> {
  const activityId = parseId(rawActivityId), actorId = parseId(rawActorId);
  return withDb(db => db.$transaction(async tx => {
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { id: true, revision: true, currentManagerId: true } });
    if (!activity) throw new ServiceError('NOT_FOUND', 404, '未找到此活动');
    if (activity.id !== activityId || !activityIdSchema.safeParse(activity.currentManagerId).success) unavailable();
    const isManager = activity.currentManagerId === actorId;
    const rows = await tx.activityApplication.findMany({
      where: { activityId, ...(isManager ? {} : { applicantUserId: actorId }) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: APPLICATION_ATTRIBUTION_LIMIT + 1,
      select: { id: true, activityId: true, applicantUserId: true, invitationSourceId: true,
        invitationSource: { select: { id: true, activityId: true, inviterDisplayName: true } } }
    });
    if (!Array.isArray(rows)) unavailable();
    if (rows.length > APPLICATION_ATTRIBUTION_LIMIT)
      throw new ServiceError('DATABASE_UNAVAILABLE', 503, '申请来源记录超出本次完整读取上限，未返回截断记录');
    const entries = rows.map(row => {
      if (row.activityId !== activityId || !activityIdSchema.safeParse(row.applicantUserId).success || (!isManager && row.applicantUserId !== actorId)) unavailable();
      if (row.invitationSourceId === null) {
        if (row.invitationSource !== null) unavailable();
        return { application_id: row.id, source: null };
      }
      const source = row.invitationSource;
      if (!source || source.id !== row.invitationSourceId || source.activityId !== activityId) unavailable();
      return { application_id: row.id, source: { invitation_id: source.id, inviter_display_name: source.inviterDisplayName, source_only: true as const } };
    });
    const response = applicationAttributionsSchema.safeParse({ schema_version: 1, activity_id: activity.id,
      revision: activity.revision, viewer_user_id: actorId, is_manager: isManager,
      complete: true, limit: APPLICATION_ATTRIBUTION_LIMIT, entries });
    if (!response.success) unavailable();
    return response.data;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

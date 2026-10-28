import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { inboxSchema, type InboxMessage } from '@weevibe/contracts';
import { withDb } from './db';
import { ServiceError } from './http';
import type { Tx } from './activities/state';
import { handoverMessage } from './handover-message';
import { requirementMessageSelect, requirementMessages } from './requirements/messages';

// Source messages are projected for the authenticated actor. Read state never
// mutates approval/acceptance/handover state, and is not a proof of consent.
export async function inboxSnapshot(tx: Tx, actor: string, now = new Date()) {
  const [activities, decisions, offers, surveys,gatheringNotices] = await Promise.all([
    tx.activity.findMany({ where: { OR: [{ currentManagerId: actor }, { segments: { some: { participations: { some: { userId: actor } } } } }] }, orderBy: { createdAt: 'desc' }, take: 100,
      include: {
        _count: { select: { applications: { where: { status: 'pending' } } } },
        applications: { where: { activity: { currentManagerId: actor } }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, status: true, createdAt: true } },
        segments: { select: { id: true, planRevision: true, cancelledAt: true, startsAt: true, participations: { where: { userId: actor }, select: { userId: true, joinedAt: true, exitedAt: true, status: true, acceptedPlanRevision: true } } } },
        events: { where: { type: { in: ['segment_capacity_changed', 'segment_deadline_extended', 'activity_cancelled', 'main_segment_changed', 'formation_confirmed', 'arrangement_changed', 'segment_arrangement_changed'] } }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, type: true, createdAt: true, detail: true } },
      } }),
    tx.activityApplication.findMany({ where: { applicantUserId: actor, status: { in: ['approved', 'rejected'] } }, orderBy: { decidedAt: 'desc' }, take: 100, select: { id: true, activityId: true, status: true, decidedAt: true, activity: { select: { name: true } } } }),
    tx.managementHandover.findMany({ where: { OR: [{ fromUserId: actor }, { toUserId: actor }] }, orderBy: { createdAt: 'desc' }, take: 100, select: { id: true, activityId: true, fromUserId: true, toUserId: true, status: true, createdAt: true, resolvedAt: true, fromManagementRevision: true, activity: { select: { name: true, currentManagerId: true, managementRevision: true, cancelledAt: true } } } }),
    tx.requirementSurvey.findMany({ where: { status: { not: 'draft' }, AND: [{ OR: [{ activityId: null, ownerUserId: actor }, { activity: { currentManagerId: actor } }, { responses: { some: { userId: actor } } }] }, { OR: [{ deadlineAt: { lte: now } }, { closedAt: { not: null } }] }] }, select: requirementMessageSelect, orderBy: { updatedAt: 'desc' }, take: 100 }),
    tx.gatheringNotificationRecipient.findMany({where:{userId:actor},orderBy:[{createdAt:'desc'},{id:'asc'}],take:100,select:{id:true,createdAt:true,event:{select:{action:true,gatheringId:true,gathering:{select:{kind:true}}}}}}),
  ]);
  const messages: InboxMessage[] = [];
  for (const activity of activities) {
    if (activity.currentManagerId === actor && activity.applications.length) {
      const pending = !activity.cancelledAt ? activity._count.applications : 0;
      const digest = createHash('sha256').update(activity.applications.map(a => a.id).sort().join(',')).digest('hex').slice(0, 24);
      messages.push({ id: `applications:${activity.id}:${digest}`, activity_id: activity.id, title: activity.name, summary: pending ? `有 ${pending} 条报名申请等待你审批` : activity.cancelledAt ? '活动已取消，报名申请不再等待审批' : '本批报名申请已处理', created_at: activity.applications[0].createdAt.toISOString(), read: false, pending: pending > 0, status: pending ? '待审批' : activity.cancelledAt ? '活动已取消' : '已处理', section: 'applications' });
    }
    const reviewedSegments = new Set<string>();
    for (const event of activity.events) {
      const detail = event.detail && typeof event.detail === 'object' && !Array.isArray(event.detail) ? event.detail as Record<string, unknown> : {};
      const own = activity.segments.filter(s => (typeof detail.segment_id !== 'string' || s.id === detail.segment_id) && s.participations.some(p => p.joinedAt <= event.createdAt && (!p.exitedAt || p.exitedAt >= event.createdAt)));
      if (!own.length && activity.currentManagerId !== actor) continue;
      const changed = ['segment_capacity_changed', 'segment_deadline_extended', 'arrangement_changed', 'segment_arrangement_changed'].includes(event.type);
      const pending = changed && !activity.cancelledAt && own.some(s => !reviewedSegments.has(s.id) && !s.cancelledAt && s.startsAt > now && s.participations.some(p => p.status === 'joined' && p.acceptedPlanRevision !== s.planRevision));
      if (changed) for (const segment of own) reviewedSegments.add(segment.id);
      const summary = event.type === 'activity_cancelled' ? '活动已取消，请查看最新通知' : event.type === 'formation_confirmed' ? '组织者已确认成局' : event.type === 'main_segment_changed' ? '活动主要环节已调整' : pending ? '活动安排有变化，请查看并确认是否继续参加' : '活动安排已更新，请查看最新详情';
      messages.push({ id: `activity-event:${event.id}`, activity_id: activity.id, title: activity.name, summary, created_at: event.createdAt.toISOString(), read: false, pending, status: pending ? '待确认' : event.type === 'activity_cancelled' ? '已取消' : changed ? '查看安排' : '活动进展', section: pending || changed ? 'arrangement' : 'activity' });
    }
  }
  for (const application of decisions) if (application.decidedAt) messages.push({ id: `application:${application.id}:${application.status}`, activity_id: application.activityId, title: application.activity.name, summary: application.status === 'approved' ? '你的报名已通过，查看参加的环节和安排' : '你的报名未通过，可查看活动最新情况', created_at: application.decidedAt.toISOString(), read: false, pending: false, status: application.status === 'approved' ? '已加入' : '未通过', section: 'activity' });
  for (const offer of offers) messages.push(handoverMessage(offer, actor));
  for (const survey of surveys) for (const source of requirementMessages(survey, new Set(), now)) messages.push({ ...source, title: source.title.slice(0, 200), summary: source.title.slice(0, 300), pending: false, status: '筹备进展', section: 'requirement' });
  for(const notice of gatheringNotices){
    const friend=notice.event.gathering.kind==='friend',updated=notice.event.action==='updated';
    if(!['friend','team'].includes(notice.event.gathering.kind)||!['submitted','updated'].includes(notice.event.action))throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'筹备消息暂时无法核对');
    messages.push({id:`gathering-notice:${notice.id}`,activity_id:null,gathering_id:notice.event.gatheringId,title:friend?'朋友出游有新填写':'团建问卷有新填写',summary:updated?'有成员更新了填写，点击查看本次筹备。':'有成员提交了填写，点击查看本次筹备。',created_at:notice.createdAt.toISOString(),read:false,pending:false,status:updated?'填写已更新':'收到新填写',section:'gathering'});
  }
  const visible = [...new Map(messages.map(m => [m.id, m])).values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)).slice(0, 100);
  const reads = await tx.messageRead.findMany({ where: { userId: actor, messageId: { in: visible.map(m => m.id) } }, select: { messageId: true } });
  const readIds = new Set(reads.map(r => r.messageId));
  for (const message of visible) message.read = readIds.has(message.id);
  return inboxSchema.parse({ messages: visible, unread_count: visible.filter(m => !m.read).length, pending_count: visible.filter(m => m.pending).length, server_time: now.toISOString(), limit: 100 });
}
export function getInbox(actor: string) { return withDb(db => db.$transaction(tx => inboxSnapshot(tx, actor), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })); }
export function readInbox(actor: string, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ServiceError('INVALID_INPUT', 400, '消息操作无效');
  const value = input as Record<string, unknown>;
  if (!['read', 'read-all'].includes(String(value.action)) || Object.keys(value).some(k => !['action', 'message_id'].includes(k)) || value.action === 'read' && typeof value.message_id !== 'string') throw new ServiceError('INVALID_INPUT', 400, '消息操作无效');
  return withDb(db => db.$transaction(async tx => {
    const snapshot = await inboxSnapshot(tx, actor);
    const messages = value.action === 'read-all' ? snapshot.messages : snapshot.messages.filter(m => m.id === value.message_id);
    if (value.action === 'read' && messages.length !== 1) throw new ServiceError('NOT_FOUND', 404, '这条消息当前不属于本人可见范围');
    if (messages.length) await tx.messageRead.createMany({ data: messages.map(m => ({ userId: actor, messageId: m.id })), skipDuplicates: true });
    return inboxSnapshot(tx, actor);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

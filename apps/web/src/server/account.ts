import { Prisma } from '@prisma/client';
import { venueSchema } from '@weevibe/contracts';
import { withDb } from './db';
import { ServiceError } from './http';
import { requirementMessages, parseRequirementMessageId, requirementMessageSelect } from './requirements/messages';
import { invitationSourceView } from './activities/invitations';
import { invitationDisplayStatus } from './activities/invitation-rules';
import { accountActivityRecords } from './account-activities';
import { emptyProfile, parsePrivateProfile, participationDisplayStatus, decisionMessageId, parseDecisionMessageId } from './account-rules';
import { normalizeCover } from './member-profile';

export function accountSnapshot(userId: string) {
  return withDb(db => db.$transaction(async tx => {
    const now = new Date();
    const [profile, favorites, reads, activities, decisions, invitations, requirementSources, activityRecords] = await Promise.all([
      tx.privateProfile.findUnique({ where: { userId } }),
      tx.savedVenue.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
      tx.messageRead.findMany({ where: { userId } }),
      tx.activity.findMany({ where: { segments: { some: { participations: { some: { userId, status: 'joined' } } } } }, orderBy: { createdAt: 'desc' }, take: 100,
        include: { segments: { where: { participations: { some: { userId, status: 'joined' } } }, orderBy: { position: 'asc' }, include: { participations: { where: { userId, status: 'joined' } } } } } }),
      tx.activityApplication.findMany({ where: { applicantUserId: userId, status: { in: ['approved', 'rejected'] } }, orderBy: { decidedAt: 'desc' }, take: 100, include: { activity: { select: { id: true, name: true } } } }),
      tx.receivedInvitation.findMany({where:{userId},orderBy:{savedAt:'desc'},take:100,include:{invitation:{include:{activity:{include:{segments:{orderBy:{position:'asc'}}}}}}}}),
      tx.requirementSurvey.findMany({ where: { status: { not: 'draft' }, AND: [ { OR: [{ activityId: null, ownerUserId: userId }, { activity: { currentManagerId: userId } }, { responses: { some: { userId } } }] }, { OR: [{ deadlineAt: { lte: now } }, { closedAt: { not: null } }] } ] }, select: requirementMessageSelect, orderBy: { updatedAt: 'desc' }, take: 100 }),
      accountActivityRecords(tx, userId, now)
    ]);
    const readIds = new Set(reads.map(r => r.messageId));
    return {
      profile: profile ? parsePrivateProfile(profile.data, now) : emptyProfile,
      favorites: favorites.map(f => venueSchema.parse(f.data)),
      // Additive contract: legacy activities below still means joined, not pending/managed/browsed.
      activity_records: activityRecords,
      activities: activities.map(a => {
        const effective = a.segments.filter(s => !s.cancelledAt);
        const dated = effective.length ? effective : a.segments;
        const start = new Date(Math.min(...dated.map(s => s.startsAt.getTime())));
        const end = new Date(Math.max(...dated.map(s => s.endsAt.getTime())));
        const location = dated[0]?.location as Record<string, unknown> | undefined;
        return { activity_id: a.id, title: a.name, starts_at: start.toISOString(), ends_at: end.toISOString(), timezone: a.timezone,
          status: participationDisplayStatus(a.segments, Boolean(a.cancelledAt), now),
          location: typeof location?.name === 'string' ? location.name : '',
          awaiting_acceptance: a.segments.some(s => s.participations.some(p => p.acceptedPlanRevision !== s.planRevision)) };
      }),
      invitations: invitations.map(record => { const source=invitationSourceView(record.invitation); return { ...source, saved_at:record.savedAt.toISOString(), status:invitationDisplayStatus(source.cancelled,source.starts_at?new Date(source.starts_at):null,source.ends_at?new Date(source.ends_at):null,now), location:'', source_only:true }; }),
      messages: [...decisions.filter(a => a.decidedAt).map(a => {
        const id = decisionMessageId(a.id, a.status);
        return { id, activity_id: a.activityId, title: `${a.activity.name}：报名${a.status === 'approved' ? '已通过' : '未通过'}`, created_at: a.decidedAt!.toISOString(), read: readIds.has(id) };
      }), ...requirementSources.flatMap(source => requirementMessages(source, readIds, now))].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      capabilities: { invitations: true, avatar_upload: true },
      limit: 100, server_time: now.toISOString()
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

export async function updateAccount(userId: string, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ServiceError('INVALID_INPUT', 400, '请求格式不正确');
  const input = raw as Record<string, unknown>;
  try {
    if (input.action === 'profile') {
      if (Object.keys(input).some(k => !['action', 'profile'].includes(k))) throw new Error('不支持的请求字段');
      if (!input.profile || typeof input.profile !== 'object' || Array.isArray(input.profile) || Object.hasOwn(input.profile, 'cover_image')) throw new Error('封面通过图片入口单独更新');
      const submitted = input.profile as Record<string, unknown>;
      await withDb(db => db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        const saved = await tx.privateProfile.findUnique({ where: { userId } });
        const profile = parsePrivateProfile({ ...(saved ? parsePrivateProfile(saved.data) : emptyProfile), ...submitted });
        const data = JSON.parse(JSON.stringify(profile)) as Prisma.InputJsonValue;
        await tx.privateProfile.upsert({ where: { userId }, create: { userId, data }, update: { data } });
      }));
    } else if (input.action === 'cover') {
      if (Object.keys(input).some(k => !['action', 'base64'].includes(k))) throw new Error('不支持的封面字段');
      const image = await normalizeCover(input.base64, userId);
      await withDb(db => db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        const saved = await tx.privateProfile.findUnique({ where: { userId } });
        const profile = parsePrivateProfile({ ...(saved ? parsePrivateProfile(saved.data) : emptyProfile), cover_style: 'custom', cover_image: image });
        const data = JSON.parse(JSON.stringify(profile)) as Prisma.InputJsonValue;
        await tx.privateProfile.upsert({ where: { userId }, create: { userId, data }, update: { data } });
      }));
    } else if (input.action === 'favorite') {
      if (Object.keys(input).some(k => !['action', 'venue', 'saved'].includes(k)) || typeof input.saved !== 'boolean') throw new Error('收藏请求格式不正确');
      const parsed = venueSchema.safeParse(input.venue);
      if (!parsed.success || !parsed.data.provider_id || parsed.data.provider_id.length > 100 || JSON.stringify(parsed.data).length > 12000) throw new Error('地点格式不正确');
      const venue = parsed.data;
      await withDb(db => db.$transaction(async tx => {
        // Serialize each account's favorites limit; account identity is never accepted from JSON.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        const where = { userId_providerId: { userId, providerId: venue.provider_id } };
        if (!input.saved) { await tx.savedVenue.deleteMany({ where: { userId, providerId: venue.provider_id } }); return; }
        const existing = await tx.savedVenue.findUnique({ where });
        if (!existing && await tx.savedVenue.count({ where: { userId } }) >= 100) throw new ServiceError('INVALID_INPUT', 400, '最多收藏100个地点');
        const data = JSON.parse(JSON.stringify(venue)) as Prisma.InputJsonValue;
        await tx.savedVenue.upsert({ where, create: { userId, providerId: venue.provider_id, data }, update: { data } });
      }));
    } else if (input.action === 'read-message') {
      if (Object.keys(input).some(k => !['action', 'message_id'].includes(k))) throw new Error('不支持的请求字段');
      if (typeof input.message_id === 'string' && input.message_id.startsWith('requirement:')) {
        const message = parseRequirementMessageId(input.message_id);
        await withDb(db => db.$transaction(async tx => {
          // Source access is revalidated now; knowing an ID is not authority to mark another user's message.
          const source = await tx.requirementSurvey.findFirst({ where: { id: message.collectionId, OR: [{ activityId: null, ownerUserId: userId }, { activity: { currentManagerId: userId } }, { responses: { some: { userId } } }] }, select: requirementMessageSelect });
          if (!source || !requirementMessages(source, new Set(), new Date()).some(item => item.id === message.id)) throw new ServiceError('NOT_FOUND', 404, '未找到本人的消息');
          await tx.messageRead.upsert({ where: { userId_messageId: { userId, messageId: message.id } }, create: { userId, messageId: message.id }, update: {} });
        }));
      } else {
        const message = parseDecisionMessageId(input.message_id);
        await withDb(db => db.$transaction(async tx => {
          const own = await tx.activityApplication.findFirst({ where: { id: message.applicationId, applicantUserId: userId, status: message.status, decidedAt: { not: null } } });
          if (!own) throw new ServiceError('NOT_FOUND', 404, '未找到本人的消息');
          await tx.messageRead.upsert({ where: { userId_messageId: { userId, messageId: message.id } }, create: { userId, messageId: message.id }, update: {} });
        }));
      }
    } else throw new Error('不支持的操作');
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    // Never expose arbitrary exception text, ORM diagnostics or submitted private fields.
    throw new ServiceError('INVALID_INPUT', 400, '输入格式不正确，请检查字段内容和长度');
  }
  return accountSnapshot(userId);
}

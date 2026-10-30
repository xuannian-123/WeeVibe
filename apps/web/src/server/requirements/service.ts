import { createHash } from 'node:crypto';
import { Prisma, type RequirementSurvey } from '@prisma/client';
import {
  requirementCreateSchema, requirementCommandSchema, requirementResponseInputSchema, privateOriginSchema, avatarAssetSchema,
  type RequirementCreateInput, type RequirementCommand, type RequirementSnapshot, type RequirementSummary,
  type RequirementList, type PublicRequirementResponse, type OwnRequirementResponse, type AvatarAsset
} from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { mutation } from '../activities/mutation';
import type { Tx } from '../activities/state';
import { aggregateResponses, managerResponse } from './privacy';
import { parseDraft, effectiveSurveyStatus, assertSurveyManager, assertRevision, assertSegmentOwnership, assertPublishable, normalizeSubmission, normalizeFinalSelection, surveyStatistics, inputError } from './rules';
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const budgetLimit = 60;

/** Durable per-actor fixed minute budget. Failed business writes still consume this budget. */
export function consumeRequirementBudget(actorId: string) {
  return mutation(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actorId}::uuid FOR UPDATE`;
    const now = new Date();
    const bucketStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const where = { userId_scope: { userId: actorId, scope: 'requirements' } };
    const current = await tx.requirementWriteBudget.findUnique({ where });
    const count = current?.bucketStart.getTime() === bucketStart.getTime() ? current.count : 0;
    if (count >= budgetLimit) throw new ServiceError('FORBIDDEN', 429, '操作过于频繁，请稍后再试');
    await tx.requirementWriteBudget.upsert({ where, create: { userId: actorId, scope: 'requirements', bucketStart, count: 1 }, update: { bucketStart, count: count + 1 } });
  });
}

async function activityFor(tx: Tx, survey: Pick<RequirementSurvey, 'activityId'>) {
  return survey.activityId ? tx.activity.findUnique({ where: { id: survey.activityId }, include: { segments: { orderBy: { position: 'asc' } } } }) : null;
}
async function lockSurvey(tx: Tx, id: string) {
  // Match the original activity-write lock order: activity parent before survey.
  const ref = await tx.requirementSurvey.findUnique({ where: { id }, select: { activityId: true, kind: true } });
  if (!ref || ref.kind !== 'friend') throw new ServiceError('NOT_FOUND', 404, '未找到需求收集');
  if (ref.activityId) await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${ref.activityId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "RequirementSurvey" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const survey = await tx.requirementSurvey.findUniqueOrThrow({ where: { id } });
  if (survey.kind !== 'friend') throw new ServiceError('NOT_FOUND', 404, '未找到需求收集');
  const activity = await activityFor(tx, survey);
  // Clock sampled only AFTER both locks and state reads. Waiting past cutoff cannot succeed.
  return { survey, activity, now: new Date() };
}
function managerFor(survey: RequirementSurvey, activity: Awaited<ReturnType<typeof activityFor>>, actorId: string) {
  return survey.activityId ? activity?.currentManagerId === actorId : survey.ownerUserId === actorId;
}
function assertReadable(survey: RequirementSurvey, isManager: boolean) {
  if (!isManager && survey.status === 'draft') throw new ServiceError('NOT_FOUND', 404, '未找到可查看的需求收集');
}
function summary(survey: RequirementSurvey, actorId: string, isManager: boolean, hasResponded: boolean, now: Date): RequirementSummary {
  return { id: survey.id, kind: 'friend', activity_id: survey.activityId, title: parseDraft(survey.draft).title,
    status: effectiveSurveyStatus(survey, now), deadline_at: survey.deadlineAt?.toISOString() ?? null, revision: survey.revision,
    is_manager: isManager, has_responded: hasResponded, updated_at: survey.updatedAt.toISOString() };
}
function publicResponse(row: { userId: string; revision: number; publicAnswers: Prisma.JsonValue; updatedAt: Date }, nickname: string): PublicRequirementResponse {
  const parsed = requirementResponseInputSchema.omit({ private_origin: true }).safeParse(row.publicAnswers);
  if (!parsed.success) throw new ServiceError('INTERNAL_ERROR', 500, '答卷数据暂时不可用');
  return { ...parsed.data, user_id: row.userId, revision: row.revision, updated_at: row.updatedAt.toISOString(), nickname };
}
/** Only the activity identity avatar is shared; never expose a generic user-avatar lookup. */
export function organizerAvatarProjection(row: { bytes: Uint8Array; contentType: string; digest: string; updatedAt: Date } | null): AvatarAsset | null {
  if (!row || row.contentType !== 'image/jpeg' || row.bytes.length > 42000) return null;
  const bytes = Buffer.from(row.bytes);
  if (createHash('sha256').update(bytes).digest('hex') !== row.digest) return null;
  const parsed = avatarAssetSchema.safeParse({ base64: bytes.toString('base64'), content_type: 'image/jpeg', digest: row.digest, updated_at: row.updatedAt.toISOString() });
  return parsed.success ? parsed.data : null;
}
export async function requirementSnapshotTx(tx: Tx, id: string, actorId: string, now = new Date()): Promise<RequirementSnapshot> {
  const survey = await tx.requirementSurvey.findUnique({ where: { id } });
  if (!survey || survey.kind !== 'friend') throw new ServiceError('NOT_FOUND', 404, '未找到需求收集');
  const activity = await activityFor(tx, survey);
  const isManager = managerFor(survey, activity, actorId);
  assertReadable(survey, isManager);
  const draft = parseDraft(survey.draft);
  const state = effectiveSurveyStatus(survey, now);
  const own = await tx.requirementSubmission.findUnique({ where: { collectionId_userId: { collectionId: id, userId: actorId } } });
  // Never read other users' privateOrigin for manager projections.
  const rows = await tx.requirementSubmission.findMany({ where: { collectionId: id }, orderBy: { updatedAt: 'asc' }, take: 501, select: { userId: true, revision: true, publicAnswers: true, updatedAt: true } });
  if (rows.length > 500) throw new ServiceError('UPSTREAM_UNAVAILABLE', 503, '需求超过当前完整汇总上限，未返回不完整结果');
  const organizerId = activity?.currentManagerId ?? survey.ownerUserId;
  const organizerAvatar = await tx.userAvatar.findUnique({ where: { userId: organizerId }, select: { bytes: true, contentType: true, digest: true, updatedAt: true } });
  const profileIds = [...new Set([organizerId, actorId, ...(isManager ? rows.map(r => r.userId) : [])])];
  const profiles = await tx.privateProfile.findMany({ where: { userId: { in: profileIds } }, select: { userId: true, data: true } });
  // Allowlist only nickname. Birthdays, MBTI, signature, profile and departure are never projected.
  const nickname = (id: string) => {
    const data = profiles.find(p => p.userId === id)?.data;
    return data && typeof data === 'object' && !Array.isArray(data) && typeof data.nickname === 'string' ? data.nickname.slice(0, 32) : '微信用户';
  };
  const responses = rows.map(r => publicResponse(r, nickname(r.userId)));
  let ownResponse: OwnRequirementResponse | null = null;
  if (own) {
    const origin = own.privateOrigin === null ? null : privateOriginSchema.safeParse(own.privateOrigin);
    if (origin && !origin.success) throw new ServiceError('INTERNAL_ERROR', 500, '个人答卷暂时不可用');
    ownResponse = { ...publicResponse(own, nickname(actorId)), response_version: own.responseVersion, private_origin: origin ? origin.data : null };
  }
  const cancelled = Boolean(activity?.cancelledAt);
  return {
    collection: { ...summary(survey, actorId, isManager, Boolean(own), now), draft,
      closed_at: survey.closedAt?.toISOString() ?? (state === 'closed' || state === 'finalized' ? survey.deadlineAt?.toISOString() ?? null : null),
      final_selection: survey.finalSelection ? normalizeFinalSelection(draft, survey.finalSelection as unknown as Parameters<typeof normalizeFinalSelection>[1]) : null,
      organizer_nickname: nickname(organizerId), organizer_avatar: organizerAvatarProjection(organizerAvatar) },
    viewer: { is_manager: isManager, can_respond: !cancelled && state === 'open', can_edit: isManager && !cancelled && survey.status === 'draft',
      can_publish: isManager && survey.status === 'draft' && !cancelled, can_close: isManager && !cancelled && state === 'open', can_finalize: isManager && state === 'closed' && !cancelled,
      blocked_reason: cancelled ? '关联活动已取消' : state === 'draft' ? '尚未发布需求收集' : state !== 'open' ? '需求收集已截止；填写不等于报名或接受最终安排' : null },
    segments: (activity?.segments ?? []).map(s => ({ id: s.id, name: s.name, starts_at: s.startsAt.toISOString(), ends_at: s.endsAt.toISOString(), cancelled_at: s.cancelledAt?.toISOString() ?? null })),
    own_response: ownResponse,
    aggregate: aggregateResponses(draft, responses),
    manager: isManager ? { responses: responses.map(managerResponse), ...surveyStatistics(draft, responses) } : null,
    server_time: now.toISOString()
  };
}
export function getRequirement(id: string, actorId: string) {
  return withDb(db => db.$transaction(tx => requirementSnapshotTx(tx, id, actorId), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}
export function getRequirementForActivity(activityId: string, actorId: string) {
  return withDb(db => db.$transaction(async tx => {
    const survey = await tx.requirementSurvey.findUnique({ where: { activityId } });
    if (!survey || survey.kind !== 'friend') return { collection: null } as const;
    const activity = await activityFor(tx, survey);
    if (survey.status === 'draft' && !managerFor(survey, activity, actorId)) return { collection: null } as const;
    return requirementSnapshotTx(tx, survey.id, actorId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}
export function listRequirements(actorId: string): Promise<RequirementList> {
  return withDb(db => db.$transaction(async tx => {
    const now = new Date();
    const rows = await tx.requirementSurvey.findMany({ where: { kind: 'friend', OR: [ { activityId: null, ownerUserId: actorId }, { activity: { currentManagerId: actorId } }, { status: { not: 'draft' }, responses: { some: { userId: actorId } } } ] },
      orderBy: { updatedAt: 'desc' }, take: 100, include: { activity: { select: { currentManagerId: true } }, responses: { where: { userId: actorId }, select: { userId: true } } } });
    return { collections: rows.map(s => summary(s, actorId, s.activityId ? s.activity?.currentManagerId === actorId : s.ownerUserId === actorId, s.responses.length > 0, now)), server_time: now.toISOString(), limit: 100 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}

export async function createRequirement(actorId: string, raw: RequirementCreateInput) {
  const parsed = requirementCreateSchema.safeParse(raw); if (!parsed.success) throw inputError();
  const input = parsed.data; const fingerprint = digest(input);
  await consumeRequirementBudget(actorId);
  return mutation(async tx => {
    if (input.activity_id) await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${input.activity_id}::uuid FOR UPDATE`;
    const activity = input.activity_id ? await tx.activity.findUnique({ where: { id: input.activity_id }, include: { segments: true } }) : null;
    if (input.activity_id) {
      if (!activity) throw new ServiceError('NOT_FOUND', 404, '未找到关联活动');
      assertSurveyManager(activity.currentManagerId === actorId);
      if (activity.cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '活动已取消');
    }
    assertSegmentOwnership(input.draft, activity?.segments ?? [], input.kind);
    const previous = await tx.requirementSurvey.findUnique({ where: { ownerUserId_creationKey: { ownerUserId: actorId, creationKey: input.idempotency_key } } });
    if (previous) {
      if (previous.creationHash !== fingerprint) throw new ServiceError('IDEMPOTENCY_CONFLICT', 409, '此创建请求编号已经用于其他内容');
      return requirementSnapshotTx(tx, previous.id, actorId);
    }
    if (input.activity_id && await tx.requirementSurvey.findUnique({ where: { activityId: input.activity_id } })) throw new ServiceError('VERSION_CONFLICT', 409, '此活动已有需求收集，请打开已有收集');
    const survey = await tx.requirementSurvey.create({ data: { kind: input.kind, ownerUserId: actorId, activityId: input.activity_id ?? null, draft: json(input.draft), creationKey: input.idempotency_key, creationHash: fingerprint } });
    return requirementSnapshotTx(tx, survey.id, actorId);
  });
}

/** Exported transaction boundary supports deterministic lock/cutoff tests without fake production storage. */
export async function commandRequirementTx(tx: Tx, id: string, actorId: string, command: RequirementCommand) {
  const { survey, activity, now } = await lockSurvey(tx, id);
  const isManager = managerFor(survey, activity, actorId);
  assertReadable(survey, isManager);
  assertRevision(survey, command.expected_revision);
  const draft = parseDraft(survey.draft);
  if (activity?.cancelledAt) throw new ServiceError('ACTIVITY_CANCELLED', 409, '关联活动已取消');
  if (command.action === 'respond') {
    const response = normalizeSubmission(survey, draft, actorId, command.response, activity?.segments ?? [], now);
    // Questionnaire revision does not change when one participant submits an answer.
    // Check this actor's answer version after the shared lock, never from client user IDs.
    if (command.expected_response_version === undefined) throw new ServiceError('VERSION_CONFLICT', 409, '客户端缺少答卷版本校验，请更新小程序并重新打开答卷；本次未保存');
    const where = { collectionId: id, userId: actorId };
    const current = await tx.requirementSubmission.findUnique({ where: { collectionId_userId: where }, select: { responseVersion: true } });
    const currentVersion = current?.responseVersion ?? 0;
    if (currentVersion !== command.expected_response_version) throw new ServiceError('VERSION_CONFLICT', 409, '你的答卷已保存过或被其他设备更新，请刷新核对后再提交；本次未覆盖');
    const data = { revision: survey.revision, publicAnswers: json(response.publicAnswers), privateOrigin: response.privateOrigin === null ? Prisma.DbNull : json(response.privateOrigin) };
    if (current) {
      // Conditional update is defense in depth in addition to the parent survey lock.
      const written = await tx.requirementSubmission.updateMany({ where: { ...where, responseVersion: currentVersion }, data: { ...data, responseVersion: { increment: 1 } } });
      if (written.count !== 1) throw new ServiceError('VERSION_CONFLICT', 409, '你的答卷已更新，请刷新核对；本次未覆盖');
    } else {
      // The composite primary key plus transaction retry serializes concurrent first submissions.
      await tx.requirementSubmission.create({ data: { ...where, ...data, responseVersion: 1 } });
    }
  } else {
    assertSurveyManager(isManager);
    if (command.action === 'save-draft') {
      if (survey.status !== 'draft' || await tx.requirementSubmission.count({ where: { collectionId: id } })) throw new ServiceError('VERSION_CONFLICT', 409, '发布后题目结构与截止时间锁定，不能修改或重新开放');
      assertSegmentOwnership(command.draft, activity?.segments ?? [], survey.kind);
      await tx.requirementSurvey.update({ where: { id }, data: { draft: json(command.draft), revision: { increment: 1 } } });
    } else if (command.action === 'publish') {
      assertPublishable(survey, draft, activity?.segments ?? [], now);
      await tx.requirementSurvey.update({ where: { id }, data: { status: 'open', deadlineAt: new Date(draft.deadline_at), revision: { increment: 1 } } });
    } else if (command.action === 'close') {
      if (survey.status !== 'open') throw new ServiceError('VERSION_CONFLICT', 409, '当前收集不能再次截止');
      await tx.requirementSurvey.update({ where: { id }, data: { status: 'closed', closedAt: now, revision: { increment: 1 } } });
    } else {
      if (effectiveSurveyStatus(survey, now) !== 'closed') throw new ServiceError('VERSION_CONFLICT', 409, '请在需求收集截止后确定安排');
      const selection = normalizeFinalSelection(draft, command.final_selection);
      // Advisory final selection only. No seats, original activity time/fee, or accepted plan revisions are changed.
      await tx.requirementSurvey.update({ where: { id }, data: { status: 'finalized', closedAt: survey.closedAt ?? survey.deadlineAt ?? now, finalSelection: json(selection), revision: { increment: 1 } } });
    }
  }
  return requirementSnapshotTx(tx, id, actorId, now);
}
export async function commandRequirement(id: string, actorId: string, raw: RequirementCommand) {
  const parsed = requirementCommandSchema.safeParse(raw); if (!parsed.success) throw inputError();
  await consumeRequirementBudget(actorId);
  return mutation(tx => commandRequirementTx(tx, id, actorId, parsed.data));
}

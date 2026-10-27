import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { memberDirectorySchema, memberProfileSchema, type MemberProfile } from '@weevibe/contracts';
import { withDb } from './db';
import { ServiceError } from './http';
import { emptyProfile, parsePrivateProfile, type PrivateProfileInput } from './account-rules';
import type { Tx } from './activities/state';
const coverBuckets = new Map<string, { count: number; expires: number }>();

export function publicProfile(profile: PrivateProfileInput, userId: string, avatar: MemberProfile['avatar'] = null): MemberProfile {
  return memberProfileSchema.parse({ user_id: userId, nickname: profile.nickname, avatar,
    cover_style: profile.cover_style, cover_image: profile.cover_style === 'custom' ? profile.cover_image : null,
    ...(profile.visibility.bio && profile.bio ? { bio: profile.bio } : {}),
    ...(profile.visibility.interests && profile.interests.length ? { interests: profile.interests } : {}),
    ...(profile.visibility.mbti && profile.mbti ? { mbti: profile.mbti } : {}),
    ...(profile.visibility.zodiac && profile.zodiac ? { zodiac: profile.zodiac } : {}),
  });
}
async function authorize(tx: Tx, activityId: string, actor: string) {
  const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { currentManagerId: true, cancelledAt: true } });
  if (!activity || activity.cancelledAt) throw new ServiceError('NOT_FOUND', 404, '此活动的成员主页暂不可查看');
  const participates = (userId: string) => tx.participation.findFirst({ where: { activityId, userId, status: 'joined', segment: { cancelledAt: null } }, select: { id: true } });
  if (activity.currentManagerId !== actor && !await participates(actor)) throw new ServiceError('FORBIDDEN', 403, '仅本活动组织者和已加入成员可查看成员主页');
  return { activity, participates };
}
export function memberDirectory(activityId: string, actor: string) {
  return withDb(db => db.$transaction(async tx => {
    const { activity } = await authorize(tx, activityId, actor);
    const rows = await tx.participation.findMany({ where: { activityId, status: 'joined', segment: { cancelledAt: null } }, select: { userId: true, displayName: true }, orderBy: { joinedAt: 'asc' }, take: 2001 });
    if (rows.length > 2000) throw new ServiceError('ROSTER_LIMIT_EXCEEDED', 503, '成员列表超出完整读取上限，请联系组织者');
    const members = new Map(rows.map(p => [p.userId, { user_id: p.userId, display_name: p.displayName }]));
    if (!members.has(activity.currentManagerId)) members.set(activity.currentManagerId, { user_id: activity.currentManagerId, display_name: '活动组织者' });
    if (members.size > 2000) throw new ServiceError('ROSTER_LIMIT_EXCEEDED', 503, '成员列表超出完整读取上限，请联系组织者');
    return memberDirectorySchema.parse({ members: [...members.values()] });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}
export function memberProfile(activityId: string, userId: string, actor: string) {
  return withDb(db => db.$transaction(async tx => {
    const { activity, participates } = await authorize(tx, activityId, actor);
    if (activity.currentManagerId !== userId && !await participates(userId)) throw new ServiceError('NOT_FOUND', 404, '此用户当前不是本活动已加入成员');
    const [saved, image] = await Promise.all([tx.privateProfile.findUnique({ where: { userId }, select: { data: true } }), tx.userAvatar.findUnique({ where: { userId }, select: { bytes: true, digest: true } })]);
    const profile = saved ? parsePrivateProfile(saved.data) : emptyProfile;
    return publicProfile(profile, userId, image ? { base64: Buffer.from(image.bytes).toString('base64'), content_type: 'image/jpeg', digest: image.digest } : null);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
}
export async function normalizeCover(input: unknown, actor?: string) {
  if (actor) {
    const now = Date.now(); for (const [key, value] of coverBuckets) if (value.expires <= now) coverBuckets.delete(key);
    const value = coverBuckets.get(actor);
    if (value && value.count >= 5 || !value && coverBuckets.size >= 10000) throw new ServiceError('INVALID_INPUT', 429, '封面更新过于频繁，请稍后再试');
    coverBuckets.set(actor, { count: (value?.count ?? 0) + 1, expires: value?.expires ?? now + 60000 });
  }
  if (typeof input !== 'string' || input.length > 56000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) throw new ServiceError('INVALID_INPUT', 400, '封面应为压缩后的 JPEG 或 PNG');
  const bytes = Buffer.from(input, 'base64');
  if (bytes.toString('base64') !== input || bytes.length > 42000) throw new ServiceError('INVALID_INPUT', 400, '封面编码或大小不正确');
  try {
    const image = sharp(bytes, { limitInputPixels: 4194304, animated: false, failOn: 'warning' });
    const info = await image.metadata();
    if (!['jpeg', 'png'].includes(info.format ?? '') || (info.pages ?? 1) !== 1) throw Error();
    const output = await image.rotate().resize(720, 300, { fit: 'cover', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
    if (output.length > 42000) throw Error();
    return { base64: output.toString('base64'), content_type: 'image/jpeg' as const, digest: createHash('sha256').update(output).digest('hex') };
  } catch { throw new ServiceError('INVALID_INPUT', 400, '封面图片无法处理，请换一张较小图片'); }
}

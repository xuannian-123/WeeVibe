import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { memberProfileSchema, type MemberProfile } from '@weevibe/contracts';
import { ServiceError } from './http';
import { type PrivateProfileInput } from './account-rules';
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
/** Kept as explicit retired endpoints for older clients. Never query or project
 * account photos, nicknames or past public-profile fields to another member. */
export async function memberDirectory(_activityId:string,_actor:string):Promise<never>{throw new ServiceError('FORBIDDEN',403,'成员主页已取消，请在活动中查看报名昵称');}
export async function memberProfile(_activityId:string,_userId:string,_actor:string):Promise<never>{throw new ServiceError('FORBIDDEN',403,'成员主页已取消，请在活动中查看报名昵称');}
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

import { avatarAssetSchema, type AvatarAsset } from '@weevibe/contracts';
/** Only the explicitly public organizer identity projection may call this helper. */
export function validatePublicOrganizerAvatar(value: unknown): AvatarAsset | null {
  if(value==null)return null;
  const parsed=avatarAssetSchema.safeParse(value);
  if(!parsed.success || !parsed.data.base64.startsWith('/9j/'))return null;
  return parsed.data;
}
export function publicAvatarFileName(asset: AvatarAsset): string {
  if(!/^[0-9a-f]{64}$/.test(asset.digest))throw new Error('公开头像摘要无效');
  return `weevibe-public-organizer-${asset.digest}.jpg`;
}

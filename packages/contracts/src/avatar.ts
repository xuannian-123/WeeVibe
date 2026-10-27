import { z } from 'zod';
const base64 = z.string().min(4).max(56000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
export const avatarUploadSchema = z.object({ base64 }).strict();
export const avatarAssetSchema = z.object({ base64, content_type: z.literal('image/jpeg'), digest: z.string().regex(/^[0-9a-f]{64}$/), updated_at: z.iso.datetime() }).strict();
export const avatarResultSchema = z.object({ avatar: avatarAssetSchema.nullable() }).strict();
export type AvatarAsset = z.infer<typeof avatarAssetSchema>;

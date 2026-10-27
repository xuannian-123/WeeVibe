import Taro from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { inboxSchema, memberDirectorySchema, memberProfileSchema, type MemberProfile } from '@weevibe/contracts';
import { getToken } from './api';
import { extensionRequest } from './extension-api';
import { requestAccount } from './account-api';

function assertSession(session: string | undefined) { if (!session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请返回后重新打开', 401); }
export async function requestInbox(session: string | undefined, operation?: { action: 'read-all' } | { action: 'read'; message_id: string }) {
  assertSession(session); const raw = await extensionRequest('/api/v1/messages', operation ? 'POST' : 'GET', operation); assertSession(session);
  const result = inboxSchema.safeParse(raw); if (!result.success) throw new ApiClientError('INVALID_RESPONSE', '消息响应无法验证，与当前版本不匹配，请刷新重试', 200); return result.data;
}
export async function readMemberDirectory(activityId: string, session: string | undefined) {
  assertSession(session); const result = memberDirectorySchema.parse(await extensionRequest(`/api/v1/activities/${activityId}/member-profiles`)); assertSession(session); return result;
}
export async function readMemberProfile(activityId: string, userId: string, session: string | undefined) {
  assertSession(session); const result = memberProfileSchema.parse(await extensionRequest(`/api/v1/activities/${activityId}/member-profiles/${userId}`)); assertSession(session);
  if (result.user_id !== userId) throw new ApiClientError('INVALID_RESPONSE', '成员主页与目标不一致，未展示返回内容', 200); return result;
}
export function cacheProfileImage(asset: NonNullable<MemberProfile['cover_image']>) {
  if (!/^[a-f0-9]{64}$/.test(asset.digest)) throw Error('Invalid image digest');
  const path = `${Taro.env.USER_DATA_PATH}/weevibe-profile-${asset.digest}.jpg`;
  Taro.getFileSystemManager().writeFileSync(path, asset.base64, 'base64'); return path;
}
export async function chooseProfileCover(session: string | undefined) {
  assertSession(session);
  const result = await Taro.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album'] }); assertSession(session);
  const source = result.tempFiles[0]?.tempFilePath; if (!source) throw new ApiClientError('INVALID_INPUT', '没有选择封面图片', 400);
  let base64 = '';
  for (const quality of [55, 30, 15]) {
    const compressed = await Taro.compressImage({ src: source, quality, compressedWidth: 640, compressedHeight: 300 }); assertSession(session);
    base64 = String(Taro.getFileSystemManager().readFileSync(compressed.tempFilePath, 'base64'));
    if (base64.length <= 56000) break;
  }
  if (base64.length > 56000) throw new ApiClientError('INVALID_INPUT', '封面过大，请换一张较小图片', 400);
  assertSession(session); return requestAccount(session, 'PATCH', { action: 'cover', base64 });
}

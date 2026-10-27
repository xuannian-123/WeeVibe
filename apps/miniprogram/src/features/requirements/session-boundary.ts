import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
/** Bind private drafts and actions to the session that opened this editor. */
export function assertRequirementSession(expected: string | undefined): void {
  if (!expected || getToken() !== expected) throw new ApiClientError('UNAUTHENTICATED', '登录账号已变化。请返回并重新打开，原账号的内容不会提交给新账号。', 401);
}

import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, apiErrorSchema } from '@weevibe/contracts';
import { invitationSourceSchema } from '@weevibe/contracts/src/invitations';
import { getToken, transport } from '../../platform/api';

const messages: Record<string, string> = {
  INVALID_INPUT: '邀请入口格式无效，请核对原入口。',
  NOT_FOUND: '未找到这份邀请来源，请向分享者核对入口。',
  ENTRY_UNAVAILABLE: '当前服务无法核验邀请入口，请核对接口部署、请求方式及前后端版本；这不代表邀请已失效。',
  SERVICE_UNAVAILABLE: '邀请来源服务暂不可用，请稍后重试；尚未确认入口是否有效。',
  INVALID_RESPONSE: '邀请来源响应无法验证，尚未打开活动，请重试或核对服务版本。',
  NOT_CONFIGURED: '尚未配置可用的公开邀请接口，请核对客户端服务配置。',
  NETWORK_ERROR: '邀请来源读取未完成，请检查网络后重试。',
  SESSION_CHANGED: '账号已变化，原入口读取已停止，请重新核验。',
  ENTRY_CHANGED: '页面或邀请入口已变化，原读取已停止，请重新核验。',
  NAVIGATION_FAILED: '活动页面打开未确认，请重试；尚未自动登录、保存邀请或报名。'
};

/** Never display a response body, provider error, token or private server message. */
export function sceneEntryErrorText(error: unknown): string {
  return error instanceof ApiClientError ? messages[error.code] ?? messages.INVALID_RESPONSE : messages.NETWORK_ERROR;
}
function failure(code: string, status = 0): ApiClientError {
  return new ApiClientError(code, messages[code] ?? messages.INVALID_RESPONSE, status);
}

/** A public source is provenance, not a login, permission or revision snapshot. */
export async function readSceneInvitation(invitationId: string, sourceSession: string | undefined, assertCanContinue: () => void) {
  const parsedId = activityIdSchema.safeParse(invitationId);
  if (!parsedId.success) throw failure('INVALID_INPUT');
  const assertSession = () => {
    // Guest reads bind to undefined too. An old 401 must never clear a newer token.
    if (getToken() !== sourceSession) throw failure('SESSION_CHANGED', 409);
  };
  const check = () => { assertSession(); assertCanContinue(); assertSession(); };
  try {
    // No await between page/session checks and the actual public GET transport.
    check();
    const response = await transport({ method: 'GET', path: `/api/v1/invitations/${parsedId.data}`, headers: { 'Content-Type': 'application/json' } });
    check();
    if (response.status !== 200) {
      const error = apiErrorSchema.safeParse(response.body);
      if (response.status === 404 && error.success && error.data.error.code === 'NOT_FOUND') throw failure('NOT_FOUND', 404);
      if (response.status === 404 || response.status === 405) throw failure('ENTRY_UNAVAILABLE', response.status);
      if (response.status >= 500) throw failure('SERVICE_UNAVAILABLE', response.status);
      throw failure('INVALID_RESPONSE', response.status);
    }
    const source = invitationSourceSchema.safeParse(response.body);
    if (!source.success || source.data.invitation_id !== parsedId.data) throw failure('INVALID_RESPONSE', 200);
    check();
    // No synthetic source revision: the canonical detail page reads current state.
    // A cancelled public source may still lead to that current cancelled detail.
    return source.data;
  } catch (error) {
    check();
    if (error instanceof ApiClientError) {
      // Cloud HTTP can reject a non-JSON 404 before returning a response object.
      if (error.code === 'INVALID_RESPONSE' && (error.status === 404 || error.status === 405)) throw failure('ENTRY_UNAVAILABLE', error.status);
      if (error.status >= 500 && !['SESSION_CHANGED', 'ENTRY_CHANGED'].includes(error.code)) throw failure('SERVICE_UNAVAILABLE', error.status);
      if (Object.hasOwn(messages, error.code)) throw failure(error.code, error.status);
      throw failure('INVALID_RESPONSE', error.status);
    }
    throw failure('NETWORK_ERROR');
  }
}

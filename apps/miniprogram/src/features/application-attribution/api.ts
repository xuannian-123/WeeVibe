import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, apiErrorSchema, type ActivityDetail } from '@weevibe/contracts';
import { applicationAttributionsSchema, type ApplicationAttributions } from '@weevibe/contracts/src/application-attributions';
import { getToken, transport } from '../../platform/api';

/** Dedicated additive endpoint: old ActivityDetail/application DTOs remain unchanged. */
export async function readApplicationAttributions(detail: ActivityDetail, session: string | undefined, assertCurrent: () => void): Promise<ApplicationAttributions> {
  const id = activityIdSchema.parse(detail.activity_id);
  const actor = activityIdSchema.safeParse(detail.viewer.user_id);
  const check = () => {
    if (!actor.success || !session || getToken() !== session) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人的申请来源。', 401);
    assertCurrent();
  };
  const bound: Transport = async request => {
    check();
    // The last check and transport call are synchronous; do not borrow a newer bearer.
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${session}` } });
    check(); return response;
  };
  try {
    check();
    const identity = await createApiClient(bound, () => session).me();
    check();
    if (!actor.success || activityIdSchema.parse(identity.user_id) !== actor.data) throw new ApiClientError('UNAUTHENTICATED', '当前身份与活动中的身份不一致，请重新读取。', 401);
    const response = await bound({ path: `/api/v1/activities/${id}/application-attributions`, method: 'GET', headers: {} });
    if (response.status < 200 || response.status >= 300) {
      const parsed = apiErrorSchema.safeParse(response.body);
      // Never display a server's arbitrary message or raw response.
      throw new ApiClientError(parsed.success ? parsed.data.error.code : 'INVALID_RESPONSE', '申请来源暂时无法读取。', response.status);
    }
    const parsed = applicationAttributionsSchema.safeParse(response.body);
    if (!parsed.success) throw new Error('invalid attribution response');
    const data = parsed.data;
    if (data.activity_id !== id || data.viewer_user_id !== actor.data || data.is_manager !== detail.viewer.is_manager) throw new Error('mismatched attribution target');
    if (data.revision !== detail.revision) throw new ApiClientError('VERSION_CONFLICT', '活动已更新，请先刷新活动再读取申请来源。', 409);
    const applications = detail.viewer.is_manager ? detail.applications ?? [] : detail.viewer.applications;
    const expected = new Set(applications.map(a => activityIdSchema.parse(a.application_id)));
    if (data.entries.length !== expected.size || data.entries.some(entry => !expected.has(entry.application_id))) throw new Error('mismatched application set');
    check(); return data;
  } catch (error) {
    if (error instanceof ApiClientError) throw new ApiClientError(error.code, '申请来源暂时无法读取，请刷新活动重试。', error.status);
    throw new ApiClientError('INVALID_RESPONSE', '申请来源响应无法验证，未展示未核实的来源。', 200);
  }
}

export function attributionError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 404 || error.status === 405) return '当前后端未提供申请来源接口，或活动入口无法读取。来源尚未核实，不表示没有邀请人；带来源的新申请需匹配版本。';
    if (error.code === 'VERSION_CONFLICT') return '活动已更新，请先刷新活动安排，再重试读取申请来源。';
    if (error.code === 'UNAUTHENTICATED' || error.status === 401) return '会话或身份未获核验，请重新登录并读取本人活动；未显示旧账号的申请来源。';
    if (error.status === 403) return '当前身份暂不能读取这些申请来源，请刷新活动核对权限。';
    if (error.code === 'APPLICATION_ATTRIBUTION_LIMIT_EXCEEDED') return '申请来源超过本片完整读取上限（2000 份申请），暂不可用；未静默截断。';
    if (error.status === 503 || error.code === 'NOT_CONFIGURED') return '申请来源服务暂不可用，请核对后端版本及迁移配置或稍后重试；这不表示没有邀请人。';
  }
  return '申请来源未能完整读取或响应无法核实，请刷新重试；未将未知来源当作没有邀请人。';
}

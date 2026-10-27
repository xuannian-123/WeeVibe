import { Text, View } from '@tarojs/components';
import { activityIdSchema } from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { getToken } from '../../platform/api';
import { requestRequirement } from '../../platform/requirements-api';
import { usePageRead, useLogin } from '../../platform/page-state';
import { Action, Notice } from '../../components/ui';
import { readCreationIdentity } from './api';
import { formFromPreparation } from './preparation-form';
import { OrdinaryEditor } from './index';

export function PreparationEditor({ sourceId }: { sourceId: string }) {
  const parsed = activityIdSchema.safeParse(sourceId);
  const read = usePageRead(async () => {
    if (!parsed.success) throw new ApiClientError('INVALID_INPUT', '筹备入口无效', 400);
    const identity = await readCreationIdentity();
    const snapshot = await requestRequirement(`/api/v1/requirements/${parsed.data}`);
    if (getToken() !== identity.session) throw new ApiClientError('INVALID_RESPONSE', '账号已变化，请重新打开筹备方案', 0);
    return { form: formFromPreparation(snapshot), session: identity.session };
  });
  const login = useLogin(read.refresh);
  if (!read.data || read.data.session !== getToken() || read.error || read.loading) return <View className="screen"><Text>从筹备方案创建活动</Text>
    {read.error && <Notice tone="error">{String(read.error)}</Notice>}
    <Action disabled={read.loading} onClick={() => void read.refresh()}>重新读取方案</Action>
    {!getToken() && <Action onClick={() => void login.login()}>微信登录</Action>}
  </View>;
  return <OrdinaryEditor key={`${sourceId}-${read.data.session}`} initialForm={read.data.form} draftSuffix={`:preparation:${parsed.success ? parsed.data : ''}`} />;
}

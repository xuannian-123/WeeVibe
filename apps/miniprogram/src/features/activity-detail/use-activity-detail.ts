import { useState } from 'react';
import { useRouter, useShareAppMessage } from '@tarojs/taro';
import { activityIdSchema } from '@weego/contracts';
import { api } from '../../platform/api';
import { useLogin, usePageRead } from '../../platform/page-state';
import { rememberActivity } from '../../platform/activities';
import { useApplications } from '../applications/use-applications';

// Lifecycle, login, share metadata and write controllers stay mounted once per page.
export function useActivityDetail() {
  const params = useRouter().params; const parsedId = activityIdSchema.safeParse(params.id);
  const id = parsedId.success ? parsedId.data : '';
  const [showMore, setShowMore] = useState(false);
  const read = usePageRead(async () => { const detail = await api.getActivity(id); rememberActivity(detail.viewer.user_id, detail); return detail; }, !!id, { pollIntervalMs: 20000 });
  const login = useLogin(read.refresh);
  const detail = read.data?.activity_id === id ? read.data : undefined;
  const userId = detail?.viewer.user_id ?? undefined;
  const fresh = !!detail && !read.error && !read.loading;
  const applications = useApplications({ id, detail, fresh, refresh: read.refresh });
  useShareAppMessage(() => ({ title: detail?.name ?? 'Weego 活动', path: id ? `/pages/activity/index?id=${encodeURIComponent(id)}` : '/pages/index/index' }));
  return { id, detail, userId, read, login, applications, showMore, setShowMore };
}

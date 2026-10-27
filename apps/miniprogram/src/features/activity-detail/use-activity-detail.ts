import { useEffect, useState } from 'react';
import safeShareImage from '../../assets/share-safe.png';
import { useRouter, useShareAppMessage } from '@tarojs/taro';
import { activityIdSchema } from '@weevibe/contracts';
import { BRAND_NAME } from '../../brand';
import { getToken } from '../../platform/api';
import { readActivityForSession } from './session-read';
import { useLogin, usePageRead } from '../../platform/page-state';
import { useApplicationAttributions } from '../application-attribution/use-attributions';
import { useApplications } from '../applications/use-applications';

// Lifecycle, login, share metadata and write controllers stay mounted once per page.
export function useActivityDetail() {
  const params = useRouter().params; const parsedId = activityIdSchema.safeParse(params.id);
  const id = parsedId.success ? parsedId.data : '';
  const incoming = activityIdSchema.safeParse(params.invitation_id);
  const incomingInvitationId = incoming.success ? incoming.data : undefined;
  // Malformed supplied provenance must not become a silent no-source application.
  const applicationInvitationId = Object.prototype.hasOwnProperty.call(params, 'invitation_id') ? (typeof params.invitation_id === 'string' ? params.invitation_id : '!invalid') : undefined;
  const [outgoingInvitationId, setOutgoingInvitationId] = useState<string>();
  const [showMore, setShowMore] = useState(false);
  const read = usePageRead(() => readActivityForSession(id), !!id, { pollIntervalMs: 20000 });
  const login = useLogin(read.refresh);
  // A previous account's applications and ETA must never survive a session switch on screen.
  const detail = !login.busy && read.data?.session === getToken() && read.data?.detail.activity_id === id ? read.data.detail : undefined;
  const userId = detail?.viewer.user_id ?? undefined;
  useEffect(() => { setOutgoingInvitationId(undefined); }, [id, userId]);
  const fresh = !!detail && !read.error && !read.loading && !login.busy;
  const attributions = useApplicationAttributions({ detail, session: detail ? read.data?.session : undefined, fresh });
  const applications = useApplications({ id, detail, session: detail ? read.data?.session : undefined, fresh, refresh: read.refresh, incomingInvitationId: applicationInvitationId, attributionAvailable: attributions.available });
  useShareAppMessage(() => ({ imageUrl: safeShareImage, title: detail?.name ?? `${BRAND_NAME} 活动`, path: id ? `/pages/activity/index?id=${encodeURIComponent(id)}${outgoingInvitationId ? `&invitation_id=${encodeURIComponent(outgoingInvitationId)}` : ''}` : '/pages/index/index' }));
  return { id, incomingInvitationId, outgoingInvitationId, setOutgoingInvitationId, detail, userId, read, login, applications, attributions, showMore, setShowMore };
}

import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import type { InvitationSourceView } from '@weevibe/contracts/src/invitations';
import { getToken } from '../../platform/api';
import { readSceneInvitation, sceneEntryErrorText } from './scene-client';

/** A verified public source never grants identity, membership or management. */
export function useInvitationSource(activityId: string, invitationId: string | undefined, session: string | undefined, fresh: boolean) {
  const key = JSON.stringify([activityId, invitationId, session]);
  const latest = useRef({ key, fresh }); latest.current = { key, fresh };
  const epoch = useRef(0), mounted = useRef(true), visible = useRef(true);
  const [retry, setRetry] = useState(0);
  const [stored, setStored] = useState<{ key: string; loading: boolean; data?: InvitationSourceView; error?: string }>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const stop = () => { visible.current = false; epoch.current++; setStored(undefined); };
  useDidHide(stop); useUnload(stop);
  useDidShow(() => { if (!visible.current) { visible.current = true; setRetry(value => value + 1); } });
  useEffect(() => {
    let live = true; const ticket = ++epoch.current;
    if (invitationId === undefined || !fresh || !visible.current || getToken() !== session) return;
    const owned = () => live && mounted.current && visible.current && epoch.current === ticket && latest.current.key === key && latest.current.fresh && getToken() === session;
    const guard = () => { if (!owned()) throw new ApiClientError('ENTRY_CHANGED', '邀请来源已变化', 409); };
    setStored({ key, loading: true });
    void readSceneInvitation(invitationId, session, guard).then(data => {
      guard();
      if (data.activity_id !== activityId) throw new ApiClientError('INVALID_RESPONSE', '邀请不属于当前活动', 409);
      setStored({ key, loading: false, data });
    }).catch(error => { if (owned()) setStored({ key, loading: false, error: sceneEntryErrorText(error) }); });
    return () => { live = false; };
  }, [key, retry, fresh]);
  const current = fresh && visible.current && getToken() === session && stored?.key === key ? stored : undefined;
  return { data: current?.data, error: current?.error, loading: invitationId !== undefined && fresh && (!current || current.loading), retry: () => setRetry(value => value + 1), isCurrent: () => mounted.current && visible.current && latest.current.key === key && getToken() === session, generation: () => epoch.current };
}

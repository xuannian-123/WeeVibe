import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { MemberProfile } from '@weevibe/contracts';
import { readMemberDirectory, readMemberProfile } from '../../platform/navigation-api';
import { getToken } from '../../platform/api';
import { Action, Notice } from '../../components/ui';
import { errorText } from '../../platform/page-state';
import { ProfileCard } from '../shell/profile-card';

export function MemberDirectory({ activityId, session, fresh }: { activityId: string; session?: string; fresh: boolean }) {
  const [members, setMembers] = useState<{ user_id: string; display_name: string | null }[]>(), [selected, setSelected] = useState<MemberProfile>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), lock = useRef(false), source = useRef({ activityId, session, fresh });source.current={activityId,session,fresh};
  useEffect(() => {mounted.current=true;return () => { mounted.current = false; };}, []);
  const valid = () => mounted.current && source.current.fresh && source.current.activityId === activityId && source.current.session === session && session === getToken();
  async function load(userId?: string) {
    if (!valid() || lock.current) return; lock.current = true; setBusy(true); setError('');
    try { if (userId) { const next = await readMemberProfile(activityId, userId, session); if (valid()) setSelected(next); } else { const next = await readMemberDirectory(activityId, session); if (valid()) setMembers(next.members); } }
    catch (e) { if (valid()) setError(errorText(e)); } finally { lock.current = false; if (valid()) setBusy(false); }
  }
  if (!valid()) return null;
  return <View><Action disabled={busy} onClick={() => void load()}>查看成员主页</Action>{error && <Notice tone="error">{error}</Notice>}{members && <View className="wv-member-directory">{members.map(m => <Button disabled={busy} key={m.user_id} onClick={() => void load(m.user_id)}><Text>○　{m.display_name || '未填写报名名'}</Text><Text>查看主页　›</Text></Button>)}</View>}
    {selected && <View className="wv-overlay" onClick={() => setSelected(undefined)}><View className="wv-sheet" onClick={e => e.stopPropagation()}><ProfileCard profile={selected} session={session}/><Action onClick={() => setSelected(undefined)}>关闭主页</Action></View></View>}
  </View>;
}

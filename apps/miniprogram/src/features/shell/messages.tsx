import { CMessagesView } from '../design-c/messages-view';
import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import type { InboxSnapshot } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { requestInbox } from '../../platform/navigation-api';
import { errorText } from '../../platform/page-state';

export function Messages({ value, session, error, refresh, changed, initialPendingOnly=false, filterChanged }: { initialPendingOnly?:boolean; filterChanged?:(value:boolean)=>void; value?: InboxSnapshot; session?: string; error: string; refresh: () => void | Promise<void>; changed: (v: InboxSnapshot) => void }) {
  const [pendingOnly, setPendingOnly] = useState(initialPendingOnly), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [refreshing,setRefreshing]=useState(false);const refreshLock=useRef(false);
  const lock = useRef(false); const source = useRef(session), active = useRef(true), mounted=useRef(true), epoch=useRef(0);
  useEffect(() => { active.current = true; mounted.current=true; return () => { active.current = false; mounted.current=false; epoch.current++; }; }, []);
  useDidHide(() => { active.current = false; epoch.current++; }); useDidShow(() => { active.current = true; });
  const valid = () => active.current && source.current === session && session === getToken();
  const ownState=()=>mounted.current&&source.current===session&&session===getToken();
  function selectFilter(value:boolean){setPendingOnly(value);if(valid())filterChanged?.(value);}
  async function mark(id?: string) {
    if (lock.current || refreshLock.current || !valid() || !session) return; lock.current = true; setBusy(true); setNotice('');
    const ticket=epoch.current, current=()=>valid()&&epoch.current===ticket;
    try {
      const next = await requestInbox(session, id ? { action: 'read', message_id: id } : { action: 'read-all' }); if (!current()) return; changed(next);
      const message = value?.messages.find(m => m.id === id); if (!message) return;
      const url = message.gathering_id ? `/pages/gathering/index?id=${message.gathering_id}` : message.requirement_id ? `/pages/requirements/index?id=${message.requirement_id}` : message.activity_id ? `/pages/activity/index?id=${message.activity_id}&section=${message.section}` : '';
      if (url && current()) await Taro.navigateTo({ url });
    } catch (e) { if (current()) setNotice(errorText(e)); } finally { lock.current = false; if (ownState()) setBusy(false); }
  }
  async function reload(){
    if(refreshLock.current||lock.current||!valid())return;
    refreshLock.current=true;setRefreshing(true);setNotice('');
    const ticket=epoch.current;
    try{await refresh();}catch{if(valid()&&epoch.current===ticket)setNotice('消息刷新未完成，可以稍后重试。');}
    finally{refreshLock.current=false;if(ownState())setRefreshing(false);}
  }
  return <CMessagesView value={value} error={notice || error} busy={busy} refreshing={refreshing} pendingOnly={pendingOnly} filter={selectFilter} read={id=>void mark(id)} refresh={()=>void reload()}/>;
}

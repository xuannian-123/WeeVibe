import { UiIcon } from '../../components/ui-icon';
import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { InboxSnapshot } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { requestInbox } from '../../platform/navigation-api';
import { LoadingCards } from '../../components/loading-cards';
import { Action, Notice } from '../../components/ui';
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
  const messages = value?.messages.filter(m => !pendingOnly || m.pending) ?? [];
  return <View className="wv-messages"><View className="wv-messages-header"><Text className="wv-title">You're in{String.fromCharCode(10)}the loop.</Text><Button className="wv-link" disabled={busy || refreshing || !value || !value.unread_count} onClick={() => void mark()}>全部已读</Button></View>
    <Text className="wv-subtitle">最新动态，随时掌握。</Text><View className="wv-message-tabs"><Button className={!pendingOnly ? 'active' : ''} onClick={() => selectFilter(false)}>全部</Button><Button className={pendingOnly ? 'active' : ''} onClick={() => selectFilter(true)}>待处理{value ? ` ${value.pending_count}` : ''}</Button><Button className="wv-link" disabled={busy||refreshing} onClick={()=>void reload()}><UiIcon name="refresh"/><Text>{refreshing?'刷新中…':'刷新'}</Text></Button></View>
    {(error || notice) && <Notice tone="error">{notice || error}</Notice>}
    {!value&&!error&&!notice&&<LoadingCards label="正在读取消息…"/>}{!value&&(error||notice) && <Text className="wv-muted">消息尚未读取，暂时无法确认本人通知。可点击刷新重试。</Text>}
    {value && !messages.length && <View className="wv-empty"><View className="wv-empty-icon"><UiIcon name="inbox"/></View><Text className="wv-section-title">{pendingOnly ? '当前没有待处理事项' : '暂时没有消息'}</Text>{pendingOnly && <Action onClick={() => selectFilter(false)}>查看全部消息</Action>}</View>}
    {messages.map(m => <Button className="wv-message-card" key={m.id} disabled={busy||refreshing} onClick={() => void mark(m.id)}><View className="wv-message-head"><Text className="wv-message-title">{!m.read && <Text className="wv-unread-dot">● </Text>}{m.title}</Text><Text className="wv-message-time">{new Date(m.created_at).toLocaleDateString('zh-CN')}</Text></View><Text className="wv-message-summary">{m.summary}</Text><View className="wv-message-footer"><Text className={m.pending ? 'pending' : ''}>{m.status}</Text><Text>›</Text></View></Button>)}
    {!!value?.messages.length && <Text className="wv-list-note">阅读状态与处理进度分别记录，全部已读不会代替审批或确认。</Text>}
  </View>;
}

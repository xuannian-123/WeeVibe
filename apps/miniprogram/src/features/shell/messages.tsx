import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow } from '@tarojs/taro';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import type { InboxSnapshot } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { requestInbox } from '../../platform/navigation-api';
import { Action, Notice } from '../../components/ui';
import { errorText } from '../../platform/page-state';

export function Messages({ value, session, error, refresh, changed }: { value?: InboxSnapshot; session?: string; error: string; refresh: () => void; changed: (v: InboxSnapshot) => void }) {
  const [pendingOnly, setPendingOnly] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const lock = useRef(false); const source = useRef(session), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useDidHide(() => { active.current = false; }); useDidShow(() => { active.current = true; });
  const valid = () => active.current && source.current === session && session === getToken();
  async function mark(id?: string) {
    if (lock.current || !valid() || !session) return; lock.current = true; setBusy(true); setNotice('');
    try {
      const next = await requestInbox(session, id ? { action: 'read', message_id: id } : { action: 'read-all' }); if (!valid()) return; changed(next);
      const message = value?.messages.find(m => m.id === id); if (!message) return;
      const url = message.requirement_id ? `/pages/requirements/index?id=${message.requirement_id}` : message.activity_id ? `/pages/activity/index?id=${message.activity_id}&section=${message.section}` : '';
      if (url && valid()) await Taro.navigateTo({ url });
    } catch (e) { if (valid()) setNotice(errorText(e)); } finally { lock.current = false; if (valid()) setBusy(false); }
  }
  const messages = value?.messages.filter(m => !pendingOnly || m.pending) ?? [];
  return <View className="wv-messages"><View className="wv-messages-header"><Text className="wv-title">消息</Text><Button className="wv-link" disabled={busy || !value || !value.unread_count} onClick={() => void mark()}>全部已读</Button></View>
    <Text className="wv-subtitle">每一次变化，都有回应。</Text><View className="wv-message-tabs"><Button className={!pendingOnly ? 'active' : ''} onClick={() => setPendingOnly(false)}>全部</Button><Button className={pendingOnly ? 'active' : ''} onClick={() => setPendingOnly(true)}>待处理{value ? ` ${value.pending_count}` : ''}</Button><Button className="wv-link" disabled={busy} onClick={refresh}>刷新</Button></View>
    {(error || notice) && <Notice tone="error">{notice || error}</Notice>}
    {!value && <Text className="wv-muted">消息尚未读取，暂时无法确认本人通知。可点击刷新重试。</Text>}
    {value && !messages.length && <View className="wv-empty"><Text className="wv-empty-icon">▱</Text><Text className="wv-section-title">{pendingOnly ? '当前没有待处理事项' : '暂时没有消息'}</Text>{pendingOnly && <Action onClick={() => setPendingOnly(false)}>查看全部消息</Action>}</View>}
    {messages.map(m => <Button className="wv-message-card" key={m.id} disabled={busy} onClick={() => void mark(m.id)}><View className="wv-message-head"><Text className="wv-message-title">{!m.read && <Text className="wv-unread-dot">● </Text>}{m.title}</Text><Text className="wv-message-time">{new Date(m.created_at).toLocaleDateString('zh-CN')}</Text></View><Text className="wv-message-summary">{m.summary}</Text><View className="wv-message-footer"><Text className={m.pending ? 'pending' : ''}>{m.status}</Text><Text>›</Text></View></Button>)}
    {!!value?.messages.length && <Text className="wv-list-note">阅读状态与处理进度分别记录，已读后待办仍会保留。</Text>}
  </View>;
}

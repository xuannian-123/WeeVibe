import { Button, Text, View } from '@tarojs/components';
import type { InboxSnapshot } from '@weevibe/contracts';
import { CIcon } from './chrome';
import { CAction, CHero, CNotice, CPageHeading } from './ui';
import type { CIconName } from './icons';

type Props = { value?: InboxSnapshot; error: string; busy: boolean; refreshing: boolean; pendingOnly: boolean; filter: (pending: boolean) => void; read: (id?: string) => void; refresh: () => void };
function eventIcon(section: string): CIconName { return section === 'applications' ? 'user' : section === 'arrangement' ? 'calendar' : section === 'handover' ? 'handover' : (section === 'requirement' || section === 'gathering') ? 'doc' : 'check'; }
export function CMessagesView({ value, error, busy, refreshing, pendingOnly, filter, read, refresh }: Props) {
  const list = value?.messages.filter(message => !pendingOnly || message.pending) ?? [];
  return <View className="c-ui c-messages"><CPageHeading title="消息"><Button className="c-header-refresh" disabled={busy || refreshing} ariaLabel="刷新消息" onClick={refresh}><CIcon name="refresh" /><Text className="c-sr-only">{refreshing ? '刷新中…' : '刷新'}</Text></Button></CPageHeading><CHero kind="messages" /><Text className="c-hero-translation">最新动态，随时掌握。</Text>
    <View className="c-message-controls"><Button className={!pendingOnly ? 'c-selected' : ''} onClick={() => filter(false)}>全部</Button><Button className={pendingOnly ? 'c-selected' : ''} onClick={() => filter(true)}>待处理</Button><Button className="c-read-all" disabled={busy || refreshing || !value?.unread_count} onClick={() => read()}>全部已读</Button></View>
    {error && <CNotice>{error}</CNotice>}{!value && <View className="c-state-empty"><Text>{error ? '消息尚未读取' : '正在读取消息…'}</Text>{error && <><Text className="c-hint">暂时无法确认本人通知，不代表没有消息。</Text><CAction onClick={refresh}>重试</CAction></>}</View>}
    {value && !list.length && <View className="c-state-empty"><Text>{pendingOnly ? '当前没有待处理事项' : '暂时没有消息'}</Text>{pendingOnly && <CAction variant="text" onClick={() => filter(false)}>查看全部消息</CAction>}</View>}
    {list.map(message => <Button key={message.id} className="c-message-row" disabled={busy || refreshing} onClick={() => read(message.id)}><View className={`c-event-icon c-event-${message.section}`}><CIcon name={eventIcon(message.section)} />{!message.read && <View className="c-unread-dot" />}</View><View className="c-message-copy"><View className="c-message-title"><Text>{message.title}</Text><Text className="c-message-time">{new Date(message.created_at).toLocaleDateString('zh-CN')}</Text></View><View className="c-message-detail"><Text>{message.summary}</Text><Text className={`c-message-pill ${message.pending ? 'c-message-pending' : ''}`}>{message.status}</Text></View></View><CIcon name="right" /></Button>)}
    {!!value?.messages.length && <Text className="c-quiet-note">已读不会完成审批或确认。</Text>}
  </View>;
}

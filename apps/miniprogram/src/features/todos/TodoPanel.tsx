import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { Text, View } from '@tarojs/components';
import type { TodoActivity, TodoItem, TodoPage } from '@weevibe/contracts';
import { Action, Notice } from '../../components/ui';
import { getToken } from '../../platform/api';
import { mergeTodoActivities, readTodoPage, todoError, type TodoIdentity } from './api';

type Feed = { sourceKey: string; page: TodoPage; activities: TodoActivity[]; pages: number; cursors: string[] };
function itemText(item: TodoItem): string {
  switch (item.kind) {
    case 'applications': return `待处理申请：${item.application_count} 份（不代表当前仍可批准）`;
    case 'missing': return `开始前缺人：${item.segment_count} 个环节共缺 ${item.missing_seat_count} 席；其中 ${item.closed_segment_count} 段已截止，仅供查看。占位统计包含保留席位。`;
    case 'review': return item.role === 'self' ? `本人 ${item.segment_count} 个环节待查看安排变更；是否能接受以可信版本历史为准。` : `成员待审阅：${item.participant_segment_count} 人次，涉及 ${item.segment_count} 个环节（不是去重人数，不能代接受）。`;
    case 'handover': return item.role === 'manager' ? '等待交接回应：1 份；可执行动作请到详情核对。' : '待回应交接邀请：1 份；不代表仍符合接任资格，拒绝等动作以详情为准。';
  }
}
export function TodoPanel({ identity }: { identity?: TodoIdentity }) {
  const sourceKey = identity ? `${identity.actor_id}:${identity.session}` : '';
  const latest = useRef({ identity, sourceKey }); latest.current = { identity, sourceKey };
  const active = useRef(true), mounted = useRef(true), epoch = useRef(0), lock = useRef<number>();
  const feedRef = useRef<Feed>(); const [stored, setStored] = useState<Feed>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const authenticated = !!identity?.session && identity.session === getToken();
  const feed = authenticated && stored?.sourceKey === sourceKey ? stored : undefined;
  function clear() { feedRef.current = undefined; setStored(undefined); }
  function invalidate() { epoch.current++; lock.current = undefined; clear(); setBusy(false); setError(''); }
  function stop() { active.current = false; invalidate(); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; lock.current = undefined; feedRef.current = undefined; }; }, []);
  const loadRef = useRef<(first: boolean) => Promise<void>>(async () => {});
  useEffect(() => { invalidate(); if (active.current && identity) void loadRef.current(true); }, [sourceKey]);
  useDidHide(stop); useUnload(stop); useDidShow(() => { active.current = true; void loadRef.current(true); });
  async function load(first: boolean) {
    const context = latest.current, owner = context.identity;
    if (!owner || getToken() !== owner.session || !mounted.current || !active.current || lock.current !== undefined) return;
    const previous = first ? undefined : feedRef.current;
    if (!first && (!previous || previous.sourceKey !== context.sourceKey || !previous.page.page.has_more)) return;
    const ticket = ++epoch.current; lock.current = ticket; setBusy(true); setError(''); if (first) clear();
    const guard = () => {
      if (!mounted.current || !active.current || epoch.current !== ticket || latest.current.sourceKey !== context.sourceKey || getToken() !== owner.session) throw new ApiClientError('INVALID_RESPONSE', '待办页面或身份已变化。', 0);
    };
    try {
      const page = await readTodoPage(owner, guard, previous?.page); guard();
      const seen = previous?.cursors ?? [];
      if (page.page.next_cursor && seen.includes(page.page.next_cursor)) throw new ApiClientError('INVALID_RESPONSE', '待办游标重复，请重新读取。', 200);
      const next: Feed = { sourceKey: context.sourceKey, page, activities: mergeTodoActivities(previous?.activities ?? [], page.activities), pages: (previous?.pages ?? 0) + 1,
        cursors: [...seen, ...(page.page.next_cursor ? [page.page.next_cursor] : [])] };
      guard(); feedRef.current = next; setStored(next);
    } catch (reason) {
      if (mounted.current && active.current && epoch.current === ticket && latest.current.sourceKey === context.sourceKey && getToken() === owner.session) {
        if (reason instanceof ApiClientError && reason.code === 'TODOS_SNAPSHOT_CHANGED') clear();
        setError(todoError(reason));
      }
    } finally { if (mounted.current && lock.current === ticket) { lock.current = undefined; setBusy(false); } }
  }
  loadRef.current = load;
  function open(activity: TodoActivity) {
    if (!feed || !authenticated || busy || !active.current || !mounted.current || latest.current.sourceKey !== feed.sourceKey || feedRef.current !== feed) return;
    // The strict DTO binds this path to the UUID. Opening details grants no write permission.
    void Taro.navigateTo({ url: activity.path }).catch(() => { if (mounted.current && active.current && getToken() === identity?.session) setError('详情页面暂时无法打开，请重试；没有提交任何处理动作。'); });
  }
  return <View className="wv-todos">
    <View className="wv-section-heading"><Text className="wv-section-title">活动待办</Text><Action disabled={busy || !authenticated} onClick={() => { void load(true); }}>刷新待办（第一页）</Action></View>
    <Text className="wv-muted">仅查看待处理申请、开始前缺人、安排审阅和交接。点击只进真实详情重新核对权限，不自动处理或标记消息已读。</Text>
    {!authenticated ? <Notice>待办身份尚未确认，请先登录或刷新本人身份。</Notice> : <View>
      {busy && <Notice>正在读取待办候选活动…</Notice>}
      {error && <Notice tone="error">{error}{feed ? ' 当前卡片仅是此前已读取的快照，不代表已完整更新。' : ''}</Notice>}
      {!busy && !error && !feed && <Notice>待办数据尚未读取，不代表没有待办。</Notice>}
      {feed && <View>
        <Text className="wv-muted">已读取 {feed.pages} 页；每页最多 50 个授权候选活动，不是 50 条待办。此处不提供跨全部页面的待办总数。</Text>
        {feed.activities.map(activity => <View className="wv-card wv-todo-card" key={activity.activity_id}>
          <Text className="wv-card-title">{activity.title}</Text>
          {activity.items.map(item => <Text className="wv-muted" key={`${item.kind}:${item.role}`}>{itemText(item)}</Text>)}
          <Action disabled={busy} onClick={() => open(activity)}>查看此活动详情</Action>
        </View>)}
        {!feed.page.activities.length && feed.page.page.has_more && <Notice>本页未发现待办，仍有候选活动，请继续查看；不能据此判定全部为空。</Notice>}
        {!feed.activities.length && !feed.page.page.has_more && !error && <Notice>本次已读取快照范围暂无这四类待办；新变化需再次刷新。</Notice>}
        {!!feed.activities.length && !feed.page.page.has_more && !error && <Text className="wv-muted">本次快照已读取到末页；实际处理状态以详情重新读取为准。</Text>}
        {feed.page.page.has_more && <Action disabled={busy} onClick={() => { void load(false); }}>继续读取下一页候选活动</Action>}
      </View>}
    </View>}
  </View>;
}

import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, usePageScroll } from '@tarojs/taro';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import type { GatheringSummary } from '@weevibe/contracts';
import type { AccountSnapshot } from '../../platform/account-api';
import { formatActivityTime } from '../shell/activity-time';
import { CActivityCard, type CFeedItem } from './home';
import { CIcon } from './chrome';
import { getToken } from '../../platform/api';
import './activity-overview.css';

type ActivityGroup = 'managed' | 'joined';
type GroupBrowse = { filter: string; scroll: number };
export type CActivityBrowseState = { session?: string; group: ActivityGroup; groups: Record<ActivityGroup, GroupBrowse> };
type Props = { session?: string; initialBrowse?: CActivityBrowseState; browseChanged?: (state: CActivityBrowseState) => void; account: AccountSnapshot; initialGroup: 'all' | 'managing' | 'joined'; preparations: GatheringSummary[]; busy: boolean; error: string; refresh: () => void; openActivity: (id: string) => void; openPreparation: (id: string) => void; back: () => void; more: () => void };
const groupFilters = { managed: ['全部', '筹备中', '未开始', '已结束', '已取消'], joined: ['全部', '筹备中', '已加入', '待审批', '退出记录'] };
function startingBrowse({ initialGroup, initialBrowse, session }: Props): CActivityBrowseState {
  const saved = initialBrowse?.session === session ? initialBrowse : undefined;
  const clean = (group: ActivityGroup): GroupBrowse => ({ filter: groupFilters[group].includes(saved?.groups[group]?.filter || '') ? saved!.groups[group].filter : '全部', scroll: Number.isFinite(saved?.groups[group]?.scroll) ? Math.max(0, saved!.groups[group].scroll) : 0 });
  return { session, group: saved?.group === 'managed' || saved?.group === 'joined' ? saved.group : initialGroup === 'joined' ? 'joined' : 'managed', groups: { managed: clean('managed'), joined: clean('joined') } };
}

export function CActivityOverview(props: Props) { return <ActivityBrowser key={props.session ?? 'guest'} {...props} />; }

function ActivityBrowser(props: Props) {
  const { account, preparations, busy, error, refresh, openActivity, openPreparation, back, more, session } = props;
  const [browse, setBrowse] = useState(() => startingBrowse(props));
  const state = useRef(browse), mounted = useRef(true), visible = useRef(true), restoring = useRef(true), epoch = useRef(0), callbacks = useRef(props.browseChanged);
  callbacks.current = props.browseChanged;
  const valid = () => mounted.current && visible.current && (session === undefined || session === getToken());
  const publish = () => { if (valid()) callbacks.current?.({ ...state.current, groups: { managed: { ...state.current.groups.managed }, joined: { ...state.current.groups.joined } } }); };
  function restore() {
    const ticket = ++epoch.current; restoring.current = true;
    const current = () => valid() && epoch.current === ticket;
    const tick = (run: () => void) => typeof Taro.nextTick === 'function' ? Taro.nextTick(run) : run();
    tick(() => {
      if (!current()) return;
      if (typeof Taro.pageScrollTo !== 'function') { restoring.current = false; return; }
      void Promise.resolve(Taro.pageScrollTo({ scrollTop: state.current.groups[state.current.group].scroll, duration: 0 })).catch(() => {}).finally(() => tick(() => { if (current()) restoring.current = false; }));
    });
  }
  useEffect(() => { mounted.current = true; restore(); publish(); return () => { mounted.current = false; epoch.current++; }; }, []);
  useEffect(() => { restore(); }, [browse.group, browse.groups[browse.group].filter]);
  useDidHide(() => { visible.current = false; epoch.current++; restoring.current = true; });
  useDidShow(() => { visible.current = true; restore(); });
  usePageScroll(event => {
    if (!valid() || restoring.current) return;
    const value = Number.isFinite(event.scrollTop) ? Math.max(0, event.scrollTop) : 0;
    const current = state.current;
    state.current = { ...current, groups: { ...current.groups, [current.group]: { ...current.groups[current.group], scroll: value } } };
    publish();
  });
  function changeGroup(group: ActivityGroup) {
    if (!valid() || state.current.group === group) return;
    publish(); restoring.current = true;
    const next = { ...state.current, group }; state.current = next; setBrowse(next); publish();
  }
  function changeFilter(filter: string) {
    const current = state.current;
    if (!valid() || current.groups[current.group].filter === filter) return;
    restoring.current = true;
    const next = { ...current, groups: { ...current.groups, [current.group]: { filter, scroll: 0 } } }; state.current = next; setBrowse(next); publish();
  }
  const leave = (action: () => void) => { if (valid()) { publish(); action(); } };
  const group = browse.group, filter = browse.groups[group].filter, filters = groupFilters[group];
  const formal = (account.activity_records ?? []).filter(r => group === 'managed' ? r.is_manager : r.joined_segment_count > 0 || r.pending_application_count > 0 || r.exited_segment_count > 0).filter(r => {
    if (filter === '全部') return true;
    if (filter === '筹备中') return false;
    if (filter === '未开始') return !r.cancelled && !r.participation_cancelled && r.phase === 'upcoming';
    if (filter === '已结束') return !r.cancelled && !r.participation_cancelled && r.phase === 'ended';
    if (filter === '已取消') return r.cancelled || r.participation_cancelled;
    if (filter === '已加入') return r.joined_segment_count > 0;
    if (filter === '待审批') return r.pending_application_count > 0;
    if (filter === '退出记录') return r.exited_segment_count > 0;
    return false;
  });
  const preparatory = preparations.filter(r => group === 'managed' ? r.is_owner : r.has_responded).filter(() => filter === '全部' || filter === '筹备中');
  const items: CFeedItem[] = [...preparatory.map(record => ({ key: `preparation:${record.id}`, kind: 'preparation' as const, record })), ...formal.map(record => ({ key: `activity:${record.activity_id}`, kind: 'activity' as const, record }))];
  const unique = [...new Map(items.map(item => [item.key, item])).values()];
  return <View className="c-home c-activity-overview">
    <View className="c-activity-sticky"><View className="c-subheader"><Button ariaLabel="返回" onClick={() => leave(back)}><CIcon name="back" /></Button><Text>我的活动</Text><Button className="c-link" onClick={() => leave(more)}>更多 ⋯</Button></View>
    <View className="c-activity-tabs">{(['managed', 'joined'] as const).map(value => <Button key={value} className={value === group ? 'c-selected' : ''} onClick={() => changeGroup(value)}>{value === 'managed' ? '我组织的' : '我参与的'}</Button>)}</View>
    <ScrollView className="c-activity-filters" scrollX showScrollbar={false}><View className="c-activity-filter-row">{filters.map(value => <Button key={value} className={filter === value ? 'c-selected' : ''} onClick={() => changeFilter(value)}>{value}</Button>)}</View></ScrollView></View>
    {busy && <Text className="c-small-status">正在读取筹备…</Text>}
    {error && <View className="c-inline-status"><Text>筹备读取失败：{error}</Text><Button className="c-link" onClick={refresh}>重试 →</Button></View>}
    {unique.map(item => <CActivityCard key={item.key} item={item} openActivity={id => leave(() => openActivity(id))} openPreparation={id => leave(() => openPreparation(id))} />)}
    {account.activity_records === undefined && <View><Text className="c-small-status">当前服务仅提供已参加列表，管理、申请与退出记录暂时无法核对。</Text>{account.activities.map(record => <Button key={record.activity_id} className="c-activity-card" onClick={() => leave(() => openActivity(record.activity_id))}><Text className="c-activity-title">{record.title}</Text><Text className="c-meta">{formatActivityTime(record.starts_at, record.timezone)}</Text><Text className="c-meta">{record.location || '地点待定'}</Text></Button>)}</View>}
    {!unique.length && account.activity_records !== undefined && !busy && !error && <Text className="c-empty-inline">此分类暂无活动记录</Text>}
  </View>;
}

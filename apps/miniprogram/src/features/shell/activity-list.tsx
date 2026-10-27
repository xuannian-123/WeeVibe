import { useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { AccountActivityRecord } from '@weevibe/contracts';
import { formatActivityTime } from './activity-time';
import './activity-list.css';

export type ActivityFilter = 'all' | 'managing' | 'joined' | 'pending' | 'exited';
const filters: { id: ActivityFilter; label: string }[] = [
  { id: 'all', label: '全部' }, { id: 'managing', label: '我在管理' }, { id: 'joined', label: '已参加' },
  { id: 'pending', label: '待审批' }, { id: 'exited', label: '退出记录' }
];
export function matchesActivityFilter(record: AccountActivityRecord, filter: ActivityFilter) {
  return filter === 'all' || (filter === 'managing' ? record.is_manager : filter === 'joined' ? record.joined_segment_count > 0 : filter === 'pending' ? record.pending_application_count > 0 : record.exited_segment_count > 0);
}
export function activityPhaseLabel(record: AccountActivityRecord) {
  if (record.cancelled || record.participation_cancelled) return '已取消';
  return record.phase === 'upcoming' ? record.joined_segment_count > 0 ? '待参加' : '未开始' : record.phase === 'ongoing' ? '活动中' : record.phase === 'ended' ? '已结束' : '时间待定';
}
export function AccountActivityList({ records, onOpen, initialFilter = 'all' }: { records: AccountActivityRecord[]; onOpen: (id: string) => void; initialFilter?: ActivityFilter }) {
  const [filter, setFilter] = useState<ActivityFilter>(initialFilter);
  const unique = [...new Map(records.map(record => [record.activity_id, record])).values()];
  const visible = unique.filter(record => matchesActivityFilter(record, filter));
  return <View>
    <View className="wv-activity-filters">{filters.map(item => <Button key={item.id} className={filter === item.id ? 'selected' : ''} onClick={() => setFilter(item.id)}>{item.label}</Button>)}</View>
    <Text className="wv-muted">管理、申请和退出记录不代表已获席位；活动时间与本人关系分别显示。最多显示最近创建的 100 条相关活动。</Text>
    {!visible.length && <View className="wv-empty compact"><Text className="wv-muted">此分类暂无本人活动记录</Text></View>}
    {visible.map((record, index) => <View key={record.activity_id} className={`wv-card activity-card ${index % 2 ? 'lilac' : 'peach'}`} onClick={() => onOpen(record.activity_id)}>
      <View className="wv-card-top"><Text className="wv-card-title">{record.title}</Text><Text className="wv-status">{activityPhaseLabel(record)}</Text></View>
      <View className="wv-activity-relations">
        {record.is_manager && <Text>我在管理</Text>}
        {record.joined_segment_count > 0 && <Text>已参加 {record.joined_segment_count} 个环节</Text>}
        {record.pending_application_count > 0 && <Text>申请待审批 · 不占席位</Text>}
        {record.exited_segment_count > 0 && <Text>{record.joined_segment_count > 0 ? '部分环节已退出' : '已退出'}</Text>}
      </View>
      <Text className="wv-muted">{record.time_scope === 'participation' ? '本人参加环节' : '活动整体'}：{formatActivityTime(record.starts_at, record.timezone)}</Text>
      <Text className="wv-muted">{record.location || '地点待定'}</Text>
      {record.cancelled && <Text className="wv-warning">活动已取消，请查看详情；不代表正常结束或已参加。</Text>}
      {!record.cancelled && record.participation_cancelled && <Text className="wv-warning">本人参加环节已取消，其他环节请查看活动详情。</Text>}
      {record.awaiting_acceptance && !record.cancelled && <Text className="wv-warning">安排有变更，需要重新确认</Text>}
      <View className="wv-card-footer"><Text>查看活动安排</Text><Text className="wv-arrow">›</Text></View>
    </View>)}
  </View>;
}

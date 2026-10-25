import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import { feeText, formatTime } from '../../platform/activities';

export function Itinerary({ detail }: { detail: ActivityDetail }) {
  return <>{detail && <View className="activity-section-heading"><Text>这次的行程</Text><Text className="caption">时间均为北京时间</Text></View>}
    {detail?.segments.map((segment, index) => <View className="activity-itinerary" key={segment.segment_id}>
      <View className="activity-itinerary-head"><Text className="activity-step">{String(index + 1).padStart(2, '0')}</Text><Text className="activity-segment-title">{segment.name}</Text>{segment.segment_id === detail.main_segment_id && <Text className="activity-badge">主环节</Text>}</View>
      <Text className="activity-time">{formatTime(segment.starts_at)} — {formatTime(segment.ends_at)}</Text>
      <Text className="activity-place">{segment.location.name}</Text>
      {!!segment.location.address && <Text className="activity-address">{segment.location.address}</Text>}
      <View className="activity-facts"><View><Text className="activity-fact-label">参加人数</Text><Text className="activity-fact-value">{segment.counts.occupied_count} / {segment.capacity}人</Text><Text className="activity-fact-note">{segment.counts.meets_minimum ? '已达最低人数' : `至少${segment.minimum_participants}人`} · {segment.counts.is_full ? '已满员' : `余${segment.counts.remaining_capacity}位`}</Text></View><View><Text className="activity-fact-label">参考费用</Text><Text className="activity-fact-value">{feeText(segment.fee)}</Text></View></View>
      {segment.counts.pending_acceptance_count > 0 && <Text className="activity-warning">{segment.counts.pending_acceptance_count}人待接受新安排，席位保留</Text>}
      <View className="activity-segment-footer"><Text>{segment.cancelled_at ? '本环节已取消' : segment.has_started ? '已开始 · 停止加入' : segment.is_join_open ? `报名截止 ${formatTime(segment.deadline_at)}` : '已截止或暂不开放加入'}</Text><Text>{segment.verification_status === 'manual_checked' ? '人工已核实' : '地点未核实'} · {segment.booking_status === 'manual_booked' ? '人工标记已预订' : '预订未确认'}</Text></View>
      {!!segment.requirements && <Text className="activity-requirements">参加要求：{segment.requirements}</Text>}
    </View>)}</>;
}

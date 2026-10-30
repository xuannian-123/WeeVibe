import { Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import './activity-arrangement.css';

type Segment = ActivityDetail['segments'][number];
function date(value: string, timeOnly = false) {
  const d = new Date(Date.parse(value) + 8 * 3600000);
  if (!Number.isFinite(d.getTime())) return '时间待确认';
  const iso = d.toISOString();
  return timeOnly ? iso.slice(11, 16) : `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${iso.slice(11, 16)}`;
}
function cost(fee: Segment['fee']) {
  if (fee.kind === 'unknown' || fee.amount_cents === null) return '费用待确认';
  const unit = { per_person: ' / 人', total: ' · 总额', per_hour: ' / 小时' }[fee.kind];
  return `¥${(fee.amount_cents / 100).toFixed(2)}${unit}`;
}
/** New C presentation; consumes the existing snapshot, with no legacy itinerary UI. */
export function ActivityArrangement({ detail }: { detail: ActivityDetail }) {
  return <View className="ia-arrangement">
    <View className="ia-heading"><Text>完整安排</Text><Text>北京时间 · UTC+8</Text></View>
    {detail.segments.map((s, index) => {
      const cancelled = !!detail.cancelled_at || !!s.cancelled_at;
      const main = s.segment_id === detail.main_segment_id;
      return <View className={`ia-card ${main ? 'ia-main' : 'ia-extra'} ${cancelled ? 'ia-cancelled' : ''}`} key={s.segment_id}>
        <View className="ia-card-heading"><Text className="ia-name">{String(index + 1).padStart(2, '0')} · {s.name}</Text>{main && <Text className="ia-badge">主环节</Text>}{cancelled && <Text className="ia-badge">已取消</Text>}</View>
        <View className="ia-card-body">
          <View className="ia-row"><Text className="ia-label">时间</Text><View className="ia-value"><Text>{date(s.starts_at)}—{date(s.ends_at, s.starts_at.slice(0,10) === s.ends_at.slice(0,10))}</Text></View></View>
          <View className="ia-row"><Text className="ia-label">地点</Text><View className="ia-value"><Text>{s.location.name}</Text>{s.location.address && <Text className="ia-note">{s.location.address}</Text>}</View></View>
          <View className="ia-row"><Text className="ia-label">{cancelled ? '原人数' : '人数'}</Text><View className="ia-value"><Text>{s.counts.occupied_count} / {s.capacity} 人</Text><Text className="ia-note">{cancelled ? '历史参加记录，不代表当前有效席位' : `${s.counts.meets_minimum ? '已达最低人数' : `至少 ${s.minimum_participants} 人`} · ${s.counts.is_full ? '已满员' : `余 ${s.counts.remaining_capacity} 位`}`}</Text></View></View>
          <View className="ia-row"><Text className="ia-label">{cancelled ? '原费用' : '费用'}</Text><View className="ia-value"><Text className="ia-cost">{cost(s.fee)}</Text><Text className="ia-note">{s.fee.kind === 'unknown' ? '尚未确认费用，不代表免费' : '参考费用，非已付款'}{s.fee.note ? `；${s.fee.note}` : ''}</Text></View></View>
          <View className="ia-row"><Text className="ia-label">报名</Text><View className="ia-value"><Text>{cancelled ? '已取消，不开放加入' : s.has_started ? '已开始，停止加入' : s.is_join_open ? `截止 ${date(s.deadline_at)}` : '已截止或暂不开放加入'}</Text></View></View>
          <View className="ia-row"><Text className="ia-label">核实</Text><View className="ia-value"><Text>{s.verification_status === 'manual_checked' ? '人工已核实' : '地点未核实'} · {s.booking_status === 'manual_booked' ? '人工标记已预订' : '预订未确认'}</Text>{cancelled && <Text className="ia-note">原安排记录，未自动退订或退款</Text>}</View></View>
          {s.requirements && <View className="ia-row"><Text className="ia-label">要求</Text><View className="ia-value"><Text>{s.requirements}</Text></View></View>}
          {!cancelled && s.counts.pending_acceptance_count > 0 && <View className="ia-status"><Text>{s.counts.pending_acceptance_count} 人待接受新安排，席位保留</Text></View>}
        </View>
      </View>;
    })}
  </View>;
}

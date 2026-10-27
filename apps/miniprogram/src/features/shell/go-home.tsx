import { Button, Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import type { AccountSnapshot } from '../../platform/account-api';
import { activityPhaseLabel } from './activity-list';
import { formatActivityTime } from './activity-time';

export function GoHome({ account, empty, friend, team, all, ideas, open }: { account?: AccountSnapshot; empty: ReactNode; friend: () => void; team: () => void; all: () => void; ideas: () => void; open: (id: string) => void }) {
  const records = account?.activity_records ?? [];
  const active = records.filter(r => !r.cancelled && !r.participation_cancelled && r.phase !== 'ended' && (r.is_manager || r.joined_segment_count || r.pending_application_count));
  const recent = (active.length ? active : records).slice(0, 2);
  return <View className="wv-go-home"><View className="wv-home-intro"><Text className="wv-eyebrow">GOOD TIMES, TOGETHER</Text><Text className="wv-title">下一站，{String.fromCharCode(10)}和朋友一起。</Text><Text className="wv-subtitle">把想见的人，约进下一段好时光。</Text><Text className="wv-home-spark">✧</Text></View>
    <View className="wv-home-paths"><Button className="wv-home-path peach" onClick={friend}><Text className="wv-home-path-icon">♧</Text><Text className="wv-card-title">朋友出游</Text><Text className="wv-muted">周末小聚，或一起去远一点</Text><Text className="wv-path-arrow">↗</Text></Button><Button className="wv-home-path mint" onClick={team}><Text className="wv-home-path-icon">♧</Text><Text className="wv-card-title">一起团建</Text><Text className="wv-muted">收集大家的想法，一起定安排</Text><Text className="wv-path-arrow">↗</Text></Button></View>
    <View className="wv-home-ai-inline"><Text>AI</Text><Text>只有一个想法？AI 可以帮你起草安排。</Text></View>
    <View className="wv-section-heading"><Text className="wv-section-title">近期活动</Text><Button className="wv-link" onClick={all}>查看全部　›</Button></View>
    {!account ? empty : recent.length ? recent.map(r => <Button className="wv-recent-activity activity-card" key={r.activity_id} onClick={() => open(r.activity_id)}><View className="wv-card-top"><Text className="wv-card-title">{r.title}</Text><Text className="wv-status">{activityPhaseLabel(r)}</Text></View><Text className="wv-muted">◷　{formatActivityTime(r.starts_at, r.timezone)}</Text><Text className="wv-muted">⌖　{r.location || '地点待定'}</Text><View className="wv-card-footer"><Text>{r.awaiting_acceptance ? '安排有变化，等待你确认' : r.joined_segment_count ? `已参加 ${r.joined_segment_count} 个环节` : r.pending_application_count ? '申请已提交，尚未占位' : r.is_manager ? '我在管理' : '查看本人活动记录'}</Text><Text>↗</Text></View></Button>) : account.activity_records === undefined && account.activities.length ? <View><Text className="wv-warning">当前后端仅提供已参加列表，不能视为完整列表。</Text>{account.activities.slice(0,2).map(r=><Button className="wv-recent-activity activity-card" key={r.activity_id} onClick={()=>open(r.activity_id)}><Text className="wv-card-title">{r.title}</Text><Text className="wv-muted">{formatActivityTime(r.starts_at,r.timezone)} · {r.status}</Text></Button>)}</View> : <View className="wv-empty"><Text className="wv-section-title">下一次相聚，等你发起</Text><Text className="wv-muted">从一个想法开始，慢慢把朋友约齐。</Text></View>}
    <View className="wv-home-ideas-link"><Text>还没想好去哪？</Text><Button onClick={ideas}>逛逛灵感　↗</Button></View>
  </View>;
}

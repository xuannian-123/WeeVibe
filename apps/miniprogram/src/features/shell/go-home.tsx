import { UiIcon } from '../../components/ui-icon';
import { Button, Text, View } from '@tarojs/components';
import type { ReactNode } from 'react';
import type { AccountSnapshot } from '../../platform/account-api';
import type {Venue} from '@weevibe/contracts';
import scenePhotos from '../../assets/design-c/scene-photos.jpg';
import {VenueCover} from './venue-card';
import { activityPhaseLabel } from './activity-list';
import { formatActivityTime } from './activity-time';

export function GoHome({ account, empty, friend, team, all, ideas, open, gatherings,venuePreviews,preview }: { gatherings?:ReactNode; account?: AccountSnapshot; empty: ReactNode; friend: () => void; team: () => void; all: () => void; ideas: () => void; open: (id: string) => void;venuePreviews?:Venue[];preview?:(venue:Venue)=>void }) {
  const records = account?.activity_records ?? [];
  const active = records.filter(r => !r.cancelled && !r.participation_cancelled && r.phase !== 'ended' && (r.is_manager || r.joined_segment_count || r.pending_application_count));
  const recent = active.slice(0, 2);
  return <View className="wv-go-home"><View className="wv-home-intro"><Text className="wv-eyebrow">GOOD TIMES, TOGETHER</Text><Text className="wv-title">Less planning.{String.fromCharCode(10)}More living.</Text><Text className="wv-subtitle">少些筹划，多些生活。</Text><UiIcon className="wv-home-spark" name="spark"/></View>
    <View className="wv-home-paths"><Button className="wv-home-path wv-photo-path peach" onClick={friend}><View className="wv-scene-photo" style={{backgroundImage:`url(${scenePhotos})`,backgroundPosition:'0 0'}}/><Text className="wv-scene-note">场景示意</Text><Text className="wv-card-title">朋友出游 ↗</Text></Button><Button className="wv-home-path wv-photo-path mint" onClick={team}><View className="wv-scene-photo" style={{backgroundImage:`url(${scenePhotos})`,backgroundPosition:'100% 0'}}/><Text className="wv-scene-note">场景示意</Text><Text className="wv-card-title">一起团建 ↗</Text></Button></View>
    <View className="wv-home-ai-inline"><Text>AI</Text><Text>只有一个想法？AI 可以帮你起草安排。</Text></View>
    {gatherings}
    <View className="wv-section-heading"><Text className="wv-section-title">近期活动</Text><Button className="wv-link" onClick={all}>查看全部　›</Button></View>
    {!account ? empty : recent.length ? recent.map(r => <Button className="wv-recent-activity activity-card" key={r.activity_id} onClick={() => open(r.activity_id)}><View className="wv-card-top"><Text className="wv-card-title">{r.title}</Text><Text className="wv-status">{activityPhaseLabel(r)}</Text></View><View className="wv-card-meta"><UiIcon name="clock"/><Text>{formatActivityTime(r.starts_at, r.timezone).replace("Asia/Shanghai","北京时间")}</Text></View><View className="wv-card-meta"><UiIcon name="location"/><Text>{r.location || '地点待定'}</Text></View><View className="wv-card-footer"><Text>{r.awaiting_acceptance ? '安排有变化，等待你确认' : r.joined_segment_count ? `已参加 ${r.joined_segment_count} 个环节` : r.pending_application_count ? '申请已提交，尚未占位' : r.is_manager ? '我在管理' : '查看本人活动记录'}</Text><Text>↗</Text></View></Button>) : account.activity_records===undefined?<View className="wv-empty"><Text className="wv-muted">当前后端未提供近期活动状态，请到全部活动核对。</Text></View>:<View className="wv-empty"><Text className="wv-section-title">下一次相聚，等你发起</Text><Text className="wv-muted">从一个想法开始，慢慢把朋友约齐。</Text></View>}
    <View className="wv-section-heading"><Text className="wv-section-title">逛逛灵感</Text><Button className="wv-link" onClick={ideas}>全部 →</Button></View><View className="wv-venue-grid">{(venuePreviews??account?.favorites??[]).slice(0,2).map(venue=><Button key={venue.provider_id} className="wv-go-venue" onClick={()=>preview?preview(venue):ideas()}><VenueCover venue={venue}/><Text className="wv-venue-name">{venue.name}</Text><Text className="wv-muted">{venue.district||venue.address||'地址待核实'}</Text></Button>)}</View>{!(venuePreviews??account?.favorites??[]).length&&<View className="wv-empty compact"><Text className="wv-muted">发现喜欢的地方，留给下次相聚。</Text><Button className="wv-link" onClick={ideas}>逛逛灵感　↗</Button></View>}
  </View>;
}

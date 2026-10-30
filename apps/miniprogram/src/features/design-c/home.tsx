import { useEffect, useState } from 'react';
import type { AccountActivityRecord, GatheringSummary, Venue } from '@weevibe/contracts';
import { Button, Image, Text, View } from '@tarojs/components';
import scenePhotos from '../../assets/design-c/scene-photos.jpg';
import type { AccountSnapshot } from '../../platform/account-api';
import { formatActivityTime } from '../shell/activity-time';
import { CIcon } from './chrome';

export type CFeedItem = { key: string; kind: 'activity'; record: AccountActivityRecord } | { key: string; kind: 'preparation'; record: GatheringSummary };

// Formal participation and preparation retain their existing, separate routes.
export function cRecentItems(account: AccountSnapshot | undefined, preparations: GatheringSummary[]): CFeedItem[] {
  const formal = (account?.activity_records ?? []).filter(r => !r.cancelled && !r.participation_cancelled && r.phase !== 'ended' && (r.is_manager || r.joined_segment_count > 0 || r.pending_application_count > 0));
  const items: CFeedItem[] = [
    ...formal.map(record => ({ key: `activity:${record.activity_id}`, kind: 'activity' as const, record })),
    ...preparations.map(record => ({ key: `preparation:${record.id}`, kind: 'preparation' as const, record })),
  ];
  return [...new Map(items.map(item => [item.key, item])).values()].sort((a, b) => {
    const time = (item: CFeedItem) => item.kind === 'activity' ? item.record.starts_at : item.record.date || item.record.updated_at;
    return (time(a) || '9999').localeCompare(time(b) || '9999');
  }).slice(0, 2);
}

export function cActivityPhase(record: AccountActivityRecord) {
  if (record.cancelled || record.participation_cancelled) return '已取消';
  return record.phase === 'upcoming' ? record.joined_segment_count > 0 ? '待参加' : '未开始' : record.phase === 'ongoing' ? '活动中' : record.phase === 'ended' ? '已结束' : '时间待定';
}

function ActivityTime({ record }: { record: AccountActivityRecord }) {
  const formatted = formatActivityTime(record.starts_at, record.timezone).replace('Asia/Shanghai', '北京时间');
  const warningAt = formatted.indexOf('（');
  const time = warningAt < 0 ? formatted : formatted.slice(0, warningAt);
  return <View><View className="c-meta"><CIcon name="clock" /><Text>{time}</Text></View>{warningAt >= 0 && <Text className="c-data-warning">{formatted.slice(warningAt + 1).replace(/）$/, '')}</Text>}</View>;
}

export function CActivityCard({ item, openActivity, openPreparation }: { item: CFeedItem; openActivity: (id: string) => void; openPreparation: (id: string) => void }) {
  const preparation = item.kind === 'preparation';
  const record = item.record;
  const status = item.kind === 'preparation' ? item.record.stage === 'arranged' ? '已有方案' : '筹备中' : cActivityPhase(item.record);
  return <Button className="c-activity-card activity-card" onClick={() => item.kind === 'preparation' ? openPreparation(item.record.id) : openActivity(item.record.activity_id)}>
    <View className="c-activity-heading"><Text className="c-activity-title">{record.title}</Text><Text className={`c-pill ${preparation ? 'c-pill-lilac' : ''}`}>{status}</Text></View>
    {item.kind === 'activity' ? <ActivityTime record={item.record} /> : <View className="c-meta"><CIcon name="calendar" /><Text>{item.record.date || '日期待确认'} · {item.record.kind === 'friend' ? '朋友出游' : '一起团建'}</Text></View>}
    {item.kind === 'activity' && <View className="c-meta"><CIcon name="pin" /><Text>{item.record.location || '地点待定'}</Text></View>}
    {item.kind === 'activity' && item.record.pending_application_count > 0 && item.record.joined_segment_count > 0 && <Text className="c-data-warning">其他环节申请待审批 · 尚不占席位</Text>}
    {item.kind === 'activity' && item.record.exited_segment_count > 0 && <Text className="c-data-warning">{item.record.joined_segment_count > 0 ? '部分环节已退出' : '已退出'}</Text>}
    <View className="c-activity-last"><Text>{item.kind === 'preparation' ? item.record.is_owner ? '我在组织 · 筹备不代表正式报名' : '已参与筹备 · 不代表正式报名' : item.record.awaiting_acceptance ? '安排有变化，等待你确认' : item.record.pending_application_count > 0 && !item.record.joined_segment_count ? '申请待审批 · 不占席位' : item.record.is_manager ? '我在管理' : `已参加 ${item.record.joined_segment_count} 个环节`}</Text><CIcon name="right" /></View>
  </Button>;
}

export function CVenueThumbnail({ venue, open }: { venue: Venue; open: () => void }) {
  const url = venue.photos?.[0]?.url;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <Button className="c-venue-thumb" onClick={open}>
    <View className="c-venue-visual">{url && !failed ? <Image className="c-venue-image" src={url} mode="aspectFill" onError={() => setFailed(true)} /> : <View className="c-venue-missing"><CIcon name="image" /><Text>暂无地点图片</Text></View>}</View>
    <Text className="c-venue-name">{venue.name}</Text><View className="c-meta"><CIcon name="pin" /><Text>{venue.district || venue.address || '地址待核实'}</Text></View>
  </Button>;
}

type Props = {
  account?: AccountSnapshot;
  signedIn: boolean;
  busy: boolean;
  login: () => void;
  refresh: () => void;
  friend: () => void;
  team: () => void;
  all: () => void;
  ideas: () => void;
  openActivity: (id: string) => void;
  openPreparation: (id: string) => void;
  venuePreviews?: Venue[];
  preview: (venue: Venue) => void;
  preparations?: GatheringSummary[];
  preparationsBusy?: boolean;
  preparationsError?: string;
  retryPreparations: () => void;
};

export function CGoHome({ account, signedIn, busy, login, refresh, friend, team, all, ideas, openActivity, openPreparation, venuePreviews, preview, preparations = [], preparationsBusy, preparationsError, retryPreparations }: Props) {
  const recent = cRecentItems(account, preparations);
  const venues = (venuePreviews ?? account?.favorites ?? []).slice(0, 2);
  return <View className="c-home">
    <View className="c-hero"><Text className="c-hero-title">Less planning.{String.fromCharCode(10)}More <Text className="c-hero-green">living.</Text></Text><Text className="c-hero-star">✳</Text></View>
    <Text className="c-hero-translation">少些筹划，多些生活。</Text>
    <View className="c-scenes">{[{ label: '朋友出游', click: friend, position: 'picnic' }, { label: '一起团建', click: team, position: 'dinner' }].map(scene => <Button key={scene.position} className={`c-scene c-scene-${scene.position}`} onClick={scene.click}>
      <View className="c-scene-clip"><Image className={`c-scene-image c-scene-image-${scene.position}`} src={scenePhotos} mode="scaleToFill" /></View><Text className="c-sample-note">场景示意</Text><Text className="c-scene-label">{scene.label} ↗</Text>
    </Button>)}</View>
    <View className="c-ai-note"><View className="c-ai-pencil"><CIcon name="pencil" /><Text>✦</Text></View><Text>AI 起草安排，<Text className="c-ai-confirm">你来确认。</Text></Text></View>
    <View className="c-section-heading"><Text>近期活动</Text><Button className="c-link" onClick={all}>全部 →</Button></View>
    {!signedIn ? <View className="c-empty-inline"><Text>登录后查看近期活动</Text><Button className="c-link c-login-link" disabled={busy} onClick={login}><Text>{busy ? '正在恢复登录…' : '微信登录'}</Text><CIcon name="right" /></Button></View> : !account ? <View className="c-inline-status"><Text>{busy ? '正在读取活动…' : '活动暂时无法读取'}</Text>{!busy && <Button className="c-link" onClick={refresh}>刷新账户数据</Button>}</View> : <View>
      {recent.map(item => <CActivityCard key={item.key} item={item} openActivity={openActivity} openPreparation={openPreparation} />)}
      {account.activity_records === undefined && <View className="c-inline-status"><Text>未提供近期活动状态，请到全部活动核对。</Text></View>}
      {!recent.length && account.activity_records !== undefined && !preparationsBusy && !preparationsError && <Text className="c-empty-inline">暂无近期活动</Text>}
      {preparationsBusy && <Text className="c-small-status">正在读取筹备…</Text>}
      {preparationsError && <View className="c-inline-status"><Text>筹备读取失败：{preparationsError}</Text><Button className="c-link" onClick={retryPreparations}>重试 →</Button></View>}
    </View>}
    <View className="c-section-heading"><Text>逛逛灵感</Text><Button className="c-link" onClick={ideas}>全部 →</Button></View>
    {venues.length ? <View className="c-venue-grid">{venues.map(venue => <CVenueThumbnail key={venue.provider_id} venue={venue} open={() => preview(venue)} />)}</View> : <Text className="c-empty-inline">暂无地点推荐</Text>}
  </View>;
}

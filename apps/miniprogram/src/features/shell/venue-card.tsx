import { UiIcon } from '../../components/ui-icon';
import { Sheet } from '../../components/sheet';
import { useEffect, useState } from 'react';
import { Button, Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import type { Venue } from '@weevibe/contracts';
import { Action, Notice } from '../../components/ui';

export function VenueCover({ venue }: { venue: Venue }) {
  const url = venue.photos?.[0]?.url; const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <View className="wv-venue-cover">{url && !failed ? <Image src={url} mode="aspectFill" onError={() => setFailed(true)}/> : <View className="wv-venue-placeholder"><Text>✧</Text><Text>{venue.category_text?.split(';')[0] || '一起去看看'}</Text></View>}</View>;
}
export function venueIdea(venue: Venue) {
  const category = venue.category_text || '';
  return /餐饮|咖啡|茶/.test(category) ? '留点时间，和朋友慢慢聊。' : /体育|运动/.test(category) ? '一起动起来，给周末充充电。' : /公园|风景|景点/.test(category) ? '不赶行程，和朋友一起看看。' : /文化|美术|展览/.test(category) ? '交换一下，各自眼里的有趣。' : '把这个好去处，加入下次相聚。';
}
export function VenueCard({ venue, saved, busy, open, favorite }: { venue: Venue; saved: boolean; busy: boolean; open: () => void; favorite: () => void }) {
  const cost = venue.reference_cost.value;
  return <View className="wv-venue-card"><View className="wv-venue-visual" onClick={open}><VenueCover venue={venue}/><Button ariaLabel={saved ? '取消收藏' : '收藏地点'} className={`wv-venue-save ${saved ? 'saved' : ''}`} disabled={busy} onClick={e => { e.stopPropagation(); favorite(); }}><UiIcon name="heart"/><Text className="wv-sr-only">{saved ? '取消收藏' : '收藏地点'}</Text></Button></View>
    <Text className="wv-venue-name" onClick={open}>{venue.name}</Text><Text className="wv-venue-reason">{venueIdea(venue)}</Text><Text className="wv-venue-meta">{venue.district || venue.address || '地址待核实'}</Text>
    <Text className="wv-venue-category">{venue.category_text?.split(';').slice(-1)[0] || '地点灵感'}</Text>
    {cost && venue.reference_cost.unit === 'person' && <Text className="wv-venue-meta">参考人均 ¥{cost}</Text>}
    {venue.search_distance_m !== null && <Text className="wv-venue-meta">搜索距离约 {Math.round(venue.search_distance_m)} 米</Text>}
    <Button className="wv-venue-more" onClick={open}>查看详情</Button>
  </View>;
}
export function VenueDetail({ venue, close, plan, favorite, saved, busy, map, error }: { venue: Venue; close: () => void; plan: () => void; favorite: () => void; saved: boolean; busy: boolean; map?:()=>void; error?:string }) {
  return <Sheet title={venue.name} close={close} className="wv-venue-detail" footer={<View className="wv-inline"><Action disabled={busy} onClick={favorite}>{saved?'取消收藏':'收藏地点'}</Action><Action variant="primary" disabled={busy} onClick={plan}>约大家去 ↗</Action></View>}><VenueCover venue={venue}/><Text className="wv-subtitle">{venueIdea(venue)}</Text><Text className="wv-muted">{venue.address || '暂无详细地址'}</Text><Button className="wv-map-link" disabled={busy} onClick={() => map ? map() : void Taro.openLocation({ latitude: venue.location.latitude, longitude: venue.location.longitude, name: venue.name, address: venue.address || '' }).catch(() => Taro.showToast({ title: '地图暂未打开，可查看地址', icon: 'none' }))}>地图位置与导航 ↗</Button>
    {venue.opening_today.value && <Text className="wv-muted">参考营业时间：{venue.opening_today.value}</Text>}{venue.reference_cost.value && <Text className="wv-muted">参考费用：{venue.reference_cost.value}{venue.reference_cost.unit === 'person' ? ' 元/人' : ''}</Text>}
    <Text className="wv-list-note">地点资料来自高德，营业、费用及预约仍需向商家核实。</Text>{error&&<Notice>{error}</Notice>}
  </Sheet>;
}

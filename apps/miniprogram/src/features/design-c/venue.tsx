import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Image, Text, View } from '@tarojs/components';
import type { Venue } from '@weevibe/contracts';
import { CIcon } from './chrome';
import { CAction, CNotice, CSheet } from './ui';

export function CVenueCover({ venue, className = '' }: { venue: Venue; className?: string }) {
  const url = venue.photos?.[0]?.url;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return <View className={`c-cover ${className}`}>{url && !failed ? <Image src={url} mode="aspectFill" onError={() => setFailed(true)} /> : <View className="c-cover-missing"><CIcon name="image" /><Text>暂无地点图片</Text></View>}</View>;
}
export function CVenueCard({ venue, saved, busy, open, favorite, collection = false }: { venue: Venue; saved: boolean; busy: boolean; open: () => void; favorite: () => void; collection?: boolean }) {
  const value = venue.reference_cost.value;
  return <View className="c-place-card"><View className="c-place-visual"><Button className="c-place-open" onClick={open} ariaLabel={`查看${venue.name}详情`}><CVenueCover venue={venue} /><Text className="c-sr-only">查看详情</Text></Button><Button className={`c-heart ${saved ? 'c-heart-saved' : ''}`} disabled={busy} ariaLabel={saved ? '取消收藏' : '收藏地点'} onClick={event => { event.stopPropagation(); favorite(); }}><CIcon name={saved ? 'heartSaved' : 'heart'} /><Text className="c-sr-only">{saved ? '取消收藏' : '收藏地点'}</Text></Button></View>
    <Button className="c-place-name" onClick={open}>{venue.name}</Button><View className="c-meta"><CIcon name="pin" /><Text>{collection ? venue.address || venue.district || '地址待核实' : venue.district || venue.address || '地址待核实'}</Text></View><Text className="c-place-cost">{value === null ? '费用待核实' : `${venue.reference_cost.unit === 'person' ? '参考人均 ' : '参考费用 '}${value} 元`}</Text>
  </View>;
}
export function CVenueDetail({ venue, close, plan, favorite, saved, busy, map, error }: { venue: Venue; close: () => void; plan: () => void; favorite: () => void; saved: boolean; busy: boolean; map?: () => void; error?: string }) {
  return <CSheet title="地点详情" tall className="c-venue-detail" close={close} footer={<><CAction disabled={busy} onClick={favorite}><CIcon name={saved ? 'heartSaved' : 'heart'} />{saved ? '取消收藏' : '收藏地点'}</CAction><CAction variant="primary" disabled={busy} onClick={plan}>约大家去 ↗</CAction></>}>
    <CVenueCover venue={venue} className="c-detail-photo" /><Text className="c-detail-name">{venue.name}</Text><Text className="c-hint">{[venue.category_text?.split(';').at(-1), venue.district].filter(Boolean).join(' · ')}</Text>
    <View className="c-detail-fact"><CIcon name="pin" /><View><Text className="c-fact-label">地址</Text><Text>{venue.address || '暂无详细地址'}</Text><Button className="c-map-link" disabled={busy} onClick={() => map ? map() : void Taro.openLocation({ latitude: venue.location.latitude, longitude: venue.location.longitude, name: venue.name, address: venue.address || '' }).catch(() => Taro.showToast({ title: '地图暂未打开，可查看地址', icon: 'none' }))}>在地图中查看 ↗</Button></View></View>
    <View className="c-detail-fact"><CIcon name="clock" /><View><Text className="c-fact-label">参考开放时间</Text><Text>{venue.opening_today.value || '暂无营业信息，请向场地核实'}</Text></View></View>
    <View className="c-detail-fact"><CIcon name="doc" /><View><Text className="c-fact-label">参考费用</Text><Text>{venue.reference_cost.value === null ? '费用未知，请向场地核实' : `${venue.reference_cost.value}${venue.reference_cost.unit === 'person' ? ' 元／人' : ' 元'} · 仅供参考`}</Text></View></View>
    <View className="c-source-note"><CIcon name="info" /><Text>地点资料来自高德；营业、费用与预约请向场地核实。</Text></View>{error && <CNotice>{error}</CNotice>}
  </CSheet>;
}

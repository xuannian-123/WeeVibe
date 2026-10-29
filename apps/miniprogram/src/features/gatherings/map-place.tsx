import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import type { VenueSelection } from '@weevibe/contracts';
import { useMapPicker } from '../../platform/use-map-picker';

/** Shared C-style entry for public gathering places; never submits the form. */
export function GatheringMapPlace({ session, disabled, venue, select }: {
  session: string; disabled: boolean; venue?: VenueSelection; select: (place: VenueSelection) => void;
}) {
  const choose = useMapPicker(disabled, session), mounted = useRef(true);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function pick() {
    if (busy || disabled) return;
    setBusy(true); setNotice('');
    try {
      const place = await choose(venue?.location);
      if (!place) return;
      if (place.address.length > 300) { setNotice('所选地址过长，请重新选择或手动填写；原地点已保留。'); return; }
      select({ name: place.name, address: place.address || null, location: place.location, source: { provider: 'wechat', source_api: 'wx.chooseLocation' } });
    } catch (error) {
      if (mounted.current && !(error instanceof ApiClientError && error.code === 'MAP_PICKER_STALE')) {
        setNotice(error instanceof ApiClientError ? error.message : '地图选点暂不可用，可继续手动填写。');
      }
    } finally { if (mounted.current) setBusy(false); }
  }
  return <View><Button className="gg-soft" disabled={disabled || busy} onClick={() => void pick()}>{busy ? '正在选择地点…' : venue ? '重新选择地点' : '地图选择地点'}</Button>
    {venue && <Text className="gg-muted">{venue.address || venue.name} · {venue.source.provider === 'wechat' ? '微信地图选点' : '高德地点'}，营业和预订待核实。</Text>}
    {notice && <Text className="gg-notice">{notice}</Text>}</View>;
}

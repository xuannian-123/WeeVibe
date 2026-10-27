import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import type { VenueList, VenueSelection } from '@weevibe/contracts';
import { venueSelectionSchema } from '@weevibe/contracts';
import { api } from '../../platform/api';
import { Action, Field, Notice } from '../../components/ui';
import { validCity } from '../shell/helpers';
import type { SegmentForm } from './form';

function initialSearchCity(): string {
  try {
    const city: unknown = Taro.getStorageSync('weevibe_selected_city');
    return typeof city === 'string' && validCity(city) ? city.trim() : '';
  } catch { return ''; }
}

export function VenuePicker({ segment, disabled, onSelect }: { segment: SegmentForm; disabled: boolean; onSelect: (venue: VenueSelection) => void }) {
  // A new picker may use the chosen city as a search default, never as a location
  // fix or a selected venue. Later city changes must not replace local edits.
  const [open, setOpen] = useState(false), [region, setRegion] = useState(initialSearchCity), [keyword, setKeyword] = useState('');
  const [result, setResult] = useState<VenueList>(), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const sequence = useRef(0); const blocked = useRef(disabled); blocked.current = disabled;
  const invalidate = () => { sequence.current++; setResult(undefined); setBusy(false); setMessage(''); };
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => { if (disabled) invalidate(); }, [disabled]);
  useDidHide(invalidate);
  async function search() {
    if (disabled || busy) return;
    if (!region.trim() || !keyword.trim()) { setMessage('请填写城市和地点关键词。'); return; }
    const request = ++sequence.current; setBusy(true); setResult(undefined); setMessage('');
    try {
      const data = await api.searchVenues({ region: region.trim(), keyword: keyword.trim(), page_size: 5 });
      if (request !== sequence.current || blocked.current) return;
      setResult(data); if (!data.venues.length) setMessage('没有找到匹配地点，可以换个关键词或手动填写。');
    } catch (error) { if (request === sequence.current) setMessage(error instanceof Error ? error.message : '地点查询失败，仍可手动填写。'); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  return <View className="create-venue-picker">
    <Action variant="text" disabled={disabled} onClick={() => { invalidate(); setOpen(!open); setKeyword(segment.place); }}>{open ? '收起地点搜索' : '从高德搜索地点'}</Action>
    {segment.venue && <View><Text className="caption">已选高德地点：{segment.address || segment.place}。资料查询于 {segment.venue.source.checked_at.slice(0, 10)}。</Text>
      <Action variant="text" disabled={disabled} onClick={() => { const venue = segment.venue!; void Taro.openLocation({ ...venue.location, name: venue.name, address: venue.address ?? '' }).catch(() => setMessage('暂时无法打开地图，可以查看已选地址。')); }}>在地图中查看</Action>
    </View>}
    {open && <View>
      <Field label="在哪个城市找" value={region} disabled={disabled} onChange={value => { invalidate(); setRegion(value); }} placeholder="例如：上海" />
      <Field label="地点或场馆关键词" value={keyword} disabled={disabled} onChange={value => { invalidate(); setKeyword(value); }} placeholder="例如：五角场羽毛球" />
      <Action disabled={disabled || busy || region.trim().length > 40 || keyword.trim().length > 80} onClick={() => { void search(); }}>{busy ? '正在查找…' : '搜索地点'}</Action>
      {result?.venues.map(venue => <View key={venue.provider_id} className="create-venue-result">
        <Text className="create-assist-title">{venue.name}</Text><Text className="caption">{venue.address || '地址待核实'}</Text>
        <Action disabled={disabled || venue.name.length > 200 || (venue.address?.length ?? 0) > 500} onClick={() => {
          onSelect(venueSelectionSchema.parse(venue)); invalidate(); setOpen(false);
        }}>选择这个地点</Action>
      </View>)}
      <Text className="caption">来源：高德地图。搜索资料不代表场馆有空位或已预订，费用请另行核实。</Text>
    </View>}
    {message && <Notice>{message}</Notice>}
  </View>;
}

import { Button, Input, Text, View } from '@tarojs/components';
import { type GatheringIntake, type Venue } from '@weevibe/contracts';
import { CAction, CLocationSettings } from './ui';
import './interview-inputs.css';

export type COriginViewProps = {
  value: GatheringIntake['private']['origin']; disabled: boolean; searching: boolean; busy: boolean; city: string; keyword: string; places: Venue[]; notice: string; denied: boolean;
  current: () => boolean; change: (label: string) => void; selectMap: () => void; locate: () => void; toggleSearch: () => void; setCity: (city: string) => void; setKeyword: (word: string) => void; search: () => void; selectPlace: (venue: Venue) => void; clearCoordinates: () => void; permissionChanged: (granted: boolean) => void;
};
export function COriginView(props: COriginViewProps) {
  const { value, busy, disabled, searching, city, keyword, places, notice, denied } = props;
  const blocked = disabled || busy;
  return <View className="ci-inputs c-ui"><Text className="ci-field-label">从哪出发 · 仅本人</Text><Input className="ci-control" value={value?.label || ''} maxlength={300} disabled={blocked} adjustPosition cursorSpacing={24} placeholder="手动填写出发地址" onInput={event => props.change(event.detail.value)} /><View className="ci-origin-actions"><CAction disabled={blocked} onClick={props.selectMap}>地图选择出发地</CAction><CAction disabled={blocked} onClick={props.locate}>获取定位</CAction><CAction disabled={blocked} onClick={props.toggleSearch}>搜索地址</CAction>{value?.latitude !== undefined && value.longitude !== undefined && <CAction variant="text" disabled={blocked} onClick={props.clearCoordinates}>清除定位</CAction>}</View>
    {searching && <View className="ci-origin-search"><Text className="ci-field-label">在哪个城市找</Text><Input className="ci-control" value={city} disabled={blocked} maxlength={30} placeholder="例如：杭州" onInput={event => props.setCity(event.detail.value)} /><Text className="ci-field-label">地址关键词</Text><Input className="ci-control" value={keyword} disabled={blocked} maxlength={80} confirmType="search" placeholder="输入地址关键词" onInput={event => props.setKeyword(event.detail.value)} onConfirm={props.search} /><CAction disabled={blocked || !city.trim() || !keyword.trim()} onClick={props.search}>搜索</CAction>{places.map(place => <Button className="ci-origin-result" key={place.provider_id} disabled={blocked} onClick={() => props.selectPlace(place)}><Text>{place.name}</Text><Text>{place.address || '暂无详细地址'}</Text></Button>)}</View>}
    {notice && <Text className="ci-input-notice">{notice}</Text>}{denied && <CLocationSettings current={props.current} changed={props.permissionChanged} />}
  </View>;
}

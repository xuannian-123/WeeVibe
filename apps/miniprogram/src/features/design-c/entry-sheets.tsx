import { Button, Input, Text, View } from '@tarojs/components';
import { CIcon } from './chrome';
import { CAction, CNotice, CSheet } from './ui';
import { cCities } from './city-catalog';

export function CCreateSheet({ close, create }: { close: () => void; create: (kind: 'friend' | 'direct') => void }) {
  return <CSheet title="发起一次相聚" close={close}>{([{ label: '朋友出游', text: '和朋友约一次出游', icon: 'group', choose: () => create('friend') }] as const).map((option, i) => <Button className={`c-scene-option c-scene-option-${i}`} key={option.label} onClick={option.choose}><View className="c-scene-option-icon"><CIcon name={option.icon} /></View><View><Text>{option.label}</Text><Text className="c-hint">{option.text}</Text></View><Text>↗</Text></Button>)}</CSheet>;
}

export function CCitySheet({ city, query, change, choose, locate, locating, note, permission, close }: { city: string; query: string; change: (value: string) => void; choose: (name: string) => void; locate: () => void; locating: boolean; note: string; permission?: import('react').ReactNode; close: () => void }) {
  const q = query.trim().toLowerCase().replace(/\s/g, '');
  const results = cCities.filter(([name, , pinyin, short]) => name.startsWith(q) || pinyin.startsWith(q) || short.startsWith(q)).slice(0, 18);
  return <CSheet title="选择城市" close={close} tall extra={<View className="c-city-search"><CIcon name="search" /><Input value={query} adjustPosition={false} cursorSpacing={24} confirmType="done" maxlength={30} placeholder="输入城市名称或拼音" onInput={event => change(event.detail.value)} onConfirm={() => choose(query)} />{query && <Button ariaLabel="清空城市搜索" onClick={() => change('')}><CIcon name="close" /></Button>}</View>}>
    {(!q||note.startsWith('已识别')) && <Button className="c-location-row" disabled={locating} onClick={locate}><CIcon name="pin" /><Text>{locating ? '正在获取位置…' : '获取当前位置'}</Text></Button>}{note && <CNotice>{note}</CNotice>}{permission}
    {q ? <><Text className="c-small-label">匹配城市</Text>{results.map(([name, region]) => <Button className="c-city-result" key={name} onClick={() => choose(name)}><Text>{name}</Text><Text>{region}</Text></Button>)}{!results.length && <Text className="c-hint">暂无匹配城市，可检查输入或手动确认。</Text>}<CAction onClick={() => choose(query)}>使用“{query}”</CAction></> : <><Text className="c-hint">用于地点浏览和新建安排，不会更改已有活动。</Text><Text className="c-small-label">当前城市</Text><View className="c-city-pills"><Button className="c-selected" onClick={() => choose(city)}>{city}</Button></View><Text className="c-small-label">常用城市</Text><View className="c-city-pills">{['北京', '上海', '苏州', '深圳', '南京', '成都', '杭州', '武汉', '重庆'].map(name => <Button className={city === name ? 'c-selected' : ''} key={name} onClick={() => choose(name)}>{name}</Button>)}</View></>}
  </CSheet>;
}

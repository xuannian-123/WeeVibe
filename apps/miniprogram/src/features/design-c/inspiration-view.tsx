import {inspirationCategory} from '@weevibe/contracts';
import type { ReactNode } from 'react';
import { Button, Input, Picker, Text, View } from '@tarojs/components';
import type { Venue } from '@weevibe/contracts';
import { CIcon } from './chrome';
import { CAction, CHero, CNotice, CPageHeading, CSheet } from './ui';
import { CVenueCard } from './venue';
export const cCategories=[['全部','全部','grid'],['吃','吃','food'],['喝','喝','food'],['玩','玩','play']] as const;
export const cRadiusKm = [2, 5, 8, 10, 15, 20, 25, 30, 35, 40, 50];
type Props = { locationLabel?: string; radiusKm: number; onRadius: (km: number, area: string) => void; chooseMap: () => void; city: string; area: string; keyword: string; scope: 'nearby' | 'city'; scopeNote: string; favorites: boolean; busy: boolean; searched: boolean; category: string; venues: Venue[]; savedIds: Set<string>; error: string; permission?: ReactNode; scopeOpen: boolean; setScopeOpen: (open: boolean) => void; onKeyword: (value: string) => void; onArea: (value: string) => void; search: (nearby?: boolean, area?: string) => void; exitFavorites: () => void; chooseCategory: (category: string) => void; showFavorites: () => void; open: (venue: Venue) => void; favorite: (venue: Venue) => void; chooseCity?: () => void };
export function CInspirationView(props: Props) {
  const { city, area, keyword, scope, scopeNote, favorites, busy, searched, category, venues, savedIds, error, permission, scopeOpen, setScopeOpen } = props;
  if(favorites)return <View className="c-ui c-inspiration"><View className="c-subheader"><Button ariaLabel="返回灵感" onClick={props.exitFavorites}><CIcon name="back"/><Text className="c-sr-only">查看全部地点</Text></Button><Text>我的收藏</Text></View>{error&&<CNotice>{error}</CNotice>}{busy&&<Text className="c-small-status">正在读取收藏…</Text>}<View className="c-place-grid">{venues.map(venue=><CVenueCard collection key={venue.provider_id} venue={venue} saved={savedIds.has(venue.provider_id)} busy={busy} open={()=>props.open(venue)} favorite={()=>props.favorite(venue)}/>)}</View>{!busy&&!error&&!venues.length&&<View className="c-state-empty"><CIcon name="heart"/><Text>还没有收藏地点</Text></View>}</View>;
  return <View className="c-ui c-inspiration"><CPageHeading title="灵感"><Button className="c-scope-link" onClick={() => setScopeOpen(true)}>{scope === 'nearby' ? '附近' : props.locationLabel || city}{scope === 'city' && !props.locationLabel && area ? ` · ${area}` : ''}⌄</Button></CPageHeading><CHero kind="ideas" /><Text className="c-hero-translation">发现下一次好时光。</Text>
    <View className="c-ideas-controls"><View className="c-search-row"><View className="c-search"><Button disabled={busy} ariaLabel="搜索地点" onClick={() => props.search()}><CIcon name="search" /><Text className="c-sr-only">搜索地点</Text></Button><Input value={keyword} maxlength={80} adjustPosition cursorSpacing={24} confirmType="search" placeholder="搜索地点、商圈或关键词" onInput={event => props.onKeyword(event.detail.value)} onConfirm={() => props.search()} />{keyword && <Button ariaLabel="清空关键词" onClick={() => props.onKeyword('')}><CIcon name="close" /></Button>}</View><Button className="c-collection-entry" disabled={busy} ariaLabel="我的收藏" onClick={props.showFavorites}><CIcon name="heart" /><Text className="c-sr-only">{favorites ? '查看全部地点' : '我的收藏'}</Text></Button></View>
      <Text className="c-scope-note">{favorites ? '全部城市的收藏' : scopeNote || (scope === 'nearby' ? `附近约${props.radiusKm}公里` : city + (area ? ` · ${area}` : ' · 全部区域'))}</Text><View className="c-categories">{cCategories.map(([id, label, icon]) => <Button key={id} className={`c-category ${(id===category||inspirationCategory(id)?.group===inspirationCategory(category)?.group&&id!=='全部') ? 'c-selected' : ''}`} disabled={busy} ariaLabel={id} onClick={() => props.chooseCategory(id)}><View><CIcon name={icon} /></View><Text>{label}</Text></Button>)}</View>
    </View>
    {error && <CNotice>{error}</CNotice>}{permission}{busy && <Text className="c-small-status">{venues.length ? '正在更新地点…' : '正在查找好去处…'}</Text>}
    {!busy && !error && !venues.length && <View className="c-state-empty"><Text>{searched ? '没有符合条件的地点' : '暂无地点推荐'}</Text>{searched && <><Text className="c-hint">试试清空关键词，或查看全部分类。</Text><View className="c-empty-actions"><CAction variant="text" onClick={() => props.onKeyword('')}>清空关键词</CAction><CAction variant="text" onClick={() => props.chooseCategory('全部')}>查看全部分类</CAction></View></>}</View>}
    <View className="c-place-grid">{venues.map(venue => <CVenueCard key={venue.provider_id} venue={venue} saved={savedIds.has(venue.provider_id)} busy={busy} open={() => props.open(venue)} favorite={() => props.favorite(venue)} />)}</View>{!!venues.length && <Text className="c-list-end">地点资料来自高德，营业与费用请向场地核实。</Text>}
    {scopeOpen && <CSheet title="浏览范围" close={() => setScopeOpen(false)}>
      <Button className="c-utility-row" disabled={busy} onClick={() => props.search(true, '')}><CIcon name="pin" /><View><Text>附近地点</Text><Text className="c-hint">使用当前精确位置查找附近地点</Text></View><CIcon name="right" /></Button>
      <Button className="c-utility-row" disabled={busy} onClick={props.chooseMap}><CIcon name="pin" /><View><Text>从地图选择</Text></View><CIcon name="right" /></Button>
      <View className="c-input" ariaLabel="当前位置"><Text>{props.locationLabel || ''}</Text></View>
      <Text className="c-small-label">范围（km）</Text>
      <Picker mode="selector" range={cRadiusKm.map(String)} value={Math.max(0, cRadiusKm.indexOf(props.radiusKm))} onChange={event => { const km = cRadiusKm[Number(event.detail.value)]; if (km !== undefined) props.onRadius(km, area); }}><View className="c-input">{props.radiusKm}<Text> ⌄</Text></View></Picker>
    </CSheet>}
  </View>;
}

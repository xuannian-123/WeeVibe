import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Button, Text, View, Input, ScrollView } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import type { Venue } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { Action, Notice } from '../../components/ui';
import { locationError, nearbyForSession, searchForSession } from './location-api';
import { VenueCard, VenueDetail } from './venue-card';

const categories = ['全部', '吃点喝点', '随便逛逛', '一起玩点', '动起来', '看点新鲜'];
const categorySearch: Record<string, string> = { '全部': '休闲', '吃点喝点': '咖啡|餐厅', '随便逛逛': '公园|步行街', '一起玩点': '桌游|手作', '动起来': '运动', '看点新鲜': '展览|博物馆' };

export function Inspiration({ city, authenticated, initialKeyword='', login, initialFavorites=[], accountChanged, plan }: { city: string; authenticated: boolean; initialKeyword?:string; login: (input:{keyword:string;city:string}) => void; initialFavorites?: Venue[]; accountChanged?: (v: AccountSnapshot) => void; plan?: (v: Venue) => void }) {
  const actorSession = useRef(getToken());
  const [keyword, setKeyword] = useState(initialKeyword); const keywordRef=useRef(initialKeyword); const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false);
  const [favorites, setFavorites] = useState(false); const [selected, setSelected] = useState<Venue>();
  const [category, setCategory] = useState('全部'), [area, setArea] = useState('');
  const [savedIds, setSavedIds] = useState(() => new Set(initialFavorites.map(v => v.provider_id)));
  const mounted = useRef(true), visible = useRef(true), epoch = useRef(0), lock = useRef<number>();
  const current = useRef({ city, authenticated }); current.current = { city, authenticated };
  function invalidate() { epoch.current++; lock.current = undefined; if (mounted.current) setBusy(false); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; lock.current = undefined; }; }, []);
  useEffect(() => { invalidate(); setVenues([]); setSearched(false); setSelected(undefined); setError(''); }, [city]);
  const hide = () => { visible.current = false; invalidate(); };
  useDidHide(hide); useUnload(hide); useDidShow(() => { visible.current = true; });
  function start() {
    if (!authenticated) { if(mounted.current&&visible.current&&getToken()===actorSession.current)login({keyword:keywordRef.current,city}); return; }
    if (!mounted.current || !visible.current || lock.current !== undefined) return;
    if (!actorSession.current || getToken() !== actorSession.current) { setError('登录账号已变化，请重新打开灵感页。'); return; }
    const ticket = ++epoch.current, session = actorSession.current, sourceCity = city;
    lock.current = ticket; setBusy(true); setError('');
    const valid = () => mounted.current && visible.current && epoch.current === ticket && current.current.authenticated && current.current.city === sourceCity && getToken() === session;
    const guard = () => { if (!valid()) throw new ApiClientError('INVALID_RESPONSE', '页面或身份来源已变化，旧地点请求未采用。', 0); };
    const finish = () => { if (lock.current === ticket) { lock.current = undefined; if (mounted.current) setBusy(false); } };
    return { session, valid, guard, finish };
  }
  async function find(nearby = false, nextCategory = category) {
    const operation = start(); if (!operation) return;
    try {
      const search = [area.trim(), keyword.trim() || categorySearch[nextCategory]].filter(Boolean).join(' ');
      if (search.length > 80) throw new ApiClientError('INVALID_INPUT', '区域与搜索关键词合计请控制在 80 字以内', 400);
      const result = nearby ? await nearbyForSession(operation.session, search, operation.guard) : await searchForSession(operation.session, { region: city, keyword: search, page_size: 10 }, operation.guard);
      operation.guard(); setVenues(result.venues); setFavorites(false); setSearched(true); setSelected(undefined);
    } catch (e) { if (operation.valid()) setError(nearby ? locationError(e) : errorText(e)); }
    finally { operation.finish(); }
  }
  async function showFavorites() {
    const operation = start(); if (!operation) return;
    try { operation.guard(); const data = await requestAccount(operation.session); operation.guard(); setVenues(data.favorites); setSavedIds(new Set(data.favorites.map(v => v.provider_id))); setFavorites(true); setSearched(true); setSelected(undefined); }
    catch(e) { if (operation.valid()) setError(errorText(e)); } finally { operation.finish(); }
  }
  async function favorite(venue: Venue, remove: boolean) {
    const operation = start(); if (!operation) return;
    try { operation.guard(); const data = await requestAccount(operation.session, 'PATCH', { action: 'favorite', venue, saved: !remove }); operation.guard(); setSavedIds(new Set(data.favorites.map(v => v.provider_id))); accountChanged?.(data); if (remove && favorites) setVenues(v => v.filter(x => x.provider_id !== venue.provider_id)); else void Taro.showToast({title:remove?'已取消收藏':'已收藏',icon:'success'}); }
    catch(e) { if (operation.valid()) setError(errorText(e)); } finally { operation.finish(); }
  }
  async function openMap(venue: Venue) {
    const operation = start(); if (!operation) return;
    try { operation.guard(); await Taro.openLocation({ latitude: venue.location.latitude, longitude: venue.location.longitude, name: venue.name, address: venue.address || '' }); operation.guard(); }
    catch(e) { if (operation.valid()) { const reason = String((e as {errMsg?:unknown})?.errMsg ?? (e instanceof Error ? e.message : '')); setError(/cancel/i.test(reason) ? '已取消打开地图，地点和地址仍保留。' : '暂时无法打开地图，可查看地点地址或重试。'); } }
    finally { operation.finish(); }
  }
  function select(venue?: Venue) { if (venue && lock.current !== undefined) return; invalidate(); setSelected(venue); setError(''); }
  if (getToken() !== actorSession.current) return <Notice>登录账号已变化，请重新打开灵感页；不会向新账号重放原收藏操作。</Notice>;
  return <View className="wv-inspiration"><View className="wv-hero mint"><Text className="wv-eyebrow">A LITTLE INSPIRATION</Text><Text className="wv-title">好地方，{String.fromCharCode(10)}想和你们一起去。</Text><Text className="wv-subtitle">探索 {city}，把下一次相聚安排上。</Text></View>
    <View className="wv-search wv-inspiration-search"><Input value={keyword} maxlength={80} placeholder="搜索地点、商圈或关键词" onInput={e=>{invalidate();keywordRef.current=e.detail.value;setKeyword(e.detail.value);setSelected(undefined);setError('');}} onConfirm={()=>void find()}/><Button disabled={busy} onClick={()=>void find(true)}>查看附近</Button></View>
    <View className="wv-inspiration-scope"><Input value={area} maxlength={30} placeholder={`${city} · 输入区域或商圈（选填）`} onInput={e=>{invalidate();setArea(e.detail.value);setSelected(undefined);}}/><Button className="wv-link" disabled={busy} onClick={()=>favorites?void find():void showFavorites()}>{favorites?'查看全部地点':'我的收藏'}</Button></View>
    <ScrollView scrollX className="wv-inspiration-tabs"><View>{categories.map(c=><Button key={c} className={c===category?'active':''} disabled={busy} onClick={()=>{invalidate();setCategory(c);void find(false,c);}}>{c}</Button>)}</View></ScrollView>
    <View className="wv-section-heading"><Text className="wv-section-title">{favorites?'收藏起来，下次一起去':'找个地方，一起出发'}</Text><Button className="wv-link" disabled={busy} onClick={()=>void find()}>搜索地点</Button></View>
    {error && <Notice tone="error">{error}</Notice>}{busy && <Text className="wv-muted">正在查找好去处…</Text>}
    {!busy && !error && venues.length===0 && <View className="wv-empty"><Text className="wv-empty-icon">✧</Text><Text className="wv-section-title">{searched?'这里暂时没有地点':'下一次相聚，从喜欢的地方开始'}</Text><Text className="wv-muted">{favorites?'收藏喜欢的地点，下次一起去。':'选个分类或搜索想去的地方。附近搜索仅在你主动点击时使用定位。'}</Text></View>}
    <View className="wv-venue-grid">{venues.map(venue=><VenueCard key={venue.provider_id} venue={venue} saved={savedIds.has(venue.provider_id)} busy={busy} open={()=>select(venue)} favorite={()=>void favorite(venue,savedIds.has(venue.provider_id))}/>)}</View>
    {!!venues.length && <Text className="wv-list-note">地点资料来自高德；参考费用、营业和预约请向商家核实。</Text>}
    {selected && <VenueDetail venue={selected} busy={busy} error={error} map={()=>void openMap(selected)} saved={savedIds.has(selected.provider_id)} favorite={()=>void favorite(selected,savedIds.has(selected.provider_id))} close={()=>select(undefined)} plan={()=>{if(mounted.current&&visible.current&&actorSession.current===getToken())plan?.(selected);}}/>}
  </View>;
}

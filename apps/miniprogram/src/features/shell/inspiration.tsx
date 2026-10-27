import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View, Input } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import type { Venue } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { requestAccount } from '../../platform/account-api';
import { Action, Notice } from '../../components/ui';
import { locationError, nearbyForSession, searchForSession } from './location-api';

export function Inspiration({ city, authenticated, initialKeyword='', login }: { city: string; authenticated: boolean; initialKeyword?:string; login: (input:{keyword:string;city:string}) => void }) {
  const actorSession = useRef(getToken());
  const [keyword, setKeyword] = useState(initialKeyword); const keywordRef=useRef(initialKeyword); const [venues, setVenues] = useState<Venue[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(false);
  const [favorites, setFavorites] = useState(false); const [selected, setSelected] = useState<Venue>();
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
  async function find(nearby = false) {
    const operation = start(); if (!operation) return;
    try {
      const result = nearby ? await nearbyForSession(operation.session, keyword, operation.guard) : await searchForSession(operation.session, { region: city, keyword: keyword.trim() || '休闲', page_size: 10 }, operation.guard);
      operation.guard(); setVenues(result.venues); setFavorites(false); setSearched(true); setSelected(undefined);
    } catch (e) { if (operation.valid()) setError(nearby ? locationError(e) : errorText(e)); }
    finally { operation.finish(); }
  }
  async function showFavorites() {
    const operation = start(); if (!operation) return;
    try { operation.guard(); const data = await requestAccount(operation.session); operation.guard(); setVenues(data.favorites); setFavorites(true); setSearched(true); setSelected(undefined); }
    catch(e) { if (operation.valid()) setError(errorText(e)); } finally { operation.finish(); }
  }
  async function favorite(venue: Venue, remove: boolean) {
    const operation = start(); if (!operation) return;
    try { operation.guard(); await requestAccount(operation.session, 'PATCH', { action: 'favorite', venue, saved: !remove }); operation.guard(); if (remove) setVenues(v => v.filter(x => x.provider_id !== venue.provider_id)); else void Taro.showToast({title:'已收藏',icon:'success'}); }
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
  return <View><View className="wv-hero mint"><Text className="wv-eyebrow">IDEAS FOR YOUR NEXT DAY</Text><Text className="wv-title">把好去处，变成下一次相聚。</Text><Text className="wv-subtitle">探索 {city}，或从身边开始。</Text></View>
    <View className="wv-search"><Input value={keyword} maxlength={80} placeholder="搜索地点、商圈或关键词" onInput={e=>{invalidate();keywordRef.current=e.detail.value;setKeyword(e.detail.value);setSelected(undefined);setError('');}} onConfirm={()=>void find()} /></View>
    <View className="wv-inline"><Action disabled={busy} onClick={()=>void find()}>搜索地点</Action><Action disabled={busy} onClick={()=>void find(true)}>查看附近</Action><Action disabled={busy} onClick={()=>void showFavorites()}>我的收藏</Action></View>
    {error && <Notice tone="error">{error}</Notice>}{busy && <Text className="wv-muted">正在处理地点操作…</Text>}
    {!busy && !error && venues.length===0 && <View className="wv-empty"><Text className="wv-empty-icon">⌕</Text><Text className="wv-section-title">{searched ? '这里暂时没有地点' : '你的灵感，从搜索开始'}</Text><Text className="wv-muted">{favorites ? '收藏喜欢的地点，下次一起去。' : '地点来自已配置的地图服务，不展示虚构商家。'}</Text></View>}
    {venues.map(venue=><View className="wv-card" key={venue.provider_id}><Text className="wv-card-title" onClick={()=>select(venue)}>{venue.name}</Text><Text className="wv-muted">{venue.category_text || '地点'} · {venue.address || '暂无详细地址'}</Text>{venue.search_distance_m!==null && <Text className="wv-muted">搜索距离约 {venue.search_distance_m} 米（非步行路线）</Text>}<View className="wv-inline"><Action disabled={busy} onClick={()=>select(venue)}>查看详情</Action><Action disabled={busy} onClick={()=>void favorite(venue,favorites)}>{favorites?'取消收藏':'收藏地点'}</Action></View></View>)}
    {selected && <View className="wv-overlay" onClick={()=>select(undefined)}><View className="wv-sheet" onClick={e=>e.stopPropagation()}><Text className="wv-section-title">{selected.name}</Text><Text className="wv-muted">{selected.address || '暂无详细地址'}</Text><Text className="wv-muted">地图来源：高德 · 未核实商家营业及预订情况</Text><Action variant="primary" disabled={busy} onClick={()=>void openMap(selected)}>地图位置与导航</Action>{error && <Notice>{error}</Notice>}<Action onClick={()=>select(undefined)}>关闭</Action></View></View>}
  </View>;
}

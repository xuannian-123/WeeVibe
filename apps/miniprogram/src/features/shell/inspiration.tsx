import {inspirationGroups,inspirationCategory,classifyInspirationVenue} from '@weevibe/contracts';
import { CInspirationView } from '../design-c/inspiration-view';
import { CVenueDetail } from '../design-c/venue';
import { CLocationSettings, CNotice } from '../design-c/ui';
import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload, usePageScroll } from '@tarojs/taro';
import { Button, Text, View, Input, ScrollView } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import type { Venue,VenueCategory } from '@weevibe/contracts';
import { getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { locationError, locateBrowseCenterForSession, nearbyForSession, searchForSession } from './location-api';
import { useMapPicker } from '../../platform/use-map-picker';
import type { Gcj02 } from '@weevibe/contracts';
type InspirationCenter = { name: string; location: Gcj02 };
import { needsLocationSettings } from '../../platform/location-permission';

const categories=['全部',...inspirationGroups.map(g=>g.title)];
export type InspirationReturnState={venues:Venue[];searched:boolean;scope:'nearby'|'city';scopeNote:string;scroll:number};
export type InspirationBrowseState={radiusKm?:number;mapPlace?:InspirationCenter;favoritesBack?:InspirationReturnState;keyword:string;area:string;category:string;venues:Venue[];searched:boolean;favorites:boolean;scope?:'nearby'|'city'};
export function Inspiration({ city, authenticated, manualCity=false, initialKeyword='', login, initialFavorites, accountChanged, plan, initialBrowse, browseChanged, autoBrowse=false, chooseCity }: { autoBrowse?:boolean;chooseCity?:()=>void;city: string; manualCity?:boolean; authenticated: boolean; initialBrowse?:InspirationBrowseState; browseChanged?:(v:InspirationBrowseState)=>void; initialKeyword?:string; login: (input:{keyword:string;city:string}) => void; initialFavorites?: Venue[]; accountChanged?: (v: AccountSnapshot) => void; plan?: (v: Venue) => void }) {
  const actorSession = useRef(getToken());
  const [radiusKm,setRadiusKm]=useState(initialBrowse?.radiusKm??2);
  const [mapPlace,setMapPlace]=useState<InspirationCenter|undefined>(initialBrowse?.mapPlace);
  const mapLock=useRef(false);
  const pickMap=useMapPicker(false,actorSession.current);
  async function selectMap(){
    if(mapLock.current||!mounted.current||!visible.current)return;
    if(!authenticated){login({keyword:keywordRef.current,city});return;}
    if(getToken()!==actorSession.current)return;
    mapLock.current=true;invalidate();setError('');
    try{
      const place=await pickMap(mapPlace?.location);
      if(!place||!mounted.current||!visible.current||getToken()!==actorSession.current)return;
      setMapPlace(place);setArea(place.name);setScope('city');
      await find(false,category,place.name,radiusKm,place);
    }catch(e){if(mounted.current&&visible.current&&getToken()===actorSession.current&&!(e instanceof ApiClientError&&e.code==='MAP_PICKER_STALE')){setError(errorText(e));setLocationDenied(needsLocationSettings(e));}}
    finally{mapLock.current=false;}
  }
  const [scopeOpen,setScopeOpen]=useState(false);const pageScroll=useRef(0);usePageScroll?.(event=>{pageScroll.current=event.scrollTop;});
  const favoritesReturn=useRef<InspirationReturnState|undefined>(initialBrowse?.favoritesBack);
  const[scope,setScope]=useState<'nearby'|'city'>(initialBrowse?.scope??'city'),[scopeNote,setScopeNote]=useState(''),[undo,setUndo]=useState<{venue:Venue;until:number}>();
  useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>setUndo(undefined),Math.max(0,undo.until-Date.now()));return()=>clearTimeout(timer);},[undo]);
  const [keyword, setKeyword] = useState(initialBrowse?.keyword??initialKeyword); const keywordRef=useRef(initialBrowse?.keyword??initialKeyword); const [venues, setVenues] = useState<Venue[]>(initialBrowse?.favorites?(initialFavorites??initialBrowse.venues):initialBrowse?.venues??[]);
  const [error, setError] = useState(''); const [locationDenied,setLocationDenied]=useState(false); const [busy, setBusy] = useState(false); const [searched, setSearched] = useState(initialBrowse?.searched??false);
  const [favorites, setFavorites] = useState(initialBrowse?.favorites??false); const [selected, setSelected] = useState<Venue>();
  const [category, setCategory] = useState(initialBrowse?.category??'全部'), [area, setArea] = useState(initialBrowse?.mapPlace?.name??'');
  const [savedIds, setSavedIds] = useState(() => new Set((initialFavorites??(initialBrowse?.favorites?initialBrowse.venues:[])).map(v=>v.provider_id)));
  const mounted = useRef(true), visible = useRef(true), epoch = useRef(0), lock = useRef<number>();
  const current = useRef({ city, authenticated }); current.current = { city, authenticated };
  function invalidate() { epoch.current++; lock.current = undefined; if (mounted.current) setBusy(false); }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; lock.current = undefined; }; }, []);
  const sourceCity=useRef(city);
  useEffect(()=>{if(mounted.current&&visible.current&&getToken()===actorSession.current)browseChanged?.({keyword,area,category,venues,searched,favorites,scope,favoritesBack:favoritesReturn.current,radiusKm,mapPlace});},[keyword,area,category,venues,searched,favorites,scope,radiusKm,mapPlace]);
  useEffect(() => { if(sourceCity.current===city)return;sourceCity.current=city;invalidate(); setVenues([]); setSearched(false); setSelected(undefined); setError(''); }, [city]);
  const hide = () => { visible.current = false; invalidate(); };
  useDidHide(hide); useUnload(hide); useDidShow(() => { visible.current = true; });
  function start() {
    if (!authenticated) { if(mounted.current&&visible.current&&getToken()===actorSession.current)login({keyword:keywordRef.current,city}); return; }
    if (!mounted.current || !visible.current || lock.current !== undefined) return;
    if (!actorSession.current || getToken() !== actorSession.current) { setError('登录账号已变化，请重新打开灵感页。'); return; }
    const ticket = ++epoch.current, session = actorSession.current, sourceCity = city;
    lock.current = ticket; setBusy(true); setError(''); setLocationDenied(false);
    const valid = () => mounted.current && visible.current && epoch.current === ticket && current.current.authenticated && current.current.city === sourceCity && getToken() === session;
    const guard = () => { if (!valid()) throw new ApiClientError('INVALID_RESPONSE', '页面或身份来源已变化，旧地点请求未采用。', 0); };
    const finish = () => { if (lock.current === ticket) { lock.current = undefined; if (mounted.current) setBusy(false); } };
    return { session, valid, guard, finish };
  }
  async function find(nearby = false, nextCategory = category, searchArea = area, km = radiusKm, place: InspirationCenter | null | undefined = mapPlace) {
    const operation = start(); if (!operation) return;
    try {
      const search = [place ? '' : searchArea.trim(), keyword.trim() || inspirationCategory(nextCategory)?.keyword || '休闲'].filter(Boolean).join(' ');
      if (search.length > 80) throw new ApiClientError('INVALID_INPUT', '区域与搜索关键词合计请控制在 80 字以内', 400);
      const categoryInput=inspirationCategory(nextCategory)?.api;
      let result;
      if(place&&!nearby){result=await nearbyForSession(operation.session,search,operation.guard,categoryInput,km*1000,place.location);operation.guard();setScope('city');setScopeNote(`${place.name} · ${km}公里内`);}
      else if(nearby){
        const located=await locateBrowseCenterForSession(operation.session,operation.guard,true);operation.guard();
        const name=located.nearest_address!;
        setMapPlace({name,location:located.location});setArea(name);setScope('nearby');setScopeNote(`${name} · ${km}公里内`);
        result=await nearbyForSession(operation.session,search,operation.guard,categoryInput,km*1000,located.location);operation.guard();
      }
      else{result=await searchForSession(operation.session,{region:city,keyword:search,...(categoryInput?{category:categoryInput}:{}),page_size:10},operation.guard);operation.guard();setScope('city');setScopeNote('');}
      operation.guard();const filter=inspirationCategory(nextCategory);setVenues(filter?result.venues.filter(v=>{const choice=classifyInspirationVenue(v);return choice?.group===filter.group&&(!filter.option||choice.option===filter.option);}):result.venues); setFavorites(false); setSearched(true); setSelected(undefined);
    } catch (e) { if (operation.valid()) {setError(nearby ? locationError(e) : errorText(e));setLocationDenied(nearby&&needsLocationSettings(e));} }
    finally { operation.finish(); }
  }
  async function showFavorites() {
    favoritesReturn.current={venues,searched,scope,scopeNote,scroll:pageScroll.current};
    const operation = start(); if (!operation) return;
    try { operation.guard(); const data = await requestAccount(operation.session); operation.guard(); accountChanged?.(data); setVenues(data.favorites); setSavedIds(new Set(data.favorites.map(v => v.provider_id))); setFavorites(true); setSearched(true); setSelected(undefined); }
    catch(e) { if (operation.valid()) setError(errorText(e)); } finally { operation.finish(); }
  }
  async function favorite(venue: Venue, remove: boolean) {
    const operation = start(); if (!operation) return;
    try { operation.guard(); const data = await requestAccount(operation.session, 'PATCH', { action: 'favorite', venue, saved: !remove }); operation.guard(); setSavedIds(new Set(data.favorites.map(v => v.provider_id))); accountChanged?.(data); if(remove){setUndo({venue,until:Date.now()+5000});if(favorites)setVenues(v=>v.filter(x=>x.provider_id!==venue.provider_id));}else{setUndo(undefined);if(favorites)setVenues(data.favorites);} if(!remove)void Taro.showToast({title:'已收藏',icon:'success'}); }
    catch(e) { if (operation.valid()) setError(errorText(e)); } finally { operation.finish(); }
  }
  async function openMap(venue: Venue) {
    const operation = start(); if (!operation) return;
    try { operation.guard(); await Taro.openLocation({ latitude: venue.location.latitude, longitude: venue.location.longitude, name: venue.name, address: venue.address || '' }); operation.guard(); }
    catch(e) { if (operation.valid()) { const reason = String((e as {errMsg?:unknown})?.errMsg ?? (e instanceof Error ? e.message : '')); setError(/cancel/i.test(reason) ? '已取消打开地图，地点和地址仍保留。' : '暂时无法打开地图，可查看地点地址或重试。'); } }
    finally { operation.finish(); }
  }
  function select(venue?: Venue) { if (venue && lock.current !== undefined) return; invalidate(); setSelected(venue); setError(''); }
  useEffect(()=>{if(autoBrowse&&authenticated&&!initialBrowse&&!initialKeyword.trim())void find();},[]);
  function leaveFavorites(){const back=favoritesReturn.current;invalidate();setFavorites(false);setSelected(undefined);setError('');if(back){setVenues(back.venues);setSearched(back.searched);setScope(back.scope);setScopeNote(back.scopeNote);Taro.nextTick?.(()=>void Taro.pageScrollTo?.({scrollTop:back.scroll,duration:0}));}}
  if (getToken() !== actorSession.current) return <CNotice>登录账号已变化，请重新打开灵感页；不会向新账号重放原收藏操作。</CNotice>;
  const permissionEpoch=epoch.current;
  return <><CInspirationView radiusKm={radiusKm} onRadius={(km,searchArea)=>{invalidate();setRadiusKm(km);if(mapPlace)void find(false,category,searchArea,km);}} chooseMap={()=>void selectMap()} locationLabel={mapPlace?.name} city={city} area={area} keyword={keyword} scope={scope} scopeNote={scopeNote} favorites={favorites} busy={busy} searched={searched} category={category} venues={venues} savedIds={savedIds} error={error} scopeOpen={scopeOpen} setScopeOpen={setScopeOpen} chooseCity={chooseCity} exitFavorites={leaveFavorites}
    onKeyword={value=>{invalidate();keywordRef.current=value;setKeyword(value);setSelected(undefined);setError('');}}
    onArea={value=>{invalidate();setMapPlace(undefined);setArea(value);setSelected(undefined);}}
    search={(nearby,searchArea)=>{void find(nearby,category,searchArea,radiusKm,nearby?null:mapPlace);}} chooseCategory={value=>{invalidate();setCategory(value);void find(false,value);}}
    showFavorites={()=>favorites?leaveFavorites():void showFavorites()} open={venue=>select(venue)} favorite={venue=>void favorite(venue,savedIds.has(venue.provider_id))}
    permission={locationDenied?<CLocationSettings current={()=>mounted.current&&visible.current&&epoch.current===permissionEpoch&&getToken()===actorSession.current} changed={granted=>{setLocationDenied(!granted);setError(granted?'位置权限已开启，请再次搜索以使用附近范围。':'位置权限仍未开启，可按城市搜索地点。');}}/>:undefined}/>
    {undo&&<View className="c-ui c-undo"><Text>已取消收藏</Text><Button disabled={busy} onClick={()=>{if(Date.now()<undo.until)void favorite(undo.venue,false);}}>撤销</Button></View>}
    {selected&&<CVenueDetail venue={selected} busy={busy} error={error} map={()=>void openMap(selected)} saved={savedIds.has(selected.provider_id)} favorite={()=>void favorite(selected,savedIds.has(selected.provider_id))} close={()=>select(undefined)} plan={()=>{if(mounted.current&&visible.current&&actorSession.current===getToken())plan?.(selected);}}/>}
  </>;
}

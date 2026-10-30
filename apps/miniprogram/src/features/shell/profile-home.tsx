import {MemoryPanel} from '../gatherings/memory-panel';
import { uploadAvatar } from '../../platform/avatar';
import Taro, { usePageScroll } from '@tarojs/taro';
import { CProfileView } from '../design-c/profile-view';
import { CVenueDetail } from '../design-c/venue';
import { CNotice } from '../design-c/ui';
import type {ReactNode} from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { Venue } from '@weevibe/contracts';
import { profilePresentationSchema } from '@weevibe/contracts';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';

export type ProfileHomeBrowseState={allFavorites:boolean;returnScroll:number};
export function ProfileHome({ account, session, edit, settings, activities, changed, plan, gatherings, avatarSaved, initialBrowse, browseChanged }: { initialBrowse?:ProfileHomeBrowseState;browseChanged?:(state:ProfileHomeBrowseState)=>void; avatarSaved?:(path:string)=>void; gatherings?:ReactNode; account: AccountSnapshot; session: string; edit: (nickname?:boolean) => void; settings: () => void; activities: (filter: 'managed' | 'joined') => void; changed: (v: AccountSnapshot) => void; plan: (v: Venue) => void }) {
  const [memoryOpen,setMemoryOpen]=useState(false);
  const [allFavorites, setAllFavorites] = useState(initialBrowse?.allFavorites??false), [selected, setSelected] = useState<Venue>(),[undo,setUndo]=useState<{venue:Venue;until:number}>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''); const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>setUndo(undefined),Math.max(0,undo.until-Date.now()));return()=>clearTimeout(timer);},[undo]);
  const valid = () => mounted.current && getToken() === session;
  const scroll=useRef(0),returnScroll=useRef(initialBrowse?.returnScroll??0);usePageScroll?.(event=>{scroll.current=event.scrollTop;});
  const openFavorites=()=>{if(!valid())return;returnScroll.current=scroll.current;setAllFavorites(true);browseChanged?.({allFavorites:true,returnScroll:returnScroll.current});Taro.nextTick?.(()=>void Taro.pageScrollTo?.({scrollTop:0,duration:0}));};
  const closeFavorites=()=>{if(!valid())return;setAllFavorites(false);browseChanged?.({allFavorites:false,returnScroll:returnScroll.current});Taro.nextTick?.(()=>void Taro.pageScrollTo?.({scrollTop:returnScroll.current,duration:0}));};
  async function chooseAvatar(path:string){if(!valid()||lock.current||!path)return;lock.current=true;setBusy(true);setNotice('');try{const saved=await uploadAvatar(path,session);if(valid())avatarSaved?.(saved);}catch(e){if(valid())setNotice(errorText(e));}finally{lock.current=false;if(valid())setBusy(false);}}
  async function remove(venue: Venue,restore=false) {
    if (!valid() || lock.current) return; lock.current = true; setBusy(true); setNotice('');
    try { const next = await requestAccount(session, 'PATCH', { action: 'favorite', venue, saved: restore }); if (valid()) { changed(next);setUndo(restore?undefined:{venue,until:Date.now()+5000}); } }
    catch (e) { if (valid()) setNotice(errorText(e)); } finally { lock.current = false; if (valid()) setBusy(false); }
  }
  if (!valid()) return <CNotice>账号已变化，原账号的主页和收藏已隐藏，请重新打开。</CNotice>;
  return <><CProfileView profile={account.profile} chooseAvatar={path=>void chooseAvatar(path)} favorites={account.favorites} busy={busy} notice={notice} allFavorites={allFavorites} edit={()=>edit()} editNickname={()=>edit(true)} settings={settings} activities={activities} showFavorites={openFavorites} closeFavorites={closeFavorites} openVenue={setSelected} remove={venue=>void remove(venue)}/>
    <Button onClick={()=>setMemoryOpen(v=>!v)}>偏好记忆</Button>{memoryOpen&&<MemoryPanel session={session}/>}
    {undo&&<View className="c-ui c-undo"><Text>已取消收藏</Text><Button disabled={busy} onClick={()=>{if(Date.now()<undo.until)void remove(undo.venue,true);}}>撤销</Button></View>}
    {selected&&<CVenueDetail venue={selected} busy={busy} error={notice} saved={account.favorites.some(venue=>venue.provider_id===selected.provider_id)} favorite={()=>void remove(selected,!account.favorites.some(venue=>venue.provider_id===selected.provider_id))} close={()=>setSelected(undefined)} plan={()=>{if(valid())plan(selected);}}/>}
  </>;
}

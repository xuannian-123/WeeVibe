import type {ReactNode} from 'react';
import { useEffect, useRef, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { Venue } from '@weevibe/contracts';
import { profilePresentationSchema } from '@weevibe/contracts';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { getToken } from '../../platform/api';
import { ProfileCard } from './profile-card';
import { VenueCard, VenueDetail } from './venue-card';
import { Action, Notice } from '../../components/ui';
import { errorText } from '../../platform/page-state';

export function ProfileHome({ account, session, edit, settings, activities, changed, plan, gatherings }: { gatherings?:ReactNode; account: AccountSnapshot; session: string; edit: () => void; settings: () => void; activities: (filter: 'managed' | 'joined') => void; changed: (v: AccountSnapshot) => void; plan: (v: Venue) => void }) {
  const [allFavorites, setAllFavorites] = useState(false), [selected, setSelected] = useState<Venue>(),[undo,setUndo]=useState<{venue:Venue;until:number}>();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''); const mounted = useRef(true), lock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(()=>{if(!undo)return;const timer=setTimeout(()=>setUndo(undefined),Math.max(0,undo.until-Date.now()));return()=>clearTimeout(timer);},[undo]);
  const valid = () => mounted.current && getToken() === session;
  const displayed={nickname:account.profile.nickname||'',...profilePresentationSchema.parse({})},p=account.profile;
  async function remove(venue: Venue,restore=false) {
    if (!valid() || lock.current) return; lock.current = true; setBusy(true); setNotice('');
    try { const next = await requestAccount(session, 'PATCH', { action: 'favorite', venue, saved: restore }); if (valid()) { changed(next);setSelected(undefined);setUndo(restore?undefined:{venue,until:Date.now()+6000}); } }
    catch (e) { if (valid()) setNotice(errorText(e)); } finally { lock.current = false; if (valid()) setBusy(false); }
  }
  if (!valid()) return <Notice>账号已变化，原账号的主页和收藏已隐藏，请重新打开。</Notice>;
  return <View className="wv-profile-home"><ProfileCard profile={displayed} session={session} avatarPath={p.avatar_url} edit={edit} settings={settings}/>
    <View>
      <View className="wv-section-heading"><Text className="wv-section-title">我的活动</Text></View><View className="wv-my-activity-links"><Button onClick={() => activities('managed')}><Text>我组织的</Text><Text>安排每一次相聚　›</Text></Button><Button onClick={() => activities('joined')}><Text>我参与的</Text><Text>一起留下的好时光　›</Text></Button></View>
      {gatherings}
      <View className="wv-section-heading"><Text className="wv-section-title">我的收藏</Text><Button className="wv-link" onClick={() => setAllFavorites(v => !v)}>{allFavorites ? '收起' : '全部'}　›</Button></View>
      {notice && <Notice tone="error">{notice}</Notice>}
      {account.favorites.length ? <View className="wv-venue-grid">{account.favorites.slice(0, allFavorites ? 100 : 2).map(v => <VenueCard key={v.provider_id} venue={v} saved busy={busy} open={() => setSelected(v)} favorite={() => void remove(v)}/>)}</View> : <View className="wv-empty compact"><Text className="wv-muted">把想一起去的地点，慢慢收藏起来。</Text></View>}


    </View>
    {undo&&<View className="wv-undo"><Text>已取消收藏</Text><Button disabled={busy} onClick={()=>{if(Date.now()<undo.until)void remove(undo.venue,true);}}>撤销</Button></View>}
    {selected && <VenueDetail venue={selected} busy={busy} saved favorite={() => void remove(selected)} close={() => setSelected(undefined)} plan={() => { if (valid()) plan(selected); }}/>}
  </View>;
}

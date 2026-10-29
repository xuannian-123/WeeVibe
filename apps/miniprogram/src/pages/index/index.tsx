import { CSupportPages } from '../../features/design-c/support-pages';
import { CInvitationsPage, CManualActivityPage, CMoreMenu, CLogoutDialog, CLoginSheet } from '../../features/design-c/account-tools';
import { cAccountUrl, clearCActivityBrowse, readCActivityBrowse, rememberCActivityBrowse, type CAccountPage, type CActivityEntry } from '../../features/design-c/account-navigation';
import { CCreateSheet, CCitySheet } from '../../features/design-c/entry-sheets';
import { CAction, CNotice, CPageHeading, CLocationSettings } from '../../features/design-c/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@weevibe/api-client';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { loadAvatar } from '../../platform/avatar';
import { activityIdSchema, type InboxSnapshot, type Venue } from '@weevibe/contracts';
import { establishSession, forgetSession, getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { automaticUser, logoutAutomaticSession, resumeAutomaticLogin } from '../../platform/automatic-session';
import { locateCityForSession, locationError } from '../../features/shell/location-api';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { PrivacyConsent } from '../../components/privacy-consent';
import { needsLocationSettings } from '../../platform/location-permission';
import { useTabScroll } from '../../features/shell/use-tab-scroll';
import type { InspirationBrowseState } from '../../features/shell/inspiration';
import { Inspiration } from '../../features/shell/inspiration';
import { ProfileForm } from '../../features/shell/profile';
import { validCity } from '../../features/shell/helpers';
import { CActivityOverview } from '../../features/design-c/activity-overview';
import type { TodoIdentity } from '../../features/todos/api';
import { CVenueDetail as VenueDetail } from '../../features/design-c/venue';
import { CGoHome } from '../../features/design-c/home';
import { CHeader, CNavigation } from '../../features/design-c/chrome';
import { useCPreparations } from '../../features/design-c/use-preparations';
import { ProfileHome, type ProfileHomeBrowseState } from '../../features/shell/profile-home';
import { Messages } from '../../features/shell/messages';
import { requestInbox } from '../../platform/navigation-api';
import { newKey, save } from '../../platform/page-state';
import './home.css';
import '../../features/shell/navigation.css';
import '../../features/shell/polish.css';
import '../../design-c.css';
import '../../features/design-c/account-navigation.css';

type Account = AccountSnapshot;
type Tab = 'go'|'ideas'|'messages'|'me';
type LoginDestination = ({ kind:'ideas'; keyword:string; city:string } | {kind:'account';page:CAccountPage;group?:CActivityEntry} | { kind:'friend'|'team'|'preparation'|'direct' }) & { session?:string; actor?:string };
type IdeasInput = { session:string|undefined; keyword:string; city:string };

export default function Home({routePage,routeGroup='all'}:{routePage?:CAccountPage;routeGroup?:CActivityEntry}={}) {
  const [todoIdentity,setTodoIdentity]=useState<TodoIdentity>();
  const [inboxState,setInboxState]=useState<{session:string;value:InboxSnapshot}>(), [inboxError,setInboxError]=useState('');
  const inbox=inboxState?.session===getToken()?inboxState?.value:undefined;
  const [tab,setTab]=useState<Tab>(()=>routePage||Taro.getCurrentInstance?.().router?.params?.tab==='me'?'me':'go'); const [city,setCity]=useState(()=>String(Taro.getStorageSync('weevibe_selected_city') || '北京'));
  const [cityOpen,setCityOpen]=useState(false); const [citySearch,setCitySearch]=useState(''); const [createOpen,setCreateOpen]=useState(false);
  const [storedAccount,setAccount]=useState<Account>(); const [signedIn,setSignedIn]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [locationNote,setLocationNote]=useState(''); const [locationDenied,setLocationDenied]=useState(false);
  const profileBack=useRef<''|'settings'>('');const[moreOpen,setMoreOpen]=useState(false);const [subpage,setSubpage]=useState<'profile'|'settings'|'activities'|'invitations'|'number'|'privacy'|'help'|'about'|''>(routePage||''); const generation=useRef(0); const loginBusy=useRef<number>(); const accountSession=useRef<string>();
  const account=accountSession.current && accountSession.current===getToken()?storedAccount:undefined;
  const[goVenue,setGoVenue]=useState<{session:string;venue:Venue}>(),[goVenueWrite,setGoVenueWrite]=useState<{session:string;key:string}>(),[goVenueError,setGoVenueError]=useState<{session:string;venueId:string;message:string}>();const goVenueLock=useRef<{session:string;key:string}>();const goVenueBusy=goVenueWrite?.session===getToken();
  const [manualId,setManualId]=useState(''),[manualError,setManualError]=useState(''),[manualBusy,setManualBusy]=useState(false);const manualLock=useRef(false),activityNavigationLock=useRef(false),permissionsLock=useRef(false);
  const [loginOpen,setLoginOpen]=useState(false),[logoutOpen,setLogoutOpen]=useState(false),[supportNotice,setSupportNotice]=useState('');
  const [profileNicknameFocus,setProfileNicknameFocus]=useState(false);
  const ideasAutoSource=useRef<string>();
  const cPreparations=useCPreparations(todoIdentity?.session===getToken()?todoIdentity?.session:undefined,tab==='go'||tab==='me'&&subpage==='activities');
  const [loginDestination,setLoginDestination]=useState<LoginDestination>(); const destinationRef=useRef<LoginDestination>();
  const [ideasInput,setIdeasInput]=useState<IdeasInput>(); const [loggingIn,setLoggingIn]=useState(false);
  const destinationEpoch=useRef(0), loginSequence=useRef(0);
  const browseCache=useRef<{session:string|undefined;city:string;state:InspirationBrowseState}>();
  const messageFilter=useRef(false);const myBrowseCache=useRef<{session:string;state:ProfileHomeBrowseState}>();
  const cacheOwner=useRef(getToken());if(cacheOwner.current!==getToken()){cacheOwner.current=getToken();browseCache.current=undefined;myBrowseCache.current=undefined;messageFilter.current=false;ideasAutoSource.current=undefined;}
  useTabScroll(tab,subpage,`${getToken()||'guest'}:${city}`,cityOpen||createOpen||subpage==='activities');
  function rememberDestination(value:LoginDestination|undefined){destinationRef.current=value;setLoginDestination(value);}
  function abandonDestination(){destinationEpoch.current++;loginBusy.current=undefined;rememberDestination(undefined);setIdeasInput(undefined);if(cityMounted.current)setLoggingIn(false);}
  function changeTab(next:Tab){setLoginOpen(false);setLogoutOpen(false);setMoreOpen(false);abandonDestination();if(next==='ideas')ideasAutoSource.current=account&&accountSession.current===getToken()&&!error&&!loggingIn&&!busy?getToken():undefined;setTab(next);setSubpage(routePage||'');}
  function requestIdeasLogin(input:{keyword:string;city:string}){
    // Only a genuinely unauthenticated draft may cross this explicit guest login.
    // Never transfer a prior account's keyword, result list, selection or coordinates.
    if(!cityMounted.current||!cityVisible.current)return;
    if(getToken()){setError('登录状态正在核对，请刷新后重新打开灵感页。');return;}
    abandonDestination();rememberDestination({kind:'ideas',keyword:input.keyword.slice(0,80),city:input.city});
    setTab('me');setSubpage(routePage||'');setLoginOpen(true);setError('请先登录。成功后返回灵感并保留关键词，不会自动搜索或定位。');
  }
  function cancelLoginReturn(){
    const previous=destinationRef.current;abandonDestination();setLoginOpen(false);setError('');
    if(previous?.kind==='ideas'&&!getToken()){
      setIdeasInput({session:undefined,keyword:previous.keyword,city:previous.city});
    }
    if(previous?.kind==='ideas')setTab('ideas');
  }

  const [locating,setLocating]=useState(false); const cityMounted=useRef(true), cityVisible=useRef(true), cityOpenRef=useRef(false), cityEpoch=useRef(0), cityLock=useRef<number>();
  function invalidateCityLookup(){cityEpoch.current++;cityLock.current=undefined;if(cityMounted.current)setLocating(false);}
  useEffect(()=>{cityMounted.current=true;return()=>{cityMounted.current=false;cityEpoch.current++;cityLock.current=undefined;destinationEpoch.current++;loginBusy.current=undefined;generation.current++;};},[]);
  const hideCity=()=>{cityVisible.current=false;invalidateCityLookup();abandonDestination();generation.current++;}; useDidHide(hideCity);useUnload(hideCity);
  function openCity(){abandonDestination();invalidateCityLookup();cityOpenRef.current=true;setCityOpen(true);setLocationNote('');setLocationDenied(false);}
  function closeCity(){invalidateCityLookup();cityOpenRef.current=false;setCityOpen(false);setLocationNote('');}
  function editCity(value:string){invalidateCityLookup();setCitySearch(value);setLocationNote('');}
  async function refresh() {
    const gen=++generation.current; let session=getToken();
    const current=()=>cityMounted.current&&cityVisible.current&&gen===generation.current&&getToken()===session;
    if(todoIdentity?.session!==session){setTodoIdentity(undefined);setSignedIn(false);}
    if(accountSession.current&&accountSession.current!==session){accountSession.current=undefined;setAccount(undefined);setSignedIn(false);setSubpage(routePage||'');setIdeasInput(undefined);}
    setError('');
    setBusy(true); let verified:TodoIdentity|undefined;
    try{
      const identity=await automaticUser();
      if(!cityMounted.current||!cityVisible.current||gen!==generation.current||getToken()!==identity.session)return;
      session=identity.session; const actor=identity.user;
      const parsed=activityIdSchema.safeParse(actor.user_id);
      if(!parsed.success)throw new ApiClientError('INVALID_RESPONSE','登录身份无法核实',200);
      verified={actor_id:parsed.data,session};setSignedIn(true);setTodoIdentity(verified);
      const accountRequest=requestAccount(session);
      setInboxError(''); void requestInbox(session).then(value=>{if(current())setInboxState({session:session!,value});}).catch(e=>{if(current())setInboxError(errorText(e));});
      const next=await accountRequest;if(!current())return;
      accountSession.current=session;setAccount(next);
      try{const avatar=await loadAvatar(actor.user_id);if(current())setAccount(value=>value?{...value,profile:{...value.profile,avatar_url:avatar}}:value);}catch{/* Avatar is optional. */}
    }catch(e){if(current()){
      setAccount(undefined);
      if(e instanceof ApiClientError&&e.code==='UNAUTHENTICATED'){forgetSession();verified=undefined;setTodoIdentity(undefined);setSignedIn(false);setSubpage(routePage||'');setIdeasInput(undefined);}
      setError(errorText(e));
    }}finally{if(cityMounted.current&&gen===generation.current)setBusy(false);}
    return current()?verified:undefined;
  }
  useDidShow(()=>{cityVisible.current=true;void refresh();});
  async function login(){
    if(loginBusy.current!==undefined||!cityMounted.current||!cityVisible.current)return;
    const destination=destinationRef.current;
    if(destination&&destination.session!==getToken()){abandonDestination();setError('登录来源已变化，请重新选择目标；旧输入未转交其他账号。');return;}
    const ticket=++loginSequence.current, epoch=destinationEpoch.current, sourceSession=getToken();
    loginBusy.current=ticket;setLoggingIn(true);setError('');
    const current=()=>cityMounted.current&&cityVisible.current&&loginBusy.current===ticket&&destinationEpoch.current===epoch;
    try{
      const established=await establishSession(()=>{
        if(!current()||getToken()!==sourceSession)throw new ApiClientError('UNAUTHENTICATED','登录来源已变化，旧会话未写入。',401);
      });if(!current())return;
      resumeAutomaticLogin();
      const session=getToken(), actor=activityIdSchema.safeParse(established?.user_id);
      if(!session||!actor.success)throw new ApiClientError('INVALID_RESPONSE','登录身份无法核实',200);
      if(destination?.actor&&destination.actor!==actor.data){rememberDestination(undefined);setIdeasInput(undefined);throw new ApiClientError('UNAUTHENTICATED','登录来源已变化',401);}
      if(destination){destination.session=session;destination.actor=actor.data;}
      const verified=await refresh();if(!current())return;
      if(getToken()===session&&!verified)return; // Transient verification failure: keep this intent for explicit same-source retry.
      if(getToken()!==session||verified?.session!==session||verified.actor_id!==actor.data){
        rememberDestination(undefined);setIdeasInput(undefined);
        throw new ApiClientError('UNAUTHENTICATED','登录来源已变化，请重新选择目标。',401);
      }
      if(destinationRef.current!==destination)return;
      rememberDestination(undefined);setLoginOpen(false);
      if(destination?.kind==='account'){openAccountPage(destination.page,destination.group);}
      else if(destination?.kind==='ideas'){
        setIdeasInput({session,keyword:destination.keyword,city:destination.city});setTab('ideas');setSubpage(routePage||'');
      }else if(destination?.kind==='direct')void Taro.navigateTo({url:'/pages/editor/index'});else if(destination?.kind==='friend'||destination?.kind==='team'||destination?.kind==='preparation')void Taro.navigateTo({url:`/pages/gathering/index?new=${destination.kind==='team'?'team':'friend'}`});
    }catch(e){if(current())setError(errorText(e));}
    finally{if(loginBusy.current===ticket){loginBusy.current=undefined;if(cityMounted.current)setLoggingIn(false);}}
  }
  function logout(){clearCActivityBrowse();setLogoutOpen(false);setLoginOpen(false);browseCache.current=undefined;myBrowseCache.current=undefined;messageFilter.current=false;ideasAutoSource.current=undefined;abandonDestination();invalidateCityLookup();closeCity();generation.current++;logoutAutomaticSession();setTodoIdentity(undefined);accountSession.current=undefined;setAccount(undefined);setSignedIn(false);setSubpage(routePage||'');setError('');setBusy(false);setTab('me');void Taro.reLaunch({url:'/pages/index/index?tab=me'});}
  function chooseCity(value:string){invalidateCityLookup();if(!validCity(value)){setLocationNote('请输入有效的城市名称');return;}abandonDestination();setCity(value.trim());Taro.setStorageSync('weevibe_selected_city',value.trim());closeCity();setCitySearch('');}
  async function locate(){
    if(cityLock.current!==undefined||!cityMounted.current||!cityVisible.current||!cityOpenRef.current)return;
    const sourceSession=getToken();if(!sourceSession){setLocationNote('自动识别城市需要登录以保护地点服务额度；你仍可直接手动选择。');return;}
    const ticket=++cityEpoch.current;cityLock.current=ticket;setLocating(true);setLocationNote('正在核对身份并请求你的位置…');
    const current=()=>cityMounted.current&&cityVisible.current&&cityOpenRef.current&&ticket===cityEpoch.current&&getToken()===sourceSession;
    const guard=()=>{if(!current())throw new ApiClientError('INVALID_RESPONSE','城市定位来源已变化，旧结果未采用。',0);};
    try{const result=await locateCityForSession(sourceSession,guard);guard();setCitySearch(result.city);setLocationNote('已识别 '+result.city+'，点击下方确认使用。');}
    catch(e){if(current()){setLocationNote(locationError(e));setLocationDenied(needsLocationSettings(e));}}
    finally{if(cityLock.current===ticket){cityLock.current=undefined;if(cityMounted.current){setLocating(false);if(cityVisible.current&&cityOpenRef.current&&getToken()!==sourceSession)setLocationNote('登录身份已变化，旧定位结果未使用；可重新发起或手动选择城市。');}}}
  }
  async function openActivity(id:string){
    if(activityNavigationLock.current)return;abandonDestination();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)){setError('活动编号格式不正确');return;}
    activityNavigationLock.current=true;const session=getToken();
    try{await Taro.navigateTo({url:`/pages/activity/index?id=${encodeURIComponent(id)}`});}
    catch{if(cityMounted.current&&cityVisible.current&&getToken()===session)setError('活动暂时无法打开，请重试。');}
    finally{activityNavigationLock.current=false;}
  }
  function create(kind:'friend'|'team'|'preparation'|'direct'){abandonDestination();setCreateOpen(false);if(!signedIn){rememberDestination({kind,session:getToken()});setLoginOpen(true);setError('请先使用微信身份登录，登录后继续创建。');return;}void Taro.navigateTo({url:kind==='direct'?'/pages/editor/index':`/pages/gathering/index?new=${kind==='team'?'team':'friend'}`});}
  function openProfile(nickname=false){abandonDestination();setProfileNicknameFocus(nickname===true);if(account && accountSession.current===getToken()){profileBack.current=subpage==='settings'?'settings':'';setSubpage('profile');}else setError('头像与昵称尚未读取，请先刷新账户数据。');}
  function storeAccount(next:Account) { const session=accountSession.current; if(!session||session!==getToken())return; generation.current++;setBusy(false);setAccount({...next,profile:{...next.profile,avatar_url:account?.profile.avatar_url}}); }
  async function refreshInbox(){const session=getToken(),gen=generation.current;if(!session)return;setInboxError('');try{const value=await requestInbox(session);if(cityMounted.current&&cityVisible.current&&session===getToken()&&gen===generation.current)setInboxState({session,value});}catch(e){if(cityMounted.current&&session===getToken()&&gen===generation.current)setInboxError(errorText(e));}}
  function allActivities(filter:'all'|'managed'|'joined'='all'){if(!signedIn){abandonDestination();rememberDestination({kind:'account',page:'activities',group:filter,session:getToken()});setLoginOpen(true);return;}openAccountPage('activities',filter);}
  function openAccountPage(page:CAccountPage,group?:CActivityEntry){
    abandonDestination();setMoreOpen(false);setSupportNotice('');
    const ticket=generation.current;
    void Taro.navigateTo({url:cAccountUrl(page,group)}).catch(()=>{if(cityMounted.current&&cityVisible.current&&generation.current===ticket)setError('页面暂时无法打开，请重试。');});
  }
  function backAccountPage(){
    if(!routePage){setSubpage(routePage||'');return;}
    const fallback=routePage==='privacy'||routePage==='help'||routePage==='about'?cAccountUrl('settings'):routePage==='invitations'||routePage==='number'?cAccountUrl('activities'):'/pages/index/index?tab=me';
    void Taro.navigateBack().catch(()=>Taro.redirectTo({url:fallback})).catch(()=>{if(cityMounted.current)setSupportNotice('暂时无法返回，请从微信返回后重新打开。');});
  }
  function requestLogin(){setLoginOpen(true);setError('');}
  async function openManualActivity(){
    if(manualLock.current)return;const id=manualId.trim();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)){setManualError('请输入有效的活动编号，仅支持字母、数字、下划线和短横线。');return;}
    manualLock.current=true;setManualBusy(true);setManualError('');const session=getToken();
    try{await Taro.navigateTo({url:`/pages/activity/index?id=${encodeURIComponent(id)}`});}
    catch{if(cityMounted.current&&cityVisible.current&&getToken()===session)setManualError('活动暂时无法打开，编号已保留，请重试。');}
    finally{manualLock.current=false;if(cityMounted.current)setManualBusy(false);}
  }
  async function openPermissions(){
    if(permissionsLock.current)return;permissionsLock.current=true;setSupportNotice('');const session=getToken(),ticket=generation.current;
    try{await Taro.openSetting();}
    catch{if(cityMounted.current&&cityVisible.current&&getToken()===session&&generation.current===ticket)setSupportNotice('微信权限设置暂时无法打开，请稍后重试。');}
    finally{permissionsLock.current=false;}
  }
  async function toggleGoVenue(){const current=goVenue,session=getToken();if(!current||!session||current.session!==session||goVenueLock.current?.session===session)return;const operation={session,key:newKey()};goVenueLock.current=operation;setGoVenueWrite(operation);setGoVenueError(undefined);try{const saved=account?.favorites.some(v=>v.provider_id===current.venue.provider_id)??false;const next=await requestAccount(session,'PATCH',{action:'favorite',venue:current.venue,saved:!saved});if(getToken()===session)storeAccount(next);}catch(e){if(getToken()===session)setGoVenueError({session,venueId:current.venue.provider_id,message:errorText(e)});}finally{if(goVenueLock.current===operation){goVenueLock.current=undefined;setGoVenueWrite(undefined);}}}
  function planVenue(venue:Venue){const identity=todoIdentity;if(!identity||identity.session!==getToken()){setError('请先核对微信身份，再从地点开始创建。');return;}const id=newKey();save(`weevibe-venue-plan-v1:${id}`,{owner_user_id:identity.actor_id,venue});void Taro.navigateTo({url:`/pages/gathering/index?new=friend&inspiration=${id}`});}
  const loginPrompt=<View className="c-ui c-account-access"><Text className="c-section-title">微信登录</Text><Text className="c-hint">登录后查看本人的活动、邀请和消息。</Text><CAction variant="primary" disabled={busy||loggingIn} onClick={requestLogin}>{loggingIn||busy?'正在恢复登录…':'微信登录'}</CAction>{loginDestination?.kind==='ideas'&&<CAction onClick={cancelLoginReturn}>取消并返回灵感</CAction>}</View>;
  const accountNotice=<View className="c-ui c-account-access"><Text className="c-section-title">{busy?'正在读取账户数据…':'账户数据尚未读取'}</Text><Text className="c-hint">暂时无法确认本人活动与邀请，不把读取失败当作空列表。</Text><CAction disabled={busy} onClick={()=>void refresh()}>刷新账户数据</CAction></View>;
  const activityPage=!signedIn?<><CPageHeading title="我的活动"><CAction variant="text" onClick={backAccountPage}>返回</CAction></CPageHeading>{loginPrompt}</>:!account?accountNotice:<CActivityOverview session={getToken()} initialBrowse={readCActivityBrowse(getToken(),routeGroup)} browseChanged={rememberCActivityBrowse} account={account} initialGroup={routeGroup==='managed'?'managing':routeGroup} preparations={cPreparations.records} busy={cPreparations.busy} error={cPreparations.error} refresh={()=>void cPreparations.refresh()} openActivity={openActivity} openPreparation={id=>void Taro.navigateTo({url:`/pages/gathering/index?id=${encodeURIComponent(id)}`})} back={backAccountPage} more={()=>setMoreOpen(true)}/>;
  let myContent;
  if(subpage==='profile'&&signedIn)myContent=<ProfileForm initialNicknameFocus={profileNicknameFocus} ownerSession={accountSession.current} initial={account?.profile||{}} close={()=>{setSubpage(profileBack.current);void refresh();}} saved={profile=>{generation.current++;setBusy(false);setAccount(a=>a?{...a,profile}:a);}} avatarSaved={path=>{generation.current++;setBusy(false);setAccount(a=>a?{...a,profile:{...a.profile,avatar_url:path}}:a);}}/>;
  else if(subpage==='activities')myContent=activityPage;
  else if(subpage==='invitations')myContent=<CInvitationsPage invitations={account?.invitations} busy={busy} error={error} refresh={()=>void refresh()} openActivity={openActivity} back={backAccountPage}/>;
  else if(subpage==='number')myContent=<CManualActivityPage value={manualId} change={value=>{setManualId(value);setManualError('');}} busy={manualBusy} error={manualError} open={()=>void openManualActivity()} back={backAccountPage}/>;
  else if(subpage==='settings'||subpage==='privacy'||subpage==='help'||subpage==='about')myContent=<CSupportPages page={subpage} signedIn={signedIn} onBack={backAccountPage} onOpen={page=>{if(page==='profile'){if(signedIn)openProfile();else requestLogin();}else openAccountPage(page);}} onLogout={()=>setLogoutOpen(true)} onPermissions={()=>void openPermissions()}/>;
  else if(signedIn&&account&&accountSession.current)myContent=<ProfileHome key={accountSession.current} initialBrowse={myBrowseCache.current&&myBrowseCache.current.session===getToken()?myBrowseCache.current.state:undefined} browseChanged={state=>{const session=getToken();if(session&&accountSession.current===session)myBrowseCache.current={session,state};}} account={account} session={accountSession.current} avatarSaved={path=>{if(accountSession.current===getToken()){generation.current++;setBusy(false);setAccount(value=>value?{...value,profile:{...value.profile,avatar_url:path}}:value);}}} edit={openProfile} settings={()=>openAccountPage('settings')} activities={allActivities} changed={storeAccount} plan={planVenue}/>;
  else myContent=<View className="c-ui c-account-guest"><CPageHeading title="我的"><CAction variant="text" onClick={()=>openAccountPage('settings')}>设置</CAction></CPageHeading>{signedIn?accountNotice:loginPrompt}</View>;
  const permissionSource={session:getToken(),epoch:cityEpoch.current};
  return <View className={`wv-shell c-shell${routePage?' c-account-route':''}`}><PrivacyConsent/>
    {tab==='go'&&<CHeader city={city} chooseCity={openCity}/>}
    {error && !loginOpen && subpage!=='invitations' && <CNotice>{error}<Text onClick={()=>void refresh()}>　重试</Text></CNotice>}
    {supportNotice&&<CNotice>{supportNotice}</CNotice>}
    <View>
    {tab==='go' && <CGoHome venuePreviews={browseCache.current&&browseCache.current.session===getToken()&&browseCache.current.city===city&&browseCache.current.state.venues.length?browseCache.current.state.venues:undefined} preview={venue=>{const session=getToken();if(session){setGoVenue({session,venue});setGoVenueError(undefined);}}} account={account} signedIn={signedIn} busy={busy||loggingIn} login={requestLogin} refresh={()=>void refresh()} friend={()=>create('friend')} team={()=>create('team')} all={()=>allActivities()} ideas={()=>changeTab('ideas')} openActivity={openActivity} openPreparation={id=>void Taro.navigateTo({url:`/pages/gathering/index?id=${encodeURIComponent(id)}`})} preparations={cPreparations.records} preparationsBusy={cPreparations.busy} preparationsError={cPreparations.error} retryPreparations={()=>void cPreparations.refresh()}/>}
    {tab==='ideas' && <Inspiration chooseCity={openCity} autoBrowse={!!ideasAutoSource.current&&ideasAutoSource.current===getToken()&&!(ideasInput&&ideasInput.session===getToken())} manualCity={!!Taro.getStorageSync('weevibe_selected_city')} key={`${city}-${signedIn}-${getToken()||'guest'}`} city={city} authenticated={signedIn} initialBrowse={browseCache.current?.session===getToken()&&browseCache.current?.city===city?browseCache.current.state:undefined} browseChanged={state=>{browseCache.current={session:getToken(),city,state};}} initialKeyword={ideasInput&&ideasInput.session===getToken()&&ideasInput.city===city?ideasInput.keyword:undefined} login={requestIdeasLogin} initialFavorites={account?.favorites} accountChanged={storeAccount} plan={planVenue}/>}
    {tab==='messages' && (!signedIn ? loginPrompt : <Messages key={getToken()} initialPendingOnly={messageFilter.current} filterChanged={value=>{messageFilter.current=value;}} value={inbox} session={getToken()} error={inboxError} refresh={refreshInbox} changed={value=>{const session=getToken();if(session)setInboxState({session,value});}}/>)}
    {tab==='me' && <View>{myContent}</View>}

    </View>
    {!routePage&&(!subpage||subpage==='profile')&&<CNavigation selected={tab} change={changeTab} create={()=>{abandonDestination();setCreateOpen(true);}} unread={inbox?.unread_count}/>}
    {goVenue&&goVenue.session===getToken()&&tab==='go'&&<VenueDetail venue={goVenue.venue} close={()=>setGoVenue(undefined)} busy={goVenueBusy} error={goVenueError?.session===goVenue.session&&goVenueError.venueId===goVenue.venue.provider_id?goVenueError.message:undefined} saved={account?.favorites.some(v=>v.provider_id===goVenue.venue.provider_id)??false} favorite={()=>void toggleGoVenue()} plan={()=>{planVenue(goVenue.venue);setGoVenue(undefined);}}/>}
    {moreOpen&&<CMoreMenu close={()=>setMoreOpen(false)} invitations={()=>openAccountPage('invitations')} manual={()=>openAccountPage('number')}/>}
    {logoutOpen&&<CLogoutDialog close={()=>setLogoutOpen(false)} confirm={logout}/>}
    {loginOpen&&<CLoginSheet close={cancelLoginReturn} login={()=>void login()} busy={loggingIn||busy} error={error}/>}
    {createOpen&&<CCreateSheet close={()=>setCreateOpen(false)} create={create}/>}
    {cityOpen&&<CCitySheet city={city} query={citySearch} change={editCity} choose={chooseCity} locate={()=>void locate()} locating={locating} note={locationNote} close={closeCity} permission={locationDenied?<CLocationSettings current={()=>cityMounted.current&&cityVisible.current&&cityOpenRef.current&&cityEpoch.current===permissionSource.epoch&&getToken()===permissionSource.session} changed={granted=>{setLocationDenied(!granted);setLocationNote(granted?'位置权限已开启，请再次点击“获取当前位置”。':'位置权限仍未开启，可继续手动选择城市。');}}/>:undefined}/>}
  </View>;
}

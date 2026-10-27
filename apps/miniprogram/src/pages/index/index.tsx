import { useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@weevibe/api-client';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Button, Input, Text, View } from '@tarojs/components';
import { loadAvatar } from '../../platform/avatar';
import { activityIdSchema, profilePresentationSchema, type InboxSnapshot, type Venue } from '@weevibe/contracts';
import { establishSession, forgetSession, getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { automaticUser, logoutAutomaticSession, resumeAutomaticLogin } from '../../platform/automatic-session';
import { locateCityForSession, locationError } from '../../features/shell/location-api';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { Action, Notice } from '../../components/ui';
import { PrivacyConsent } from '../../components/privacy-consent';
import { LocationSettings } from '../../components/location-settings';
import { needsLocationSettings } from '../../platform/location-permission';
import { TeamCreate } from '../../features/team';
import { UiIcon } from '../../components/ui-icon';
import { Sheet } from '../../components/sheet';
import { LoadingCards } from '../../components/loading-cards';
import { useTabScroll } from '../../features/shell/use-tab-scroll';
import type { InspirationBrowseState } from '../../features/shell/inspiration';
import { Inspiration } from '../../features/shell/inspiration';
import { ProfileForm } from '../../features/shell/profile';
import { COMMON_CITIES, validCity } from '../../features/shell/helpers';
import { AccountActivityList } from '../../features/shell/activity-list';
import { formatActivityTime } from '../../features/shell/activity-time';
import { TodoPanel } from '../../features/todos/TodoPanel';
import type { TodoIdentity } from '../../features/todos/api';
import { GoHome } from '../../features/shell/go-home';
import { ProfileHome } from '../../features/shell/profile-home';
import { ProfileCard } from '../../features/shell/profile-card';
import { Messages } from '../../features/shell/messages';
import { requestInbox } from '../../platform/navigation-api';
import { newKey, save } from '../../platform/page-state';
import './home.css';
import '../../features/shell/navigation.css';
import '../../features/shell/polish.css';

type Activity = { activity_id:string;title:string;starts_at:string|null;ends_at:string|null;timezone:string;status:string;location:string;awaiting_acceptance?:boolean };
type Account = AccountSnapshot;
type Tab = 'go'|'ideas'|'messages'|'me';
type LoginDestination = ({ kind:'ideas'; keyword:string; city:string } | { kind:'friend'|'team'|'preparation' }) & { session?:string; actor?:string };
type IdeasInput = { session:string|undefined; keyword:string; city:string };

export default function Home() {
  const [todoIdentity,setTodoIdentity]=useState<TodoIdentity>();
  const [inboxState,setInboxState]=useState<{session:string;value:InboxSnapshot}>(), [inboxError,setInboxError]=useState('');
  const inbox=inboxState?.session===getToken()?inboxState?.value:undefined;
  const [activityFilter,setActivityFilter]=useState<'all'|'managing'|'joined'>('all');
  const [createContext,setCreateContext]=useState<'all'|'friend'>('all');
  const [tab,setTab]=useState<Tab>('go'); const [city,setCity]=useState(()=>String(Taro.getStorageSync('weevibe_selected_city') || '北京'));
  const [preparationKind,setPreparationKind]=useState<'friend'|'team'>('team');
  const [cityOpen,setCityOpen]=useState(false); const [citySearch,setCitySearch]=useState(''); const [createOpen,setCreateOpen]=useState(false); const [team,setTeam]=useState(false);
  const [storedAccount,setAccount]=useState<Account>(); const [signedIn,setSignedIn]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [locationNote,setLocationNote]=useState(''); const [locationDenied,setLocationDenied]=useState(false);
  const [subpage,setSubpage]=useState<'profile'|'settings'|'activities'|''>(''); const generation=useRef(0); const loginBusy=useRef<number>(); const accountSession=useRef<string>();
  const account=accountSession.current && accountSession.current===getToken()?storedAccount:undefined;
  const [manualId,setManualId]=useState('');
  const [loginDestination,setLoginDestination]=useState<LoginDestination>(); const destinationRef=useRef<LoginDestination>();
  const [ideasInput,setIdeasInput]=useState<IdeasInput>(); const [loggingIn,setLoggingIn]=useState(false);
  const destinationEpoch=useRef(0), loginSequence=useRef(0);
  const browseCache=useRef<{session:string|undefined;city:string;state:InspirationBrowseState}>();
  const messageFilter=useRef(false);
  const cacheOwner=useRef(getToken());if(cacheOwner.current!==getToken()){cacheOwner.current=getToken();browseCache.current=undefined;messageFilter.current=false;}
  useTabScroll(tab,subpage,`${getToken()||'guest'}:${city}`,team||cityOpen||createOpen);
  function rememberDestination(value:LoginDestination|undefined){destinationRef.current=value;setLoginDestination(value);}
  function abandonDestination(){destinationEpoch.current++;loginBusy.current=undefined;rememberDestination(undefined);setIdeasInput(undefined);if(cityMounted.current)setLoggingIn(false);}
  function changeTab(next:Tab){abandonDestination();setTab(next);setTeam(false);setSubpage('');}
  function requestIdeasLogin(input:{keyword:string;city:string}){
    // Only a genuinely unauthenticated draft may cross this explicit guest login.
    // Never transfer a prior account's keyword, result list, selection or coordinates.
    if(!cityMounted.current||!cityVisible.current)return;
    if(getToken()){setError('登录状态正在核对，请刷新后重新打开灵感页。');return;}
    abandonDestination();rememberDestination({kind:'ideas',keyword:input.keyword.slice(0,80),city:input.city});
    setTab('me');setSubpage('');setError('请先登录。成功后返回灵感并保留关键词，不会自动搜索或定位。');
  }
  function cancelLoginReturn(){
    const previous=destinationRef.current;abandonDestination();setError('');
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
    if(accountSession.current&&accountSession.current!==session){accountSession.current=undefined;setAccount(undefined);setSignedIn(false);setSubpage('');setTeam(false);setIdeasInput(undefined);}
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
      if(e instanceof ApiClientError&&e.code==='UNAUTHENTICATED'){forgetSession();verified=undefined;setTodoIdentity(undefined);setSignedIn(false);setSubpage('');setTeam(false);setIdeasInput(undefined);}
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
      rememberDestination(undefined);
      if(destination?.kind==='ideas'){
        setIdeasInput({session,keyword:destination.keyword,city:destination.city});setTab('ideas');setSubpage('');
      }else if(destination?.kind==='friend')void Taro.navigateTo({url:'/pages/editor/index'});
      else if(destination?.kind==='team'||destination?.kind==='preparation'){setPreparationKind(destination.kind==='team'?'team':'friend');setTeam(true);}
    }catch(e){if(current())setError(errorText(e));}
    finally{if(loginBusy.current===ticket){loginBusy.current=undefined;if(cityMounted.current)setLoggingIn(false);}}
  }
  function logout(){browseCache.current=undefined;messageFilter.current=false;abandonDestination();invalidateCityLookup();closeCity();generation.current++;logoutAutomaticSession();setTodoIdentity(undefined);accountSession.current=undefined;setAccount(undefined);setSignedIn(false);setSubpage('');setError('');setBusy(false);setTab('me');void Taro.reLaunch({url:'/pages/index/index'});}
  function chooseCity(value:string){invalidateCityLookup();if(!validCity(value)){setLocationNote('请输入有效的城市名称');return;}abandonDestination();setCity(value.trim());Taro.setStorageSync('weevibe_selected_city',value.trim());closeCity();setCitySearch('');}
  async function locate(){
    if(cityLock.current!==undefined||!cityMounted.current||!cityVisible.current||!cityOpenRef.current)return;
    const sourceSession=getToken();if(!sourceSession){setLocationNote('自动识别城市需要登录以保护地点服务额度；你仍可直接手动选择。');return;}
    const ticket=++cityEpoch.current;cityLock.current=ticket;setLocating(true);setLocationNote('正在核对身份并请求你的位置…');
    const current=()=>cityMounted.current&&cityVisible.current&&cityOpenRef.current&&ticket===cityEpoch.current&&getToken()===sourceSession;
    const guard=()=>{if(!current())throw new ApiClientError('INVALID_RESPONSE','城市定位来源已变化，旧结果未采用。',0);};
    try{const result=await locateCityForSession(sourceSession,guard);guard();setCitySearch(result.city);setLocationNote('已识别 '+result.city+'，点击下方确认使用。坐标不会保存在城市设置中。');}
    catch(e){if(current()){setLocationNote(locationError(e));setLocationDenied(needsLocationSettings(e));}}
    finally{if(cityLock.current===ticket){cityLock.current=undefined;if(cityMounted.current){setLocating(false);if(cityVisible.current&&cityOpenRef.current&&getToken()!==sourceSession)setLocationNote('登录身份已变化，旧定位结果未使用；可重新发起或手动选择城市。');}}}
  }
  function openActivity(id:string){abandonDestination();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)){setError('活动编号格式不正确');return;}void Taro.navigateTo({url:`/pages/activity/index?id=${encodeURIComponent(id)}`});}
  function create(kind:'friend'|'team'|'preparation'){abandonDestination();setCreateOpen(false);if(!signedIn){rememberDestination({kind,session:getToken()});setTab('me');setError('请先使用微信身份登录，登录后继续创建。');return;}if(kind==='friend')void Taro.navigateTo({url:'/pages/editor/index'});else {setPreparationKind(kind==='team'?'team':'friend');setTeam(true);}}
  function openProfile(){abandonDestination();if(account && accountSession.current===getToken())setSubpage('profile');else setError('个人资料尚未读取，请先刷新账户数据。');}
  function storeAccount(next:Account) { const session=accountSession.current; if(!session||session!==getToken())return; generation.current++;setBusy(false);setAccount({...next,profile:{...next.profile,avatar_url:account?.profile.avatar_url}}); }
  async function refreshInbox(){const session=getToken(),gen=generation.current;if(!session)return;setInboxError('');try{const value=await requestInbox(session);if(cityMounted.current&&cityVisible.current&&session===getToken()&&gen===generation.current)setInboxState({session,value});}catch(e){if(cityMounted.current&&session===getToken()&&gen===generation.current)setInboxError(errorText(e));}}
  function allActivities(filter:'all'|'managed'|'joined'='all'){abandonDestination();setTab('me');setActivityFilter(filter==='managed'?'managing':filter);setSubpage('activities');}
  function planVenue(venue:Venue){const identity=todoIdentity;if(!identity||identity.session!==getToken()){setError('请先核对微信身份，再从地点开始创建。');return;}const id=newKey();save(`weevibe-venue-plan-v1:${id}`,{owner_user_id:identity.actor_id,venue});void Taro.navigateTo({url:`/pages/editor/index?venue=${id}`});}
  const cards=(entries:Activity[])=>entries.map((a,i)=><View key={a.activity_id} className={`wv-card activity-card ${i%2?'lilac':'peach'}`} onClick={()=>openActivity(a.activity_id)}><View className="wv-card-top"><Text className="wv-card-title">{a.title}</Text><Text className="wv-status">{a.status}</Text></View><Text className="wv-muted">{formatActivityTime(a.starts_at,a.timezone)}</Text><Text className="wv-muted">{a.location || '地点待定'}</Text>{a.awaiting_acceptance && <Text className="wv-warning">安排有变更，需要重新确认</Text>}<View className="wv-card-footer"><Text>查看活动安排</Text><UiIcon name="right" className="wv-arrow"/></View></View>);
  const loginPrompt=<View className="wv-empty"><View className="wv-empty-icon"><UiIcon name="user"/></View><Text className="wv-section-title">登录，让相聚有迹可循</Text><Text className="wv-muted">自动恢复微信身份后，继续查看活动和通知；若未成功，可点击重试。</Text><Action variant="primary" disabled={busy||loggingIn} onClick={()=>void login()}>{loggingIn||busy?'正在恢复登录…':'微信登录'}</Action>{loginDestination?.kind==='ideas'&&<Action onClick={cancelLoginReturn}>取消并返回灵感</Action>}</View>;
  const accountNotice=busy?<LoadingCards label="正在读取账户数据…"/>:<View className="wv-empty"><Text className="wv-section-title">{busy?'正在读取账户数据…':'账户数据尚未读取'}</Text><Text className="wv-muted">暂时无法确认本人活动、邀请和消息，不把读取失败当作空列表。</Text><Action disabled={busy} onClick={()=>void refresh()}>刷新账户数据</Action></View>;
  const permissionSource={session:getToken(),epoch:cityEpoch.current};
  return <View className="wv-shell"><PrivacyConsent/>
    <View className="wv-top"><Button className="wv-city" ariaLabel="选择城市" hoverClass="wv-pressed" onClick={openCity}><UiIcon name="location"/><Text>{city}</Text><UiIcon name="down"/></Button></View>
    {error && <Notice tone="error">{error}<Text onClick={()=>void refresh()}>　重试</Text></Notice>}
    {team ? <TeamCreate key={`${preparationKind}-${getToken()}`} kind={preparationKind} onClose={()=>setTeam(false)}/> : <View>
    {tab==='go' && <GoHome account={account} empty={!signedIn?loginPrompt:accountNotice} friend={()=>{abandonDestination();setCreateContext('friend');setCreateOpen(true);}} team={()=>create('team')} all={()=>allActivities()} ideas={()=>changeTab('ideas')} open={openActivity}/>}
    {tab==='ideas' && <Inspiration key={`${city}-${signedIn}-${getToken()||'guest'}`} city={city} authenticated={signedIn} initialBrowse={browseCache.current?.session===getToken()&&browseCache.current?.city===city?browseCache.current.state:undefined} browseChanged={state=>{browseCache.current={session:getToken(),city,state};}} initialKeyword={ideasInput&&ideasInput.session===getToken()&&ideasInput.city===city?ideasInput.keyword:undefined} login={requestIdeasLogin} initialFavorites={account?.favorites} accountChanged={storeAccount} plan={planVenue}/>}
    {tab==='messages' && (!signedIn ? loginPrompt : <Messages key={getToken()} initialPendingOnly={messageFilter.current} filterChanged={value=>{messageFilter.current=value;}} value={inbox} session={getToken()} error={inboxError} refresh={refreshInbox} changed={value=>{const session=getToken();if(session)setInboxState({session,value});}}/>)}
    {tab==='me' && <View>{subpage==='profile' && signedIn ? <ProfileForm ownerSession={accountSession.current} initial={account?.profile || {}} close={()=>{setSubpage('');void refresh();}} saved={profile=>{generation.current++;setBusy(false);setAccount(a=>a?{...a,profile}:a);}} avatarSaved={path=>{generation.current++;setBusy(false);setAccount(a=>a?{...a,profile:{...a.profile,avatar_url:path}}:a);}}/> : subpage==='activities' && signedIn ? <View><Text className="wv-title">我的活动</Text><Text className="wv-muted">参加状态由服务器计算；可切换查看管理、待审批和退出记录。</Text><TodoPanel identity={todoIdentity?.session===getToken()?todoIdentity:undefined}/>{!account ? accountNotice : Array.isArray(account?.activity_records) ? <AccountActivityList key={`my-activity-records-${activityFilter}`} initialFilter={activityFilter} records={account.activity_records} onOpen={openActivity}/> : <View>{account && <Text className="wv-warning">当前后端仅提供已参加列表，尚不能显示完整管理、申请和退出记录。</Text>}{account?.activities.length ? cards(account.activities) : <View className="wv-empty">暂无已确认参加的活动</View>}</View>}<View className="wv-section-heading"><Text className="wv-section-title">已保存的邀请</Text></View>{account?.invitations.length?cards(account.invitations):<Text className="wv-muted">暂无已保存邀请。打开朋友分享的入口后可主动保存。</Text>}<View className="wv-card"><Text className="wv-card-title">打开朋友分享的活动</Text><Input className="wv-input" value={manualId} maxlength={100} placeholder="粘贴活动编号" onInput={e=>setManualId(e.detail.value)}/><Action onClick={()=>openActivity(manualId.trim())}>查看活动</Action></View><Action onClick={()=>setSubpage('')}>返回</Action></View> : subpage==='settings' ? <View><Text className="wv-title">设置</Text><Action onClick={()=>signedIn?openProfile():setSubpage('')}>个人资料</Action><View className="wv-card"><Text className="wv-card-title">隐私与数据</Text><Text className="wv-muted">封面、头像、昵称可由同活动组织者和已加入成员查看；介绍、兴趣、MBTI、星座默认私密，可由本人主动公开。生日和性别不随主页公开。定位只在主动点击时请求。退出仅清理本机会话，不会删除服务器中的活动与记录。头像经安全压缩后存于同一后端数据库，原始照片与临时路径不会作为头像记录保存。</Text></View>{signedIn && <Action variant="danger" onClick={logout}>退出登录</Action>}<Action onClick={()=>setSubpage('')}>返回</Action></View> : signedIn && account && accountSession.current ? <ProfileHome key={accountSession.current} account={account} session={accountSession.current} edit={openProfile} settings={()=>{abandonDestination();setSubpage('settings');}} activities={allActivities} changed={storeAccount} plan={planVenue}/> : <View><ProfileCard profile={{nickname:'认识一下吧',...profilePresentationSchema.parse({})}} session={getToken()} edit={()=>void login()}/>{signedIn?accountNotice:loginPrompt}</View>}</View>}

    </View>}
    <View className="wv-bottom"><Button className={tab==='go'?'active':''} onClick={()=>changeTab('go')}><UiIcon name="go" className="wv-tab-symbol"/><Text>GO</Text></Button><Button className={tab==='ideas'?'active':''} onClick={()=>changeTab('ideas')}><UiIcon name="spark" className="wv-tab-symbol"/><Text>灵感</Text></Button><Button className="wv-create" ariaLabel="创建活动" onClick={()=>{abandonDestination();setCreateContext('all');setCreateOpen(true);}}><UiIcon name="plusWhite"/><Text className="wv-sr-only">＋</Text></Button><Button className={tab==='messages'?'active':''} onClick={()=>changeTab('messages')}><UiIcon name="inbox" className="wv-tab-symbol"/><Text>消息{inbox?.unread_count ? ` ${inbox.unread_count>99?'99+':inbox.unread_count}` : ''}</Text></Button><Button className={tab==='me'?'active':''} onClick={()=>changeTab('me')}><UiIcon name="user" className="wv-tab-symbol"/><Text>我的</Text></Button></View>
    {createOpen && <Sheet title="发起一次相聚" close={()=>setCreateOpen(false)}><Text className="wv-subtitle">选一种方式，把期待变成计划。</Text><View className="wv-create-card peach" onClick={()=>create('friend')}><View className="wv-create-icon"><UiIcon name="friends"/></View><View><Text className="wv-card-title">朋友聚会</Text><Text className="wv-muted">安排已明确，直接创建活动</Text></View><UiIcon name="right" className="wv-arrow"/></View><View className="wv-create-card lilac" onClick={()=>create('preparation')}><View className="wv-create-icon"><UiIcon name="spark"/></View><View><Text className="wv-card-title">先筹备朋友聚会</Text><Text className="wv-muted">只有想法，先收集大家的需求</Text></View><UiIcon name="right" className="wv-arrow"/></View>{createContext==='all' && <View className="wv-create-card mint" onClick={()=>create('team')}><View className="wv-create-icon"><UiIcon name="team"/></View><View><Text className="wv-card-title">大型团建</Text><Text className="wv-muted">收集需求，让安排更合心意</Text></View><UiIcon name="right" className="wv-arrow"/></View>}<Action onClick={()=>setCreateOpen(false)}>取消</Action></Sheet>}
    {cityOpen && <Sheet title="想去哪个城市？" close={closeCity}><Text className="wv-muted">用于地点浏览和新建时的搜索城市默认，不改变已有安排或已编辑的输入。</Text><View className="wv-search"><Input value={citySearch} adjustPosition={false} cursorSpacing={24} confirmType="done" maxlength={30} placeholder="搜索或输入城市名称" onInput={e=>editCity(e.detail.value)} onConfirm={()=>chooseCity(citySearch)}/></View><Action disabled={locating} onClick={()=>void locate()}>{locating?'正在获取位置…':'获取当前位置'}</Action>{locationNote && <Notice>{locationNote}</Notice>}{locationDenied && <LocationSettings current={()=>cityMounted.current&&cityVisible.current&&cityOpenRef.current&&cityEpoch.current===permissionSource.epoch&&getToken()===permissionSource.session} changed={granted=>{setLocationDenied(!granted);setLocationNote(granted?'位置权限已开启，请再次点击“获取当前位置”。':'位置权限仍未开启，可继续手动选择城市。');}}/>}<Text className="wv-section-title">常用城市</Text><View className="wv-city-grid">{COMMON_CITIES.filter(c=>!citySearch||c.includes(citySearch)).map(c=><Button key={c} className={c===city?'selected':''} onClick={()=>chooseCity(c)}>{c}</Button>)}</View>{citySearch && <Action onClick={()=>chooseCity(citySearch)}>使用“{citySearch}”</Action>}<Action onClick={closeCity}>返回</Action></Sheet>}
  </View>;
}

import { useEffect, useRef, useState } from 'react';
import { ApiClientError } from '@weevibe/api-client';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Button, Image, Input, Text, View } from '@tarojs/components';
import { loadAvatar } from '../../platform/avatar';
import { activityIdSchema, type AccountActivityRecord } from '@weevibe/contracts';
import { api, establishSession, forgetSession, getToken } from '../../platform/api';
import { errorText } from '../../platform/page-state';
import { locateCityForSession, locationError } from '../../features/shell/location-api';
import { requestAccount, type AccountSnapshot } from '../../platform/account-api';
import { Action, Notice } from '../../components/ui';
import { TeamCreate } from '../../features/team';
import { Inspiration } from '../../features/shell/inspiration';
import { ProfileForm, type ProfileData } from '../../features/shell/profile';
import { activityPathFromScan, COMMON_CITIES, validCity } from '../../features/shell/helpers';
import { AccountActivityList } from '../../features/shell/activity-list';
import { formatActivityTime } from '../../features/shell/activity-time';
import { TodoPanel } from '../../features/todos/TodoPanel';
import type { TodoIdentity } from '../../features/todos/api';
import './home.css';

type Activity = { activity_id:string;title:string;starts_at:string|null;ends_at:string|null;timezone:string;status:string;location:string;awaiting_acceptance?:boolean };
type Message = {id:string;activity_id:string|null;requirement_id?:string;title:string;created_at:string;read:boolean};
type Account = AccountSnapshot;
type Tab = 'go'|'ideas'|'messages'|'me';
type LoginDestination = ({ kind:'ideas'; keyword:string; city:string } | { kind:'friend'|'team'|'preparation' }) & { session?:string; actor?:string };
type IdeasInput = { session:string|undefined; keyword:string; city:string };

export default function Home() {
  const [todoIdentity,setTodoIdentity]=useState<TodoIdentity>();
  const [tab,setTab]=useState<Tab>('go'); const [city,setCity]=useState(()=>String(Taro.getStorageSync('weevibe_selected_city') || '北京'));
  const [preparationKind,setPreparationKind]=useState<'friend'|'team'>('team');
  const [cityOpen,setCityOpen]=useState(false); const [citySearch,setCitySearch]=useState(''); const [createOpen,setCreateOpen]=useState(false); const [team,setTeam]=useState(false);
  const [storedAccount,setAccount]=useState<Account>(); const [signedIn,setSignedIn]=useState(false); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [locationNote,setLocationNote]=useState('');
  const [subpage,setSubpage]=useState<'profile'|'settings'|'activities'|''>(''); const generation=useRef(0); const loginBusy=useRef<number>(); const accountSession=useRef<string>();
  const account=accountSession.current && accountSession.current===getToken()?storedAccount:undefined;
  const [manualId,setManualId]=useState('');
  const [loginDestination,setLoginDestination]=useState<LoginDestination>(); const destinationRef=useRef<LoginDestination>();
  const [ideasInput,setIdeasInput]=useState<IdeasInput>(); const [loggingIn,setLoggingIn]=useState(false);
  const destinationEpoch=useRef(0), loginSequence=useRef(0);
  const scanEpoch=useRef(0), scanLock=useRef<number>(), scanSession=useRef(getToken());
  const [scanBusy,setScanBusy]=useState<number>();
  // Observed session A→B→A cannot revive a native result from the first A.
  if(scanSession.current!==getToken()){scanSession.current=getToken();scanEpoch.current++;scanLock.current=undefined;}
  function invalidateScan(){scanEpoch.current++;scanLock.current=undefined;if(cityMounted.current)setScanBusy(undefined);}
  function rememberDestination(value:LoginDestination|undefined){destinationRef.current=value;setLoginDestination(value);}
  function abandonDestination(){invalidateScan();destinationEpoch.current++;loginBusy.current=undefined;rememberDestination(undefined);setIdeasInput(undefined);if(cityMounted.current)setLoggingIn(false);}
  function changeTab(next:Tab){abandonDestination();setTab(next);setTeam(false);}
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
  function openCity(){abandonDestination();invalidateCityLookup();cityOpenRef.current=true;setCityOpen(true);setLocationNote('');}
  function closeCity(){invalidateCityLookup();cityOpenRef.current=false;setCityOpen(false);setLocationNote('');}
  function editCity(value:string){invalidateCityLookup();setCitySearch(value);setLocationNote('');}
  async function refresh() {
    const gen=++generation.current, session=getToken();
    const current=()=>cityMounted.current&&cityVisible.current&&gen===generation.current&&getToken()===session;
    if(todoIdentity?.session!==session)setTodoIdentity(undefined);
    if(accountSession.current&&accountSession.current!==session){accountSession.current=undefined;setAccount(undefined);setSignedIn(false);setSubpage('');setTeam(false);setIdeasInput(undefined);}
    setError('');
    if(!session){setSignedIn(false);setAccount(undefined);setBusy(false);return;}
    setBusy(true); let verified:TodoIdentity|undefined;
    try{
      const actor=await api.me();if(!current())return;
      const parsed=activityIdSchema.safeParse(actor.user_id);
      if(!parsed.success)throw new ApiClientError('INVALID_RESPONSE','登录身份无法核实',200);
      verified={actor_id:parsed.data,session};setSignedIn(true);setTodoIdentity(verified);
      const next=await requestAccount(session);if(!current())return;
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
  function logout(){abandonDestination();invalidateCityLookup();closeCity();generation.current++;forgetSession();setTodoIdentity(undefined);accountSession.current=undefined;setAccount(undefined);setSignedIn(false);setSubpage('');setError('');setBusy(false);setTab('me');void Taro.reLaunch({url:'/pages/index/index'});}
  function chooseCity(value:string){invalidateCityLookup();if(!validCity(value)){setLocationNote('请输入有效的城市名称');return;}abandonDestination();setCity(value.trim());Taro.setStorageSync('weevibe_selected_city',value.trim());closeCity();setCitySearch('');}
  async function locate(){
    if(cityLock.current!==undefined||!cityMounted.current||!cityVisible.current||!cityOpenRef.current)return;
    const sourceSession=getToken();if(!sourceSession){setLocationNote('自动识别城市需要登录以保护地点服务额度；你仍可直接手动选择。');return;}
    const ticket=++cityEpoch.current;cityLock.current=ticket;setLocating(true);setLocationNote('正在核对身份并请求你的位置…');
    const current=()=>cityMounted.current&&cityVisible.current&&cityOpenRef.current&&ticket===cityEpoch.current&&getToken()===sourceSession;
    const guard=()=>{if(!current())throw new ApiClientError('INVALID_RESPONSE','城市定位来源已变化，旧结果未采用。',0);};
    try{const result=await locateCityForSession(sourceSession,guard);guard();setCitySearch(result.city);setLocationNote('已识别 '+result.city+'，点击下方确认使用。坐标不会保存在城市设置中。');}
    catch(e){if(current())setLocationNote(locationError(e));}
    finally{if(cityLock.current===ticket){cityLock.current=undefined;if(cityMounted.current){setLocating(false);if(cityVisible.current&&cityOpenRef.current&&getToken()!==sourceSession)setLocationNote('登录身份已变化，旧定位结果未使用；可重新发起或手动选择城市。');}}}
  }
  function openActivity(id:string){abandonDestination();if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)){setError('活动编号格式不正确');return;}void Taro.navigateTo({url:`/pages/activity/index?id=${encodeURIComponent(id)}`});}
  async function scan(){
    if(scanLock.current!==undefined||!cityMounted.current||!cityVisible.current)return;
    abandonDestination();const ticket=++scanEpoch.current,sourceSession=getToken(),destination=destinationEpoch.current;
    scanLock.current=ticket;setScanBusy(ticket);setError('');
    const current=()=>cityMounted.current&&cityVisible.current&&scanLock.current===ticket&&scanEpoch.current===ticket&&destinationEpoch.current===destination&&getToken()===sourceSession;
    try{
      const result=await Taro.scanCode({onlyFromCamera:false});if(!current())return;
      const path=activityPathFromScan(result.path || result.result);
      if(!path){setError('这不是支持的 WeeVibe 活动入口，请使用朋友分享的小程序卡片。');return;}
      // No await between source/lifecycle validation and the actual navigation dispatch.
      if(!current())return;await Taro.navigateTo({url:path});
    }catch(e){if(current()&&!/cancel/i.test(String((e as {errMsg?:string}).errMsg || '')))setError('扫码或打开活动未完成，请重试。');}
    finally{if(scanLock.current===ticket){scanLock.current=undefined;if(cityMounted.current)setScanBusy(undefined);}}
  }
  function create(kind:'friend'|'team'|'preparation'){abandonDestination();setCreateOpen(false);if(!signedIn){rememberDestination({kind,session:getToken()});setTab('me');setError('请先使用微信身份登录，登录后继续创建。');return;}if(kind==='friend')void Taro.navigateTo({url:'/pages/editor/index'});else {setPreparationKind(kind==='team'?'team':'friend');setTeam(true);}}
  async function openMessage(message:Message){try{const data=await requestAccount(accountSession.current,'PATCH',{action:'read-message',message_id:message.id});setAccount(current=>current?{...current,messages:data.messages}:data);if(message.requirement_id){void Taro.navigateTo({url:'/pages/requirements/index?id='+encodeURIComponent(message.requirement_id)});}else if(message.activity_id){openActivity(message.activity_id);}}catch(e){setError(errorText(e));}}
  function openProfile(){abandonDestination();if(account && accountSession.current===getToken())setSubpage('profile');else setError('个人资料尚未读取，请先刷新账户数据。');}
  const cards=(entries:Activity[])=>entries.map((a,i)=><View key={a.activity_id} className={`wv-card activity-card ${i%2?'lilac':'peach'}`} onClick={()=>openActivity(a.activity_id)}><View className="wv-card-top"><Text className="wv-card-title">{a.title}</Text><Text className="wv-status">{a.status}</Text></View><Text className="wv-muted">{formatActivityTime(a.starts_at,a.timezone)}</Text><Text className="wv-muted">{a.location || '地点待定'}</Text>{a.awaiting_acceptance && <Text className="wv-warning">安排有变更，需要重新确认</Text>}<View className="wv-card-footer"><Text>查看活动安排</Text><Text className="wv-arrow">›</Text></View></View>);
  const loginPrompt=<View className="wv-empty"><Text className="wv-empty-icon">○</Text><Text className="wv-section-title">登录，让相聚有迹可循</Text><Text className="wv-muted">真实微信身份登录后，查看本人活动和通知。</Text><Action variant="primary" disabled={busy||loggingIn} onClick={()=>void login()}>{loggingIn?'正在登录…':'微信登录'}</Action>{loginDestination?.kind==='ideas'&&<Action onClick={cancelLoginReturn}>取消并返回灵感</Action>}</View>;
  const accountNotice=<View className="wv-empty"><Text className="wv-section-title">{busy?'正在读取账户数据…':'账户数据尚未读取'}</Text><Text className="wv-muted">暂时无法确认本人活动、邀请和消息，不把读取失败当作空列表。</Text><Action disabled={busy} onClick={()=>void refresh()}>刷新账户数据</Action></View>;
  return <View className="wv-shell">
    <View className="wv-top"><Button className="wv-city" onClick={openCity}>⌖ {city}⌄</Button><Text className="wv-brand">WeeVibe</Text><Button className="wv-scan" ariaLabel="扫码打开活动" disabled={scanLock.current!==undefined&&scanBusy===scanLock.current} onClick={()=>void scan()}>▣</Button></View>
    {error && <Notice tone="error">{error}<Text onClick={()=>void refresh()}>　重试</Text></Notice>}
    {team ? <TeamCreate key={`${preparationKind}-${getToken()}`} kind={preparationKind} onClose={()=>setTeam(false)}/> : <View>
    {tab==='go' && <View><View className="wv-hero peach"><Text className="wv-eyebrow">GOOD TIMES, TOGETHER</Text><Text className="wv-title">下一站，和朋友一起。</Text><Text className="wv-subtitle">我的活动、申请进度与已保存的邀请。</Text></View>{signedIn && <TodoPanel identity={todoIdentity?.session===getToken()?todoIdentity:undefined}/>}<View className="wv-section-heading"><Text className="wv-section-title">我的活动</Text><Button className="wv-link" onClick={()=>void refresh()}>{busy?'更新中':'刷新'}</Button></View>{!signedIn ? loginPrompt : !account ? accountNotice : <View>{Array.isArray(account?.activity_records) ? <AccountActivityList records={account.activity_records} onOpen={openActivity}/> : <View>{account && <Text className="wv-warning">当前后端仅提供已参加列表；管理、待审批与退出记录需更新匹配的后端，不能视为完整列表。</Text>}{account?.activities.length ? cards(account.activities) : <View className="wv-empty"><Text className="wv-empty-icon">↗</Text><Text className="wv-section-title">下一次相聚，等你发起</Text><Text className="wv-muted">{busy?'正在读取本人活动…':'暂无已确认参加的活动。申请待审批不占席位。'}</Text></View>}</View>}<Text className="wv-section-title">已保存的邀请</Text><Text className="wv-muted">来自你主动保存的真实可转发入口；不代表指定收件人、群资格或已报名。</Text>{account?.invitations.length ? cards(account.invitations) : <View className="wv-empty compact"><Text className="wv-muted">{account?.capabilities?.invitations === false ? '邀请收件箱尚未接入。可从朋友分享的入口查看安排。' : '暂无已保存的邀请。打开带来源的邀请后，可主动保存到这里。'}</Text></View>}</View>}<View className="wv-card"><Text className="wv-card-title">打开朋友分享的活动</Text><Input className="wv-input" value={manualId} maxlength={100} placeholder="粘贴活动编号" onInput={e=>setManualId(e.detail.value)}/><Action onClick={()=>openActivity(manualId.trim())}>查看活动</Action></View></View>}
    {tab==='ideas' && <Inspiration key={`${city}-${signedIn}-${getToken()||'guest'}`} city={city} authenticated={signedIn} initialKeyword={ideasInput&&ideasInput.session===getToken()&&ideasInput.city===city?ideasInput.keyword:undefined} login={requestIdeasLogin}/>}
    {tab==='messages' && <View><View className="wv-section"><Text className="wv-title">消息</Text><Text className="wv-subtitle">重要的进展，都在这里。</Text></View>{!signedIn ? loginPrompt : !account ? accountNotice : account?.messages.length ? account.messages.map(m=><View key={m.id} className="wv-card" onClick={()=>void openMessage(m)}><View className="wv-card-top"><Text className="wv-card-title">{!m.read?'● ':''}{m.title}</Text><Text className="wv-arrow">›</Text></View><Text className="wv-muted">{new Date(m.created_at).toLocaleString('zh-CN')}</Text></View>) : <View className="wv-empty"><Text className="wv-empty-icon">▱</Text><Text className="wv-section-title">暂时没有新消息</Text><Text className="wv-muted">真实业务通知会显示在这里，不是聊天会话。</Text><Action disabled={busy} onClick={()=>void refresh()}>刷新消息</Action></View>}</View>}
    {tab==='me' && <View>{subpage==='profile' && signedIn ? <ProfileForm ownerSession={accountSession.current} initial={account?.profile || {}} close={()=>setSubpage('')} saved={profile=>{generation.current++;setBusy(false);setAccount(a=>a?{...a,profile}:a);}} avatarSaved={path=>{generation.current++;setBusy(false);setAccount(a=>a?{...a,profile:{...a.profile,avatar_url:path}}:a);}}/> : subpage==='activities' && signedIn ? <View><Text className="wv-title">参加的活动</Text><Text className="wv-muted">参加状态由服务器计算；可切换查看管理、待审批和退出记录。</Text>{!account ? accountNotice : Array.isArray(account?.activity_records) ? <AccountActivityList key="my-activity-records" initialFilter="joined" records={account.activity_records} onOpen={openActivity}/> : <View>{account && <Text className="wv-warning">当前后端仅提供已参加列表，尚不能显示完整管理、申请和退出记录。</Text>}{account?.activities.length ? cards(account.activities) : <View className="wv-empty">暂无已确认参加的活动</View>}</View>}<Action onClick={()=>setSubpage('')}>返回</Action></View> : subpage==='settings' ? <View><Text className="wv-title">设置</Text><Action onClick={()=>signedIn?openProfile():setSubpage('')}>个人资料</Action><View className="wv-card"><Text className="wv-card-title">隐私与数据</Text><Text className="wv-muted">头像与昵称作为活动内身份，可出现在活动和分享摘要；其他个人资料仅本人可见。定位只在主动点击时请求。退出仅清理本机会话，不会删除服务器中的活动与记录。头像经安全压缩后存于同一后端数据库，原始照片与临时路径不会作为头像记录保存。</Text></View>{signedIn && <Action variant="danger" onClick={logout}>退出登录</Action>}<Action onClick={()=>setSubpage('')}>返回</Action></View> : <View><Button className="wv-link wv-settings" onClick={()=>{abandonDestination();setSubpage('settings');}}>⚙ 设置</Button><View className="wv-profile"><Button className="wv-avatar-button" onClick={()=>signedIn?openProfile():void login()}>{account?.profile.avatar_url ? <Image className="wv-avatar" src={account.profile.avatar_url}/> : <Text>○</Text>}</Button><Text className="wv-title">{signedIn ? account?.profile.nickname || '你好，新朋友' : '认识一下吧'}</Text><Text className="wv-muted">{signedIn?'让每一次相聚，都成为好回忆。':'点击头像，用微信身份登录。'}</Text></View>{!signedIn ? loginPrompt : !account ? accountNotice : <View><View className="wv-card mint" onClick={openProfile}><Text className="wv-card-title">个人信息</Text><Text className="wv-muted">关于你，可以慢慢填写　›</Text></View><View className="wv-card lilac" onClick={()=>{abandonDestination();setSubpage('activities');}}><Text className="wv-card-title">参加的活动</Text><Text className="wv-muted">待参加 · 活动中 · 已结束　›</Text></View></View>}</View>}</View>}
    </View>}
    <View className="wv-bottom"><Button className={tab==='go'?'active':''} onClick={()=>changeTab('go')}><Text className="wv-tab-symbol">↗</Text><Text>GO</Text></Button><Button className={tab==='ideas'?'active':''} onClick={()=>changeTab('ideas')}><Text className="wv-tab-symbol">✧</Text><Text>灵感</Text></Button><Button className="wv-create" ariaLabel="创建活动" onClick={()=>{abandonDestination();setCreateOpen(true);}}>＋</Button><Button className={tab==='messages'?'active':''} onClick={()=>changeTab('messages')}><Text className="wv-tab-symbol">▱</Text><Text>消息{account?.messages.some(m=>!m.read)?' ·':''}</Text></Button><Button className={tab==='me'?'active':''} onClick={()=>changeTab('me')}><Text className="wv-tab-symbol">○</Text><Text>我的</Text></Button></View>
    {createOpen && <View className="wv-overlay" onClick={()=>setCreateOpen(false)}><View className="wv-sheet" onClick={e=>e.stopPropagation()}><Text className="wv-title">发起一次相聚</Text><Text className="wv-subtitle">选一种方式，把期待变成计划。</Text><View className="wv-create-card peach" onClick={()=>create('friend')}><Text className="wv-create-icon">♧</Text><View><Text className="wv-card-title">朋友聚会</Text><Text className="wv-muted">安排已明确，直接创建活动</Text></View><Text className="wv-arrow">›</Text></View><View className="wv-create-card lilac" onClick={()=>create('preparation')}><Text className="wv-create-icon">✧</Text><View><Text className="wv-card-title">先筹备朋友聚会</Text><Text className="wv-muted">只有想法，先收集大家的需求</Text></View><Text className="wv-arrow">›</Text></View><View className="wv-create-card mint" onClick={()=>create('team')}><Text className="wv-create-icon">◈</Text><View><Text className="wv-card-title">大型团建</Text><Text className="wv-muted">收集需求，让安排更合心意</Text></View><Text className="wv-arrow">›</Text></View><Action onClick={()=>setCreateOpen(false)}>取消</Action></View></View>}
    {cityOpen && <View className="wv-overlay" onClick={closeCity}><View className="wv-sheet" onClick={e=>e.stopPropagation()}><Text className="wv-title">想去哪个城市？</Text><Text className="wv-muted">用于地点浏览和新建时的搜索城市默认，不改变已有安排或已编辑的输入。</Text><View className="wv-search"><Input value={citySearch} maxlength={30} placeholder="搜索或输入城市名称" onInput={e=>editCity(e.detail.value)} onConfirm={()=>chooseCity(citySearch)}/></View><Action disabled={locating} onClick={()=>void locate()}>{locating?'正在获取位置…':'获取当前位置'}</Action>{locationNote && <Notice>{locationNote}</Notice>}<Text className="wv-section-title">常用城市</Text><View className="wv-city-grid">{COMMON_CITIES.filter(c=>!citySearch||c.includes(citySearch)).map(c=><Button key={c} className={c===city?'selected':''} onClick={()=>chooseCity(c)}>{c}</Button>)}</View>{citySearch && <Action onClick={()=>chooseCity(citySearch)}>使用“{citySearch}”</Action>}<Action onClick={closeCity}>返回</Action></View></View>}
  </View>;
}

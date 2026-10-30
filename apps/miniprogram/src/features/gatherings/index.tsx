import {ApiClientError} from '@weevibe/api-client';
import '../design-c/foundation.css';
import '../design-c/screens.css';
import {useEffect,useRef,useState} from 'react';
import Taro,{useDidHide,useDidShow,useUnload,useRouter,useShareAppMessage} from '@tarojs/taro';
import {Text,View} from '@tarojs/components';
import {activityIdSchema,type GatheringSnapshot} from '@weevibe/contracts';
import {automaticUser} from '../../platform/automatic-session';
import {establishSession,getToken} from '../../platform/api';
import safeShare from '../../assets/share-safe.png';
import {PrivacyConsent} from '../../components/privacy-consent';
import {GatheringDesigner} from './designer';
import {GatheringInspirationEntry} from './inspiration-entry';
import {GatheringManage} from './manage';
import {GatheringProfileBoundary} from './profile-boundary';
import {gatheringMessage,readGathering} from './client';
import './gatherings.css';
import '../../design-c.css';
import {GatheringDesignChrome} from './page-chrome';
import {CAction} from '../design-c/ui';
import {GatheringEntryState} from './entry-state';

export default function GatheringPage(){
  const[designChrome,setDesignChrome]=useState<'nickname'|'plan'|'result'|'interview'|'form'|null>(null);
  const params=useRouter().params,parsedId=activityIdSchema.safeParse(params.id),id=parsedId.success?parsedId.data:'',kind=params.new==='friend'||params.new==='team'?params.new:undefined,entry=params.entry==='share'?'share':'manage';
  const[createdShare,setCreatedShare]=useState<{actor:string;session:string;data:GatheringSnapshot}>();
  const routeInvalid=params.id!==undefined&&(!parsedId.success||params.new!==undefined)||params.new!==undefined&&!kind||!id&&!kind;
  const[identity,setIdentity]=useState<{actor:string;session:string}>(),[stored,setStored]=useState<{actor:string;session:string;data:GatheringSnapshot}>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[readFailed,setReadFailed]=useState(false);
  const snapshot=identity&&stored?.actor===identity.actor&&stored.session===identity.session&&stored.data.gathering.id===id?stored.data:undefined;
  function accept(source:{actor:string;session:string},next:GatheringSnapshot){setStored(previous=>{
    if(previous?.actor===source.actor&&previous.session===source.session&&previous.data.gathering.id===next.gathering.id){
      if(previous.data.workflow&&next.workflow&&next.workflow.version<previous.data.workflow.version)return previous;
      if(previous.data.viewer.is_member&&!next.viewer.is_member||previous.data.own&&!next.own||next.gathering.revision<previous.data.gathering.revision||(next.own&&previous.data.own&&next.own.version<previous.data.own.version)||next.server_time<previous.data.server_time)return previous;
    }
    return {...source,data:next};
  });}
  const mounted=useRef(true),visible=useRef(true),epoch=useRef(0),lock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  const hide=()=>{visible.current=false;epoch.current++;lock.current=false;};useDidHide(hide);useUnload(hide);useDidShow(()=>{visible.current=true;void refresh();});
  async function refresh(){
    if(lock.current||!mounted.current||!visible.current)return;
    if(routeInvalid){setNotice('入口不完整，请从朋友分享、主页或我的筹备记录进入。');return;}
    lock.current=true;const ticket=++epoch.current;setBusy(true);setNotice('');let readingSession=getToken();
    try{
      const next=await automaticUser();if(!mounted.current||!visible.current||ticket!==epoch.current||getToken()!==next.session)return;
      const actor=activityIdSchema.parse(next.user.user_id),source={actor,session:next.session};
      readingSession=source.session;setIdentity(source);
      if(id){const guard=()=>{if(!mounted.current||!visible.current||ticket!==epoch.current||getToken()!==source.session)throw Error('STALE_GATHERING');};const data=await readGathering(source.session,id,guard);guard();accept(source,data);}setReadFailed(false);
    }catch(e){if(mounted.current&&visible.current&&ticket===epoch.current){if(getToken()!==readingSession||e instanceof ApiClientError&&(['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'].includes(e.code)||[401,403,404].includes(e.status)))setStored(undefined);setReadFailed(true);setNotice(gatheringMessage(e));}}
    finally{if(ticket===epoch.current){lock.current=false;if(mounted.current)setBusy(false);}}
  }
  async function login(){if(lock.current||!visible.current)return;lock.current=true;setBusy(true);setNotice('');const ticket=++epoch.current;try{await establishSession(()=>{if(!mounted.current||!visible.current||ticket!==epoch.current)throw Error('STALE_GATHERING');});if(ticket===epoch.current){lock.current=false;await refresh();}}catch(e){if(mounted.current&&visible.current&&ticket===epoch.current)setNotice(gatheringMessage(e));}finally{if(ticket===epoch.current){lock.current=false;setBusy(false);}}}
  const valid=!!identity&&identity.session===getToken();
  const newFriend=!id&&kind==='friend';
  const shared=snapshot??(valid&&!id&&createdShare?.actor===identity?.actor&&createdShare?.session===identity?.session&&createdShare?.data.gathering.kind===kind?createdShare.data:undefined);
  useShareAppMessage(()=>!routeInvalid&&identity?.session===getToken()&&shared?{title:`${shared.gathering.title}｜${shared.gathering.kind==='friend'?'朋友出游':'一起团建'}${shared.final_choice?' · 安排已定案':''}`,path:`/pages/gathering/index?id=${shared.gathering.id}&entry=share`,imageUrl:safeShare}:{title:'WeeVibe · 一起出发',path:'/pages/index/index',imageUrl:safeShare});
  const created=(next:GatheringSnapshot)=>{if(!id&&identity&&getToken()===identity.session&&mounted.current&&visible.current&&next.gathering.kind===kind&&next.viewer.is_owner&&next.gathering.owner.user_id.toLowerCase()===identity.actor.toLowerCase()&&activityIdSchema.safeParse(next.gathering.id).success)setCreatedShare({...identity,data:next});};
  const home=()=>void Taro.reLaunch({url:'/pages/index/index'});

  const update=(next:GatheringSnapshot)=>{if(valid&&identity&&mounted.current&&visible.current&&next.gathering.id===id){accept(identity,next);setReadFailed(false);setNotice('');}};
  const teamChrome=kind==='team'||snapshot?.gathering.kind==='team';
  return <GatheringDesignChrome.Provider value={setDesignChrome}><View className={`gg-screen gg-screen-designed`}>
    {routeInvalid?<GatheringEntryState mode="invalid" message="入口不完整或有冲突，请重新打开朋友分享的活动。" busy={false} home={home} retry={()=>{}}/>:valid&&identity?<>
      {teamChrome&&!params.inspiration&&!designChrome&&<View className="gg-top"><Text className="gg-brand">WeeVibe<Text>•</Text></Text><Text className="gg-muted">好时光，一起。</Text></View>}
      {snapshot&&readFailed&&<View className="gh-notice" role="alert"><Text>{snapshot.final_choice?'最新内容暂未读到，以下为上次读取的定案记录。':'最新内容暂未读到，修改已暂停，当前输入会保留。'}</Text><Text>{notice||'正在重新读取最新内容…'}</Text><CAction disabled={busy} onClick={()=>void refresh()}>{snapshot.final_choice?'重新读取定案记录':'重新读取最新内容'}</CAction></View>}
      <GatheringProfileBoundary actor={identity.actor} session={identity.session} cancel={home}>{id?snapshot?<GatheringManage key={`${identity.actor}:${identity.session}:${id}:${entry}`} entry={entry} readVerified={!readFailed} snapshot={snapshot} actor={identity.actor} session={identity.session} update={update} refresh={refresh}/>:<GatheringEntryState mode={busy?'loading':'error'} message={notice} busy={busy} home={home} retry={()=>void refresh()}/>:kind==='friend'&&params.inspiration?<GatheringInspirationEntry key={`${identity.actor}:${identity.session}:${params.inspiration}`} actor={identity.actor} session={identity.session} sourceId={params.inspiration} onCreated={created}/>:kind?<GatheringDesigner key={`${identity.actor}:${identity.session}:${kind}`} actor={identity.actor} session={identity.session} kind={kind} onCreated={created}/>:null}</GatheringProfileBoundary>
    </>:<GatheringEntryState mode={busy?'loading':'login'} message={notice} busy={busy} home={home} retry={()=>void login()}/>}
    <PrivacyConsent/>
  </View></GatheringDesignChrome.Provider>;
}

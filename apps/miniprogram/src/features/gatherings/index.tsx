import {useEffect,useRef,useState} from 'react';
import Taro,{useDidHide,useDidShow,useUnload,useRouter,useShareAppMessage} from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import {activityIdSchema,type GatheringSnapshot} from '@weevibe/contracts';
import {automaticUser} from '../../platform/automatic-session';
import {establishSession,getToken} from '../../platform/api';
import safeShare from '../../assets/share-safe.png';
import {PrivacyConsent} from '../../components/privacy-consent';
import {GatheringDesigner} from './designer';
import {GatheringManage} from './manage';
import {GatheringProfileBoundary} from './profile-boundary';
import {gatheringMessage,readGathering} from './client';
import './gatherings.css';
import {GatheringDesignChrome} from './page-chrome';

export default function GatheringPage(){
  const[designChrome,setDesignChrome]=useState<'nickname'|'plan'|null>(null);
  const params=useRouter().params,parsedId=activityIdSchema.safeParse(params.id),id=parsedId.success?parsedId.data:'',kind=params.new==='friend'||params.new==='team'?params.new:undefined,entry=params.entry==='share'?'share':'manage';
  const[identity,setIdentity]=useState<{actor:string;session:string}>(),[stored,setStored]=useState<{actor:string;session:string;data:GatheringSnapshot}>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const snapshot=identity&&stored?.actor===identity.actor&&stored.session===identity.session&&stored.data.gathering.id===id?stored.data:undefined;
  function accept(source:{actor:string;session:string},next:GatheringSnapshot){setStored(previous=>{
    if(previous?.actor===source.actor&&previous.session===source.session&&previous.data.gathering.id===next.gathering.id){
      if(previous.data.viewer.is_member&&!next.viewer.is_member||previous.data.own&&!next.own||next.gathering.revision<previous.data.gathering.revision||(next.own&&previous.data.own&&next.own.version<previous.data.own.version)||next.server_time<previous.data.server_time)return previous;
    }
    return {...source,data:next};
  });}
  const mounted=useRef(true),visible=useRef(true),epoch=useRef(0),lock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;epoch.current++;};},[]);
  const hide=()=>{visible.current=false;epoch.current++;lock.current=false;};useDidHide(hide);useUnload(hide);useDidShow(()=>{visible.current=true;void refresh();});
  async function refresh(){
    if(lock.current||!mounted.current||!visible.current)return;
    if(!id&&!kind){setNotice('入口不完整，请从朋友分享、主页或我的筹备记录进入。');return;}
    lock.current=true;const ticket=++epoch.current;setBusy(true);setNotice('');
    try{
      const next=await automaticUser();if(!mounted.current||!visible.current||ticket!==epoch.current||getToken()!==next.session)return;
      const actor=activityIdSchema.parse(next.user.user_id),source={actor,session:next.session};
      setIdentity(source);
      if(id){const guard=()=>{if(!mounted.current||!visible.current||ticket!==epoch.current||getToken()!==source.session)throw Error('STALE_GATHERING');};const data=await readGathering(source.session,id,guard);guard();accept(source,data);}
    }catch(e){if(mounted.current&&visible.current&&ticket===epoch.current){if(getToken()!==identity?.session)setStored(undefined);setNotice(gatheringMessage(e));}}
    finally{if(ticket===epoch.current){lock.current=false;if(mounted.current)setBusy(false);}}
  }
  async function login(){if(lock.current||!visible.current)return;lock.current=true;setBusy(true);setNotice('');const ticket=++epoch.current;try{await establishSession(()=>{if(!mounted.current||!visible.current||ticket!==epoch.current)throw Error('STALE_GATHERING');});if(ticket===epoch.current){lock.current=false;await refresh();}}catch(e){if(mounted.current&&visible.current&&ticket===epoch.current)setNotice(gatheringMessage(e));}finally{if(ticket===epoch.current){lock.current=false;setBusy(false);}}}
  const valid=!!identity&&identity.session===getToken();
  useShareAppMessage(()=>identity?.session===getToken()&&snapshot?{title:`${snapshot.gathering.title}｜${snapshot.gathering.kind==='friend'?'朋友出游':'一起团建'}`,path:`/pages/gathering/index?id=${snapshot.gathering.id}&entry=share`,imageUrl:safeShare}:{title:'WeeVibe · 一起出发',path:'/pages/index/index',imageUrl:safeShare});
  const update=(next:GatheringSnapshot)=>{if(valid&&identity&&mounted.current&&visible.current&&next.gathering.id===id)accept(identity,next);};
  return <GatheringDesignChrome.Provider value={setDesignChrome}><View className={`gg-screen${designChrome?' gg-screen-designed':''}`}>{!designChrome&&<View className="gg-top"><Text className="gg-brand">WeeVibe<Text>•</Text></Text><Text className="gg-muted">好时光，一起。</Text></View>}{designChrome!=='plan'&&<Button className="gg-back" onClick={()=>void Taro.navigateBack({fail:()=>void Taro.reLaunch({url:'/pages/index/index'})}).catch(()=>{})}>← 返回</Button>}
    {notice&&<Text className="gg-notice error">{notice}</Text>}
    {valid&&identity?<GatheringProfileBoundary actor={identity.actor} session={identity.session} cancel={()=>void Taro.reLaunch({url:'/pages/index/index'})}>{id?snapshot?<GatheringManage key={`${identity.actor}:${identity.session}:${id}:${entry}`} entry={entry} snapshot={snapshot} actor={identity.actor} session={identity.session} update={update} refresh={refresh}/>:<View className="gg-empty"><Text>{busy?'正在读取筹备…':'暂时无法确认筹备内容'}</Text><Button className="gg-secondary" disabled={busy} onClick={()=>void refresh()}>重新读取</Button></View>:kind?<GatheringDesigner key={`${identity.actor}:${identity.session}:${kind}`} actor={identity.actor} session={identity.session} kind={kind}/>:null}</GatheringProfileBoundary>:<View className="gg-panel"><Text className="gg-heading">先认识一下，再一起出发</Text><Text className="gg-muted">使用微信身份后继续；当前入口会保留。</Text><Button className="gg-primary" disabled={busy} loading={busy} onClick={()=>void login()}>{busy?'正在确认微信身份…':'微信登录并继续'}</Button></View>}
    <PrivacyConsent/>
  </View></GatheringDesignChrome.Provider>;
}

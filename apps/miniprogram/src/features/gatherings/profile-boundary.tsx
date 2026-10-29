import {Fragment,useEffect,useRef,useState,type ReactNode} from 'react';
import Taro from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import {activityIdSchema} from '@weevibe/contracts';
import {api,getToken} from '../../platform/api';

/** Keep one verified actor/session while this editable area stays mounted; page refreshes retain drafts. */
export function GatheringProfileBoundary({actor,session=getToken(),required=true,children,cancel}:{actor?:string;session?:string;required?:boolean;children:ReactNode;cancel?:()=>void}){
  const sourceKey=`${session||''}:${actor||'lookup'}`,observed=useRef({key:sourceKey,epoch:0});
  if(observed.current.key!==sourceKey)observed.current={key:sourceKey,epoch:observed.current.epoch+1};
  const epoch=observed.current.epoch,mounted=useRef(true),request=useRef(0),lock=useRef(false);
  const[identity,setIdentity]=useState<{session:string;actor:string;epoch:number}>(),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;};},[]);
  const sameSource=()=>mounted.current&&!!session&&getToken()===session&&observed.current.key===sourceKey&&observed.current.epoch===epoch;
  async function resolveIdentity(){
    if(!required||actor||!sameSource()||lock.current)return;lock.current=true;setBusy(true);setNotice('');const ticket=++request.current;
    try{const me=await api.me();if(!sameSource()||ticket!==request.current)return;const id=activityIdSchema.safeParse(me.user_id);if(!id.success)throw Error();setIdentity({session:session!,actor:id.data,epoch});}
    catch{if(sameSource()&&ticket===request.current)setNotice('暂时无法确认本人身份，请重新读取。');}
    finally{lock.current=false;if(mounted.current&&ticket===request.current)setBusy(false);}
  }
  useEffect(()=>{request.current++;lock.current=false;if(required&&!actor&&session)void resolveIdentity();},[sourceKey,required]);
  if(!required)return <>{children}</>;
  const leave=cancel??(()=>{try{void Taro.reLaunch({url:'/pages/index/index'}).catch(()=>{});}catch{}});
  if(!session||getToken()!==session)return <View className="gg-profile-gate"><Text className="gg-notice">请使用微信身份继续。无需设置账号头像或昵称。</Text><Button className="gg-secondary" onClick={leave}>返回首页</Button></View>;
  const actorId=actor?activityIdSchema.safeParse(actor).data:identity?.session===session&&identity.epoch===epoch?identity.actor:undefined;
  if(!actorId)return <View className="gg-profile-gate"><Text className="gg-notice">{notice||'正在确认本人身份…'}</Text><Button className="gg-secondary" disabled={busy} onClick={()=>void resolveIdentity()}>重新读取身份</Button><Button className="gg-secondary" onClick={leave}>返回首页</Button></View>;
  return <Fragment key={`${sourceKey}:${epoch}`}>{children}</Fragment>;
}

import {useEffect,useRef,useState} from 'react';
import {Button,Text,View} from '@tarojs/components';
import {requestAccount,type AccountProfile} from '../../platform/account-api';
import {loadAvatar} from '../../platform/avatar';
import {errorText} from '../../platform/page-state';
import {ProfileForm} from '../shell/profile';
import {useGatheringSource} from './use-source';
import './gatherings.css';
import './profile-gate.css';

export function GatheringProfileGate({actor,session,completed,cancel}:{actor:string;session:string;completed:()=>void|Promise<void>;cancel:()=>void}){
  const source=useGatheringSource(session),owner=useRef(actor),lock=useRef(false);
  const[profile,setProfile]=useState<AccountProfile>(),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const valid=()=>source.valid()&&owner.current.toLowerCase()===actor.toLowerCase();
  async function verify(){
    if(lock.current||!valid())return;lock.current=true;setBusy(true);setNotice('');const ticket=source.ticket();
    const guard=()=>{ticket();if(!valid())throw Error('STALE_GATHERING');};
    try{
      const[account,path]=await Promise.all([requestAccount(session),loadAvatar(actor)]);guard();
      // loadAvatar obtains a validated server asset for this actor, then creates its native path.
      // A ProfileForm callback or a temporary selected image is never treated as verification.
      setProfile({...account.profile,avatar_url:path});
      if(account.profile.nickname?.trim()&&path){await completed();return;}
      setNotice('请先保存头像和昵称。可以使用微信头像、微信昵称，也可以自定义。');
    }catch(error){if(valid())setNotice(errorText(error));}
    finally{lock.current=false;if(source.alive())setBusy(false);}
  }
  useEffect(()=>{void verify();},[]);
  if(!valid())return <View><Text className="gg-notice">登录来源已变化，原资料已隐藏，请重新打开。</Text><Button className="gg-secondary" onClick={cancel}>返回首页</Button></View>;
  return <View className="gg-profile-gate"><Text className="gg-title">先认识一下，再一起出发</Text><Text className="gg-muted">组局和填写前请保存头像、昵称。这些用于你的小程序账号；朋友出游另外设置本次活动昵称，其他资料的公开范围仍由你控制。</Text>{notice&&<Text className="gg-notice">{notice}</Text>}{busy?<Text className="gg-notice">正在核对服务器保存的头像与昵称…</Text>:profile?<ProfileForm initial={profile} ownerSession={session} saved={next=>{if(valid())setProfile(next);}} avatarSaved={()=>{}} close={()=>void verify()}/>:<Button className="gg-primary" onClick={()=>void verify()}>重新核对资料</Button>}<Button className="gg-secondary" disabled={busy} onClick={cancel}>暂时返回首页</Button></View>;
}

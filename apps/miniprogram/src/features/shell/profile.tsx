import { CIdentityEditor } from '../design-c/profile-view';
import { CAction, CNotice, CSheet } from '../design-c/ui';
import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { getToken } from '../../platform/api';
import { uploadAvatar } from '../../platform/avatar';
import { requestAccount, type AccountProfile } from '../../platform/account-api';
import { errorText } from '../../platform/page-state';
import { profilePresentationSchema } from '@weevibe/contracts';
import { requirePrivacyPermission } from '../../platform/location-permission';
export type ProfileData = AccountProfile;
export function ProfileForm({ initial, ownerSession, close, saved, avatarSaved, initialNicknameFocus=false }: { initialNicknameFocus?:boolean; initial: ProfileData; ownerSession: string | undefined; close:()=>void; saved:(p:ProfileData)=>void; avatarSaved?:(path:string)=>void }) {
  const [data,setData]=useState<ProfileData>(initial); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [avatar,setAvatar]=useState('');const [persistedAvatar,setPersistedAvatar]=useState(initial.avatar_url || '');
  const editorToken=useRef(ownerSession);const operationLock=useRef(false);const [avatarBusy,setAvatarBusy]=useState(false);
  async function saveAvatar(){if(!canEdit() || !avatar)return;operationLock.current=true;setAvatarBusy(true);setError('');try{const path=await uploadAvatar(avatar,editorToken.current);if(!sameSource())return;setAvatar('');setPersistedAvatar(path);avatarSaved?.(path);if(sameSource())setError('头像已保存到服务器，下次登录可恢复。');}catch(e){if(sameSource())setError(errorText(e));}finally{operationLock.current=false;if(mounted.current)setAvatarBusy(false);}}
  const mounted=useRef(true);const currentData=useRef(data);currentData.current=data;const operationTicket=useRef(0);
  const source=useRef({owner:ownerSession,epoch:0});
  if(source.current.owner!==ownerSession)source.current={owner:ownerSession,epoch:source.current.epoch+1};
  const renderEpoch=source.current.epoch;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operationTicket.current++;};},[]);
  const sameSource=()=>mounted.current && !!editorToken.current && editorToken.current===getToken() && source.current.owner===editorToken.current && source.current.epoch===renderEpoch;
  const canEdit=()=>sameSource() && !operationLock.current;
  const field=(key:keyof ProfileData,value:string)=>{if(!canEdit()){if(mounted.current)setError('当前操作或账号已变化，请核对资料后重试');return;}const next={...currentData.current,[key]:value};currentData.current=next;setData(next);};
  const [nicknameFocus,setNicknameFocus]=useState(initialNicknameFocus);
  const extra=profilePresentationSchema.parse(data);
  function previewAvatar(path:string){if(!canEdit()||!path)return;setAvatar(path);setError('已选择新头像，点击“保存头像”后生效。');}
  async function chooseCustomAvatar(){
    if(!canEdit())return;const ticket=++operationTicket.current;operationLock.current=true;setAvatarBusy(true);setError('');
    const guard=()=>{if(!sameSource()||ticket!==operationTicket.current)throw Error('STALE_AVATAR_SELECTION');};
    try{await requirePrivacyPermission(guard);guard();const result=await Taro.chooseMedia({count:1,mediaType:['image'],sourceType:['album']});guard();const path=result.tempFiles[0]?.tempFilePath;if(path){setAvatar(path);setError('已选择自定义头像，点击“保存头像”后生效。');}}
    catch(e){if(sameSource()&&ticket===operationTicket.current){const reason=String((e as {errMsg?:string})?.errMsg||'');if(!/cancel/i.test(reason))setError('头像选择未完成，可重新选择；原头像保持不变。');}}
    finally{if(ticket===operationTicket.current){operationLock.current=false;if(mounted.current)setAvatarBusy(false);}}
  }
  async function submit(){
    if(operationLock.current)return;
    if(!sameSource()){if(mounted.current)setError('账号或编辑来源已切换，请重新打开资料页');return;}
    setError('');const input=currentData.current;
    const ticket=++operationTicket.current;operationLock.current=true;setBusy(true);
    try {
      const result=await requestAccount(editorToken.current,'PATCH',{action:'profile',profile:{nickname:input.nickname || '',birthday:input.birthday || '',gender:input.gender || '',zodiac:input.zodiac || '',mbti:input.mbti || '',signature:input.signature || '',introduction:input.introduction || '',bio:input.bio||'',interests:input.interests||[],cover_style:input.cover_style||'mint',visibility:input.visibility||extra.visibility}});
      if(!sameSource() || operationTicket.current!==ticket)return;
      saved({...result.profile,avatar_url:persistedAvatar});
      if(sameSource() && operationTicket.current===ticket)close();
    }catch(e){if(sameSource() && operationTicket.current===ticket)setError(errorText(e));}
    finally{if(operationTicket.current===ticket){operationLock.current=false;if(mounted.current)setBusy(false);}}
  }
  if(!editorToken.current || editorToken.current!==getToken() || ownerSession!==editorToken.current)return <CNotice>登录账号已变化，原账号的私人资料已隐藏；请返回后重新打开。<CAction onClick={close}>返回</CAction></CNotice>;
  return <CSheet title="头像与昵称" close={close} footer={<CAction variant="primary" disabled={busy||avatarBusy} onClick={()=>void submit()}>{busy?'保存中…':'保存资料'}</CAction>}><CIdentityEditor hideActions nickname={data.nickname||''} avatar={avatar||persistedAvatar} selectedAvatar={!!avatar} busy={busy} avatarBusy={avatarBusy} focus={nicknameFocus} notice={error} choose={previewAvatar} custom={()=>void chooseCustomAvatar()} saveAvatar={()=>void saveAvatar()} setNickname={value=>field('nickname',value)} focusNickname={value=>{if(!value||canEdit())setNicknameFocus(value);}} save={()=>void submit()} close={close}/></CSheet>;
}

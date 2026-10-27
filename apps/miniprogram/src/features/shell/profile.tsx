import { useEffect, useRef, useState } from 'react';
import { getToken } from '../../platform/api';
import { uploadAvatar } from '../../platform/avatar';
import { View, Text, Input, Picker, Button, Image, Textarea } from '@tarojs/components';
import { requestAccount, type AccountProfile } from '../../platform/account-api';
import { errorText } from '../../platform/page-state';
import { Action, Field, Notice } from '../../components/ui';
import { zodiacSuggestion } from './zodiac';
export type ProfileData = AccountProfile;
const mbtis=['未设置','INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];
const genders=['未设置','女','男','不愿透露'];
export function ProfileForm({ initial, ownerSession, close, saved, avatarSaved }: { initial: ProfileData; ownerSession: string | undefined; close:()=>void; saved:(p:ProfileData)=>void; avatarSaved?:(path:string)=>void }) {
  const [data,setData]=useState<ProfileData>(initial); const [busy,setBusy]=useState(false); const [error,setError]=useState(''); const [avatar,setAvatar]=useState('');const [persistedAvatar,setPersistedAvatar]=useState(initial.avatar_url || '');
  const editorToken=useRef(ownerSession);const operationLock=useRef(false);const [avatarBusy,setAvatarBusy]=useState(false);
  async function saveAvatar(){if(operationLock.current || !avatar)return;operationLock.current=true;setAvatarBusy(true);setError('');try{const path=await uploadAvatar(avatar,editorToken.current);setAvatar(path);setPersistedAvatar(path);avatarSaved?.(path);setError('头像已保存到服务器，下次登录可恢复。');}catch(e){setError(errorText(e));}finally{operationLock.current=false;setAvatarBusy(false);}}
  const mounted=useRef(true);const currentData=useRef(data);currentData.current=data;const operationTicket=useRef(0);
  const source=useRef({owner:ownerSession,epoch:0});
  if(source.current.owner!==ownerSession)source.current={owner:ownerSession,epoch:source.current.epoch+1};
  const renderEpoch=source.current.epoch;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;operationTicket.current++;};},[]);
  const sameSource=()=>mounted.current && !!editorToken.current && editorToken.current===getToken() && source.current.owner===editorToken.current && source.current.epoch===renderEpoch;
  const canEdit=()=>sameSource() && !operationLock.current;
  const field=(key:keyof ProfileData,value:string)=>{if(!canEdit()){if(mounted.current)setError('当前操作或账号已变化，请核对资料后重试');return;}const next={...currentData.current,[key]:value};currentData.current=next;setData(next);};
  const suggestion=zodiacSuggestion(data.birthday);
  function adoptSuggestion(sourceBirthday: string | undefined){if(!canEdit() || currentData.current.birthday!==sourceBirthday){if(mounted.current)setError('生日或账号已变化，请核对当前建议');return;}const next=zodiacSuggestion(sourceBirthday);if(next)field('zodiac',next);}

  async function submit(){
    if(operationLock.current)return;
    if(!sameSource()){if(mounted.current)setError('账号或编辑来源已切换，请重新打开资料页');return;}
    setError('');const input=currentData.current;
    if(input.birthday && input.birthday>new Date().toISOString().slice(0,10)){setError('生日不能晚于今天');return;}
    const ticket=++operationTicket.current;operationLock.current=true;setBusy(true);
    try {
      const result=await requestAccount(editorToken.current,'PATCH',{action:'profile',profile:{nickname:input.nickname || '',birthday:input.birthday || '',gender:input.gender || '',zodiac:input.zodiac || '',mbti:input.mbti || '',signature:input.signature || '',introduction:input.introduction || ''}});
      if(!sameSource() || operationTicket.current!==ticket)return;
      saved({...result.profile,avatar_url:persistedAvatar});
      if(sameSource() && operationTicket.current===ticket)close();
    }catch(e){if(sameSource() && operationTicket.current===ticket)setError(errorText(e));}
    finally{if(operationTicket.current===ticket){operationLock.current=false;if(mounted.current)setBusy(false);}}
  }
  if(!editorToken.current || editorToken.current!==getToken() || ownerSession!==editorToken.current)return <Notice>登录账号已变化，原账号的私人资料已隐藏；请返回后重新打开。<Action onClick={close}>返回</Action></Notice>;
  return <View><View className="wv-section"><Text className="wv-title">个人信息</Text><Text className="wv-muted">资料选填。头像与昵称用于活动内身份和分享摘要；生日、性别、星座、MBTI、签名与介绍仅本人可见，不用于性格或能力推断。</Text></View>
  <Button className="wv-avatar-button" openType="chooseAvatar" onChooseAvatar={e=>{setAvatar(e.detail.avatarUrl);setError('已选择头像预览，请点击保存头像。未保存前不会替换服务器资料。');}}>{avatar || data.avatar_url ? <Image className="wv-avatar" src={avatar || data.avatar_url || ''}/> : '选择头像'}</Button>
  {avatar && <Action disabled={avatarBusy || busy} onClick={()=>void saveAvatar()}>{avatarBusy?'上传头像中…':'保存头像'}</Action>}
  <View className="field"><Text className="field-label">昵称</Text><Input type="nickname" value={data.nickname || ''} maxlength={32} placeholder="手动填写或使用微信提供的昵称" onInput={e=>field('nickname',e.detail.value)} onBlur={e=>field('nickname',e.detail.value)}/></View>
  <View className="wv-card"><Picker mode="date" end={new Date().toISOString().slice(0,10)} value={data.birthday || ''} onChange={e=>field('birthday',String(e.detail.value))}><Text>出生日期　{data.birthday || '未设置'}　›</Text></Picker>{data.birthday && <Action variant="text" onClick={()=>field('birthday','')}>清空生日</Action>}</View>
  <View className="wv-card"><Picker range={genders} onChange={e=>field('gender',genders[Number(e.detail.value)] || '未设置')}><Text>性别　{data.gender || '未设置'}　›</Text></Picker></View>
  <View className="wv-card"><Field label="星座（选填）" value={data.zodiac || ''} disabled={busy || avatarBusy} onChange={v=>field('zodiac',v)}/>
  <Text className="wv-muted">按常用月日区间提供建议，交界日期可能不同，并非天文精算；不用于性格或匹配判断。采用或清空后仍需点击保存资料。</Text>
  {suggestion ? <View><Text>生日建议：{suggestion}</Text><Action disabled={busy || avatarBusy} onClick={()=>adoptSuggestion(data.birthday)}>采用生日建议</Action></View> : <Text className="wv-muted">可选填有效生日查看建议，也可手动填写或留空。</Text>}
  <Action variant="text" disabled={busy || avatarBusy || !data.zodiac} onClick={()=>field('zodiac','')}>清空星座</Action></View>
  <View className="wv-card"><Picker range={mbtis} onChange={e=>field('mbti',mbtis[Number(e.detail.value)]==='未设置'?'':mbtis[Number(e.detail.value)] || '')}><Text>MBTI　{data.mbti || '未设置'}　›</Text></Picker></View>
  <View className="field"><Text className="field-label">个性签名（最多 100 字）</Text><Input value={data.signature || ''} maxlength={100} onInput={e=>field('signature',e.detail.value)}/></View>
  <View className="field"><Text className="field-label">介绍自己（最多 500 字）</Text><Textarea className="wv-textarea" value={data.introduction || ''} maxlength={500} onInput={e=>field('introduction',e.detail.value)}/></View>
  {error && <Notice>{error}</Notice>}<Action variant="primary" disabled={busy || avatarBusy} onClick={()=>void submit()}>{busy?'保存中…':'保存资料'}</Action><Action disabled={busy || avatarBusy} onClick={close}>返回</Action></View>;
}

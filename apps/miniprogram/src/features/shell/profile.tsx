import { UiIcon } from '../../components/ui-icon';
import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { getToken } from '../../platform/api';
import { uploadAvatar } from '../../platform/avatar';
import { View, Text, Input, Picker, Button, Image, Switch } from '@tarojs/components';
import { requestAccount, type AccountProfile } from '../../platform/account-api';
import { errorText } from '../../platform/page-state';
import { Action, Field, Notice } from '../../components/ui';
import { zodiacSuggestion } from './zodiac';
import { profilePresentationSchema } from '@weevibe/contracts';
import { requirePrivacyPermission } from '../../platform/location-permission';
export type ProfileData = AccountProfile;
const mbtis=['未设置','INTJ','INTP','ENTJ','ENTP','INFJ','INFP','ENFJ','ENFP','ISTJ','ISFJ','ESTJ','ESFJ','ISTP','ISFP','ESTP','ESFP'];
const genders=['未设置','女','男','不愿透露'];
export function ProfileForm({ initial, ownerSession, close, saved, avatarSaved }: { initial: ProfileData; ownerSession: string | undefined; close:()=>void; saved:(p:ProfileData)=>void; avatarSaved?:(path:string)=>void }) {
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
  const suggestion=zodiacSuggestion(data.birthday);
  const [interestDraft,setInterestDraft]=useState(''), [nicknameFocus,setNicknameFocus]=useState(false);
  const extra=profilePresentationSchema.parse(data);
  function present(patch:Partial<ProfileData>){if(!canEdit())return;const next={...currentData.current,...patch};currentData.current=next;setData(next);}
  function addInterest(value:string){const tag=value.trim();if(!canEdit()||!tag)return;const tags=currentData.current.interests||[];if(tag.length>12||tags.length>=6){setError('兴趣最多 6 个，每个最多 12 字');return;}if(!tags.includes(tag))present({interests:[...tags,tag]});setInterestDraft('');}
  function moveInterest(index:number){const tags=[...(currentData.current.interests||[])];if(index<1)return;[tags[index-1],tags[index]]=[tags[index],tags[index-1]];present({interests:tags});}
  function previewAvatar(path:string){if(!canEdit()||!path)return;setAvatar(path);setError('已选择新头像，点击“保存头像”后生效。');}
  async function chooseCustomAvatar(){
    if(!canEdit())return;const ticket=++operationTicket.current;operationLock.current=true;setAvatarBusy(true);setError('');
    const guard=()=>{if(!sameSource()||ticket!==operationTicket.current)throw Error('STALE_AVATAR_SELECTION');};
    try{await requirePrivacyPermission(guard);guard();const result=await Taro.chooseMedia({count:1,mediaType:['image'],sourceType:['album']});guard();const path=result.tempFiles[0]?.tempFilePath;if(path){setAvatar(path);setError('已选择自定义头像，点击“保存头像”后生效。');}}
    catch(e){if(sameSource()&&ticket===operationTicket.current){const reason=String((e as {errMsg?:string})?.errMsg||'');if(!/cancel/i.test(reason))setError('头像选择未完成，可重新选择；原头像保持不变。');}}
    finally{if(ticket===operationTicket.current){operationLock.current=false;if(mounted.current)setAvatarBusy(false);}}
  }
  function adoptSuggestion(sourceBirthday: string | undefined){if(!canEdit() || currentData.current.birthday!==sourceBirthday){if(mounted.current)setError('生日或账号已变化，请核对当前建议');return;}const next=zodiacSuggestion(sourceBirthday);if(next)field('zodiac',next);}

  async function submit(){
    if(operationLock.current)return;
    if(!sameSource()){if(mounted.current)setError('账号或编辑来源已切换，请重新打开资料页');return;}
    setError('');const input=currentData.current;
    if(input.birthday && input.birthday>new Date().toISOString().slice(0,10)){setError('生日不能晚于今天');return;}
    const ticket=++operationTicket.current;operationLock.current=true;setBusy(true);
    try {
      const result=await requestAccount(editorToken.current,'PATCH',{action:'profile',profile:{nickname:input.nickname || '',birthday:input.birthday || '',gender:input.gender || '',zodiac:input.zodiac || '',mbti:input.mbti || '',signature:input.signature || '',introduction:input.introduction || '',bio:input.bio||'',interests:input.interests||[],cover_style:input.cover_style||'mint',visibility:input.visibility||extra.visibility}});
      if(!sameSource() || operationTicket.current!==ticket)return;
      saved({...result.profile,avatar_url:persistedAvatar});
      if(sameSource() && operationTicket.current===ticket)close();
    }catch(e){if(sameSource() && operationTicket.current===ticket)setError(errorText(e));}
    finally{if(operationTicket.current===ticket){operationLock.current=false;if(mounted.current)setBusy(false);}}
  }
  if(!editorToken.current || editorToken.current!==getToken() || ownerSession!==editorToken.current)return <Notice>登录账号已变化，原账号的私人资料已隐藏；请返回后重新打开。<Action onClick={close}>返回</Action></Notice>;
  return <View className="wv-profile-editor"><View className="wv-section"><Text className="wv-title">编辑资料</Text><Text className="wv-muted">头像和昵称可供同活动成员查看；一句话介绍、兴趣、MBTI 和星座由你逐项选择是否公开。生日与性别仅本人可见。</Text></View>
  <View className="wv-identity-editor"><Text className="wv-section-title">头像</Text><View className="wv-identity-row"><View className="wv-avatar-button">{avatar || persistedAvatar ? <Image className="wv-avatar" src={avatar || persistedAvatar}/> : <UiIcon name="user"/>}</View><View className="wv-identity-actions"><Button className="action action-secondary" disabled={avatarBusy||busy} openType="chooseAvatar" onChooseAvatar={e=>previewAvatar(e.detail.avatarUrl)}>使用微信头像</Button><Button className="wv-link" disabled={avatarBusy||busy} onClick={()=>void chooseCustomAvatar()}>从相册自定义</Button></View></View><Text className="wv-muted">在微信选择面板中确认头像，也可以上传自己的图片。</Text></View>
  {avatar && <Action disabled={avatarBusy || busy} onClick={()=>void saveAvatar()}>{avatarBusy?'上传头像中…':'保存头像'}</Action>}
  <View className="field"><View className="wv-nickname-heading"><Text className="field-label">昵称</Text><Button className="wv-link" disabled={busy||avatarBusy} onClick={()=>{if(canEdit())setNicknameFocus(true);}}>使用微信昵称</Button></View><Input type="nickname" adjustPosition cursorSpacing={24} confirmType="done" value={data.nickname || ''} focus={nicknameFocus} disabled={busy||avatarBusy} maxlength={32} placeholder="填写昵称，或选择键盘上的微信昵称" onInput={e=>field('nickname',e.detail.value)} onConfirm={e=>field('nickname',e.detail.value)} onBlur={e=>{setNicknameFocus(false);field('nickname',e.detail.value);}}/><Text className="wv-muted">点击“使用微信昵称”，在键盘上方选择微信提供的昵称；也可以直接输入。</Text></View>
  <Field label="一句话介绍" value={data.bio||''} disabled={busy||avatarBusy} onChange={v=>present({bio:v})}/>
  <View className="wv-profile-edit-section"><Text className="wv-section-title">我的兴趣 · 最多 6 个</Text><View className="wv-interest-options">{['徒步','探店','桌游','看展','摄影','运动','下午茶','美食','唱歌','喝酒','手作'].map(tag=><Button key={tag} disabled={busy||avatarBusy} className={extra.interests.includes(tag)?'selected':''} onClick={()=>extra.interests.includes(tag)?present({interests:extra.interests.filter(t=>t!==tag)}):addInterest(tag)}>{tag}</Button>)}</View><Input className="wv-input" value={interestDraft} maxlength={12} placeholder="也可以写下自己的兴趣" onInput={e=>setInterestDraft(e.detail.value)} onConfirm={()=>addInterest(interestDraft)}/><Action disabled={busy||avatarBusy} onClick={()=>addInterest(interestDraft)}>添加兴趣</Action>{extra.interests.map((tag,i)=><View className="wv-tag-order" key={tag}><Text>{tag}</Text>{i>0&&<Button disabled={busy||avatarBusy} onClick={()=>moveInterest(i)}>上移</Button>}<Button disabled={busy||avatarBusy} onClick={()=>present({interests:extra.interests.filter(t=>t!==tag)})}>删除</Button></View>)}</View>
  <View className="wv-profile-edit-section"><Text className="wv-section-title">主动公开给同活动成员</Text>{(['bio','interests','mbti','zodiac'] as const).map((key,i)=><View className="wv-visibility-row" key={key}><Text>{['一句话介绍','兴趣标签','MBTI','星座'][i]}</Text><Switch checked={extra.visibility[key]} disabled={busy||avatarBusy} onChange={e=>present({visibility:{...extra.visibility,[key]:e.detail.value}})}/></View>)}</View>
  <View className="wv-card"><Picker mode="date" end={new Date().toISOString().slice(0,10)} value={data.birthday || ''} onChange={e=>field('birthday',String(e.detail.value))}><Text>出生日期　{data.birthday || '未设置'}　›</Text></Picker>{data.birthday && <Action variant="text" onClick={()=>field('birthday','')}>清空生日</Action>}</View>
  <View className="wv-card"><Picker range={genders} onChange={e=>field('gender',genders[Number(e.detail.value)] || '未设置')}><Text>性别　{data.gender || '未设置'}　›</Text></Picker></View>
  <View className="wv-card"><Field label="星座（选填）" value={data.zodiac || ''} disabled={busy || avatarBusy} onChange={v=>field('zodiac',v)}/>
  <Text className="wv-muted">按常用月日区间提供建议，交界日期可能不同，并非天文精算；不用于性格或匹配判断。采用或清空后仍需点击保存资料。</Text>
  {suggestion ? <View><Text>生日建议：{suggestion}</Text><Action disabled={busy || avatarBusy} onClick={()=>adoptSuggestion(data.birthday)}>采用生日建议</Action></View> : <Text className="wv-muted">可选填有效生日查看建议，也可手动填写或留空。</Text>}
  <Action variant="text" disabled={busy || avatarBusy || !data.zodiac} onClick={()=>field('zodiac','')}>清空星座</Action></View>
  <View className="wv-card"><Picker range={mbtis} onChange={e=>field('mbti',mbtis[Number(e.detail.value)]==='未设置'?'':mbtis[Number(e.detail.value)] || '')}><Text>MBTI　{data.mbti || '未设置'}　›</Text></Picker></View>
  {error && <Notice>{error}</Notice>}<Action variant="primary" disabled={busy || avatarBusy} onClick={()=>void submit()}>{busy?'保存中…':'保存资料'}</Action><Action disabled={busy || avatarBusy} onClick={close}>返回</Action></View>;
}

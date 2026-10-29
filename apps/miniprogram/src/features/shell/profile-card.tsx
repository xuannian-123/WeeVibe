import { UiIcon } from '../../components/ui-icon';
import { useEffect, useState } from 'react';
import { Button, Image, Text, View } from '@tarojs/components';
import type { MemberProfile } from '@weevibe/contracts';
import { cacheProfileImage } from '../../platform/navigation-api';
import { getToken } from '../../platform/api';
import './navigation.css';

export function ProfileCard({ profile, session, avatarPath = '', edit, settings }: { profile: Omit<MemberProfile, 'user_id' | 'avatar'> & { avatar?: MemberProfile['avatar'] }; session?: string; avatarPath?: string; edit?: () => void; settings?: () => void }) {
  const [avatar, setAvatar] = useState(avatarPath);
  useEffect(()=>{if(session!==getToken())return;try{setAvatar(profile.avatar?cacheProfileImage(profile.avatar):avatarPath);}catch{setAvatar(avatarPath);}},[profile.avatar?.digest,avatarPath,session]);
  if (session !== getToken()) return null;
  return <View className="wv-personal-card wv-simple-identity">
    {settings&&<Button ariaLabel="设置" className="wv-cover-settings" onClick={settings}><UiIcon name="settings"/><Text className="wv-sr-only">设置</Text></Button>}
    <View className="wv-profile-identity"><Button className="wv-avatar-button" onClick={edit} ariaLabel="修改头像昵称">{avatar?<Image className="wv-avatar" src={avatar}/>:<UiIcon name="user"/>}</Button><View><Text className="wv-personal-name">{profile.nickname||'你好，新朋友'}</Text>{edit&&<Button className="wv-edit-profile" onClick={edit}>{profile.nickname&&avatar?'修改头像昵称':!profile.nickname&&!avatar?'设置头像昵称（选填）':!profile.nickname?'设置昵称（选填）':'设置头像（选填）'}</Button>}</View></View>
  </View>;
}

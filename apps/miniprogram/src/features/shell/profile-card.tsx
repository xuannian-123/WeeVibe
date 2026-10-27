import { useEffect, useState } from 'react';
import { Button, Image, Text, View } from '@tarojs/components';
import type { MemberProfile } from '@weevibe/contracts';
import { cacheProfileImage } from '../../platform/navigation-api';
import { getToken } from '../../platform/api';
import './navigation.css';

export function ProfileCard({ profile, session, avatarPath = '', edit, settings }: { profile: Omit<MemberProfile, 'user_id' | 'avatar'> & { avatar?: MemberProfile['avatar'] }; session?: string; avatarPath?: string; edit?: () => void; settings?: () => void }) {
  const [cover, setCover] = useState(''), [avatar, setAvatar] = useState(avatarPath);
  useEffect(() => { if (session !== getToken()) return; try { setCover(profile.cover_style === 'custom' && profile.cover_image ? cacheProfileImage(profile.cover_image) : ''); setAvatar(profile.avatar ? cacheProfileImage(profile.avatar) : avatarPath); } catch { setCover(''); setAvatar(avatarPath); } }, [profile.cover_image?.digest, profile.cover_style, profile.avatar?.digest, avatarPath, session]);
  if (session !== getToken()) return null;
  return <View className="wv-personal-card"><View className={`wv-profile-cover ${profile.cover_style === 'custom' ? 'mint' : profile.cover_style}`}>
    {cover ? <Image className="wv-cover-image" mode="aspectFill" src={cover}/> : <View className="wv-cover-pattern"><Text>✧</Text><Text>GOOD TIMES, TOGETHER</Text></View>}
    {settings && <Button ariaLabel="设置" className="wv-cover-settings" onClick={settings}>⚙</Button>}
  </View><View className="wv-profile-body"><View className="wv-profile-identity"><View className="wv-avatar-button">{avatar ? <Image className="wv-avatar" src={avatar}/> : <Text>○</Text>}</View>{edit && <Button className="wv-edit-profile" onClick={edit}>编辑资料</Button>}</View>
    <Text className="wv-personal-name">{profile.nickname || '你好，新朋友'}</Text>
    {profile.bio && <Text className="wv-personal-bio">{profile.bio}</Text>}
    {!!profile.interests?.length && <View className="wv-interest-tags">{profile.interests.map((s, i) => <Text className={i % 2 ? 'lilac' : 'mint'} key={s}>{s}</Text>)}</View>}
    {(profile.mbti || profile.zodiac) && <View className="wv-personal-optional">{profile.mbti && <Text>{profile.mbti}</Text>}{profile.zodiac && <Text>{profile.zodiac}</Text>}</View>}
  </View></View>;
}

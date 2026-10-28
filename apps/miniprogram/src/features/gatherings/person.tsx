import {useEffect,useState} from 'react';
import Taro from '@tarojs/taro';
import {Image,Text,View} from '@tarojs/components';
import {avatarAssetSchema,type GatheringSnapshot} from '@weevibe/contracts';
type Person=GatheringSnapshot['gathering']['owner'];
export function GatheringPerson({person}:{person:Person}){
  const[path,setPath]=useState('');
  useEffect(()=>{setPath('');const parsed=avatarAssetSchema.safeParse(person.avatar);if(!parsed.success)return;try{const asset=parsed.data,file=`${Taro.env.USER_DATA_PATH}/weevibe-gathering-avatar-${person.user_id}-${asset.digest}.jpg`;Taro.getFileSystemManager().writeFileSync(file,asset.base64,'base64');setPath(file);}catch{/* Missing local file support keeps the identity placeholder. */}},[person.user_id,person.avatar?.digest]);
  return <View className="gg-person">{path?<Image className="gg-avatar" src={path} mode="aspectFill"/>:<View className="gg-avatar gg-avatar-placeholder"><Text>{person.nickname.slice(0,1)||'友'}</Text></View>}<Text className="gg-person-name">{person.nickname}</Text></View>;
}

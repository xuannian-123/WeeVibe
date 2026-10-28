import {useEffect,useState} from 'react';
import Taro from '@tarojs/taro';
import {Image,Text,View} from '@tarojs/components';
import {avatarAssetSchema,type GatheringSnapshot,type GatheringAnimalId} from '@weevibe/contracts';
import cat from '../../assets/gathering-animals/cat.png';
import dog from '../../assets/gathering-animals/dog.png';
import fox from '../../assets/gathering-animals/fox.png';
import rabbit from '../../assets/gathering-animals/rabbit.png';
import bear from '../../assets/gathering-animals/bear.png';
import panda from '../../assets/gathering-animals/panda.png';
import koala from '../../assets/gathering-animals/koala.png';
import tiger from '../../assets/gathering-animals/tiger.png';
import lion from '../../assets/gathering-animals/lion.png';
import penguin from '../../assets/gathering-animals/penguin.png';
import owl from '../../assets/gathering-animals/owl.png';
import capybara from '../../assets/gathering-animals/capybara.png';
const animalAssets:Record<GatheringAnimalId,string>={cat,dog,fox,rabbit,bear,panda,koala,tiger,lion,penguin,owl,capybara};

type Person=GatheringSnapshot['gathering']['owner'];
export function GatheringPerson({person}:{person:Person}){
  const[path,setPath]=useState('');const animal=person.animal_id?animalAssets[person.animal_id]:undefined;
  useEffect(()=>{setPath('');if(animal)return;const parsed=avatarAssetSchema.safeParse(person.avatar);if(!parsed.success)return;try{const asset=parsed.data,file=`${Taro.env.USER_DATA_PATH}/weevibe-gathering-avatar-${person.user_id}-${asset.digest}.jpg`;Taro.getFileSystemManager().writeFileSync(file,asset.base64,'base64');setPath(file);}catch{/* Missing local file support keeps the identity placeholder. */}},[person.user_id,person.avatar?.digest,animal]);
  const avatar=animal||path?<Image className="gg-avatar" src={animal||path} mode="aspectFill"/>:<View className="gg-avatar gg-avatar-placeholder"><Text>{person.nickname.slice(0,1)||'友'}</Text></View>;
  return <View className="gg-person">{avatar}<Text className="gg-person-name">{person.nickname}</Text></View>;
}

import {useState} from 'react';
import Taro from '@tarojs/taro';
import {Text,View} from '@tarojs/components';
import {activityIdSchema,inspirationIntake,venueSchema,type GatheringSnapshot} from '@weevibe/contracts';
import {GatheringDesigner} from './designer';
export function GatheringInspirationEntry({actor,session,sourceId,onCreated}:{actor:string;session:string;sourceId:string;onCreated?:(snapshot:GatheringSnapshot)=>void}){
 const [seed]=useState(()=>{try{const id=activityIdSchema.parse(sourceId),saved=Taro.getStorageSync(`weevibe-venue-plan-v1:${id}`);if(!saved||saved.owner_user_id!==actor)return null;return inspirationIntake(venueSchema.parse(saved.venue));}catch{return null;}});
 if(!seed)return <View className="gg-notice"><Text>地点入口无效或不属于当前账号，请返回灵感重新选择。</Text></View>;
 return <GatheringDesigner actor={actor} session={session} kind="friend" initialIntake={seed} onCreated={onCreated} draftSuffix={`:inspiration:${sourceId}`}/>;
}

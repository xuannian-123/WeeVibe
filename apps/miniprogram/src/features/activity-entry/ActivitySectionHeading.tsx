import { Text, View } from '@tarojs/components';
import { Action } from './ActivityUI';

export function ActivitySectionHeading({title,name,status,busy,back,refresh}:{title:string;name?:string;status?:string;busy:boolean;back:()=>void;refresh:()=>void}) {
  return <View className="ca-section-heading"><View className="ca-section-top"><Text className="iv-brand">wee<Text className="iv-brand-green">vibe</Text><Text className="iv-brand-star">*</Text></Text><Action variant="text" disabled={busy} onClick={back}>返回活动</Action></View><Text className="ca-section-title">{title}</Text>{name&&<Text className="ca-section-name">{name}</Text>}<View className="ca-section-status"><Text>{status}</Text><Action variant="text" disabled={busy} onClick={refresh}>刷新安排</Action></View></View>;
}

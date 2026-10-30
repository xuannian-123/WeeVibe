import {useEffect,useState} from 'react';
import {Button,Text,View} from '@tarojs/components';
import {gatheringSections} from '@weevibe/contracts';
import {requestMemory,memoryCategories,memoryLabels,type MemoryView} from './memory-client';
import {getToken} from '../../platform/api';
function MemoryPanelInner({session}:{session:string}){
 const [value,setValue]=useState<MemoryView>(),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 async function load(body?:unknown){if(busy||getToken()!==session)return;setBusy(true);try{const v=await requestMemory(session,body);if(getToken()===session){setValue(v);setNotice('');}}catch{if(getToken()===session)setNotice('偏好记忆服务暂时不可用，未确认更新。');}finally{setBusy(false);}}
 useEffect(()=>{void load();},[session]);
 if(getToken()!==session)return null;
 return <View className="gg-panel"><Text>偏好记忆</Text><Text>开启后自动记住本人主动选择的活动类型、交通方式和活动节奏，用于个人及本次组局推荐。不记录预算、出发地或私人原文，不扩大对他人的公开范围。</Text>{notice&&<Text>{notice}</Text>}{value&&<>
 <Button disabled={busy} onClick={()=>void load({action:'settings',learning:!value.learning,recommending:value.version===0?true:value.recommending})}>{value.learning?'暂停学习':'开启自动记住我的组局偏好'}</Button>
 <Button disabled={busy} onClick={()=>void load({action:'settings',learning:value.learning,recommending:!value.recommending})}>{value.recommending?'停止用于推荐':'允许用于推荐'}</Button><Text>暂停学习保留已有记忆；停止用于推荐才会停止自动参考。</Text>
 <Text>{value.pending?`后台待处理 ${value.pending} 项；尚未更新`:value.failed?'有学习任务失败，活动保存不受影响':'暂无待处理任务'}</Text><Button disabled={busy} onClick={()=>void load()}>刷新状态</Button>
 {memoryCategories.map(category=><View key={category}><Text>{memoryLabels[category]}：{value.profiles.find(p=>p.category===category)?.values.join('、')||'暂无'}</Text>{value.profiles.filter(p=>p.category===category).map(p=><Text key={p.category}>{p.confidence==='manual'?'本人纠正，撤销前优先':p.confidence==='high'?'较高可信':'较低可信，仅供参考'}；{p.evidence_count} 场独立活动；{p.source}</Text>)}
 <Button disabled={busy} onClick={()=>void load({action:'delete',category})}>删除此类记忆</Button><Button disabled={busy} onClick={()=>void load({action:'revoke',category})}>撤销手动纠正</Button>
 {gatheringSections.flatMap(s=>s.groups).find(g=>g.id===category)?.options.filter(o=>o!=='其他').map(option=><Button key={option} disabled={busy} onClick={()=>void load({action:'correct',category,values:[option]})}>改为：{option}</Button>)}
 </View>)}<Button disabled={busy} onClick={()=>void load({action:'clear'})}>清空所有记忆（旧活动不会重建）</Button></>}</View>;
}

export function MemoryPanel({session}:{session:string}){return <MemoryPanelInner key={session} session={session}/>;}

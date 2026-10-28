import {useEffect,useRef,useState} from 'react';
import Taro,{useDidHide,useDidShow,useUnload} from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import type {GatheringSummary} from '@weevibe/contracts';
import {getToken} from '../../platform/api';
import {readGatheringList,gatheringMessage} from './client';
import './gatherings.css';

export function GatheringDashboardList({session,variant='home'}:{session:string|undefined;variant?:'home'|'profile'}){
  const[stored,setStored]=useState<{session:string;records:GatheringSummary[]}>(),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false);
  const records=stored&&stored.session===session?stored.records:[];
  const mounted=useRef(true),visible=useRef(true),sequence=useRef(0),lock=useRef(false);
  const current=()=>mounted.current&&visible.current&&!!session&&getToken()===session;
  async function load(){if(lock.current||!current()||!session)return;lock.current=true;const ticket=++sequence.current;setBusy(true);setNotice('');const guard=()=>{if(!current()||ticket!==sequence.current)throw Error('STALE_GATHERING');};try{const next=await readGatheringList(session,guard);guard();setStored({session,records:next.gatherings});}catch(e){if(current()&&ticket===sequence.current)setNotice(gatheringMessage(e));}finally{if(ticket===sequence.current){lock.current=false;if(mounted.current)setBusy(false);}}}
  useEffect(()=>{mounted.current=true;lock.current=false;setStored(undefined);setBusy(false);setNotice('');setExpanded(false);void load();return()=>{mounted.current=false;sequence.current++;lock.current=false;};},[session]);
  const hide=()=>{visible.current=false;sequence.current++;lock.current=false;};useDidHide(hide);useUnload(hide);useDidShow(()=>{visible.current=true;void load();});
  if(session&&getToken()!==session)return null;
  return <View className="gg-dashboard-list"><View className="gg-row"><Text className="gg-heading">正在筹备</Text>{session&&<Button className="gg-link" disabled={busy} onClick={()=>void load()}>{busy?'更新中…':'刷新'}</Button>}</View>
    {notice&&<Text className="gg-notice">{notice}</Text>}{!session?<Text className="gg-muted">登录后查看自己发起或参与的筹备。</Text>:records.length?<View>{records.slice(0,expanded?100:variant==='home'?3:5).map(item=><Button key={item.id} className={`gg-preparation-card ${item.kind==='friend'?'peach':'mint'}`} onClick={()=>{if(current())void Taro.navigateTo({url:`/pages/gathering/index?id=${item.id}`});}}><View className="gg-row"><Text className="gg-heading">{item.title}</Text><Text className="gg-badge">{item.stage==='arranged'?'已有方案':'正在筹备'}</Text></View><Text className="gg-muted">{item.date||'日期待确认'} · {item.kind==='friend'?'朋友出游':'一起团建'} · {item.member_count} 人</Text><Text className="gg-muted">{item.is_owner?'管理活动':'查看大家的想法'}　↗</Text></Button>)}{records.length>(variant==='home'?3:5)&&<Button className="gg-link" onClick={()=>setExpanded(v=>!v)}>{expanded?'收起':'查看全部筹备'}　›</Button>}</View>:!notice&&<View className="gg-empty"><Text>{busy?'正在读取筹备…':'下一次相聚，从一个日期开始'}</Text><Text className="gg-muted">朋友出游或一起团建，发起后可在这里继续管理。</Text></View>}
  </View>;
}

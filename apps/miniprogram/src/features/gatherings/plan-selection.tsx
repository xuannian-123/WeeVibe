import {useContext,useEffect} from 'react';
import {Button,Text,View} from '@tarojs/components';
import type {GatheringSnapshot} from '@weevibe/contracts';
import {GatheringDesignChrome} from './page-chrome';
import './plan-selection.css';

type Plans=NonNullable<GatheringSnapshot['itinerary']>['plans'];
type Props={plans:Plans;selected:string;owner:boolean;stale:boolean;busy:boolean;blocked:boolean;pending:boolean;notice:string;choose:(id:string)=>void;openSegment:(id:string)=>void;adopt:()=>void;back:()=>void;refresh:()=>void;retry:()=>void};

/** Candidate data is authoritative; photos and monetary amounts are never inferred. */
export function GatheringPlanSelection({plans,selected,owner,stale,busy,blocked,pending,notice,choose,openSegment,adopt,back,refresh,retry}:Props){
  const chrome=useContext(GatheringDesignChrome);
  useEffect(()=>{chrome?.('plan');return()=>chrome?.(null);},[chrome]);
  const plan=plans.find(p=>p.id===selected);
  return <View className="gg-plan-selection">
    <Button className="gg-plan-back" disabled={busy} onClick={back}>← 返回全部方案</Button>
    <Text className="gg-plan-eyebrow">朋友出游 · 候选方案</Text>
    <Text className="gg-plan-title">选一个，<Text>去过好时光。</Text></Text>
    <Text className="gg-plan-subtitle">看看安排，再决定。</Text>
    <View className="gg-plan-state"><Text>{stale?'待重新生成':'待定案'}</Text><Button disabled={busy} onClick={refresh}>刷新</Button></View>
    <View className="gg-plan-tabs">{plans.map((item,i)=><Button key={item.id} className={item.id===selected?'selected':''} disabled={busy} onClick={()=>choose(item.id)}>方案{i+1}</Button>)}</View>
    {stale&&<Text className="gg-plan-warning">大家的想法已变化，以下旧方案仅供参考，请由组织者重新生成后再定案。</Text>}
    {notice&&<Text className="gg-plan-warning">{notice}</Text>}
    {!plan?<View className="gg-plan-empty"><Text>方案已更新，请重新选择或刷新。</Text></View>:<View className="gg-plan-body">
      <Text className="gg-plan-name">{plan.title}</Text>
      {plan.summary&&<Text className="gg-plan-summary">{plan.summary}</Text>}
      <View className="gg-plan-stops">{plan.segments.map(segment=><Button key={segment.id} className="gg-plan-stop-card" disabled={busy} onClick={()=>openSegment(segment.id)}>
        <Text className="gg-plan-time">{segment.date||'日期待定'} · {segment.start_time||'开始时间待定'}{segment.end_time?` — ${segment.end_time}`:''}</Text>
        <View className="gg-plan-stop-heading"><Text>{segment.title}</Text><Text>↗</Text></View>
        <Text className="gg-plan-fact">{segment.place||'具体地点待选择'}</Text>
        {segment.address&&<Text className="gg-plan-address">{segment.address}</Text>}
        <Text className="gg-plan-fact">{segment.fee_note||'费用待核实'}</Text>
        {segment.description&&<Text className="gg-plan-description">{segment.description}</Text>}
        {segment.unknowns.map((item,n)=><Text className="gg-plan-unknown" key={n}>{item}</Text>)}
      </Button>)}</View>
      {plan.notes.map((note,i)=><Text className="gg-plan-summary" key={i}>{note}</Text>)}
      <Text className="gg-plan-footnote">地点、营业与费用仍需核实，不代表已预订或付款。</Text>
    </View>}
    <View className="gg-plan-footer">
      {pending?<View><Text className="gg-plan-footer-note">上次操作结果待核对，原请求已保留。</Text><Button className="gg-plan-adopt" disabled={busy} onClick={retry}>沿用原请求核对并重试</Button></View>:owner?<View><Button className="gg-plan-adopt" disabled={busy||blocked||stale||!plan} onClick={adopt}>确定采用这套方案</Button><Text className="gg-plan-footer-note">定案后，大家的填写将锁定。</Text></View>:<Text className="gg-plan-footer-note">由组织者核对并选定最终方案。</Text>}
    </View>
  </View>;
}

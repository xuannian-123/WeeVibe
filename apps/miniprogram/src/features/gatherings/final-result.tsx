import {useContext,useEffect} from 'react';
import {Button,Text,View} from '@tarojs/components';
import type {GatheringSnapshot} from '@weevibe/contracts';
import {GatheringDesignChrome} from './page-chrome';
import './final-result.css';

type Plan=NonNullable<GatheringSnapshot['itinerary']>['plans'][number];
type Props={plan?:Plan;hasOwn:boolean;busy:boolean;notice:string;back:()=>void;open:()=>void;viewOwn:()=>void;refresh:()=>void};

/** A persisted final choice is distinct from enrollment, member consent or a booking. */
export function GatheringFinalResult({plan,hasOwn,busy,notice,back,open,viewOwn,refresh}:Props){
  const chrome=useContext(GatheringDesignChrome);
  useEffect(()=>{chrome?.('result');return()=>chrome?.(null);},[chrome]);
  return <View className="gg-final-result">
    <View className="gg-final-heading"><Button disabled={busy} onClick={back}>← 返回</Button><Text>定案结果</Text></View>
    <Text className="gg-final-eyebrow">朋友出游</Text>
    <View className="gg-final-hero"><Text className="gg-final-check">✓</Text><Text className="gg-final-title">好，<Text>就这么安排。</Text></Text></View>
    <Text className="gg-final-status">筹备方案已定案</Text>
    <Text className="gg-final-subtitle">大家的填写已锁定，原内容仍可查看。</Text>
    {notice&&<Text className="gg-final-notice">{notice}</Text>}
    {!plan?<View className="gg-final-card"><Text>定案记录已保存，暂时无法核对完整安排。</Text><Button className="gg-final-refresh" disabled={busy} onClick={refresh}>重新读取安排</Button></View>:<View className="gg-final-card">
      <Text className="gg-final-plan-name">{plan.title}</Text>
      <View className="gg-final-stops">{plan.segments.map(segment=><View key={segment.id} className="gg-final-stop">
        <Text className="gg-final-time">{segment.date||'日期待定'} · {segment.start_time||'开始时间待定'}{segment.end_time?` — ${segment.end_time}`:''}</Text>
        <Text className="gg-final-stop-title">{segment.title}</Text>
        <Text className="gg-final-fact">{segment.place||'具体地点待选择'}</Text>
        <Text className="gg-final-fact">{segment.fee_note||'费用待核实'}</Text>
      </View>)}</View>
      <Text className="gg-final-footnote">地点、营业与费用仍需核实，不代表已预订或付款。</Text>
    </View>}
    {hasOwn&&<Button className="gg-final-own" disabled={busy} onClick={viewOwn}>查看我的填写</Button>}
    <View className="gg-final-footer"><Button className="gg-final-open" disabled={busy||!plan} onClick={open}>查看完整安排</Button><Button className="gg-final-share" disabled={busy} openType="share">分享给朋友</Button><Text>分享后可查看定案安排，不开放新的填写。</Text></View>
  </View>;
}

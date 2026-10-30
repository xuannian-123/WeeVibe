import {Text,View} from '@tarojs/components';
import type {GatheringSnapshot} from '@weevibe/contracts';
import {CAction} from '../design-c/ui';
import {GatheringFlowHeader} from './flow-header';
import {useGatheringFormChrome} from './page-chrome';
import './workflow-panel.css';

type Plans=NonNullable<GatheringSnapshot['itinerary']>['plans'];
export function GatheringPlanBody({plan,openSegment,heading=true}:{plan:Plans[number];openSegment?:(id:string)=>void;heading?:boolean}){
 return <View className="gw-plan-body gp-panel">{heading&&<><Text className="gw-plan-title">{plan.title}</Text><Text className="gp-caption">{plan.summary}</Text></>}{plan.segments.map((segment,i)=><View key={segment.id} className="gw-stop"><Text className="gw-tag">环节 {i+1} · {segment.date||'日期待定'} · {segment.start_time||'开始时间待定'}{segment.end_time?` — ${segment.end_time}`:''}</Text><Text className="gw-stop-title">{segment.title}</Text><Text className="gp-caption">{segment.place||'具体地点待选择'}{segment.address?'\n'+segment.address:''}</Text><Text className="gp-caption">{segment.description}</Text><Text className="gp-caption">{segment.fee_note||'费用待核实'}</Text>{segment.unknowns.map((item,n)=><Text key={n} className="gp-caption">待核实 · {item}</Text>)}{openSegment&&<CAction className="gw-segment-open" onClick={()=>openSegment(segment.id)}>查看环节详情</CAction>}</View>)}{plan.notes.map((note,i)=><Text key={i} className="gp-caption">{note}</Text>)}<Text className="gp-caption">地点、营业与费用仍需核实，不代表已预订或付款。</Text></View>;
}
export function GatheringSegmentDetails({segment,busy,back,backLabel='返回方案详情'}:{backLabel?:string;segment?:Plans[number]['segments'][number];busy:boolean;back:()=>void}){
 useGatheringFormChrome();
 return <View className="c-ui gf-start gw-flow"><GatheringFlowHeader back={back} disabled={busy} label={backLabel}/><View className="gf-heading"><Text className="gf-eyebrow">{'朋友出游'} / 环节详情</Text><Text className="gf-title">{segment?.title||'环节已更新'}</Text><View className="gf-marker"/></View>{segment?<GatheringPlanBody heading={false} plan={{id:'detail',title:segment.title,summary:'',segments:[segment],notes:[]}}/>:<Text className="gp-caption">请返回读取当前安排。</Text>}<CAction onClick={back}>{backLabel}</CAction></View>;
}
export function GatheringPlanSelection({plans,selected,stale,busy,notice,choose,openSegment,back,refresh,generate,canGenerate}:{plans:Plans;selected:string;stale:boolean;busy:boolean;notice:string;choose:(id:string)=>void;openSegment:(id:string)=>void;back:()=>void;refresh:()=>void;generate?:()=>void;canGenerate?:boolean}){
 useGatheringFormChrome();const plan=plans.find(p=>p.id===selected);
 return <View className="c-ui gf-start gw-flow"><GatheringFlowHeader back={back} disabled={busy} label="返回全部方案"/><View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / 候选方案</Text><Text className="gf-title">把安排，看仔细。</Text><View className="gf-marker"/></View><View className="gw-choice-tabs">{plans.map((item,i)=><CAction key={item.id} variant={item.id===selected?'primary':'secondary'} disabled={busy} onClick={()=>choose(item.id)}>方案{i+1}</CAction>)}</View>{notice&&<View className="gw-alert"><Text>{notice}</Text></View>}<View className="gw-alert"><Text>{stale?'大家的想法已变化，以下旧方案仅供参考。':'这份历史推荐尚未进入共同确认流程，仅供查看。'}请局头重新生成后，再一起选择和确认。</Text></View>{plan?<GatheringPlanBody plan={plan} openSegment={openSegment}/>:<Text className="gp-caption">方案已更新，请刷新后重新选择。</Text>}<CAction disabled={busy} onClick={refresh}>刷新核对方案</CAction>{generate&&<CAction className="gw-full" variant="primary" disabled={busy||!canGenerate} onClick={generate}>重新生成推荐安排</CAction>}</View>;
}

import {GatheringPublicDetails} from './public-details';
import {Text,View} from '@tarojs/components';
import type {GatheringSnapshot} from '@weevibe/contracts';
import {CAction} from '../design-c/ui';
import {GatheringFlowHeader} from './flow-header';
import {useGatheringFormChrome} from './page-chrome';
import {GatheringPlanBody} from './plan-selection';
import {GatheringPerson} from './person';
import {gatheringFinalPlan,gatheringUnanimous} from './final-plan';
import './workflow-panel.css';
import './final-result.css';

type Props={snapshot:GatheringSnapshot;busy:boolean;pending?:boolean;retryBlocked?:boolean;retry?:()=>void;notice:string;back:()=>void;open:()=>void;viewOwn:()=>void;refresh:()=>void};
function FinalContext({snapshot}:{snapshot:GatheringSnapshot}){
  const member=snapshot.viewer.is_member;
  return <View className="gf-final-context"><Text className="gp-section-title">{snapshot.gathering.title}</Text><Text className="gp-caption">{snapshot.gathering.date||'日期以各环节安排为准'} · {member?'本次筹备成员':'通过分享查看'}</Text><View className="gf-final-owner"><Text>发起人</Text><GatheringPerson person={snapshot.gathering.owner}/></View>{!member&&<Text className="gp-caption">本次筹备已定案，不再接受新的填写。</Text>}</View>;
}

export function GatheringFinalPlan({snapshot,busy,back,viewOwn,refresh,openSegment,backLabel='返回安排'}:{snapshot:GatheringSnapshot;busy:boolean;back:()=>void;viewOwn:()=>void;refresh:()=>void;openSegment?:(id:string)=>void;backLabel?:string}){
  useGatheringFormChrome();
  const plan=gatheringFinalPlan(snapshot),hasOwn=snapshot.viewer.is_member&&(snapshot.own?.version??0)>0;
  return <View className="c-ui gf-start gw-flow gf-final-detail">
    <GatheringFlowHeader back={back} disabled={busy} label={backLabel}/>
    <View className="gf-heading"><Text className="gf-eyebrow">{snapshot.gathering.kind==='friend'?'朋友出游':'一起团建'} / 已定案</Text><Text className="gf-title">完整安排</Text><View className="gf-marker"/></View>
    <FinalContext snapshot={snapshot}/>
    <GatheringPublicDetails details={snapshot.gathering.details}/>
    <View className="gf-final-readonly"><Text>安排已定案，内容只读。</Text><Text>地点、营业和费用仍按各环节的待核实项查看。</Text></View>
    {plan?<GatheringPlanBody plan={plan} openSegment={openSegment}/>:<MissingPlan busy={busy} refresh={refresh}/>}
    {hasOwn&&<CAction className="gw-full" disabled={busy} onClick={viewOwn}>查看我的填写</CAction>}
    <CAction className="gw-full" disabled={busy} onClick={back}>{backLabel}</CAction>
  </View>;
}

function MissingPlan({busy,refresh}:{busy:boolean;refresh:()=>void}){
  return <View className="gp-panel gf-final-missing"><Text className="gp-section-title">完整安排暂未读到</Text><Text className="gp-caption">定案记录已保存，暂时无法核对完整安排。请重新读取，不使用其他候选替代。</Text><CAction className="gw-full" disabled={busy} onClick={refresh}>重新读取安排</CAction></View>;
}

export function GatheringFinalResult({snapshot,busy,pending=false,retryBlocked=false,retry,notice,back,open,viewOwn,refresh}:Props){
  useGatheringFormChrome();
  const plan=gatheringFinalPlan(snapshot),unanimous=gatheringUnanimous(snapshot);
  const hasOwn=snapshot.viewer.is_member&&(snapshot.own?.version??0)>0;
  return <View className="c-ui gf-start gw-flow gw-final">
    <GatheringFlowHeader back={back} disabled={busy} label={snapshot.gathering.kind==='friend'?'返回出游内容':'返回团建内容'}/>
    <View className="gf-heading"><Text className="gf-eyebrow">{snapshot.gathering.kind==='friend'?'朋友出游':'一起团建'} / 定案结果</Text><View className="gw-success-symbol">✓</View><Text className="gf-title">好，就这么安排。</Text><View className="gf-marker"/></View>
    <Text className="gp-section-title">{unanimous?'全员已确认，安排已确定':'筹备方案已定案'}</Text>
    <Text className="gp-caption">{unanimous?'每个人都明确确认了本轮安排。':'已读取保存的定案记录。'}大家的填写已锁定，原内容仍可查看。</Text>
    <FinalContext snapshot={snapshot}/>
    <GatheringPublicDetails details={snapshot.gathering.details}/>
    {notice&&<View className="gw-alert"><Text>{notice}</Text></View>}
    {pending&&<View className="gp-panel gw-lilac"><Text className="gp-caption">定案记录已经读取，上次操作的回执仍待核对。原请求已保留。</Text><CAction className="gw-full" disabled={busy||retryBlocked} onClick={retry}>沿用原请求核对操作</CAction><CAction className="gw-full" disabled={busy} onClick={refresh}>刷新核对进度</CAction></View>}
    {!plan?<MissingPlan busy={busy} refresh={refresh}/>:<View className="gw-summary"><Text className="gw-plan-title">{plan.title}</Text><Text className="gp-caption">{plan.summary}</Text>{plan.segments.map((segment,index)=><View className="gw-stop" key={segment.id}><Text className="gw-tag">{index+1} · {segment.date||'日期待定'} · {segment.start_time||'时间待核实'}</Text><Text className="gw-stop-title">{segment.title}</Text><Text className="gp-caption">{segment.place||'具体地点待选择'} · {segment.fee_note||'费用待核实'}</Text></View>)}</View>}
    {plan&&<CAction className="gw-full" variant="primary" disabled={busy} onClick={open}>查看完整安排</CAction>}
    {hasOwn&&<CAction className="gw-full" disabled={busy||pending} onClick={viewOwn}>查看我的填写</CAction>}
    <CAction className="gw-full" openType="share" disabled={busy}>分享给朋友</CAction>
    <Text className="gp-caption">分享后可查看定案安排，不开放新的填写。地点、营业与费用仍需核实，不代表已预订或付款。</Text>
  </View>;
}

import {gatheringCapacityReached} from './details-validation';
import {GatheringPublicDetails} from './public-details';
import {Button,Text,View} from '@tarojs/components';
import type {GatheringIntake,GatheringSnapshot} from '@weevibe/contracts';
import {CAction} from '../design-c/ui';
import {GatheringFlowHeader} from './flow-header';
import {GatheringPerson} from './person';
import {useGatheringFormChrome} from './page-chrome';
import {gatheringFinalPlan} from './final-plan';
import './friend-hub.css';

type Member=NonNullable<GatheringSnapshot['members']>[number];
type Props={snapshot:GatheringSnapshot;view:'content'|'arrangements';members:Member[];more:boolean;busy:boolean;blocked:boolean;notice:string;home:()=>void;change:(view:'content'|'arrangements')=>void;refresh:()=>void;editOwn:()=>void;loadMore:()=>void;generate:()=>void;workflow:()=>void;openPlan:(id:string)=>void};
export function GatheringFriendHub(p:Props){
  useGatheringFormChrome();
  const {gathering:g,viewer}=p.snapshot,capacityReached=gatheringCapacityReached(p.snapshot),finalized=!!p.snapshot.final_choice,finalPlan=gatheringFinalPlan(p.snapshot),canEdit=viewer.can_respond&&!finalized&&!capacityReached,plans=finalized?(finalPlan?[finalPlan]:[]):p.snapshot.itinerary?.plans??[];
  return <View className="c-ui gf-start gh-hub"><GatheringFlowHeader back={p.home} disabled={p.busy} label="回到首页"/><View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / {finalized?'已定案':viewer.is_owner?'我在组织':'一起筹备'}</Text><Text className="gf-title">{p.view==='content'?'大家的想法，放一起':'活动安排'}</Text><View className="gf-marker"/></View><Text className="gp-caption">{g.title+' · '}{g.date||'日期待商量'} · {g.member_count} 位筹备成员</Text><View className="gh-actions"><CAction openType="share" disabled={p.busy}>分享给朋友</CAction><CAction variant="text" disabled={p.busy} onClick={p.refresh}>刷新</CAction></View>
    {(p.snapshot.workflow||finalized)&&<CAction className="gh-primary" variant="primary" disabled={p.busy} onClick={p.workflow}>{finalized?'查看最终安排':'进入方案选择与确认'}</CAction>}
    <GatheringPublicDetails details={g.details}/>
    {p.notice&&<View className="gh-notice" role="status"><Text>{p.notice}</Text></View>}
    {!viewer.is_member?<View className="gp-panel"><Text className="gp-section-title">{finalized?'这次安排已经确定':capacityReached?'这次筹备人数已满':'一起参与这次出游'}</Text><GatheringPerson person={g.owner}/><Text className="gp-caption">{finalized?'你正在查看分享的安排，本次筹备不再接受新的填写。':capacityReached?'当前筹备填写人数已达到上限，包含发起人。请联系发起人核对；不会自动加入或占位。':'提交前不会加入筹备名单。公开偏好供同次成员参考，个人预算与出发地点仅本人可见。'}</Text>{canEdit?<CAction variant="primary" disabled={p.busy||p.blocked} onClick={p.editOwn}>填写我的想法</CAction>:<Text className="gp-caption">{capacityReached?'当前不能新增填写。':'本次填写已结束。'}</Text>}</View>:<>
        <View className="gh-tabs"><CAction variant={p.view==='content'?'primary':'secondary'} disabled={p.busy} onClick={()=>p.change('content')}>内容整合</CAction><CAction variant={p.view==='arrangements'?'primary':'secondary'} disabled={p.busy} onClick={()=>p.change('arrangements')}>活动安排</CAction></View>
        {p.view==='content'?<>
          {p.members.map(m=><View className="gp-panel gh-member" key={m.person.user_id}><View className="gh-person-row"><GatheringPerson person={m.person}/><Text className="gh-status">{m.submitted?'已提交':'待填写'}</Text></View>{m.submitted?m.blocks.length?<View className="gh-blocks">{m.blocks.map(b=><View className="gh-block" key={b.id}><Text>{b.label} · {b.confirmed?'已确定':'待商量'}</Text><Text>{b.value}</Text></View>)}</View>:<Text className="gp-caption">已提交，暂未选择公开偏好。</Text>:<Text className="gp-caption">还没有提交公开想法。</Text>}</View>)}
          {p.more&&<CAction disabled={p.busy} onClick={p.loadMore}>查看更多成员</CAction>}
          {p.snapshot.own&&<View className="gp-panel gh-lilac"><Text className="gp-section-title">我的填写</Text><Text className="gp-caption">个人预算与出发地点不在内容整合中展示，只能在本人的填写中查看。</Text><CAction disabled={p.busy||p.blocked} onClick={p.editOwn}>{canEdit?'修改我的想法':'查看我的 AI 整理'}</CAction></View>}
          {viewer.is_owner&&canEdit&&<CAction className="gh-primary" variant="primary" disabled={p.busy||p.blocked||!viewer.can_generate||!p.snapshot.source_fingerprint||p.snapshot.generation?.status==='processing'} onClick={p.generate}>人齐了，生成安排！</CAction>}
        </>:!plans.length?<View className="gp-panel"><Text className="gp-section-title">{finalized?'完整安排暂未读到':'暂未生成'}</Text><Text className="gp-caption">{finalized?'请重新读取最终安排，不使用其他候选替代。':'等大家填写想法后，由局头生成候选方案。'}</Text>{finalized&&<CAction disabled={p.busy} onClick={p.refresh}>重新读取安排</CAction>}</View>:<View>{!finalized&&p.snapshot.itinerary?.stale&&<View className="gh-notice"><Text>大家的想法已更新，旧方案仅供参考，待局头重新生成。</Text></View>}<Text className="gp-caption">{finalized?'本次筹备已定案，仅展示最终安排。地点、营业与费用仍需实际核实。':'候选方案仍需共同核对，不代表已预订或全员同意。'}</Text>{plans.map((plan,i)=><Button key={plan.id} className="gh-plan-card" disabled={p.busy} onClick={()=>p.openPlan(plan.id)}><Text className="gp-section-title">{finalized?'最终安排':`方案${i+1}`} · {plan.title}</Text><View className="gh-plan-chain">{plan.segments.map((s,n)=><View key={s.id}><Text>{s.place&&!s.title.includes(s.place)?s.place+' · ':''}{s.title}</Text>{n<plan.segments.length-1&&<Text>→</Text>}</View>)}</View><Text className="gp-caption">{plan.summary}</Text></Button>)}</View>}
        {p.snapshot.generation?.status==='processing'&&<View className="gp-panel"><Text>正在生成方案，原有安排会保留。</Text><CAction disabled={p.busy} onClick={p.refresh}>核对生成结果</CAction></View>}
    </>}
  </View>;
}

export function GatheringFriendSaveRecovery({intake,busy,blocked,message,retry,home}:{intake?:GatheringIntake;busy:boolean;blocked:boolean;message:string;retry:()=>void;home:()=>void}){
  useGatheringFormChrome();
  return <View className="c-ui gf-start gh-recovery"><GatheringFlowHeader back={home} disabled={busy} label="回到首页"/><View className="gf-heading"><Text className="gf-eyebrow">朋友出游 / 提交待核对</Text><Text className="gf-title">先核对上次提交</Text><View className="gf-marker"/></View><View className="gp-panel"><Text className="gp-section-title">{intake?.public.activity_nickname||'本人的填写'}</Text><Text className="gp-caption">原请求已保留。核对时会沿用原来的内容，不会创建第二份填写。</Text></View><View className="gh-notice" role="alert"><Text>{message||'上次提交结果尚未确认。'}</Text></View>{!blocked&&<CAction className="gh-primary" variant="primary" disabled={busy} loading={busy} onClick={retry}>沿用原请求核对保存</CAction>}<Text className="gp-caption">预算与出发地点始终仅本人可见。返回首页不会清除这份待核对请求。</Text></View>;
}

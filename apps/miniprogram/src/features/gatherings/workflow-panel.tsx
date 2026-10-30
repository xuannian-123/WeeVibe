import {GatheringPublicDetails} from './public-details';
import {useEffect,useState} from 'react';
import {Text,Textarea,View} from '@tarojs/components';
import {privateGatheringInputText,type GatheringSnapshot,type GatheringWorkflowCommand} from '@weevibe/contracts';
import {CAction} from '../design-c/ui';
import {GatheringPerson} from './person';
import {GatheringFlowHeader} from './flow-header';
import {useGatheringFormChrome} from './page-chrome';
import {GatheringPlanBody} from './plan-selection';
import {GatheringFinalResult} from './final-result';
import './workflow-panel.css';

type Action=Omit<Extract<GatheringWorkflowCommand,{action:'select'}>,'idempotency_key'|'generation_id'>|Omit<Extract<GatheringWorkflowCommand,{action:'propose'}>,'idempotency_key'|'generation_id'>|Omit<Extract<GatheringWorkflowCommand,{action:'respond'}>,'idempotency_key'|'generation_id'>;
export function GatheringWorkflowPanel({snapshot,blocked,pending,readBlocked=false,retryBlocked=false,notice,send,retry,refresh,editOwn,inspect,generate,viewFinal}:{snapshot:GatheringSnapshot;blocked:boolean;pending:boolean;readBlocked?:boolean;retryBlocked?:boolean;notice:string;send:(action:Action)=>void;retry:()=>void;refresh:()=>void;editOwn:()=>void;inspect:()=>void;generate:()=>void;viewFinal:()=>void}){
  useGatheringFormChrome();
  const state=snapshot.workflow!,owner=snapshot.viewer.is_owner;
  const [choices,setChoices]=useState(state.own_selection?.plan_ids??[]),[note,setNote]=useState(state.own_selection?.note??'');
  const [proposal,setProposal]=useState(state.proposal_plan_id??''),[coordination,setCoordination]=useState(state.coordination_note);
  const [feedback,setFeedback]=useState(state.own_confirmation?.note??''),[error,setError]=useState('');
  const [tab,setTab]=useState<'plans'|'people'|'coordinate'>('plans'),[detail,setDetail]=useState('');
  useEffect(()=>{setChoices(state.own_selection?.plan_ids??[]);setNote(state.own_selection?.note??'');},[state.generation_id,state.own_selection?.version]);
  useEffect(()=>{setProposal(state.proposal_plan_id??'');setCoordination(state.coordination_note);setFeedback(state.own_confirmation?.note??'');setTab('plans');setDetail('');setError('');},[state.generation_id,state.proposal_version]);
  useEffect(()=>{setFeedback(state.own_confirmation?.note??'');},[state.own_confirmation?.version]);
  const plans=snapshot.itinerary?.generation_id===state.generation_id?snapshot.itinerary.plans:[];
  const completed=state.phase==='completed',canChoose=state.phase==='selecting'||state.phase==='adjusting';
  const processing=snapshot.generation?.status==='processing',disabled=blocked||pending||readBlocked||state.stale||processing;
  const eligible=snapshot.viewer.is_member&&snapshot.gathering.has_responded;
  const waitingIntake=Math.max(0,snapshot.gathering.member_count-state.total);
  const ready=plans.length>0&&(state.total>0&&waitingIntake===0&&state.selected_count===state.total);
  const proposed=plans.find(p=>p.id===state.proposal_plan_id),shown=state.phase==='confirming'&&tab!=='coordinate'?(proposed?[proposed]:[]):plans;
  function submit(action:Action){if(disabled)return;if(privateGatheringInputText.test(action.note)){setError('预算和个人出发地点请在“我的填写”中补充，这里的说明会公开给同次成员。');return;}setError('');send(action);}
  const inspected=plans.find(p=>p.id===detail);
  if(completed)return <GatheringFinalResult snapshot={snapshot} busy={blocked} pending={pending} retryBlocked={retryBlocked} retry={retry} notice={notice} back={inspect} open={viewFinal} viewOwn={editOwn} refresh={refresh}/>;
  const title=detail?'把安排，看仔细。':tab==='people'?'大家怎么想？':tab==='coordinate'?'照顾大家，再协调。':state.phase==='confirming'?'这次，就这样出发？':state.phase==='adjusting'?'再商量，一起调整。':'喜欢哪套，都可以选。';
  return <View className="c-ui gf-start gw-flow">
    <GatheringFlowHeader back={()=>detail?setDetail(''):tab!=='plans'?setTab('plans'):inspect()} disabled={blocked} stepKey={`${tab}:${detail}:${state.phase}`}/>
    <View className="gf-heading"><Text className="gf-eyebrow">{'朋友出游'} / {snapshot.gathering.title}</Text><Text className="gf-title">{title}</Text><View className="gf-marker"/></View>
    <GatheringPublicDetails details={snapshot.gathering.details}/>
    {detail?<>{inspected?<GatheringPlanBody plan={inspected}/>:<Text className="gp-caption">方案已更新，请返回后重新核对。</Text>}<CAction onClick={()=>setDetail('')}>返回方案列表</CAction></>:<>
      <View className="gw-stages">{['选择偏好','局头协调','全员确认'].map((label,i)=><View key={label} className={(state.phase==='confirming'?2:tab==='coordinate'||state.phase==='adjusting'?1:0)>=i?'gw-stage-active':''}><Text>{i+1}</Text><Text>{label}</Text></View>)}</View>
      <View className="gw-status"><View><Text className="gp-section-title">{state.phase==='confirming'?`本轮确认 ${state.accepted_count} / ${state.total} 人`:`已选偏好 ${state.selected_count} / ${state.total} 人`}</Text><Text className="gp-caption">{state.phase==='confirming'?`第 ${state.proposal_version} 轮 · 每个人明确确认后才定案`:'选偏好后，局头会协调一套安排，再请大家确认。'}</Text></View><CAction variant="text" disabled={blocked} onClick={refresh}>刷新核对进度</CAction></View>
      {state.stale&&<View className="gw-alert"><Text>成员或填写内容已变化，旧方案不能继续选择或确认，请局头重新生成。</Text></View>}
      {processing&&<View className="gw-alert"><Text>正在生成新推荐，当前方案暂不操作。刷新后核对结果。</Text></View>}
      {state.phase==='adjusting'&&<View className="gw-alert"><Text>有人提出调整。局头重新发送安排后，所有人都需要重新确认。</Text></View>}
      <View className="gw-tabs"><CAction variant={tab==='plans'?'primary':'secondary'} disabled={blocked} onClick={()=>setTab('plans')}>候选安排</CAction>{<CAction variant={tab==='people'?'primary':'secondary'} disabled={blocked} onClick={()=>setTab('people')}>大家的选择与反馈</CAction>}</View>
      {tab==='people'?<><Text className="gp-caption">选择偏好不代表同意最终安排，未回复也不代表同意。</Text>{state.people.map(person=><View className="gp-panel gw-person" key={person.person.user_id}><GatheringPerson person={person.person}/><Text>{person.plan_ids.map(id=>plans.find(p=>p.id===id)?.title||'已更新的方案').join('、')||'暂未选择具体方案'}</Text>{person.note&&<Text>{person.note}</Text>}<Text className="gw-tag">{person.decision==='accept'?'已确认本轮安排':person.decision==='reject'?'希望调整':'尚未确认本轮安排'}</Text></View>)}{!state.people.length&&<Text className="gp-caption">还没有人提交方案偏好。</Text>}</>:<>
        {tab==='coordinate'&&<View className="gw-alert"><Text>{'选择一套照顾大家想法的安排。发送后包含局头在内的每个人都需要明确确认。'}{state.phase==='confirming'?'重新发送会清除本轮确认，所有人都需重新确认。':''}</Text></View>}
        {shown.map((plan,i)=><View key={plan.id} className={`gp-panel gw-plan ${tab==='coordinate'&&proposal===plan.id||tab==='plans'&&choices.includes(plan.id)?'gw-plan-selected':''}`}><View className="gw-plan-top"><Text className="gw-tag">{state.phase==='confirming'&&tab!=='coordinate'?'本轮协调方案':`候选 ${i+1}`}</Text>{choices.includes(plan.id)&&<Text className="gw-tag">我的偏好 ✓</Text>}</View><Text className="gw-plan-title">{plan.title}</Text><Text className="gp-caption">{plan.summary}</Text><View className="gw-chain">{plan.segments.map((segment,n)=><Text key={segment.id}>{n+1} · {segment.title}</Text>)}</View><CAction variant="text" disabled={blocked} onClick={()=>setDetail(plan.id)}>查看完整安排</CAction>{tab==='coordinate'&&owner?<CAction disabled={disabled} variant={proposal===plan.id?'primary':'secondary'} onClick={()=>setProposal(plan.id)}>{proposal===plan.id?'已选为协调方案':'作为协调方案'}</CAction>:canChoose&&eligible&&<CAction variant={choices.includes(plan.id)?'primary':'secondary'} disabled={disabled} onClick={()=>setChoices(current=>current.includes(plan.id)?current.filter(id=>id!==plan.id):[...current,plan.id])}>{choices.includes(plan.id)?'已选偏好':'选择这套偏好'}</CAction>}</View>)}
        {!shown.length&&<View className="gp-panel"><Text>{'当前推荐暂时无法核对，请刷新读取完整安排。'}</Text></View>}
        {state.coordination_note&&tab!=='coordinate'&&<View className="gp-panel gw-lilac"><Text className="gp-section-title">局头的协调说明</Text><Text className="gp-caption">{state.coordination_note}</Text></View>}
        {tab==='plans'&&canChoose&&eligible&&<View className="gp-panel"><Text className="gp-section-title">我的方案偏好</Text><Text className="gp-caption">可以多选。都不合适，也可以直接提交意见。</Text><Textarea className="gw-area" maxlength={300} disabled={disabled} value={note} placeholder="补充想调整的地方（选填，向成员公开）" onInput={e=>setNote(e.detail.value)}/><CAction className="gw-full" variant="primary" disabled={disabled||!plans.length} onClick={()=>submit({action:'select',expected_version:state.own_selection?.version??0,plan_ids:choices,note})}>{choices.length?'保存我的方案选择':'这些都不合适，提交意见'}</CAction></View>}
        {tab==='coordinate'&&owner&&<View className="gp-panel"><Text className="gp-section-title">{'局头协调'}</Text><Text className="gp-caption">{waitingIntake?`还有 ${waitingIntake} 位成员未提交填写，请先等大家补齐。`:state.selected_count<state.total?'等每个人提交偏好后，再协调确认。':'核对安排与说明后，再发送。'}</Text><Textarea className="gw-area" maxlength={300} disabled={disabled} value={coordination} placeholder="这套安排如何照顾大家的想法（选填，公开）" onInput={e=>setCoordination(e.detail.value)}/><CAction className="gw-full" variant="primary" disabled={disabled||!proposal||!ready} onClick={()=>submit({action:'propose',expected_version:state.version,plan_id:proposal,note:coordination})}>{'发送给所有人确认'}</CAction></View>}
        {tab==='plans'&&state.phase==='confirming'&&eligible&&<View className="gp-panel gw-lilac"><Text className="gp-section-title">我的明确确认</Text>{state.own_confirmation&&<Text className="gp-caption">{state.own_confirmation.decision==='accept'?'你已确认本轮安排，等待其他人。定案前仍可提出调整。':'你已提出调整意见。'}</Text>}<Textarea className="gw-area" maxlength={300} disabled={disabled} value={feedback} placeholder="如需调整，请说明原因（选填，公开）" onInput={e=>setFeedback(e.detail.value)}/><CAction className="gw-full" variant="primary" disabled={disabled||!proposed||state.own_confirmation?.decision==='accept'} onClick={()=>submit({action:'respond',expected_version:state.own_confirmation?.version??0,proposal_version:state.proposal_version,decision:'accept',note:feedback})}>我确认这套安排</CAction><CAction className="gw-full" disabled={disabled||!proposed} onClick={()=>submit({action:'respond',expected_version:state.own_confirmation?.version??0,proposal_version:state.proposal_version,decision:'reject',note:feedback})}>我希望调整</CAction></View>}
      </>}
      {owner&&tab!=='coordinate'&&<CAction className="gw-full" variant="primary" disabled={disabled||!plans.length} onClick={()=>setTab('coordinate')}>{state.phase==='confirming'?'重新协调安排':'开始协调'}</CAction>}
      {error&&<View className="gp-error" role="alert"><Text>{error}</Text></View>}
    </>}
    {notice&&<View className="gw-alert" role="alert"><Text>{notice}</Text></View>}{pending&&<CAction className="gw-full" disabled={blocked||retryBlocked} onClick={retry}>沿用原请求核对操作</CAction>}
    <View className="gw-links"><CAction variant="text" disabled={blocked||pending} onClick={inspect}>{'查看大家的公开想法'}</CAction>{snapshot.own&&<CAction variant="text" disabled={blocked||pending} onClick={editOwn}>修改我的填写</CAction>}{owner&&<CAction variant="text" disabled={blocked||pending||readBlocked||processing||!snapshot.viewer.can_generate||!snapshot.source_fingerprint} onClick={generate}>重新生成推荐安排</CAction>}</View>
    <Text className="gp-caption">场地营业、费用和预订仍需实际核实。</Text>
  </View>;
}

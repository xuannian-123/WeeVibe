import {GatheringLegacyDetailsRecovery} from './legacy-details-recovery';
import {gatheringConfirmedDetails,gatheringCapacityReached} from './details-validation';
import {beijingLabel} from '../requirements/answer-state';
import {ApiClientError} from '@weevibe/api-client';
import {useEffect,useRef,useState} from 'react';
import Taro,{usePageScroll} from '@tarojs/taro';
import {Button,Text,View} from '@tarojs/components';
import {
  gatheringFriendMemberLimit,gatheringWorkflowCommandSchema,gatheringMemberSaveSchema,gatheringDetailsUpdateSchema,gatheringGenerateSchema,emptyGatheringIntake,
  type GatheringSnapshot,type GatheringDetails,type GatheringIntake,
} from '@weevibe/contracts';
import {useStoredWrite} from '../../platform/write-state';
import {newKey} from '../../platform/local-id';
import {gatheringRequest,gatheringMessage,parseBoundGathering,readMoreGatheringMembers} from './client';
import {useGatheringSource} from './use-source';
import {GatheringIntakeEditor} from './intake-editor';
import {GatheringDetailsEditor} from './details-editor';
import {GatheringQuestionnaire} from './questionnaire';
import {GatheringPerson} from './person';
import {GatheringSubscription,useGatheringSubscription} from './subscription';
import {GatheringPlanSelection,GatheringSegmentDetails} from './plan-selection';
import {GatheringFinalResult,GatheringFinalPlan} from './final-result';
import {GatheringWorkflowPanel} from './workflow-panel';
import {GatheringGenerationReview} from './generation-review';
import {parseWorkflowReceipt,parseGenerationReceipt} from './workflow-receipt';
import {gatheringFinalPlan} from './final-plan';
import {GatheringFriendHub,GatheringFriendSaveRecovery} from './friend-hub';

type ViewName='final-detail'|'generation'|'save-recovery'|'workflow'|'content'|'arrangements'|'plan'|'segment'|'final-result'|'intake'|'questionnaire'|'team'|'team-stats'|'edit-details'|'edit-questionnaire';
export function GatheringManage({snapshot,actor,session,entry='manage',readVerified=true,update,refresh}:{snapshot:GatheringSnapshot;actor:string;session:string;entry?:'share'|'manage';readVerified?:boolean;update:(v:GatheringSnapshot)=>void;refresh:()=>Promise<void>}){
  const source=useGatheringSource(session),id=snapshot.gathering.id,owner=snapshot.viewer.is_owner,friend=snapshot.gathering.kind==='friend';
  const subscription=useGatheringSubscription(actor,session);
  const finalized=!!snapshot.final_choice,capacityReached=gatheringCapacityReached(snapshot);
  const initialView:ViewName=snapshot.workflow?'workflow':friend?(finalized?'final-result':owner&&snapshot.generation&&snapshot.generation.status!=='ready'?'generation':'content'):owner&&entry!=='share'?'team-stats':'team';
  const needsResponse=!capacityReached&&!snapshot.gathering.has_responded&&snapshot.viewer.can_respond&&(friend||entry==='share'||!snapshot.viewer.is_member);
  const[view,setView]=useState<ViewName>(needsResponse?(friend?'intake':'questionnaire'):initialView),[notice,setNotice]=useState(''),[detailError,setDetailError]=useState(''),[busy,setBusy]=useState(false),[members,setMembers]=useState(snapshot.members??[]),[cursor,setCursor]=useState(snapshot.next_member_cursor);
  const[planId,setPlanId]=useState(''),[segmentId,setSegmentId]=useState('');
  const segmentOrigin=useRef<ViewName>('plan');
  const finalPosition=useRef(0),ownPosition=useRef(0);
  const finalOrigin=useRef<ViewName>(initialView),ownOrigin=useRef<ViewName>(initialView),planOrigin=useRef<ViewName>('arrangements');
  const scroll=useRef(0),planPositions=useRef({arrangements:0,plan:0}),restoreScroll=useRef<number>();
  const wasFinalized=useRef(finalized);
  usePageScroll(event=>{scroll.current=event.scrollTop;});
  useEffect(()=>{
    if(restoreScroll.current===undefined)return;
    const target=restoreScroll.current;restoreScroll.current=undefined;const guard=source.ticket();
    const timer=setTimeout(()=>{try{guard();void Taro.pageScrollTo?.({scrollTop:target,duration:0})?.catch(()=>{});}catch{}},0);
    return()=>clearTimeout(timer);
  },[view,planId]);
  function openFinal(){finalPosition.current=scroll.current;finalOrigin.current=view;restoreScroll.current=0;setView('final-detail');}
  function backFromFinal(){restoreScroll.current=finalPosition.current;setView(finalOrigin.current);}
  function cancelOwn(){restoreScroll.current=ownPosition.current;setView(ownOrigin.current);}
  function openCandidate(next:string){planOrigin.current=view;planPositions.current.arrangements=scroll.current;restoreScroll.current=0;setPlanId(next);setView('plan');}
  function backFromCandidate(){restoreScroll.current=planPositions.current.arrangements;setView(planOrigin.current);}
  function openCandidateSegment(next:string){segmentOrigin.current=view;planPositions.current.plan=scroll.current;restoreScroll.current=0;setSegmentId(next);setView('segment');}
  function backFromSegment(){restoreScroll.current=planPositions.current.plan;setView(segmentOrigin.current);}
  const actionLock=useRef(false),editVersion=useRef(snapshot.own?.version??0),editRevision=useRef(snapshot.gathering.revision);
  const editInitial=useRef(snapshot.own?.intake??emptyGatheringIntake()),editDetails=useRef(snapshot.gathering.details);
  useEffect(()=>{setMembers(snapshot.members??[]);setCursor(snapshot.next_member_cursor);},[snapshot]);
  const commit=(next:GatheringSnapshot)=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView(next.workflow?'workflow':friend?'content':initialView);setNotice('内容已保存。');};
  const saveWrite=useStoredWrite({storageKey:`weevibe-gathering-intake-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringMemberSaveSchema.parse(v),execute:input=>gatheringRequest(session,`/api/v1/gatherings/${id}/intake`,'POST',input,v=>{const next=parseBoundGathering(v,id);if(!next.viewer.is_member||!next.gathering.has_responded||!next.own||next.own.version<input.expected_version+1)throw new ApiClientError('INVALID_RESPONSE','本人提交结果尚未确认，请保留原请求核对。',200);return next;},source.ticket()),committed:commit});
  const detailWrite=useStoredWrite({storageKey:`weevibe-gathering-details-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringDetailsUpdateSchema.parse(v),execute:async input=>{try{return await gatheringRequest(session,`/api/v1/gatherings/${id}/details`,'POST',input,v=>parseBoundGathering(v,id),source.ticket());}catch(error){if(source.valid())setDetailError(gatheringMessage(error));throw error;}},committed:commit});
  const generateWrite=useStoredWrite({storageKey:`weevibe-gathering-generation-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringGenerateSchema.parse(v),execute:input=>gatheringRequest(session,`/api/v1/gatherings/${id}/generate`,'POST',input,v=>parseGenerationReceipt(v,id),source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView(friend?(next.generation?.status==='ready'&&next.workflow?'workflow':'generation'):next.workflow?'workflow':next.generation?.status==='failed'?'team-stats':'arrangements');setNotice(next.generation?.status==='processing'?'正在生成，稍后点击刷新核对结果。':next.generation?.status==='ready'&&next.itinerary?'安排已生成，请共同核对后再决定。':next.generation?.error||'本次生成未完成，原安排已保留，请重新生成。');}});
  const workflowWrite=useStoredWrite({storageKey:`weevibe-gathering-workflow-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringWorkflowCommandSchema.parse(v),execute:input=>gatheringRequest(session,`/api/v1/gatherings/${id}/workflow`,'POST',input,v=>parseWorkflowReceipt(v,id,input),source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView('workflow');setNotice('');}});
  const writing=workflowWrite.busy||saveWrite.busy||detailWrite.busy||generateWrite.busy||subscription.busy,boundaryBlocked=!readVerified||generateWrite.blocked||!!generateWrite.pending||saveWrite.blocked||detailWrite.blocked||!!workflowWrite.pending||workflowWrite.blocked||!!saveWrite.pending||!!detailWrite.pending;
  useEffect(()=>{if(friend&&finalized&&!wasFinalized.current&&!saveWrite.pending&&!generateWrite.pending){restoreScroll.current=0;setView(snapshot.workflow?'workflow':'final-result');}wasFinalized.current=finalized;},[friend,finalized,!!snapshot.workflow,saveWrite.pending,generateWrite.pending]);
  useEffect(()=>{if(friend&&!saveWrite.busy&&(saveWrite.pending||saveWrite.blocked))setView('save-recovery');},[friend,saveWrite.busy,saveWrite.pending,saveWrite.blocked]);
  function editOwn(){if(!source.valid()||writing||boundaryBlocked&&!finalized)return;ownPosition.current=scroll.current;ownOrigin.current=view;editVersion.current=snapshot.own?.version??0;editRevision.current=snapshot.gathering.revision;editDetails.current=snapshot.gathering.details;editInitial.current=snapshot.own?.intake??emptyGatheringIntake();setView(friend?'intake':'questionnaire');setNotice('');}
  function editCommon(section:'details'|'questionnaire'){if(friend||!owner||finalized||!source.valid()||writing||boundaryBlocked)return;editRevision.current=snapshot.gathering.revision;editDetails.current=snapshot.gathering.details;setView(`edit-${section}`);setNotice('');setDetailError('');}
  async function saveOwn(intake:GatheringIntake){
    if(!source.valid()||!readVerified||finalized||!snapshot.viewer.can_respond||writing||actionLock.current)return;
    if(capacityReached){setNotice('本次筹备人数已满，当前输入已保留。请联系发起人核对人数上限后再提交。');return;}
    actionLock.current=true;const guard=source.ticket();
    const input={...(snapshot.viewer.is_member?{}:{join_if_needed:true}),expected_version:editVersion.current,expected_revision:editRevision.current,idempotency_key:newKey(),intake};
    try{guard();await saveWrite.send(input);}
    catch(error){if(source.valid())setNotice(gatheringMessage(error));}finally{actionLock.current=false;}
  }
  function saveDetails(details:GatheringDetails){if(friend||!source.valid()||!readVerified||finalized)return;void detailWrite.send({expected_revision:editRevision.current,details:{...details,confirmed_details:gatheringConfirmedDetails(details,view.slice(5) as 'details'|'questionnaire')}});}
  async function more(){if(!cursor||actionLock.current||!source.valid())return;actionLock.current=true;setBusy(true);const guard=source.ticket();try{const result=await readMoreGatheringMembers(session,id,cursor,guard);guard();setMembers(current=>[...current,...result.members.filter(m=>!current.some(old=>old.person.user_id===m.person.user_id))]);setCursor(result.next_cursor);}catch(e){if(source.valid())setNotice(gatheringMessage(e));}finally{actionLock.current=false;if(source.alive())setBusy(false);}}
  const generationSource=useRef(snapshot.source_fingerprint);
  function generate(){if(!snapshot.viewer.can_generate||!owner||finalized||writing||boundaryBlocked||!snapshot.source_fingerprint||!source.valid())return;if(friend){generationSource.current=snapshot.source_fingerprint;setView('generation');return;}void confirmGeneration();}
  async function confirmGeneration(){if(!snapshot.viewer.can_generate||!owner||finalized||actionLock.current||writing||boundaryBlocked||!source.valid())return;if(friend&&(snapshot.gathering.member_count>gatheringFriendMemberLimit||snapshot.members?.some(m=>!m.submitted)))return;const fingerprint=friend?generationSource.current:snapshot.source_fingerprint;if(!fingerprint)return;actionLock.current=true;const guard=source.ticket();try{if(!friend){const choice=await Taro.showModal({title:'生成团建安排',content:'根据问卷公开统计生成推荐，仍需局头确认后通知成员。',confirmText:'生成安排',cancelText:'再等等'});guard();if(!choice.confirm)return;}await generateWrite.send({expected_source:fingerprint,idempotency_key:newKey()});}catch(e){if(source.valid())setNotice(gatheringMessage(e));}finally{actionLock.current=false;}}
  useEffect(()=>{if(friend&&!generateWrite.busy&&(generateWrite.pending||generateWrite.blocked))setView('generation');},[friend,generateWrite.busy,generateWrite.pending,generateWrite.blocked]);
  useEffect(()=>{if(friend&&view==='generation'&&snapshot.generation?.status==='ready'&&snapshot.workflow&&!generateWrite.pending&&!generateWrite.busy)setView('workflow');},[friend,snapshot.generation?.id,snapshot.generation?.status,generateWrite.pending,generateWrite.busy]);
  if(!source.valid())return <Text className="gg-notice">账号或页面来源已变化，请返回后重新打开。</Text>;
  const home=()=>void Taro.reLaunch({url:'/pages/index/index'});
  if(friend&&view==='generation')return <GatheringGenerationReview snapshot={snapshot} busy={writing} pending={!!generateWrite.pending} blocked={!readVerified||generateWrite.blocked} message={generateWrite.message==='服务端已确认本次操作。'?'':generateWrite.message||notice} confirm={()=>void confirmGeneration()} retry={()=>{if(source.valid())void generateWrite.send();}} refresh={()=>void refresh()} back={()=>setView(snapshot.workflow?'workflow':'content')}/>;
  if(friend&&view==='save-recovery')return <GatheringFriendSaveRecovery intake={saveWrite.pending?.input.intake} busy={saveWrite.busy} blocked={saveWrite.blocked} message={saveWrite.message} home={home} retry={()=>{if(source.valid())void saveWrite.send();}}/>;
  if(friend&&(detailWrite.pending||detailWrite.blocked))return <GatheringLegacyDetailsRecovery snapshot={snapshot} input={detailWrite.pending?.input} verified={readVerified} busy={writing||busy} blocked={detailWrite.blocked} message={detailWrite.message} refresh={()=>void refresh()} home={home} resolve={()=>{if(source.valid()&&readVerified&&!writing&&detailWrite.clearPending()){setNotice('当前保存内容已保留，本机待核对记录已清除。');setView(snapshot.workflow?'workflow':finalized?'final-result':'content');}}}/>;
  if(view==='intake')return <View><GatheringIntakeEditor flow={friend} readOnlyNotice={!readVerified&&!finalized?'最新内容暂未核对，先查看上次保存的本人内容。当前输入仍保留，重新读取后可继续修改。':undefined} activityLabel={friend?`${snapshot.gathering.title} · ${snapshot.gathering.date||'日期待商量'}\n${owner?'我的活动偏好':snapshot.gathering.owner.nickname+' 邀你一起筹备'}`:undefined} submitLabel={friend?snapshot.viewer.is_member?'保存我的想法':'确认参与并提交':undefined} readOnly={finalized||!snapshot.viewer.can_respond||!readVerified} saving={saveWrite.busy||!!saveWrite.pending||saveWrite.blocked||subscription.busy} participationNotice={!snapshot.viewer.is_member?'点击确认参与并提交后加入本次筹备；公开偏好供同次成员查看，个人预算与出发地点仅本人可见。':undefined} saveFeedback={{message:saveWrite.message||notice,pending:!!saveWrite.pending,busy:saveWrite.busy,retry:()=>void saveWrite.send()}} initial={finalized||!readVerified?snapshot.own?.intake??emptyGatheringIntake():editInitial.current} session={session} date={snapshot.gathering.date} done={intake=>void saveOwn(intake)} cancel={cancelOwn}/></View>;
  if(view==='questionnaire')return <View>{!snapshot.viewer.is_member&&<Text className="gg-notice">提交问卷后参与本次团建；个人答卷仅你可见，局头查看统计。</Text>}<GatheringQuestionnaire readOnlyNotice={!readVerified&&!finalized?'最新内容暂未核对，填写已暂停。重新读取后可继续修改。':undefined} readOnly={finalized||!snapshot.viewer.can_respond||!readVerified} details={editDetails.current} initial={editInitial.current} session={session} busy={saveWrite.busy||!!saveWrite.pending||subscription.busy} save={intake=>void saveOwn(intake)} cancel={cancelOwn}/>{saveWrite.message&&<Text className="gg-notice">{saveWrite.message}</Text>}{saveWrite.pending&&<Button className="gg-secondary" disabled={saveWrite.busy} onClick={()=>void saveWrite.send()}>沿用原请求核对保存</Button>}</View>;
  if(!friend&&(view==='edit-details'||view==='edit-questionnaire'))return <View><GatheringDetailsEditor feedback={detailError||detailWrite.message} memberCount={snapshot.gathering.member_count} saving={!readVerified||detailWrite.busy||!!detailWrite.pending} initial={editDetails.current} kind="team" section={view==='edit-details'?'details':'questionnaire'} session={session} cancel={()=>setView(initialView)} save={saveDetails}/>{detailWrite.message&&<Text className="gg-notice">{detailWrite.message}</Text>}{detailWrite.pending&&<Button className="gg-secondary" disabled={detailWrite.busy} onClick={()=>void detailWrite.send()}>沿用原请求核对修改</Button>}</View>;
  const currentPlan=finalized?gatheringFinalPlan(snapshot):snapshot.itinerary?.plans.find(p=>p.id===planId),currentSegment=currentPlan?.segments.find(s=>s.id===segmentId);
  const details=snapshot.gathering.details;
  const displayedPlans=snapshot.itinerary?.plans.filter(plan=>!snapshot.final_choice||plan.id===snapshot.final_choice.plan_id)??[];
  if(snapshot.workflow&&view==='workflow')return <GatheringWorkflowPanel key={snapshot.workflow.generation_id} snapshot={snapshot} readBlocked={!readVerified} viewFinal={openFinal} blocked={writing||busy||!source.valid()} pending={!!workflowWrite.pending||workflowWrite.blocked} retryBlocked={workflowWrite.blocked} notice={workflowWrite.message==='服务端已确认本次操作。'?'':workflowWrite.message||notice} send={action=>{if(source.valid()&&!writing&&!boundaryBlocked&&snapshot.workflow)void workflowWrite.send({...action,generation_id:snapshot.workflow.generation_id,idempotency_key:newKey()});}} retry={()=>{if(source.valid())void workflowWrite.send();}} refresh={()=>void refresh()} editOwn={editOwn} inspect={()=>setView(friend?'content':'team-stats')} generate={()=>void generate()}/>;
  if(view==='final-detail'&&finalized)return <GatheringFinalPlan snapshot={snapshot} busy={writing||busy} back={backFromFinal} backLabel="返回定案结果" viewOwn={editOwn} refresh={()=>void refresh()} openSegment={openCandidateSegment}/>;
  if(friend&&view==='final-result'&&snapshot.final_choice)return <GatheringFinalResult snapshot={snapshot} busy={writing||busy} notice={notice} back={()=>setView('content')} open={openFinal} viewOwn={editOwn} refresh={()=>void refresh()}/>;
  if(friend&&view==='plan'&&finalized)return <GatheringFinalPlan snapshot={snapshot} busy={writing||busy} back={backFromCandidate} backLabel="返回活动安排" viewOwn={editOwn} refresh={()=>void refresh()} openSegment={openCandidateSegment}/>;
  if(friend&&view==='plan')return <GatheringPlanSelection plans={displayedPlans} selected={planId} stale={!!snapshot.itinerary?.stale} busy={writing||busy} notice={notice} choose={next=>{if(source.valid()&&!writing){restoreScroll.current=0;setPlanId(next);}}} openSegment={openCandidateSegment} back={backFromCandidate} refresh={()=>void refresh()} generate={!finalized?generate:undefined} canGenerate={!boundaryBlocked&&owner&&snapshot.viewer.can_generate&&!!snapshot.source_fingerprint}/>;
  if(view==='segment')return <GatheringSegmentDetails backLabel={finalized?'返回完整安排':'返回方案详情'} kind={snapshot.gathering.kind} segment={currentSegment} busy={writing||busy} back={backFromSegment}/>;
  if(friend&&(view==='content'||view==='arrangements'))return <GatheringFriendHub snapshot={snapshot} view={view} members={members} more={!!cursor} busy={writing||busy} blocked={boundaryBlocked} notice={[...new Set([notice,saveWrite.result?'':saveWrite.message,detailWrite.result?'':detailWrite.message,generateWrite.result?'':generateWrite.message].filter(Boolean))].join(' ')} home={home} change={next=>{if(source.valid()&&!writing){restoreScroll.current=0;setView(next);}}} refresh={()=>void refresh()} editOwn={editOwn} loadMore={()=>void more()} generate={()=>void generate()} workflow={()=>setView(snapshot.workflow?'workflow':'final-result')} openPlan={openCandidate}/>;
  return <View className="gg-manage"><View className="gg-row"><Text className="gg-eyebrow">{friend?'朋友出游':'一起团建'} / 管理活动</Text><Button className="gg-link" disabled={writing||busy} onClick={()=>void refresh()}>刷新</Button></View><Text className="gg-title">{snapshot.gathering.title}</Text><Text className="gg-muted">{snapshot.gathering.date||'日期待确认'} · {snapshot.gathering.member_count} 位筹备成员{owner?' · 我是局头':''}</Text>
    <View className="gg-row"><GatheringPerson person={snapshot.gathering.owner}/><Button className="gg-soft" openType="share">分享给朋友</Button></View>
    {notice&&<Text className="gg-notice">{notice}</Text>}{[saveWrite,detailWrite,generateWrite].map((write,i)=>write.pending?<View className="gg-panel" key={i}><Text>{write.message||'上次操作结果待核对，原请求已保留。'}</Text><Button className="gg-secondary" disabled={write.busy} onClick={()=>void write.send()}>沿用原请求核对并重试</Button></View>:null)}
    {!snapshot.viewer.is_member&&!finalized&&snapshot.viewer.can_respond?<View className="gg-panel mint"><Text className="gg-heading">一起参与这次{friend?'出游':'团建'}</Text><Text className="gg-muted">{friend?'确认参与后，同次出游成员可看到你的头像、昵称及公开整理内容。':'参与者只能查看局头已确认的信息和本人问卷，看不到其他人的答案或统计。'}预算和出发地点仅本人可见。</Text><Button className="gg-primary" disabled={writing||!snapshot.viewer.can_respond} onClick={editOwn}>{snapshot.viewer.can_respond?'继续填写我的想法':'本次填写已结束'}</Button></View>:<>
    {!friend&&(view==='team'||view==='team-stats')&&<View><Text className="gg-heading">{view==='team-stats'?'问卷统计':'活动安排'}</Text>{owner&&<View className="gg-inline"><Button className="gg-soft" onClick={()=>setView('team')}>活动安排</Button><Button className="gg-soft" onClick={()=>setView('team-stats')}>问卷统计</Button></View>}<View className="gg-panel mint"><Text className="gg-heading">局头已确认的信息</Text><Text>{details.date||'日期待确认'} {details.approximate_time||details.start_time}</Text><Text>{details.place||'集合地点待确认'}</Text>{details.address&&<Text>{details.address}</Text>}{details.description&&<Text>{details.description}</Text>}{details.deadline_at&&<Text className="gg-muted">填写截止：{beijingLabel(details.deadline_at)}</Text>}</View>
      {owner&&view==='team-stats'&&snapshot.stats&&<View className="gg-team-statistics"><Text className="gg-heading">问卷统计结果</Text>{!finalized&&<Button className="gg-primary" disabled={writing||boundaryBlocked||snapshot.generation?.status==='processing'} onClick={()=>void generate()}>生成团建推荐安排</Button>}<Text className="gg-muted">已填写 {snapshot.stats.respondent_count} 人；预算与个人出发地点不公开、不计入统计。</Text>{snapshot.stats.questions.map(q=><View className="gg-panel" key={q.id}><Text className="gg-heading">{q.title}</Text>{q.private?<Text className="gg-muted">此题仅本人可见，不纳入局头统计。</Text>:<View><Text className="gg-muted">{q.response_count} 人填写</Text>{q.options.map(o=><View className="gg-stats-row" key={o.id}><Text>{o.label}</Text><Text>{o.count} 人</Text></View>)}{q.type==='text'?<Text className="gg-muted">文字原文仅本人可见，统计只展示填写人数。</Text>:<Text className="gg-muted">其他／自己填写：{q.other_count} 人，原文仅本人可见。</Text>}</View>}</View>)}</View>}
      {!owner&&<Text className="gg-muted">问卷统计仅局头可见，个人答卷仅本人可见。</Text>}{snapshot.viewer.is_member&&<Button className="gg-primary" disabled={writing||boundaryBlocked} onClick={editOwn}>{snapshot.gathering.has_responded?'查看我的填写':'填写我的问卷'}</Button>}{!snapshot.viewer.can_respond&&<Text className="gg-notice">问卷填写已截止，已保存的内容仍仅本人可见。</Text>}
    </View>}
    </>}
    {snapshot.workflow&&<Button className="gg-primary" disabled={writing||boundaryBlocked} onClick={()=>setView('workflow')}>{finalized?'查看最终安排':'进入方案选择与确认'}</Button>}
    {snapshot.viewer.is_member&&!finalized&&<GatheringSubscription value={subscription} gatheringId={id}/>}
    {!friend&&owner&&!finalized&&!view.startsWith('edit-')&&<View className="gg-inline"><Button className="gg-link" disabled={writing||boundaryBlocked} onClick={()=>editCommon('questionnaire')}>修改问卷与基本信息</Button><Button className="gg-link" disabled={writing||boundaryBlocked} onClick={()=>editCommon('details')}>修改其他明细</Button></View>}
  </View>;
}

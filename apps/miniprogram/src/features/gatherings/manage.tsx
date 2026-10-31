import {GatheringLegacyDetailsRecovery} from './legacy-details-recovery';
import {gatheringCapacityReached} from './details-validation';
import {ApiClientError} from '@weevibe/api-client';
import {useEffect,useRef,useState} from 'react';
import Taro,{usePageScroll} from '@tarojs/taro';
import {Text,View} from '@tarojs/components';
import {
  gatheringFriendMemberLimit,gatheringWorkflowCommandSchema,gatheringMemberSaveSchema,gatheringDetailsUpdateSchema,gatheringGenerateSchema,gatheringAdjustmentSchema,emptyGatheringIntake,
  type GatheringSnapshot,type GatheringIntake,gatheringPublishSchema,gatheringAttendanceSchema,gatheringFeedbackSchema,
} from '@weevibe/contracts';
import {useStoredWrite} from '../../platform/write-state';
import {newKey} from '../../platform/local-id';
import {gatheringRequest,gatheringMessage,parseBoundGathering,readMoreGatheringMembers,publishGathering,saveGatheringAttendance,addGatheringFeedback,adjustGathering} from './client';
import {useGatheringSource} from './use-source';
import {GatheringIntakeEditor} from './intake-editor';
import {useGatheringSubscription} from './subscription';
import {GatheringPlanSelection,GatheringSegmentDetails} from './plan-selection';
import {GatheringFinalResult,GatheringFinalPlan,GatheringPublishedArrangement} from './final-result';
import {GatheringWorkflowPanel} from './workflow-panel';
import {GatheringGenerationReview} from './generation-review';
import {parseWorkflowReceipt,parseGenerationReceipt} from './workflow-receipt';
import {gatheringFinalPlan} from './final-plan';
import {GatheringFriendHub,GatheringFriendSaveRecovery} from './friend-hub';

type ViewName='final-detail'|'generation'|'save-recovery'|'workflow'|'content'|'arrangements'|'plan'|'segment'|'final-result'|'intake';
export function GatheringManage({snapshot,actor,session,entry='manage',readVerified=true,update,refresh}:{snapshot:GatheringSnapshot;actor:string;session:string;entry?:'share'|'manage';readVerified?:boolean;update:(v:GatheringSnapshot)=>void;refresh:()=>Promise<void>}){
  const source=useGatheringSource(session),id=snapshot.gathering.id,owner=snapshot.viewer.is_owner;
  const subscription=useGatheringSubscription(actor,session);
  const finalized=!!snapshot.final_choice,capacityReached=gatheringCapacityReached(snapshot);
  const initialView:ViewName=snapshot.workflow?'workflow':(finalized?'final-result':owner&&snapshot.generation&&snapshot.generation.status!=='ready'?'generation':'content');
  const needsResponse=!capacityReached&&!snapshot.gathering.has_responded&&snapshot.viewer.can_respond;
  const[view,setView]=useState<ViewName>(needsResponse?'intake':initialView),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[members,setMembers]=useState(snapshot.members??[]),[cursor,setCursor]=useState(snapshot.next_member_cursor);
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
  const editInitial=useRef(snapshot.own?.intake??emptyGatheringIntake());
  useEffect(()=>{setMembers(snapshot.members??[]);setCursor(snapshot.next_member_cursor);},[snapshot]);
  const commit=(next:GatheringSnapshot)=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView(next.workflow?'workflow':'content');setNotice('内容已保存。');};
  const saveWrite=useStoredWrite({storageKey:`weevibe-gathering-intake-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringMemberSaveSchema.parse(v),execute:input=>gatheringRequest(session,`/api/v1/gatherings/${id}/intake`,'POST',input,v=>{const next=parseBoundGathering(v,id);if(!next.viewer.is_member||!next.gathering.has_responded||!next.own||next.own.version<input.expected_version+1)throw new ApiClientError('INVALID_RESPONSE','本人提交结果尚未确认，请保留原请求核对。',200);return next;},source.ticket()),committed:commit});
  const detailWrite=useStoredWrite({storageKey:`weevibe-gathering-details-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringDetailsUpdateSchema.parse(v),execute:async()=>{throw Error('历史明细仅支持读取核对，请刷新当前记录。');},committed:()=>{}});
  const generateWrite=useStoredWrite({storageKey:`weevibe-gathering-generation-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringGenerateSchema.parse(v),execute:input=>gatheringRequest(session,`/api/v1/gatherings/${id}/generate`,'POST',input,v=>parseGenerationReceipt(v,id),source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView(next.generation?.status==='ready'&&next.workflow?'workflow':'generation');setNotice(next.generation?.status==='processing'?'正在生成，稍后点击刷新核对结果。':next.generation?.status==='ready'&&next.itinerary?'安排已生成，请共同核对后再决定。':next.generation?.error||'本次生成未完成，原安排已保留，请重新生成。');}});
  const workflowWrite=useStoredWrite({storageKey:`weevibe-gathering-workflow-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringWorkflowCommandSchema.parse(v),execute:input=>gatheringRequest(session,`/api/v1/gatherings/${id}/workflow`,'POST',input,v=>parseWorkflowReceipt(v,id,input),source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView('workflow');setNotice('');}});
  const publishWrite=useStoredWrite({storageKey:`weevibe-gathering-publish-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringPublishSchema.parse(v),execute:input=>publishGathering(session,id,input,source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setNotice('安排已发布，成员可以分别表达参加意向。');}});
  const attendanceWrite=useStoredWrite({storageKey:`weevibe-gathering-attendance-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringAttendanceSchema.parse(v),execute:input=>saveGatheringAttendance(session,id,input,source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setNotice('参加意向已保存，可随时修改。');}});
  const feedbackWrite=useStoredWrite({storageKey:`weevibe-gathering-feedback-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringFeedbackSchema.parse(v),execute:input=>addGatheringFeedback(session,id,input,source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setNotice('反馈已提交给局头。');}});
  const adjustWrite=useStoredWrite({storageKey:`weevibe-gathering-adjustment-pending-v1:${actor}:${id}`,userId:actor,parse:v=>gatheringAdjustmentSchema.parse(v),execute:input=>adjustGathering(session,id,input,source.ticket()),committed:next=>{if(!source.valid())throw Error('STALE_GATHERING');update(next);setView('workflow');setNotice('AI 已生成调整草案，请核对后再发布新版。');}});
  const writing=workflowWrite.busy||saveWrite.busy||detailWrite.busy||generateWrite.busy||adjustWrite.busy||publishWrite.busy||attendanceWrite.busy||feedbackWrite.busy||subscription.busy,boundaryBlocked=!readVerified||generateWrite.blocked||!!generateWrite.pending||adjustWrite.blocked||!!adjustWrite.pending||saveWrite.blocked||detailWrite.blocked||!!workflowWrite.pending||workflowWrite.blocked||!!saveWrite.pending||!!detailWrite.pending||publishWrite.blocked||!!publishWrite.pending||attendanceWrite.blocked||!!attendanceWrite.pending||feedbackWrite.blocked||!!feedbackWrite.pending;
  useEffect(()=>{if(finalized&&!wasFinalized.current&&!saveWrite.pending&&!generateWrite.pending){restoreScroll.current=0;setView(snapshot.workflow?'workflow':'final-result');}wasFinalized.current=finalized;},[finalized,!!snapshot.workflow,saveWrite.pending,generateWrite.pending]);
  useEffect(()=>{if(!saveWrite.busy&&(saveWrite.pending||saveWrite.blocked))setView('save-recovery');},[saveWrite.busy,saveWrite.pending,saveWrite.blocked]);
  function editOwn(){if(!source.valid()||writing||boundaryBlocked&&!finalized)return;ownPosition.current=scroll.current;ownOrigin.current=view;editVersion.current=snapshot.own?.version??0;editRevision.current=snapshot.gathering.revision;editInitial.current=snapshot.own?.intake??emptyGatheringIntake();setView('intake');setNotice('');}
  async function saveOwn(intake:GatheringIntake){
    if(!source.valid()||!readVerified||finalized||!snapshot.viewer.can_respond||writing||actionLock.current)return;
    if(capacityReached){setNotice('本次筹备人数已满，当前输入已保留。请联系发起人核对人数上限后再提交。');return;}
    actionLock.current=true;const guard=source.ticket();
    const input={...(snapshot.viewer.is_member?{}:{join_if_needed:true}),expected_version:editVersion.current,expected_revision:editRevision.current,idempotency_key:newKey(),intake};
    try{guard();await saveWrite.send(input);}
    catch(error){if(source.valid())setNotice(gatheringMessage(error));}finally{actionLock.current=false;}
  }
  async function more(){if(!cursor||actionLock.current||!source.valid())return;actionLock.current=true;setBusy(true);const guard=source.ticket();try{const result=await readMoreGatheringMembers(session,id,cursor,guard);guard();setMembers(current=>[...current,...result.members.filter(m=>!current.some(old=>old.person.user_id===m.person.user_id))]);setCursor(result.next_cursor);}catch(e){if(source.valid())setNotice(gatheringMessage(e));}finally{actionLock.current=false;if(source.alive())setBusy(false);}}
  const generationSource=useRef(snapshot.source_fingerprint);
  function generate(){if(!snapshot.viewer.can_generate||!owner||finalized||writing||boundaryBlocked||!snapshot.source_fingerprint||!source.valid())return;generationSource.current=snapshot.source_fingerprint;setView('generation');}
  async function confirmGeneration(){if(!snapshot.viewer.can_generate||!owner||finalized||actionLock.current||writing||boundaryBlocked||!source.valid())return;if(snapshot.gathering.member_count>gatheringFriendMemberLimit)return;const fingerprint=generationSource.current;if(!fingerprint)return;actionLock.current=true;try{await generateWrite.send({expected_source:fingerprint,idempotency_key:newKey()});}catch(e){if(source.valid())setNotice(gatheringMessage(e));}finally{actionLock.current=false;}}
  function publish(planId:string){if(!owner||!snapshot.source_fingerprint||!snapshot.itinerary||!snapshot.workflow||writing||boundaryBlocked)return;void publishWrite.send({expected_source:snapshot.source_fingerprint,generation_id:snapshot.itinerary.generation_id,plan_id:planId,expected_published_version:snapshot.published?.version??0,idempotency_key:newKey()}).catch(e=>{if(source.valid())setNotice(gatheringMessage(e));});}
  function attendance(decision:'going'|'unsure'|'not_going'){if(!snapshot.published||writing||boundaryBlocked)return;void attendanceWrite.send({arrangement_version:snapshot.published.version,decision,expected_version:snapshot.own_attendance?.version??0,idempotency_key:newKey()}).catch(e=>{if(source.valid())setNotice(gatheringMessage(e));});}
  function feedback(body:string){if(!snapshot.published||writing||boundaryBlocked)return;void feedbackWrite.send({arrangement_version:snapshot.published.version,body,idempotency_key:newKey()}).catch(e=>{if(source.valid())setNotice(gatheringMessage(e));});}
  function adjust(){if(!owner||!snapshot.published||!snapshot.source_fingerprint||writing||boundaryBlocked)return;void adjustWrite.send({expected_source:snapshot.source_fingerprint,base_arrangement_version:snapshot.published.version,idempotency_key:newKey()}).catch(e=>{if(source.valid())setNotice(gatheringMessage(e));});}
  useEffect(()=>{if(!generateWrite.busy&&(generateWrite.pending||generateWrite.blocked))setView('generation');},[generateWrite.busy,generateWrite.pending,generateWrite.blocked]);
  useEffect(()=>{if(view==='generation'&&snapshot.generation?.status==='ready'&&snapshot.workflow&&!generateWrite.pending&&!generateWrite.busy)setView('workflow');},[snapshot.generation?.id,snapshot.generation?.status,generateWrite.pending,generateWrite.busy]);
  if(!source.valid())return <Text className="gg-notice">账号或页面来源已变化，请返回后重新打开。</Text>;
  const home=()=>void Taro.reLaunch({url:'/pages/index/index'});
  if(view==='generation')return <GatheringGenerationReview snapshot={snapshot} busy={writing} pending={!!generateWrite.pending} blocked={!readVerified||generateWrite.blocked} message={generateWrite.message==='服务端已确认本次操作。'?'':generateWrite.message||notice} confirm={()=>void confirmGeneration()} retry={()=>{if(source.valid())void generateWrite.send();}} refresh={()=>void refresh()} back={()=>setView(snapshot.workflow?'workflow':'content')}/>;
  if(snapshot.published&&!finalized&&!(owner&&snapshot.workflow&&snapshot.itinerary?.generation_id!==snapshot.published.generation_id))return <GatheringPublishedArrangement snapshot={snapshot} busy={writing} notice={notice||publishWrite.message||attendanceWrite.message||feedbackWrite.message||adjustWrite.message} publishPending={!!publishWrite.pending} retryPublish={()=>void publishWrite.send()} attendancePending={!!attendanceWrite.pending} retryAttendance={()=>void attendanceWrite.send()} saveAttendance={attendance} saveFeedback={feedback} adjust={owner?adjust:undefined} adjustmentPending={!!adjustWrite.pending} retryAdjustment={()=>void adjustWrite.send()} regenerate={owner?()=>{if(snapshot.source_fingerprint){generationSource.current=snapshot.source_fingerprint;setView('generation');}}:undefined} back={()=>setView('content')} refresh={()=>void refresh()} />;
  if(view==='save-recovery')return <GatheringFriendSaveRecovery intake={saveWrite.pending?.input.intake} busy={saveWrite.busy} blocked={saveWrite.blocked} message={saveWrite.message} home={home} retry={()=>{if(source.valid())void saveWrite.send();}}/>;
  if((detailWrite.pending||detailWrite.blocked))return <GatheringLegacyDetailsRecovery snapshot={snapshot} input={detailWrite.pending?.input} verified={readVerified} busy={writing||busy} blocked={detailWrite.blocked} message={detailWrite.message} refresh={()=>void refresh()} home={home} resolve={()=>{if(source.valid()&&readVerified&&!writing&&detailWrite.clearPending()){setNotice('当前保存内容已保留，本机待核对记录已清除。');setView(snapshot.workflow?'workflow':finalized?'final-result':'content');}}}/>;
  if(view==='intake')return <View><GatheringIntakeEditor flow readOnlyNotice={!readVerified&&!finalized?'最新内容暂未核对，先查看上次保存的本人内容。当前输入仍保留，重新读取后可继续修改。':undefined} activityLabel={`${snapshot.gathering.title} · ${snapshot.gathering.date||'日期待商量'}\n${owner?'我的活动偏好':snapshot.gathering.owner.nickname+' 邀你一起筹备'}`} submitLabel={snapshot.viewer.is_member?'保存我的想法':'确认参与并提交'} readOnly={finalized||!snapshot.viewer.can_respond||!readVerified} saving={saveWrite.busy||!!saveWrite.pending||saveWrite.blocked||subscription.busy} participationNotice={!snapshot.viewer.is_member?'点击确认参与并提交后加入本次筹备；公开偏好供同次成员查看，个人预算与出发地点仅本人可见。':undefined} saveFeedback={{message:saveWrite.message||notice,pending:!!saveWrite.pending,busy:saveWrite.busy,retry:()=>void saveWrite.send()}} initial={finalized||!readVerified?snapshot.own?.intake??emptyGatheringIntake():editInitial.current} session={session} date={snapshot.gathering.date} done={intake=>void saveOwn(intake)} cancel={cancelOwn}/></View>;
  const currentPlan=finalized?gatheringFinalPlan(snapshot):snapshot.itinerary?.plans.find(p=>p.id===planId),currentSegment=currentPlan?.segments.find(s=>s.id===segmentId);
  const displayedPlans=snapshot.itinerary?.plans.filter(plan=>!snapshot.final_choice||plan.id===snapshot.final_choice.plan_id)??[];
  if(snapshot.workflow&&view==='workflow')return <GatheringWorkflowPanel key={snapshot.workflow.generation_id} snapshot={snapshot} readBlocked={!readVerified} viewFinal={openFinal} blocked={writing||busy||!source.valid()} pending={!!workflowWrite.pending||workflowWrite.blocked} retryBlocked={workflowWrite.blocked} notice={workflowWrite.message==='服务端已确认本次操作。'?'':workflowWrite.message||notice} send={action=>{if(source.valid()&&!writing&&!boundaryBlocked&&snapshot.workflow)void workflowWrite.send({...action,generation_id:snapshot.workflow.generation_id,idempotency_key:newKey()});}} retry={()=>{if(source.valid())void workflowWrite.send();}} refresh={()=>void refresh()} editOwn={editOwn} inspect={()=>setView('content')} generate={()=>void generate()} publish={publish} canPublish={owner&&!!snapshot.source_fingerprint&&!snapshot.published}/>;
  if(view==='final-detail'&&finalized)return <GatheringFinalPlan snapshot={snapshot} busy={writing||busy} back={backFromFinal} backLabel="返回定案结果" viewOwn={editOwn} refresh={()=>void refresh()} openSegment={openCandidateSegment}/>;
  if(view==='final-result'&&snapshot.final_choice)return <GatheringFinalResult snapshot={snapshot} busy={writing||busy} notice={notice} back={()=>setView('content')} open={openFinal} viewOwn={editOwn} refresh={()=>void refresh()}/>;
  if(view==='plan'&&finalized)return <GatheringFinalPlan snapshot={snapshot} busy={writing||busy} back={backFromCandidate} backLabel="返回活动安排" viewOwn={editOwn} refresh={()=>void refresh()} openSegment={openCandidateSegment}/>;
  if(view==='plan')return <GatheringPlanSelection plans={displayedPlans} selected={planId} stale={!!snapshot.itinerary?.stale} busy={writing||busy} notice={notice} choose={next=>{if(source.valid()&&!writing){restoreScroll.current=0;setPlanId(next);}}} openSegment={openCandidateSegment} back={backFromCandidate} refresh={()=>void refresh()} generate={!finalized?generate:undefined} canGenerate={!boundaryBlocked&&owner&&snapshot.viewer.can_generate&&!!snapshot.source_fingerprint}/>;
  if(view==='segment')return <GatheringSegmentDetails backLabel={finalized?'返回完整安排':'返回方案详情'} segment={currentSegment} busy={writing||busy} back={backFromSegment}/>;
  if((view==='content'||view==='arrangements'))return <GatheringFriendHub snapshot={snapshot} view={view} members={members} more={!!cursor} busy={writing||busy} blocked={boundaryBlocked} notice={[...new Set([notice,saveWrite.result?'':saveWrite.message,detailWrite.result?'':detailWrite.message,generateWrite.result?'':generateWrite.message].filter(Boolean))].join(' ')} home={home} change={next=>{if(source.valid()&&!writing){restoreScroll.current=0;setView(next);}}} refresh={()=>void refresh()} editOwn={editOwn} loadMore={()=>void more()} generate={()=>void generate()} workflow={()=>setView(snapshot.workflow?'workflow':'final-result')} openPlan={openCandidate}/>;
  return <Text className="gg-notice">当前页面已更新，请返回后重新打开朋友出游。</Text>;
}

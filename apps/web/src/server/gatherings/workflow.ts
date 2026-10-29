import {createHash} from 'node:crypto';
import {gatheringWorkflowCommandSchema,gatheringWorkflowStateSchema,gatheringDetailsSchema,gatheringItinerarySchema,privateGatheringInputText,type GatheringSnapshot,type GatheringWorkflowState} from '@weevibe/contracts';
import type {Gathering} from '@prisma/client';
import type {Tx} from '../activities/state';
import {mutation} from '../activities/mutation';
import {ServiceError} from '../http';
import {consumeRequirementBudget} from '../requirements/service';
import {lockGathering,readGatheringRows,gatheringSnapshotTx,gatheringJson,assertGatheringOwner,assertGatheringEditable,gatheringConflict} from './service';
import {gatheringSourceFingerprint,type PublicGatheringRow} from './privacy';
import {enqueueGatheringLifecycle} from './notifications';

export async function beginGatheringWorkflow(tx:Tx,row:Gathering,generationId:string,sourceHash:string){
 const state:GatheringWorkflowState={generation_id:generationId,source_hash:sourceHash,phase:'selecting',proposal_plan_id:null,proposal_version:0,coordination_note:'',selections:{},confirmations:{}};
 await tx.gatheringWorkflow.upsert({where:{gatheringId:row.id},create:{gatheringId:row.id,state:gatheringJson(state)},update:{state:gatheringJson(state),version:{increment:1}}});
 await enqueueGatheringLifecycle(tx,row,row.ownerUserId,'plans_ready');
}
export async function gatheringWorkflowView(tx:Tx,row:Gathering,actor:string,rows:PublicGatheringRow[],person:(id:string)=>NonNullable<GatheringSnapshot['members']>[number]['person']):Promise<GatheringSnapshot['workflow']>{
 // Older isolated transport doubles do not implement this new capability.
 if(!tx.gatheringWorkflow)return undefined;
 const stored=await tx.gatheringWorkflow.findUnique({where:{gatheringId:row.id}});if(!stored)return undefined;
 const state=gatheringWorkflowStateSchema.parse(stored.state),owner=row.ownerUserId===actor,member=rows.some(r=>r.userId===actor);
 if(!owner&&!member&&!row.finalizedAt)return undefined;
 const eligible=rows.filter(r=>r.responseVersion>0),stale=state.source_hash!==gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),rows,row.kind);
 const currentConfirmation=(userId:string)=>{const response=state.confirmations[userId];return response?.proposal_version===state.proposal_version?response:null;};
 const showPeople=owner||row.kind==='friend'&&member;
 const finalGeneration=state.phase==='completed'?await tx.gatheringGeneration.findUnique({where:{id:state.generation_id},select:{result:true}}):null;
 const finalPlan=finalGeneration?gatheringItinerarySchema.parse(finalGeneration.result).plans.find(p=>p.id===state.proposal_plan_id)??null:null;
 return {version:stored.version,generation_id:state.generation_id,phase:state.phase,stale,proposal_plan_id:state.proposal_plan_id,proposal_version:state.proposal_version,coordination_note:member||owner?state.coordination_note:'',total:row.kind==='friend'?eligible.length:0,selected_count:showPeople?eligible.filter(r=>state.selections[r.userId]).length:0,accepted_count:row.kind==='friend'?eligible.filter(r=>currentConfirmation(r.userId)?.decision==='accept').length:0,rejected_count:showPeople?eligible.filter(r=>currentConfirmation(r.userId)?.decision==='reject').length:0,own_selection:member?state.selections[actor]??null:null,own_confirmation:member?currentConfirmation(actor):null,people:showPeople?eligible.map(r=>({person:person(r.userId),plan_ids:state.selections[r.userId]?.plan_ids??[],note:currentConfirmation(r.userId)?.note||state.selections[r.userId]?.note||'',decision:currentConfirmation(r.userId)?.decision??null})):[],final_plan:finalPlan};
}

export async function commandGatheringWorkflow(id:string,actor:string,raw:unknown){
 const parsed=gatheringWorkflowCommandSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'请核对当前方案与操作版本');
 const input=parsed.data,hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 if(privateGatheringInputText.test(input.note))throw new ServiceError('INVALID_INPUT',400,'个人预算和出发地点请保留在私人填写中，协调说明不要包含这些内容');
 await consumeRequirementBudget(actor);
 return mutation(async tx=>{
  const row=await lockGathering(tx,id),rows=await readGatheringRows(tx,id),own=rows.find(r=>r.userId===actor),owner=row.ownerUserId===actor;
  if(!owner&&(!own||own.responseVersion===0))throw new ServiceError('FORBIDDEN',403,'请先完成本人的填写');
  const previous=await tx.gatheringWorkflowCommand.findUnique({where:{gatheringId_actorId_key:{gatheringId:id,actorId:actor,key:input.idempotency_key}}});
  if(previous){if(previous.hash!==hash)throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'原请求不能用于另一项选择或确认');return gatheringSnapshotTx(tx,id,actor);}
  assertGatheringEditable(row);
  const stored=await tx.gatheringWorkflow.findUnique({where:{gatheringId:id}});if(!stored)throw new ServiceError('INVALID_INPUT',409,'请先生成本轮推荐');
  const state=gatheringWorkflowStateSchema.parse(stored.state),source=gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),rows,row.kind);
  if(input.generation_id!==state.generation_id||row.currentGenerationId!==state.generation_id||state.source_hash!==source)throw gatheringConflict();
  const generated=await tx.gatheringGeneration.findUnique({where:{id:state.generation_id}});
  if(!generated||generated.gatheringId!==id||generated.status!=='ready')throw gatheringConflict();
  const plans=gatheringItinerarySchema.parse(generated.result).plans,eligible=rows.filter(r=>r.responseVersion>0);
  let action:'selection_updated'|'confirmation_requested'|'confirmation_declined'|'completed';
  if(input.action==='select'){
   if(row.kind!=='friend'||!own||own.responseVersion===0)throw new ServiceError('FORBIDDEN',403,'只有完成填写的朋友出游成员可以选择方案');
   if(state.phase!=='selecting'&&state.phase!=='adjusting')throw new ServiceError('INVALID_INPUT',409,'本轮正在确认具体安排，请先完成确认或反馈调整');
   if((state.selections[actor]?.version??0)!==input.expected_version)throw gatheringConflict();
   if(input.plan_ids.some(id=>!plans.some(p=>p.id===id)))throw new ServiceError('INVALID_INPUT',400,'请选择本轮实际存在的方案');
   state.selections[actor]={version:input.expected_version+1,plan_ids:input.plan_ids,note:input.note};action='selection_updated';
  }else if(input.action==='propose'){
   assertGatheringOwner(row,actor);if(stored.version!==input.expected_version)throw gatheringConflict();
   if(!plans.some(p=>p.id===input.plan_id))throw new ServiceError('INVALID_INPUT',400,'未找到本轮方案');
   if(row.kind==='friend'&&(!eligible.length||rows.some(r=>r.responseVersion===0)||eligible.some(r=>!state.selections[r.userId])))throw new ServiceError('INVALID_INPUT',409,'请先收齐每位成员的方案选择，再协调确认');
   state.proposal_plan_id=input.plan_id;state.proposal_version++;state.confirmations={};state.coordination_note=input.note;
   state.phase=row.kind==='team'?'completed':'confirming';action=row.kind==='team'?'completed':'confirmation_requested';
  }else{
   if(row.kind!=='friend'||!own||own.responseVersion===0)throw new ServiceError('FORBIDDEN',403,'仅本次朋友出游成员可以确认');
   if(state.phase!=='confirming'||!state.proposal_plan_id||input.proposal_version!==state.proposal_version)throw gatheringConflict();
   if((state.confirmations[actor]?.version??0)!==input.expected_version)throw gatheringConflict();
   state.confirmations[actor]={version:input.expected_version+1,proposal_version:state.proposal_version,decision:input.decision,note:input.note};
   if(input.decision==='reject'){state.phase='adjusting';action='confirmation_declined';}
   else if(eligible.length&&eligible.every(r=>state.confirmations[r.userId]?.decision==='accept'&&state.confirmations[r.userId]?.proposal_version===state.proposal_version)){state.phase='completed';action='completed';}
   else action='confirmation_requested';
  }
  await tx.gatheringWorkflow.update({where:{gatheringId:id},data:{state:gatheringJson(state),version:{increment:1}}});
  if(state.phase==='completed')await tx.gathering.update({where:{id},data:{finalGenerationId:state.generation_id,finalPlanId:state.proposal_plan_id,finalizedAt:new Date(),revision:{increment:1}}});
  await tx.gatheringWorkflowCommand.create({data:{gatheringId:id,actorId:actor,key:input.idempotency_key,hash}});
  await enqueueGatheringLifecycle(tx,row,actor,action);
  return gatheringSnapshotTx(tx,id,actor);
 });
}

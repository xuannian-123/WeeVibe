import {ApiClientError} from '@weevibe/api-client';
import type {GatheringWorkflowCommand} from '@weevibe/contracts';
import {parseBoundGathering} from './client';
/** Idempotent replay returns the current snapshot, which may be a newer generation or round. */
export function parseWorkflowReceipt(value:unknown,id:string,input:GatheringWorkflowCommand){
 const next=parseBoundGathering(value,id),state=next.workflow;
 const invalid=()=>{throw new ApiClientError('INVALID_RESPONSE','操作结果尚未确认，请沿用原请求核对。',200);};
 if(!state)return invalid();
 if(state.generation_id===input.generation_id){
  if(input.action==='select'&&(!state.own_selection||state.own_selection.version<input.expected_version+1))return invalid();
  if(input.action==='propose'&&(state.version<input.expected_version+1||state.proposal_version<1||state.phase==='selecting'))return invalid();
  if(input.action==='respond'&&(state.proposal_version<input.proposal_version||state.proposal_version===input.proposal_version&&(!state.own_confirmation||state.own_confirmation.version<input.expected_version+1)))return invalid();
 }
 if(state.phase==='completed'&&(!next.final_choice||!state.final_plan||next.final_choice.generation_id!==state.generation_id||next.final_choice.plan_id!==state.final_plan.id||next.viewer.can_respond||next.viewer.can_generate))return invalid();
 return next;
}

export function parseGenerationReceipt(value:unknown,id:string){
 const next=parseBoundGathering(value,id),generation=next.generation;
 if(!generation||generation.status==='ready'&&(!next.itinerary||next.itinerary.generation_id!==generation.id||!next.workflow||next.workflow.generation_id!==generation.id))throw new ApiClientError('INVALID_RESPONSE','生成结果尚未确认，请保留原请求核对。',200);
 return next;
}

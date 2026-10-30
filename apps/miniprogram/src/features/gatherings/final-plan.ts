import type {GatheringSnapshot} from '@weevibe/contracts';

/** A final view always follows the persisted choice, including historical records. */
export function gatheringFinalPlan(snapshot:GatheringSnapshot){
  const choice=snapshot.final_choice,workflow=snapshot.workflow;
  if(!choice)return undefined;
  if(workflow){
    if(workflow.phase!=='completed'||workflow.generation_id!==choice.generation_id||workflow.proposal_plan_id!==choice.plan_id)return undefined;
    if(workflow.final_plan)return workflow.final_plan.id===choice.plan_id?workflow.final_plan:undefined;
  }
  return snapshot.itinerary?.generation_id===choice.generation_id?snapshot.itinerary.plans.find(plan=>plan.id===choice.plan_id):undefined;
}

export function gatheringUnanimous(snapshot:GatheringSnapshot){
  const workflow=snapshot.workflow;
  return snapshot.gathering.kind==='friend'&&!!snapshot.final_choice&&workflow?.phase==='completed'
    &&workflow.generation_id===snapshot.final_choice.generation_id&&workflow.proposal_plan_id===snapshot.final_choice.plan_id
    &&workflow.total>0&&workflow.total===snapshot.gathering.member_count&&workflow.accepted_count===workflow.total&&workflow.rejected_count===0;
}

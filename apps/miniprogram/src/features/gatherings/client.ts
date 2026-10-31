import { ApiClientError } from '@weevibe/api-client';
import {
  gatheringPublicIntakeSchema,apiErrorSchema,gatheringListSchema,gatheringSnapshotSchema,gatheringMembersPageSchema,gatheringOrganizedSchema,
  gatheringPublishSchema,gatheringAttendanceSchema,gatheringFeedbackSchema,
  gatheringAdjustmentSchema,
  type GatheringSnapshot,
} from '@weevibe/contracts';
import { getToken,transport } from '../../platform/api';

const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export async function gatheringRequest<T>(session:string,path:string,method:'GET'|'POST',body:unknown,parse:(raw:unknown)=>T,guard:()=>void=()=>{}):Promise<T>{
  const current=()=>{guard();if(!session||getToken()!==session)throw new ApiClientError('UNAUTHENTICATED','登录账号已变化，请重新打开',401);};
  current();
  if(!new RegExp(`^/api/v1/gatherings(?:/organize|/notifications/subscription|/${uuid}(?:/(?:join|intake|details|generate|adjust|finalize|workflow|publish|attendance|feedback)|/members(?:\\?cursor=${uuid})?)?)?$`).test(path))throw new ApiClientError('INVALID_INPUT','筹备入口不正确',400);
  const response=await transport({path,method,body,headers:{Authorization:`Bearer ${session}`,'Content-Type':'application/json'},timeoutMs:method==='POST'?40000:15000});current();
  if(response.status<200||response.status>=300){const e=apiErrorSchema.safeParse(response.body);throw new ApiClientError(e.success?e.data.error.code:'INVALID_RESPONSE',e.success?e.data.error.message:'服务响应暂时无法核对',response.status);}
  try{return parse(response.body);}catch{throw new ApiClientError('INVALID_RESPONSE','筹备响应无法核实，请保留输入并刷新；未确认保存成功',response.status);}
}
export const parseGatheringSnapshot=(raw:unknown):GatheringSnapshot=>{
  const value=gatheringSnapshotSchema.parse(raw);
  if(value.members?.some(m=>m.blocks.some(b=>b.id==='budget'||b.id==='origin')))throw Error('private member fields');
  if(!value.viewer.is_member&&value.own!==null)throw Error('private own projection');
  if(!value.viewer.is_owner&&!value.viewer.is_member&&(value.members!==null||value.workflow&&(value.workflow.people.length>0||value.workflow.own_selection!==null||value.workflow.own_confirmation!==null||value.workflow.coordination_note!=='')))throw Error('private visitor projection');
  const choice=value.final_choice,workflow=value.workflow;
  if(choice&&(value.viewer.can_respond||value.viewer.can_generate))throw Error('unlocked final choice');
  if(workflow?.phase==='completed'){
    if(!choice||workflow.generation_id!==choice.generation_id||workflow.proposal_plan_id!==choice.plan_id||workflow.final_plan&&workflow.final_plan.id!==choice.plan_id)throw Error('inconsistent final choice');
    if(value.gathering.kind==='friend'&&(workflow.total!==value.gathering.member_count||workflow.total===0||workflow.accepted_count!==workflow.total||workflow.rejected_count!==0))throw Error('incomplete final consent');
  }else if(choice&&workflow)throw Error('incomplete final workflow');
  return value;
};
export const readGathering=(session:string,id:string,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}`,'GET',undefined,v=>parseBoundGathering(v,id),guard);
export const parseBoundGathering=(raw:unknown,id:string)=>{const value=parseGatheringSnapshot(raw);if(value.gathering.id.toLowerCase()!==id.toLowerCase())throw Error('different gathering');return value;};
// A previous server may still return retired records during a staged upgrade.
// Drop only the retired kind; malformed friend records must still fail validation.
export const parseGatheringList=(raw:unknown)=>{
  const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
  return gatheringListSchema.parse(value&&Array.isArray(value.gatherings)?{...value,gatherings:value.gatherings.filter(row=>!row||typeof row!=='object'||row.kind!=='team')}:raw);
};
export const readGatheringList=(session:string,guard?:()=>void)=>gatheringRequest(session,'/api/v1/gatherings','GET',undefined,parseGatheringList,guard);
export const readMoreGatheringMembers=(session:string,id:string,cursor:string,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}/members?cursor=${cursor}`,'GET',undefined,v=>gatheringMembersPageSchema.parse(v),guard);
export const organizeGathering=(session:string,publicInput:unknown,guard?:()=>void)=>{const {activity_nickname:_displayOnly,...preferences}=gatheringPublicIntakeSchema.parse(publicInput);return gatheringRequest(session,'/api/v1/gatherings/organize','POST',{public:preferences},v=>gatheringOrganizedSchema.parse(v),guard);};
export const publishGathering=(session:string,id:string,input:unknown,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}/publish`,'POST',gatheringPublishSchema.parse(input),v=>parseBoundGathering(v,id),guard);
export const saveGatheringAttendance=(session:string,id:string,input:unknown,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}/attendance`,'POST',gatheringAttendanceSchema.parse(input),v=>parseBoundGathering(v,id),guard);
export const addGatheringFeedback=(session:string,id:string,input:unknown,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}/feedback`,'POST',gatheringFeedbackSchema.parse(input),v=>parseBoundGathering(v,id),guard);
export const adjustGathering=(session:string,id:string,input:unknown,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}/adjust`,'POST',gatheringAdjustmentSchema.parse(input),v=>parseBoundGathering(v,id),guard);
export function gatheringMessage(error:unknown){return error instanceof ApiClientError?error.message:error instanceof Error&&error.message!=='STALE_GATHERING'?error.message:'当前页面或账号已变化，请重新打开';}

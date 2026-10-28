import { ApiClientError } from '@weevibe/api-client';
import {
  apiErrorSchema,gatheringListSchema,gatheringSnapshotSchema,gatheringMembersPageSchema,gatheringOrganizedSchema,
  type GatheringSnapshot,
} from '@weevibe/contracts';
import { getToken,transport } from '../../platform/api';

const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
export async function gatheringRequest<T>(session:string,path:string,method:'GET'|'POST',body:unknown,parse:(raw:unknown)=>T,guard:()=>void=()=>{}):Promise<T>{
  const current=()=>{guard();if(!session||getToken()!==session)throw new ApiClientError('UNAUTHENTICATED','登录账号已变化，请重新打开',401);};
  current();
  if(!new RegExp(`^/api/v1/gatherings(?:/organize|/${uuid}(?:/(?:join|intake|details|generate|finalize|members)(?:\\?cursor=${uuid})?)?)?$`).test(path))throw new ApiClientError('INVALID_INPUT','筹备入口不正确',400);
  const response=await transport({path,method,body,headers:{Authorization:`Bearer ${session}`,'Content-Type':'application/json'},timeoutMs:method==='POST'?40000:15000});current();
  if(response.status<200||response.status>=300){const e=apiErrorSchema.safeParse(response.body);throw new ApiClientError(e.success?e.data.error.code:'INVALID_RESPONSE',e.success?e.data.error.message:'服务响应暂时无法核对',response.status);}
  try{return parse(response.body);}catch{throw new ApiClientError('INVALID_RESPONSE','筹备响应无法核实，请保留输入并刷新；未确认保存成功',response.status);}
}
export const parseGatheringSnapshot=(raw:unknown):GatheringSnapshot=>{
  const value=gatheringSnapshotSchema.parse(raw);
  if(value.gathering.kind==='team'&&(!value.viewer.is_owner&&value.stats!==null||value.members!==null))throw Error('private team projection');
  if(value.members?.some(m=>m.blocks.some(b=>b.id==='budget'||b.id==='origin')))throw Error('private member fields');
  return value;
};
export const readGathering=(session:string,id:string,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}`,'GET',undefined,v=>parseBoundGathering(v,id),guard);
export const parseBoundGathering=(raw:unknown,id:string)=>{const value=parseGatheringSnapshot(raw);if(value.gathering.id.toLowerCase()!==id.toLowerCase())throw Error('different gathering');return value;};
export const readGatheringList=(session:string,guard?:()=>void)=>gatheringRequest(session,'/api/v1/gatherings','GET',undefined,v=>gatheringListSchema.parse(v),guard);
export const readMoreGatheringMembers=(session:string,id:string,cursor:string,guard?:()=>void)=>gatheringRequest(session,`/api/v1/gatherings/${id}/members?cursor=${cursor}`,'GET',undefined,v=>gatheringMembersPageSchema.parse(v),guard);
export const organizeGathering=(session:string,publicInput:unknown,guard?:()=>void)=>gatheringRequest(session,'/api/v1/gatherings/organize','POST',{public:publicInput},v=>gatheringOrganizedSchema.parse(v),guard);
export function gatheringMessage(error:unknown){return error instanceof ApiClientError?error.message:error instanceof Error&&error.message!=='STALE_GATHERING'?error.message:'当前页面或账号已变化，请重新打开';}

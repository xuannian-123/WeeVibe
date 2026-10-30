import {resolveMemoryRows} from './memory';
import { gatheringDetailsSchema, gatheringGenerateSchema,gatheringFriendMemberLimit } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from '../activities/mutation';
import { consumeRequirementBudget } from '../requirements/service';
import { gatheringAI,reviewGatheringItinerary } from './ai';
import {beginGatheringWorkflow} from './workflow';
import { gatheringModelSource, gatheringSourceFingerprint } from './privacy';
import { assertGatheringOwner,assertGatheringEditable, gatheringConflict, gatheringJson, gatheringSnapshotTx, lockGathering, readGatheringRows } from './service';

export async function generateGatheringItinerary(id:string,actor:string,raw:unknown,provider:Pick<typeof gatheringAI,'generate'>=gatheringAI){
  const parsed=gatheringGenerateSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'请刷新当前筹备后生成');
  const input=parsed.data;await consumeRequirementBudget(actor);
  const reserved=await mutation(async tx=>{
    const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);

    const previous=await tx.gatheringGeneration.findUnique({where:{gatheringId_idempotencyKey:{gatheringId:id,idempotencyKey:input.idempotency_key}}});
    if(previous){if(previous.sourceHash!==input.expected_source)throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'原生成请求不能用于新的需求');return {existing:true as const,snapshot:await gatheringSnapshotTx(tx,id,actor)};}
    assertGatheringEditable(row);
    await tx.gatheringGeneration.updateMany({where:{gatheringId:id,status:'processing',createdAt:{lt:new Date(Date.now()-90000)}},data:{status:'failed',error:'生成未完成，请重新核对后重试'}});
    if(await tx.gatheringGeneration.findFirst({where:{gatheringId:id,status:'processing'}}))throw new ServiceError('CONCURRENT_MODIFICATION',409,'已有一次生成正在处理，请先核对生成状态');
    const details=gatheringDetailsSchema.parse(row.details),rows=await readGatheringRows(tx,id);
    if(row.kind==='friend'&&rows.some(r=>r.responseVersion===0))throw new ServiceError('INVALID_INPUT',409,'还有成员未完成填写，请先收齐大家的想法');
    if(row.kind==='friend'&&rows.length>gatheringFriendMemberLimit)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,`当前一次生成最多支持${gatheringFriendMemberLimit}人，不会遗漏成员后继续生成`);
    const sourceHash=gatheringSourceFingerprint(details,rows,row.kind);if(sourceHash!==input.expected_source)throw gatheringConflict();
    const generation=await tx.gatheringGeneration.create({data:{gatheringId:id,creatorUserId:actor,idempotencyKey:input.idempotency_key,sourceHash,status:'processing'}});
    const workflow=tx.gatheringWorkflow?await tx.gatheringWorkflow.findUnique({where:{gatheringId:id}}):null;
    const state=workflow?.state as {selections?:Record<string,{plan_ids:string[];note:string}>;confirmations?:Record<string,{decision:string;note:string}>;coordination_note?:string}|undefined;
    const coordination=state?{choices:Object.values(state.selections??{}).map(s=>({plan_ids:s.plan_ids,note:s.note})),feedback:Object.values(state.confirmations??{}).filter(c=>c.decision==='reject').map(c=>c.note),organizer_note:state.coordination_note||''}:undefined;
    const memory=await resolveMemoryRows(tx,rows.map(r=>({...r,gatheringId:id})));
    return {memoryStamp:memory.stamp,existing:false as const,id:generation.id,sourceHash,workflowVersion:workflow?.version??0,source:{...gatheringModelSource(details,memory.rows,row.kind),...(coordination?{coordination}:{})}};
  });
  if(reserved.existing)return reserved.snapshot;
  try{
    const itinerary=reviewGatheringItinerary(await provider.generate(actor,reserved.source),reserved.source);
    return await mutation(async tx=>{
      const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);
      assertGatheringEditable(row);
      const generation=await tx.gatheringGeneration.findUnique({where:{id:reserved.id}});
      const currentRows=await readGatheringRows(tx,id);
      const memory=await resolveMemoryRows(tx,currentRows.map(r=>({...r,gatheringId:id})));
      if(memory.stamp!==reserved.memoryStamp)throw gatheringConflict();
      const source=gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),currentRows,row.kind);
      const workflow=tx.gatheringWorkflow?await tx.gatheringWorkflow.findUnique({where:{gatheringId:id}}):null;
      if(!generation||generation.status!=='processing'||source!==reserved.sourceHash||(workflow?.version??0)!==reserved.workflowVersion)throw gatheringConflict();
      await tx.gatheringGeneration.update({where:{id:reserved.id},data:{status:'ready',result:gatheringJson(itinerary),error:null}});
      await tx.gathering.update({where:{id},data:{currentGenerationId:reserved.id}});
      if(tx.gatheringWorkflow)await beginGatheringWorkflow(tx,row,reserved.id,reserved.sourceHash);
      return gatheringSnapshotTx(tx,id,actor);
    });
  }catch(e){
    await mutation(async tx=>{await tx.gatheringGeneration.updateMany({where:{id:reserved.id,status:'processing'},data:{status:'failed',error:e instanceof ServiceError&&e.code==='VERSION_CONFLICT'?'填写内容已变化，请核对后重新生成':'生成未完成，原安排保留，请重试'}});}).catch(()=>{});
    throw e instanceof ServiceError?e:new ServiceError('UPSTREAM_UNAVAILABLE',503,'AI 生成未完成，原安排已保留，请稍后重试');
  }
}

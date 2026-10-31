import { createHash } from 'node:crypto';
import { gatheringDetailsSchema, gatheringGenerateSchema, gatheringAdjustmentSchema,gatheringFriendMemberLimit,gatheringItinerarySchema } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from '../activities/mutation';
import { consumeRequirementBudget } from '../requirements/service';
import { gatheringAI,reviewGatheringItinerary } from './ai';
import {beginGatheringWorkflow} from './workflow';
import { gatheringModelSource, gatheringSourceFingerprint, gatheringVenuePairs } from './privacy';
import { amapProvider, AmapError } from '../providers/amap';
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
    if(row.kind==='friend'&&rows.length>gatheringFriendMemberLimit)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,`当前一次生成最多支持${gatheringFriendMemberLimit}人，不会遗漏成员后继续生成`);
    const sourceHash=gatheringSourceFingerprint(details,rows,row.kind);if(sourceHash!==input.expected_source)throw gatheringConflict();
    const generation=await tx.gatheringGeneration.create({data:{gatheringId:id,creatorUserId:actor,idempotencyKey:input.idempotency_key,sourceHash,status:'processing'}});
    const workflow=tx.gatheringWorkflow?await tx.gatheringWorkflow.findUnique({where:{gatheringId:id}}):null;
    const state=workflow?.state as {selections?:Record<string,{plan_ids:string[];note:string}>;confirmations?:Record<string,{decision:string;note:string}>;coordination_note?:string}|undefined;
    const coordination=state?{choices:Object.values(state.selections??{}).map(s=>({plan_ids:s.plan_ids,note:s.note})),feedback:Object.values(state.confirmations??{}).filter(c=>c.decision==='reject').map(c=>c.note),organizer_note:state.coordination_note||''}:undefined;
    const modelSource={...gatheringModelSource(details,rows,row.kind),...(coordination?{coordination}:{})};
    return {existing:false as const,id:generation.id,source:modelSource,details,sourceHash,workflowVersion:workflow?.version??0};
  });
  if(reserved.existing)return reserved.snapshot;
  try{
    const source=await enrichGatheringSource(actor,reserved.source,reserved.details);
    const itinerary=reviewGatheringItinerary(await provider.generate(actor,source),source);
    return await mutation(async tx=>{
      const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);
      assertGatheringEditable(row);
      const generation=await tx.gatheringGeneration.findUnique({where:{id:reserved.id}});
      const source=gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),await readGatheringRows(tx,id),row.kind);
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

/**
 * Build a new, reviewable generation from feedback on one immutable
 * published arrangement. This deliberately does not publish or mutate the
 * published snapshot; the organizer must inspect it and call publish again.
 */
export async function adjustGatheringItinerary(id:string,actor:string,raw:unknown,provider:Pick<typeof gatheringAI,'adjust'>=gatheringAI){
  const parsed=gatheringAdjustmentSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'请刷新当前发布安排后再生成调整草案');
  const input=parsed.data;await consumeRequirementBudget(actor);
  const reserved=await mutation(async tx=>{
    const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);
    if(row.finalizedAt)throw new ServiceError('INVALID_INPUT',409,'这次出游已经定案，不能再调整');
    const previous=await tx.gatheringGeneration.findUnique({where:{gatheringId_idempotencyKey:{gatheringId:id,idempotencyKey:input.idempotency_key}}});
    if(previous){if(previous.sourceHash!==input.expected_source)throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'原调整请求不能用于新的内容');return {existing:true as const,snapshot:await gatheringSnapshotTx(tx,id,actor)};}
    const details=gatheringDetailsSchema.parse(row.details),rows=await readGatheringRows(tx,id),sourceHash=gatheringSourceFingerprint(details,rows,row.kind);
    if(sourceHash!==input.expected_source)throw gatheringConflict();
    const arrangement=await tx.gatheringArrangementVersion.findFirst({where:{gatheringId:id,version:input.base_arrangement_version}});
    if(!arrangement)throw new ServiceError('NOT_FOUND',404,'未找到要调整的已发布安排');
    const plan=gatheringItinerarySchema.shape.plans.element.safeParse(arrangement.snapshot);if(!plan.success)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'已发布安排暂时无法核对');
    const feedbackModel=tx.gatheringFeedback as {findMany?:Function}|undefined;
    const feedback=feedbackModel&&typeof feedbackModel.findMany==='function'?await feedbackModel.findMany({where:{gatheringId:id,arrangementId:arrangement.id,status:'open'},orderBy:{createdAt:'asc'},take:100,select:{body:true,authorUserId:true}}):[];
    if(!feedback.length)throw new ServiceError('INVALID_INPUT',409,'暂时没有待处理反馈，请先收集成员意见');
    const generation=await tx.gatheringGeneration.create({data:{gatheringId:id,creatorUserId:actor,idempotencyKey:input.idempotency_key,sourceHash,status:'processing',baseArrangementId:arrangement.id,adjustmentHash:createAdjustmentHash(arrangement.id,feedback)}});
    const workflow=tx.gatheringWorkflow?await tx.gatheringWorkflow.findUnique({where:{gatheringId:id}}):null;
    return {existing:false as const,id:generation.id,sourceHash,workflowVersion:workflow?.version??0,source:gatheringModelSource(details,rows,row.kind),details,basePlan:plan.data,feedback:feedback.map((value:{body:string})=>({body:value.body,author_ref:'f'+String(feedback.indexOf(value)+1)}))};
  });
  if(reserved.existing)return reserved.snapshot;
  try{
    const source=await enrichGatheringSource(actor,reserved.source,reserved.details);
    const itinerary=reviewGatheringItinerary(await provider.adjust(actor,{source,base_plan:reserved.basePlan,feedback:reserved.feedback}),source);
    return await mutation(async tx=>{
      const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);if(row.finalizedAt)throw new ServiceError('INVALID_INPUT',409,'这次出游已经定案，不能再调整');
      const generation=await tx.gatheringGeneration.findUnique({where:{id:reserved.id}}),source=gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),await readGatheringRows(tx,id),row.kind),workflow=tx.gatheringWorkflow?await tx.gatheringWorkflow.findUnique({where:{gatheringId:id}}):null;
      if(!generation||generation.status!=='processing'||source!==reserved.sourceHash||(workflow?.version??0)!==reserved.workflowVersion)throw gatheringConflict();
      await tx.gatheringGeneration.update({where:{id:reserved.id},data:{status:'ready',result:gatheringJson(itinerary),error:null}});
      await tx.gathering.update({where:{id},data:{currentGenerationId:reserved.id}});
      if(tx.gatheringWorkflow)await beginGatheringWorkflow(tx,row,reserved.id,reserved.sourceHash);
      return gatheringSnapshotTx(tx,id,actor);
    });
  }catch(e){
    await mutation(async tx=>{await tx.gatheringGeneration.updateMany({where:{id:reserved.id,status:'processing'},data:{status:'failed',error:'调整草案未完成，已发布安排保留，请稍后重试'}});}).catch(()=>{});
    throw e instanceof ServiceError?e:new ServiceError('UPSTREAM_UNAVAILABLE',503,'AI 调整未完成，已发布安排保留，请稍后重试');
  }
}

function createAdjustmentHash(arrangementId:string,feedback:Array<{body:string;authorUserId:string}>){
  return createHash('sha256').update(JSON.stringify({arrangementId,feedback})).digest('hex');
}

async function enrichGatheringSource(actor:string,source:ReturnType<typeof gatheringModelSource>,details:ReturnType<typeof gatheringDetailsSchema.parse>){
  if(!process.env.AMAP_WEB_SERVICE_KEY)return source;
  const routeEvidence=[] as Array<{from:string;to:string;distance_m:number;duration_seconds:number;source:{provider:'amap';source_api:string;checked_at:string};basis:'provider_estimate';includes_indoor_transfer:false;includes_activity_buffer:false;booking:'unknown'}>;
  for(const pair of gatheringVenuePairs(details)){
    try{const result=await amapProvider.walk(actor,{origin:pair.from.location,destination:pair.to.location});if(result.route)routeEvidence.push({from:pair.from.label,to:pair.to.label,...result.route,source:result.source});}
    catch(error){if(!(error instanceof AmapError))throw error;}
  }
  return routeEvidence.length?{...source,route_evidence:routeEvidence}:source;
}

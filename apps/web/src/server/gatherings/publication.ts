import { randomUUID, createHash } from 'node:crypto';
import {
  gatheringAttendanceSchema, gatheringFeedbackSchema, gatheringPublishSchema,
  gatheringItinerarySchema, gatheringDetailsSchema, type GatheringSnapshot,
  privateGatheringInputText,
} from '@weevibe/contracts';
import { Prisma } from '@prisma/client';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { consumeRequirementBudget } from '../requirements/service';
import { gatheringJson, gatheringSnapshotTx, lockGathering, readGatheringRows, assertGatheringOwner } from './service';
import { gatheringSourceFingerprint } from './privacy';
import { enqueueGatheringLifecycle } from './notifications';

const write = <T>(fn:(tx:Prisma.TransactionClient)=>Promise<T>) => withDb(db => db.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 10000 }));
const invalid = (message:string) => new ServiceError('INVALID_INPUT', 400, message);
const conflict = () => new ServiceError('VERSION_CONFLICT', 409, '当前安排已更新，请刷新后重新核对');
const verifyVersion = (raw:unknown) => { const parsed=gatheringPublishSchema.safeParse(raw); if(!parsed.success) throw invalid('请重新核对当前候选方案'); return parsed.data; };

export async function publishGatheringArrangement(id:string, actor:string, raw:unknown):Promise<GatheringSnapshot>{
  const input=verifyVersion(raw); await consumeRequirementBudget(actor);
  return write(async tx=>{
    const row=await lockGathering(tx,id); assertGatheringOwner(row,actor);
    if(row.finalizedAt)throw invalid('这次出游已经定案，不能再发布候选方案');
    const existing=await tx.gatheringArrangementVersion.findUnique({where:{gatheringId_idempotencyKey:{gatheringId:id,idempotencyKey:input.idempotency_key}}});
    if(existing){if(existing.generationId!==input.generation_id||existing.planId!==input.plan_id)throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'原发布请求不能用于另一套方案'); return gatheringSnapshotTx(tx,id,actor);}
    const current=await tx.gatheringArrangementVersion.findFirst({where:{gatheringId:id},orderBy:{version:'desc'}});
    if((current?.version??0)!==input.expected_published_version)throw conflict();
    const generation=await tx.gatheringGeneration.findUnique({where:{id:input.generation_id}});
    if(!generation||generation.gatheringId!==id||generation.status!=='ready')throw invalid('候选方案尚未准备好，请重新生成');
    const source=gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),await readGatheringRows(tx,id),row.kind);
    if(source!==input.expected_source||generation.sourceHash!==source)throw conflict();
    const itinerary=gatheringItinerarySchema.safeParse(generation.result); if(!itinerary.success)throw invalid('候选方案内容无法核对');
    const plan=itinerary.data.plans.find(value=>value.id===input.plan_id); if(!plan)throw invalid('未找到要发布的方案');
    const arrangement=await tx.gatheringArrangementVersion.create({data:{id:randomUUID(),gatheringId:id,version:(current?.version??0)+1,generationId:generation.id,planId:plan.id,sourceHash:source,snapshot:gatheringJson(plan),publishedByUserId:actor,idempotencyKey:input.idempotency_key}});
    // A published adjustment consumes only feedback attached to the base
    // arrangement used by that generation. Other open feedback remains open
    // for the organizer to review against its own version.
    if(generation.baseArrangementId&&tx.gatheringFeedback)await tx.gatheringFeedback.updateMany({where:{gatheringId:id,arrangementId:generation.baseArrangementId,status:'open'},data:{status:'applied'}});
    await tx.gathering.update({where:{id},data:{currentGenerationId:generation.id,revision:{increment:1},updatedAt:new Date()}});
    await enqueueGatheringLifecycle(tx,row,actor,'arrangement_published');
    return gatheringSnapshotTx(tx,id,actor);
  });
}

async function arrangementFor(tx:Prisma.TransactionClient,id:string,version:number){
  const arrangement=await tx.gatheringArrangementVersion.findFirst({where:{gatheringId:id,version}});
  if(!arrangement)throw new ServiceError('NOT_FOUND',404,'未找到这版已发布安排'); return arrangement;
}
async function assertMember(tx:Prisma.TransactionClient,id:string,actor:string){
  const member=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:id,userId:actor}}});
  if(!member||member.responseVersion<1)throw new ServiceError('FORBIDDEN',403,'请先提交本人想法'); return member;
}

export async function saveGatheringAttendance(id:string,actor:string,raw:unknown):Promise<GatheringSnapshot>{
  const parsed=gatheringAttendanceSchema.safeParse(raw); if(!parsed.success)throw invalid('请选择参加意向'); const input=parsed.data; await consumeRequirementBudget(actor);
  return write(async tx=>{ const row=await lockGathering(tx,id); const member=await assertMember(tx,id,actor); const arrangement=await arrangementFor(tx,id,input.arrangement_version);
    if(row.finalizedAt&&row.finalGenerationId!==arrangement.generationId)throw conflict();
    const existing=await tx.gatheringAttendance.findUnique({where:{gatheringId_memberUserId_idempotencyKey:{gatheringId:id,memberUserId:actor,idempotencyKey:input.idempotency_key}}});
    if(existing)return gatheringSnapshotTx(tx,id,actor);
    const current=await tx.gatheringAttendance.findUnique({where:{gatheringId_memberUserId_arrangementId:{gatheringId:id,memberUserId:actor,arrangementId:arrangement.id}}});
    if((current?.responseVersion??0)!==input.expected_version)throw conflict();
    if(current?.decision===input.decision)return gatheringSnapshotTx(tx,id,actor);
    await tx.gatheringAttendance.upsert({where:{gatheringId_memberUserId_arrangementId:{gatheringId:id,memberUserId:actor,arrangementId:arrangement.id}},create:{id:randomUUID(),gatheringId:id,memberUserId:actor,arrangementId:arrangement.id,decision:input.decision,idempotencyKey:input.idempotency_key},update:{decision:input.decision,responseVersion:{increment:1},idempotencyKey:input.idempotency_key}});
    await enqueueGatheringLifecycle(tx,row,actor,'attendance_updated');
    void member; return gatheringSnapshotTx(tx,id,actor);
  });
}

export async function addGatheringFeedback(id:string,actor:string,raw:unknown):Promise<GatheringSnapshot>{
  const parsed=gatheringFeedbackSchema.safeParse(raw); if(!parsed.success)throw invalid('请填写反馈内容'); const input=parsed.data; await consumeRequirementBudget(actor);
  if(privateGatheringInputText.test(input.body))throw invalid('个人预算和出发地点请保留在私人填写中，反馈内容会提供给局头和调整助手');
  return write(async tx=>{const row=await lockGathering(tx,id); await assertMember(tx,id,actor); const arrangement=await arrangementFor(tx,id,input.arrangement_version);
    const existing=await tx.gatheringFeedback.findUnique({where:{gatheringId_authorUserId_idempotencyKey:{gatheringId:id,authorUserId:actor,idempotencyKey:input.idempotency_key}}});
    if(existing)return gatheringSnapshotTx(tx,id,actor);
    await tx.gatheringFeedback.create({data:{id:randomUUID(),gatheringId:id,authorUserId:actor,arrangementId:arrangement.id,body:input.body,status:'open',idempotencyKey:input.idempotency_key}});
    await tx.gathering.update({where:{id},data:{updatedAt:new Date()}});
    await enqueueGatheringLifecycle(tx,row,actor,'feedback_added');
    return gatheringSnapshotTx(tx,id,actor);
  });
}

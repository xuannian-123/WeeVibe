import { createHash,randomInt } from 'node:crypto';
import { Prisma, type Gathering } from '@prisma/client';
import {
  gatheringCreateSchema, gatheringMemberSaveSchema, gatheringDetailsSchema, gatheringDetailsUpdateSchema, gatheringIntakeSchema,gatheringFinalizeSchema,
  normalizeGatheringCertainty,gatheringQuestions,gatheringItinerarySchema, gatheringPublicBlocks, gatheringOwnBlocks, gatheringVisibleDetails, emptyGatheringIntake,
  gatheringPublicIntakeSchema,gatheringAnimalIdSchema,gatheringAnimalIds,gatheringAvatarKeySchema,
  type GatheringDetails, type GatheringIntake, type GatheringSnapshot, type GatheringSummary,
} from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { mutation } from '../activities/mutation';
import type { Tx } from '../activities/state';
import { consumeRequirementBudget } from '../requirements/service';
import { gatheringSourceFingerprint, gatheringTeamStatistics, type PublicGatheringRow } from './privacy';
import {enqueueGatheringSubmission} from './notifications';
import {gatheringWorkflowView} from './workflow';
import {allocateGatheringAvatar} from './avatars';

export const gatheringJson=(value:unknown)=>JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hash=(value:unknown)=>{
  const canonical=JSON.parse(JSON.stringify(value));
  // Missing aliases in legacy persisted requests parse as empty. Preserve those
  // original hashes so an already successful request can still be acknowledged.
  if(canonical.intake?.public?.activity_nickname==='')delete canonical.intake.public.activity_nickname;
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
};
const randomAnimal=()=>gatheringAnimalIds[randomInt(gatheringAnimalIds.length)];
const invalid=(message='填写内容不完整，请检查后重试')=>new ServiceError('INVALID_INPUT',400,message);
export const gatheringConflict=()=>new ServiceError('VERSION_CONFLICT',409,'内容已更新，请刷新核对；当前输入已保留');
export async function lockGathering(tx:Tx,id:string){
  await tx.$queryRaw`SELECT "id" FROM "Gathering" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row=await tx.gathering.findUnique({where:{id}});
  if(!row)throw new ServiceError('NOT_FOUND',404,'未找到这次筹备');
  return row;
}
export function assertGatheringOwner(row:Gathering,actor:string){if(row.ownerUserId!==actor)throw new ServiceError('FORBIDDEN',403,'仅局头可以执行这个操作');}
export function assertGatheringEditable(row:Gathering){if(row.finalizedAt)throw new ServiceError('INVALID_INPUT',409,'这次出游已定案，不能再修改或加入');}
export async function readGatheringRows(tx:Tx,id:string):Promise<Array<PublicGatheringRow&{animalId:string;avatarKey:string|null}>>{
  // Deliberately exclude every other member's privateIntake from all shared reads.
  const rows=await tx.gatheringMember.findMany({where:{gatheringId:id},orderBy:{userId:'asc'},take:501,
    select:{userId:true,publicIntake:true,answers:true,responseVersion:true,animalId:true,avatarKey:true}});
  if(rows.length>500)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'当前筹备超出完整读取上限');
  return rows;
}
function normalizeIntake(raw:unknown,details:GatheringDetails,validateRequired:boolean,kind:string):GatheringIntake{
  const parsed=gatheringIntakeSchema.safeParse(raw);if(!parsed.success)throw invalid('请检查预算、填写内容和确定项');
  const intake=parsed.data;
  if(!intake.public.activity_nickname)throw invalid('请先填写这次活动使用的昵称');
  try{gatheringOwnBlocks(intake);}catch(e){throw invalid(e instanceof Error?e.message:undefined);}
  const answers=intake.answers,questions=kind==='team'?gatheringQuestions(details):details.questions;
  if(new Set(answers.map(a=>a.question_id)).size!==answers.length||answers.some(a=>!questions.some(q=>q.id===a.question_id)))throw invalid('问题已变化，请刷新后重新填写');
  for(const q of questions){
    const a=answers.find(a=>a.question_id===q.id),chosen=a?.option_ids??[];
    if(new Set(chosen).size!==chosen.length||chosen.some(id=>!q.options.some(o=>o.id===id))||q.type==='single'&&chosen.length+Number(!!a?.other)>1||q.type==='text'&&(chosen.length||a?.other)||q.type!=='text'&&a?.text)throw invalid('请检查问题的选项和其他回答');
    if(validateRequired&&q.required&&!(q.type==='text'?a?.text:chosen.length||a?.other))throw invalid(`请填写必答题：${q.title}`);
  }
  return normalizeGatheringCertainty(intake);
}
function assertDetails(details:GatheringDetails,kind:string,now:Date){
  if(!details.date)throw invalid('请先选择活动日期');
  if(kind==='team'&&(!details.deadline_at||Date.parse(details.deadline_at)<=now.getTime()))throw invalid('请设置未来的问卷填写截止时间');
}
const mayRespond=(row:Gathering,details:GatheringDetails,now:Date)=>!row.finalizedAt&&(row.kind==='friend'||!!details.deadline_at&&now.getTime()<Date.parse(details.deadline_at));
function summary(row:Gathering,actor:string,details:GatheringDetails,count:number,responded:boolean):GatheringSummary{
  const visible=gatheringVisibleDetails(details,row.kind as 'friend'|'team',row.ownerUserId===actor);
  return {id:row.id,kind:row.kind as 'friend'|'team',title:visible.title||(row.kind==='friend'?'朋友出游':'一起团建'),date:visible.date,stage:row.currentGenerationId?'arranged':'collecting',is_owner:row.ownerUserId===actor,has_responded:responded,member_count:count,updated_at:row.updatedAt.toISOString()};
}
function friendIdentities(rows:{userId:string;publicIntake:unknown;animalId:string;avatarKey?:string|null}[]){
  const people=new Map(rows.map(row=>{
    const input=gatheringPublicIntakeSchema.safeParse(row.publicIntake),animal=gatheringAnimalIdSchema.safeParse(row.animalId);
    if(!input.success||!animal.success||row.avatarKey&&!gatheringAvatarKeySchema.safeParse(row.avatarKey).success)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'活动昵称与动物头像暂时无法核对');
    return [row.userId,{user_id:row.userId,nickname:input.data.activity_nickname||'还未设置活动昵称',avatar:null,animal_id:animal.data,...(row.avatarKey?{avatar_key:row.avatarKey}:{})}] as const;
  }));
  return(userId:string)=>{const person=people.get(userId);if(!person)throw new ServiceError('UPSTREAM_UNAVAILABLE',503,'未找到活动内身份');return person;};
}
export async function gatheringSnapshotTx(tx:Tx,id:string,actor:string):Promise<GatheringSnapshot>{
  const row=await tx.gathering.findUnique({where:{id}});if(!row)throw new ServiceError('NOT_FOUND',404,'未找到这次筹备');
  const details=gatheringDetailsSchema.parse(row.details),isOwner=row.ownerUserId===actor;
  // The only full private row lookup is bound to the authenticated actor.
  const own=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:id,userId:actor}}});
  const rows=await readGatheringRows(tx,id),isMember=!!own;
  const page=row.kind==='friend'&&isMember?rows.slice(0,10):[];
  const person=friendIdentities(rows);
  const ownIntake=own?gatheringIntakeSchema.parse({public:own.publicIntake,private:own.privateIntake,answers:own.answers}):null;
  const source=gatheringSourceFingerprint(details,rows,row.kind);
  const finalChoice=row.finalGenerationId&&row.finalPlanId&&row.finalizedAt?{generation_id:row.finalGenerationId,plan_id:row.finalPlanId,finalized_at:row.finalizedAt.toISOString()}:null;
  const currentId=row.finalGenerationId||row.currentGenerationId;
  const current=currentId&&(row.kind==='team'?isOwner:isMember||finalChoice)?await tx.gatheringGeneration.findFirst({where:{id:currentId,gatheringId:id,status:'ready'},select:{id:true,result:true,createdAt:true,sourceHash:true}}):null;
  const latest=isOwner?await tx.gatheringGeneration.findFirst({where:{gatheringId:id},orderBy:{createdAt:'desc'},select:{id:true,status:true,error:true,createdAt:true}}):null;
  const workflow=await gatheringWorkflowView(tx,row,actor,rows,person);
  const expired=latest?.status==='processing'&&Date.now()-latest.createdAt.getTime()>90000;
  return {gathering:{...summary(row,actor,details,rows.length,!!own&&own.responseVersion>0),details:gatheringVisibleDetails(details,row.kind as 'friend'|'team',isOwner),owner:person(row.ownerUserId),revision:row.revision},
    viewer:{is_owner:isOwner,is_member:isMember,can_respond:mayRespond(row,details,new Date()),can_generate:isOwner&&!row.finalizedAt},
    own:own&&ownIntake?{version:own.responseVersion,intake:ownIntake,blocks:gatheringOwnBlocks(ownIntake)}:null,
    members:row.kind==='friend'&&isMember?page.map(r=>({person:person(r.userId),blocks:r.responseVersion>0?gatheringPublicBlocks(r.publicIntake):[],submitted:r.responseVersion>0})):null,
    next_member_cursor:page.length===10&&rows.length>10?page.at(-1)!.userId:null,
    // Team statistics never enter the participant / invitation payload.
    stats:row.kind==='team'&&isOwner?gatheringTeamStatistics(details,rows):null,
    source_fingerprint:isOwner?source:null,
    itinerary:current?{...gatheringItinerarySchema.parse(current.result),generation_id:current.id,generated_at:current.createdAt.toISOString(),stale:current.sourceHash!==source}:null,
    ...(workflow?{workflow}:{}),
    final_choice:finalChoice,
    generation:latest?{id:latest.id,status:expired?'failed':latest.status as 'processing'|'ready'|'failed',error:expired?'生成未完成，可以重新核对后重试':latest.error}:null,server_time:new Date().toISOString()};
}
export function getGathering(id:string,actor:string){return withDb(db=>db.$transaction(tx=>gatheringSnapshotTx(tx,id,actor),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}));}
export function listGatherings(actor:string){return withDb(db=>db.$transaction(async tx=>{
  const rows=await tx.gathering.findMany({where:{members:{some:{userId:actor}}},orderBy:{updatedAt:'desc'},take:100,include:{_count:{select:{members:true}},members:{where:{userId:actor},select:{responseVersion:true}}}});
  return {gatherings:rows.map(row=>summary(row,actor,gatheringDetailsSchema.parse(row.details),row._count.members,(row.members[0]?.responseVersion??0)>0))};
},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}));}
export async function createGathering(actor:string,raw:unknown){
  const result=gatheringCreateSchema.safeParse(raw);if(!result.success)throw invalid();const input=result.data;
  const fingerprint=hash(input);
  await consumeRequirementBudget(actor);
  return mutation(async tx=>{
    const previous=await tx.gathering.findUnique({where:{ownerUserId_creationKey:{ownerUserId:actor,creationKey:input.idempotency_key}}});
    if(previous){if(previous.creationHash!==fingerprint)throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'原请求已用于其他筹备内容');return gatheringSnapshotTx(tx,previous.id,actor);}
    const intake=normalizeIntake(input.intake,input.details,false,input.kind);
    assertDetails(input.details,input.kind,new Date());
    const submitted=input.kind==='friend';
    const row=await tx.gathering.create({data:{ownerUserId:actor,kind:input.kind,details:gatheringJson(input.details),creationKey:input.idempotency_key,creationHash:fingerprint,submissionSequence:submitted?1:0}});
    await tx.gatheringMember.create({data:{gatheringId:row.id,userId:actor,animalId:randomAnimal(),avatarKey:await allocateGatheringAvatar(tx,row.id),publicIntake:gatheringJson(intake.public),privateIntake:gatheringJson(intake.private),answers:gatheringJson(intake.answers),responseVersion:submitted?1:0,firstSubmissionSequence:submitted?1:null}});
    if(submitted)await enqueueGatheringSubmission(tx,row,actor,1,1);
    return gatheringSnapshotTx(tx,row.id,actor);
  });
}
export async function joinGathering(id:string,actor:string){
  await consumeRequirementBudget(actor);
  return mutation(async tx=>{
    const row=await lockGathering(tx,id),details=gatheringDetailsSchema.parse(row.details);
    assertGatheringEditable(row);
    const previous=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:id,userId:actor}}});
    if(!previous){
      if(!mayRespond(row,details,new Date()))throw new ServiceError('INVALID_INPUT',409,'问卷已截止，暂不接受新的填写');
      const count=await tx.gatheringMember.count({where:{gatheringId:id}});
      if(count>=500||details.capacity!==null&&count>=details.capacity)throw new ServiceError('CAPACITY_FULL',409,'当前筹备已达到填写人数上限');
      const empty=emptyGatheringIntake();
      await tx.gatheringMember.create({data:{gatheringId:id,userId:actor,animalId:randomAnimal(),avatarKey:await allocateGatheringAvatar(tx,id),publicIntake:gatheringJson(empty.public),privateIntake:gatheringJson(empty.private),answers:gatheringJson([])}});
    }
    return gatheringSnapshotTx(tx,id,actor);
  });
}
export async function saveGatheringIntake(id:string,actor:string,raw:unknown){
  const parsed=gatheringMemberSaveSchema.safeParse(raw);if(!parsed.success)throw invalid();const input=parsed.data,fingerprint=hash(input);
  await consumeRequirementBudget(actor);
  return mutation(async tx=>{
    const row=await lockGathering(tx,id),details=gatheringDetailsSchema.parse(row.details);
    const own=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:id,userId:actor}}});
    if(!own&&!input.join_if_needed)throw new ServiceError('FORBIDDEN',403,'请先确认参与这次筹备');
    if(own?.lastWriteKey===input.idempotency_key){if(own.lastWriteHash!==fingerprint)throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'此保存请求已用于其他内容');return gatheringSnapshotTx(tx,id,actor);}
    assertGatheringEditable(row);
    if(row.revision!==input.expected_revision)throw gatheringConflict();
    if((own?.responseVersion??0)!==input.expected_version)throw gatheringConflict();
    if(!mayRespond(row,details,new Date()))throw new ServiceError('INVALID_INPUT',409,'已到填写截止，原输入保留');
    const intake=normalizeIntake(input.intake,details,row.kind==='team',row.kind);
    const sequence=row.submissionSequence+1,version=(own?.responseVersion??0)+1;
    const response={publicIntake:gatheringJson(intake.public),privateIntake:gatheringJson(intake.private),answers:gatheringJson(intake.answers),lastWriteKey:input.idempotency_key,lastWriteHash:fingerprint,firstSubmissionSequence:own?.firstSubmissionSequence??sequence};
    if(own)await tx.gatheringMember.update({where:{gatheringId_userId:{gatheringId:id,userId:actor}},data:{...response,responseVersion:{increment:1}}});
    else{
      const count=await tx.gatheringMember.count({where:{gatheringId:id}});
      if(count>=500||details.capacity!==null&&count>=details.capacity)throw new ServiceError('CAPACITY_FULL',409,'当前筹备已达到填写人数上限');
      await tx.gatheringMember.create({data:{gatheringId:id,userId:actor,animalId:randomAnimal(),avatarKey:await allocateGatheringAvatar(tx,id),...response,responseVersion:1}});
    }
    await tx.gathering.update({where:{id},data:{updatedAt:new Date(),submissionSequence:{increment:1}}});
    await enqueueGatheringSubmission(tx,row,actor,version,sequence);
    return gatheringSnapshotTx(tx,id,actor);
  });
}
export async function updateGatheringDetails(id:string,actor:string,raw:unknown){
  const request=gatheringDetailsUpdateSchema.safeParse(raw);if(!request.success)throw invalid();
  const input=request.data;
  await consumeRequirementBudget(actor);
  return mutation(async tx=>{
    const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);assertGatheringEditable(row);if(row.revision!==input.expected_revision)throw gatheringConflict();
    const details=input.details,old=gatheringDetailsSchema.parse(row.details);assertDetails(details,row.kind,new Date());
    if(JSON.stringify(row.kind==='team'?gatheringQuestions(details):details.questions)!==JSON.stringify(row.kind==='team'?gatheringQuestions(old):old.questions)&&await tx.gatheringMember.count({where:{gatheringId:id,responseVersion:{gt:0}}}))throw invalid('已有人填写，题目不能再修改；可以补充其他安排');
    await tx.gathering.update({where:{id},data:{details:gatheringJson(details),revision:{increment:1}}});
    return gatheringSnapshotTx(tx,id,actor);
  });
}
export async function finalizeGathering(id:string,actor:string,raw:unknown){
  const parsed=gatheringFinalizeSchema.safeParse(raw);if(!parsed.success)throw invalid('请选择当前方案并重新核对');
  const input=parsed.data;await consumeRequirementBudget(actor);
  return mutation(async tx=>{
    const row=await lockGathering(tx,id);assertGatheringOwner(row,actor);
    if(row.kind!=='friend')throw new ServiceError('INVALID_INPUT',409,'当前仅朋友出游支持选定方案');
    if(row.finalizedAt){
      if(row.finalGenerationId===input.generation_id&&row.finalPlanId===input.plan_id)return gatheringSnapshotTx(tx,id,actor);
      throw new ServiceError('INVALID_INPUT',409,'已选定最终方案，不能改选');
    }
    if(tx.gatheringWorkflow)throw new ServiceError('INVALID_INPUT',409,'请通过方案协调确认完成；旧推荐请重新生成，不能跳过成员确认');
    const generation=await tx.gatheringGeneration.findUnique({where:{id:input.generation_id}});
    if(!generation||generation.gatheringId!==id||generation.status!=='ready')throw new ServiceError('INVALID_INPUT',409,'该方案尚未完成或不属于这次出游');
    const source=gatheringSourceFingerprint(gatheringDetailsSchema.parse(row.details),await readGatheringRows(tx,id));
    if(source!==input.expected_source||generation.sourceHash!==source)throw gatheringConflict();
    const itinerary=gatheringItinerarySchema.safeParse(generation.result);
    if(!itinerary.success||!itinerary.data.plans.some(plan=>plan.id===input.plan_id))throw invalid('未找到可选定的方案');
    await tx.gathering.update({where:{id},data:{currentGenerationId:generation.id,finalGenerationId:generation.id,finalPlanId:input.plan_id,finalizedAt:new Date(),revision:{increment:1}}});
    return gatheringSnapshotTx(tx,id,actor);
  });
}
export function getGatheringMembers(id:string,actor:string,cursor:string|undefined){return withDb(db=>db.$transaction(async tx=>{
  const row=await tx.gathering.findUnique({where:{id}}),member=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:id,userId:actor}},select:{userId:true}});
  if(!row||!member||row.kind!=='friend')throw new ServiceError('FORBIDDEN',403,'当前不能查看成员内容');
  const rows=await tx.gatheringMember.findMany({where:{gatheringId:id,...(cursor?{userId:{gt:cursor}}:{})},orderBy:{userId:'asc'},take:11,select:{userId:true,publicIntake:true,responseVersion:true,animalId:true,avatarKey:true}});
  const page=rows.slice(0,10),person=friendIdentities(page);
  return {members:page.map(r=>({person:person(r.userId),blocks:r.responseVersion>0?gatheringPublicBlocks(r.publicIntake):[],submitted:r.responseVersion>0})),next_cursor:rows.length>10?page.at(-1)!.userId:null};
},{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}));}

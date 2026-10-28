import { Prisma, type ManagementHandover } from '@prisma/client';
import { activityIdSchema, createHandoverInputSchema, handoverCommandSchema, handoverStateSchema, type CreateHandoverInput, type HandoverCommand, type HandoverCandidate, type HandoverOffer, type HandoverState } from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { loadActivity, lockActivity, type Tx } from './state';
import { activitySnapshot } from './snapshot';
import { checkManager, checkNotCancelled, checkRevision, requestFingerprint } from './rules';
import { replay, remember } from './idempotency';

const scopeNotice='接任者必须仍参加至少一个未取消、尚未结束的有效环节；待重新接受安排仍保留参加资格。交接不代替安排接受，不受报名截止限制，无自动过期。交接不改变参加、安排、费用或预订。';
const memberSelect={userId:true,displayName:true,segmentId:true,status:true,acceptedPlanRevision:true,segment:{select:{id:true,activityId:true,planRevision:true,cancelledAt:true,startsAt:true,endsAt:true}}} satisfies Prisma.ParticipationSelect;
type Member=Prisma.ParticipationGetPayload<{select:typeof memberSelect}>;
type Activity=Awaited<ReturnType<typeof loadActivity>>;
const maxMembers=2000;
function ids(activityId:string,actorId:string,handoverId?:string){
 const a=activityIdSchema.safeParse(activityId),u=activityIdSchema.safeParse(actorId),h=handoverId===undefined?undefined:activityIdSchema.safeParse(handoverId);
 if(!a.success||!u.success||(h&&!h.success))throw new ServiceError('INVALID_INPUT',400,'活动或交接标识不正确');
 return{id:a.data,actor:u.data,offerId:h?.success?h.data:undefined};
}
function conflict():never{throw new ServiceError('CONCURRENT_MODIFICATION',409,'交接状态正在变化，请刷新后重试');}
function requireScope():never{throw new ServiceError('HANDOVER_SCOPE_UNAVAILABLE',409,'接任人须仍参加至少一个未取消、尚未结束的有效环节；当前资格不足，待接邀请仍保留，可拒绝或撤回');}
async function schemaReady<T>(action:()=>Promise<T>):Promise<T>{try{return await action();}catch(error){
 // Only this new schema's absent table/column is configuration failure. Never
 // emit raw adapter details or silently substitute an in-memory invitation.
 if(error instanceof Prisma.PrismaClientKnownRequestError && ['P2021','P2022'].includes(error.code) && JSON.stringify(error.meta??{}).includes('ManagementHandover'))throw new ServiceError('NOT_CONFIGURED',503,'管理交接数据库版本尚未配置，请使用匹配迁移与后端');
 throw error;
}}
/** Must be called under the same Activity parent lock/transaction as cancellation.
 * The additive table is required; absence cannot silently leave a pending grant.
 */
export function invalidatePendingHandovers(tx:Tx,activityId:string,now:Date){
 return schemaReady(()=>tx.managementHandover.updateMany({where:{activityId,status:'pending'},data:{status:'invalidated',resolvedAt:now}}));
}
async function members(tx:Tx,activityId:string,userId?:string):Promise<Member[]>{
 const rows=await tx.participation.findMany({where:{activityId,status:'joined',...(userId?{userId}:{})},select:memberSelect,orderBy:[{userId:'asc'},{segmentId:'asc'}],take:maxMembers+1});
 if(rows.length>maxMembers)throw new ServiceError('NOT_CONFIGURED',503,'当前交接名单超过完整读取范围，未截取成员或发出邀请');
 return rows;
}
function eligible(row:Member,activityId:string,now:Date){const s=row.segment;return row.status==='joined'&&s.activityId===activityId&&s.id===row.segmentId&&!s.cancelledAt&&Number.isFinite(s.startsAt.getTime())&&Number.isFinite(s.endsAt.getTime())&&s.endsAt>s.startsAt&&now<s.endsAt;}
function candidates(rows:Member[],activity:Activity,now:Date):HandoverCandidate[]{
 const map=new Map<string,HandoverCandidate>();
 for(const row of rows){if(row.userId===activity.currentManagerId||!eligible(row,activity.id,now))continue;
  let candidate=map.get(row.userId);if(!candidate){candidate={user_id:row.userId,display_name:typeof row.displayName==='string'?row.displayName.slice(0,40):null,segment_ids:[]};map.set(row.userId,candidate);}
  if(!candidate.segment_ids.includes(row.segmentId))candidate.segment_ids.push(row.segmentId);
 }
 return [...map.values()];
}
function readable(offer:ManagementHandover,activity:Activity,actor:string){if(offer.fromUserId!==actor&&offer.toUserId!==actor&&activity.currentManagerId!==actor)throw new ServiceError('NOT_FOUND',404,'未找到可查看的管理交接');}
function view(offer:ManagementHandover,activity:Activity,actor:string,rows:Member[],now:Date):HandoverOffer{
 const cancelled=offer.status==='pending'&&!!activity.cancelledAt;
 const currentSource=activity.currentManagerId===offer.fromUserId&&activity.managementRevision===offer.fromManagementRevision;
 const pending=offer.status==='pending'&&!cancelled&&currentSource;
 const qualified=rows.some(row=>row.userId===offer.toUserId&&eligible(row,activity.id,now));
 return{handover_id:offer.id,activity_id:offer.activityId,from_user_id:offer.fromUserId,to_user_id:offer.toUserId,from_management_revision:offer.fromManagementRevision,
  status:cancelled?'invalidated':offer.status,created_at:offer.createdAt.toISOString(),resolved_at:cancelled?activity.cancelledAt!.toISOString():offer.resolvedAt?.toISOString()??null,
  can_accept:pending&&offer.toUserId===actor&&qualified,can_reject:pending&&offer.toUserId===actor,can_withdraw:pending&&activity.currentManagerId===actor&&offer.fromUserId===actor,
  blocked_reason:cancelled||offer.status==='invalidated'?'activity_cancelled':offer.status!=='pending'?'resolved':!currentSource?'management_changed':!qualified?'recipient_scope_unavailable':null};
}
async function state(tx:Tx,id:string,actor:string,offerId?:string):Promise<HandoverState>{
 const activity=await loadActivity(tx,id),isManager=activity.currentManagerId===actor;
 const selected=offerId?await tx.managementHandover.findUnique({where:{id:offerId}}):null;
 if(offerId&&(!selected||selected.activityId!==id))throw new ServiceError('NOT_FOUND',404,'未找到可查看的管理交接');
 if(selected)readable(selected,activity,actor);
 // Non-managers query only their addressed pending offer, not the whole roster.
 const pending=await tx.managementHandover.findFirst({where:{activityId:id,status:'pending',...(isManager?{}:{toUserId:actor})},orderBy:{createdAt:'asc'}});
 const needed=new Set([actor,...(selected?[selected.toUserId]:[]),...(pending?[pending.toUserId]:[])]);
 const rows=isManager?await members(tx,id):(await Promise.all([...needed].map(user=>members(tx,id,user)))).flat();
 const snapshot=await activitySnapshot(tx,id,actor),now=new Date();
 const choices=isManager&&!activity.cancelledAt?candidates(rows,activity,now):[];
 const pendingView=pending?view(pending,activity,actor,rows,now):null;
 return handoverStateSchema.parse({activity:snapshot,management_revision:activity.managementRevision,can_create:isManager&&!activity.cancelledAt&&!pending&&choices.length>0,candidates:choices,pending:pendingView?.status==='pending'?pendingView:null,offer:selected?view(selected,activity,actor,rows,now):null,scope_notice:scopeNotice});
}
export function getHandovers(rawId:string,rawActor:string,rawOfferId?:string):Promise<HandoverState>{
 const{id,actor,offerId}=ids(rawId,rawActor,rawOfferId);
 return withDb(db=>schemaReady(()=>db.$transaction(tx=>state(tx,id,actor,offerId),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead})));
}
function assertVersions(activity:Activity,input:{expected_revision:number;expected_management_revision:number}){checkRevision(activity.revision,input.expected_revision);checkRevision(activity.managementRevision,input.expected_management_revision);}
export function createHandover(rawId:string,rawActor:string,raw:CreateHandoverInput):Promise<HandoverState>{
 const{id,actor}=ids(rawId,rawActor);const parsed=createHandoverInputSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'交接邀请内容不正确');const input=parsed.data;
 const scope=`handover-create:${id}`,fingerprint=requestFingerprint(actor,scope,input);
 return mutation(tx=>schemaReady(async()=>{
  const activity=await lockActivity(tx,id);checkManager(activity.currentManagerId,actor);
  if(await replay(tx,actor,input.idempotency_key,scope,fingerprint)){
   const original=await tx.managementHandover.findUnique({where:{fromUserId_creationKey:{fromUserId:actor,creationKey:input.idempotency_key}}});
   if(!original||original.activityId!==id||original.toUserId!==input.target_user_id)throw new ServiceError('INTERNAL_ERROR',500,'原交接记录暂时无法核对');
   return state(tx,id,actor,original.id);
  }
  checkNotCancelled(activity.cancelledAt);assertVersions(activity,input);
  if(input.target_user_id===actor)throw new ServiceError('INVALID_INPUT',400,'不能把管理权转交给自己');
  if(await tx.managementHandover.findFirst({where:{activityId:id,status:'pending'}}))throw new ServiceError('HANDOVER_ALREADY_PENDING',409,'已有待接受交接，请先撤回原邀请再改选成员');
  const rows=await members(tx,id,input.target_user_id);const now=new Date();
  if(!rows.some(row=>eligible(row,id,now)))requireScope();
  const offer=await tx.managementHandover.create({data:{activityId:id,fromUserId:actor,toUserId:input.target_user_id,fromManagementRevision:activity.managementRevision,creationKey:input.idempotency_key,createdAt:now}});
  const changed=await tx.activity.updateMany({where:{id,currentManagerId:actor,revision:activity.revision,managementRevision:activity.managementRevision,cancelledAt:null},data:{revision:{increment:1}}});if(changed.count!==1)conflict();
  await tx.activityEvent.create({data:{activityId:id,actorUserId:actor,type:'management_handover_created',revision:activity.revision+1,detail:{handover_id:offer.id}}});
  await remember(tx,actor,input.idempotency_key,scope,fingerprint,id);return state(tx,id,actor,offer.id);
 }));
}
export function commandHandover(rawId:string,rawOfferId:string,rawActor:string,raw:HandoverCommand):Promise<HandoverState>{
 const{id,actor,offerId}=ids(rawId,rawActor,rawOfferId);const parsed=handoverCommandSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'交接操作内容不正确');const input=parsed.data;
 const scope=`handover-${input.action}:${id}:${offerId}`,fingerprint=requestFingerprint(actor,scope,input);
 return mutation(tx=>schemaReady(async()=>{
  const activity=await lockActivity(tx,id);
  // Manager authority precedes all withdrawal replay; recipient authority precedes
  // acceptance/rejection replay. A successful acceptance necessarily changes manager.
  if(input.action==='withdraw')checkManager(activity.currentManagerId,actor);
  const offer=await tx.managementHandover.findUnique({where:{id:offerId!}});
  if(!offer||offer.activityId!==id)throw new ServiceError('NOT_FOUND',404,'未找到可处理的管理交接');
  if(input.action==='withdraw'?offer.fromUserId!==actor:offer.toUserId!==actor)throw new ServiceError('FORBIDDEN',403,'不能代他人处理管理交接');
  if(await replay(tx,actor,input.idempotency_key,scope,fingerprint))return state(tx,id,actor,offer.id);
  checkNotCancelled(activity.cancelledAt);assertVersions(activity,input);
  if(offer.status!=='pending')throw new ServiceError('HANDOVER_ALREADY_RESOLVED',409,'这份交接已处理，请查看当前状态');
  if(activity.currentManagerId!==offer.fromUserId||activity.managementRevision!==offer.fromManagementRevision)throw new ServiceError('VERSION_CONFLICT',409,'管理归属已变化，不能接受或重启旧交接');
  const rows=input.action==='accept'?await members(tx,id,actor):[];const now=new Date();
  if(input.action==='accept'&&!rows.some(row=>eligible(row,id,now)))requireScope();
  const status=input.action==='accept'?'accepted':input.action==='reject'?'rejected':'withdrawn';
  const resolved=await tx.managementHandover.updateMany({where:{id:offer.id,activityId:id,fromUserId:offer.fromUserId,toUserId:offer.toUserId,fromManagementRevision:offer.fromManagementRevision,status:'pending'},data:{status,resolvedAt:now}});if(resolved.count!==1)conflict();
  const changed=await tx.activity.updateMany({where:{id,currentManagerId:offer.fromUserId,managementRevision:offer.fromManagementRevision,revision:activity.revision,cancelledAt:null},data:{revision:{increment:1},...(input.action==='accept'?{currentManagerId:actor,managementRevision:{increment:1}}:{})}});if(changed.count!==1)conflict();
  await tx.activityEvent.create({data:{activityId:id,actorUserId:actor,type:`management_handover_${status}`,revision:activity.revision+1,detail:{handover_id:offer.id}}});
  await remember(tx,actor,input.idempotency_key,scope,fingerprint,id);return state(tx,id,actor,offer.id);
 }));
}

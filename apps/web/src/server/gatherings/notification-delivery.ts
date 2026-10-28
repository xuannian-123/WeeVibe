import {createHash,randomBytes} from 'node:crypto';
import {activityIdSchema,gatheringDetailsSchema,gatheringSubscriptionIntentSchema} from '@weevibe/contracts';
import {readConfig,verify,PREFIX,NotificationProofError,type NotifyConfig} from '../../../../../cloudfunctions/weevibeNotifyGathering/protocol.cjs';
import {readText,ServiceError} from '../http';
import {withDb} from '../db';
import {mutation} from '../activities/mutation';
import type {Tx} from '../activities/state';
import {lockGathering,assertGatheringEditable} from './service';

const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const forbidden=()=>new ServiceError('UNAUTHENTICATED',401,'通知工作凭证无效或已使用');
type Config=NotifyConfig&{templateId:string};
function config():Config{
  try{
    if(process.env.GATHERING_NOTIFY_ENABLED!=='true')throw Error();
    const proof=readConfig(process.env),templateId=process.env.GATHERING_NOTIFY_TEMPLATE_ID||'';
    if(!/^[A-Za-z0-9_-]{10,200}$/.test(templateId))throw Error();
    return {...proof,templateId};
  }catch{throw new ServiceError('NOT_CONFIGURED',503,'尚未启用本次活动的微信订阅通知');}
}
async function identity(tx:Tx,userId:string,appId:string){const rows=await tx.wechatIdentity.findMany({where:{userId,appId},select:{openId:true},take:2});return rows.length===1?rows[0].openId:null;}
export async function notificationSubscriptionStatus(actor:string){
  let conf:Config;try{conf=config();}catch{return {enabled:false,template_id:null,scope:null,authorization:'one_time_intent' as const};}
  const enabled=await withDb(db=>db.$transaction(async tx=>!!await identity(tx,actor,conf.appId)));
  return {enabled,template_id:enabled?conf.templateId:null,scope:enabled?conf.scope:null,authorization:'one_time_intent' as const};
}
export async function recordNotificationSubscription(actor:string,raw:unknown){
  const parsed=gatheringSubscriptionIntentSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'订阅确认参数不正确');
  const input=parsed.data,conf=config();if(input.template_id!==conf.templateId)throw new ServiceError('INVALID_INPUT',400,'订阅模板已变化，请重新确认');
  return mutation(async tx=>{
    if(!await identity(tx,actor,conf.appId))throw new ServiceError('FORBIDDEN',403,'请使用当前小程序的微信身份确认订阅');
    const previous=await tx.gatheringSubscriptionGrant.findUnique({where:{userId_authorizationKey:{userId:actor,authorizationKey:input.authorization_key}}});
    if(previous&&(previous.gatheringId!==input.gathering_id||previous.scope!==conf.scope||previous.appId!==conf.appId||previous.templateId!==conf.templateId))throw new ServiceError('IDEMPOTENCY_CONFLICT',409,'此订阅确认已用于其他活动');
    const available=()=>tx.gatheringSubscriptionGrant.count({where:{userId:actor,gatheringId:input.gathering_id,scope:conf.scope,appId:conf.appId,templateId:conf.templateId,consumedAt:null}});
    if(previous)return {recorded:true,available_intents:await available(),authorization:'one_time_intent' as const};
    const row=await lockGathering(tx,input.gathering_id);assertGatheringEditable(row);
    const details=gatheringDetailsSchema.parse(row.details);
    if(row.kind==='team'&&(!details.deadline_at||Date.parse(details.deadline_at)<=Date.now()))throw new ServiceError('INVALID_INPUT',409,'填写已截止，不再接受本次订阅确认');
    if(input.result!=='accept')return {recorded:false,available_intents:await available(),authorization:'one_time_intent' as const};
    if(await available()>=64)throw new ServiceError('INVALID_INPUT',409,'本次活动已有待使用的订阅确认');
    await tx.gatheringSubscriptionGrant.create({data:{userId:actor,gatheringId:input.gathering_id,scope:conf.scope,appId:conf.appId,templateId:conf.templateId,authorizationKey:input.authorization_key}});
    return {recorded:true,available_intents:await available(),authorization:'one_time_intent' as const};
  });
}
function fields(raw:unknown,keys:string[]):Record<string,unknown>|null{return raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).sort().join(',')===keys.sort().join(',')?raw as Record<string,unknown>:null;}
function claimInput(raw:unknown){const value=fields(raw,['limit']);return value&&typeof value.limit==='number'&&Number.isInteger(value.limit)&&value.limit>=1&&value.limit<=10?{limit:value.limit}:null;}
function ackInput(raw:unknown){
  const value=fields(raw,['outbox_id','lease_token','outcome','err_code']);
  if(!value||!activityIdSchema.safeParse(value.outbox_id).success||typeof value.lease_token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.lease_token)||typeof value.outcome!=='string'||!['sent','failed','unknown'].includes(value.outcome)||value.err_code!==null&&(typeof value.err_code!=='number'||!Number.isInteger(value.err_code)||Math.abs(value.err_code)>1_000_000))return null;
  return {outbox_id:value.outbox_id as string,lease_token:value.lease_token,outcome:value.outcome as 'sent'|'failed'|'unknown',err_code:value.err_code as number|null};
}
async function proof(request:Request,action:'claim'|'ack'){
  const conf=config();
  try{
    const url=new URL(request.url);
    if(request.method!=='POST'||url.pathname!==PREFIX+action||url.search||request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw forbidden();
    const signed=verify(url.pathname,await readText(request,16384),request.headers.get('x-weevibe-notify-signature')||'',conf);
    return {conf,...signed};
  }catch(error){if(error instanceof ServiceError)throw error;if(error instanceof NotificationProofError)throw forbidden();throw forbidden();}
}
async function consumeNonce(tx:Tx,source:Awaited<ReturnType<typeof proof>>){
  const scope=`${source.conf.scope}:gathering-submission-notify`,where={scope,appId:source.conf.appId,nonceHash:source.nonceHash};
  if(source.expiresAt.getTime()<=Date.now()||await tx.gatheringWorkerNonce.findUnique({where:{scope_appId_nonceHash:where}}))throw forbidden();
  await tx.gatheringWorkerNonce.create({data:{...where,expiresAt:source.expiresAt}});
}
export async function claimGatheringNotifications(request:Request){
  const source=await proof(request,'claim'),input=claimInput(source.payload);
  if(!input)throw new ServiceError('INVALID_INPUT',400,'通知批次参数不正确');
  const conf=source.conf;
  return mutation(async tx=>{
    await consumeNonce(tx,source);
    const expiredProofs=await tx.gatheringWorkerNonce.findMany({where:{scope:`${conf.scope}:gathering-submission-notify`,appId:conf.appId,expiresAt:{lt:new Date()}},select:{id:true},orderBy:{expiresAt:'asc'},take:100});
    if(expiredProofs.length)await tx.gatheringWorkerNonce.deleteMany({where:{id:{in:expiredProofs.map(row=>row.id)}}});
    // Serialize grant assignment so one accepted click cannot authorize two outboxes.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`gathering-notify:${conf.scope}:${conf.appId}`}))::text`;
    const now=new Date();
    await tx.gatheringPushOutbox.updateMany({where:{status:'leased',leaseExpiresAt:{lt:now},grant:{scope:conf.scope,appId:conf.appId}},data:{status:'unknown'}});
    const candidates=await tx.$queryRaw<{id:string}[]>`SELECT o."id" FROM "GatheringPushOutbox" o
      JOIN "GatheringNotificationRecipient" r ON r."id"=o."recipientId"
      JOIN "GatheringSubmissionEvent" e ON e."id"=r."eventId"
      WHERE o."status"='pending' AND o."nextAttemptAt"<=${now}
      AND EXISTS(SELECT 1 FROM "GatheringSubscriptionGrant" g WHERE g."userId"=r."userId" AND g."gatheringId"=e."gatheringId"
        AND g."scope"=${conf.scope} AND g."appId"=${conf.appId} AND g."templateId"=${conf.templateId}
        AND g."createdAt"<=e."createdAt" AND ((o."grantId" IS NULL AND g."consumedAt" IS NULL) OR o."grantId"=g."id"))
      ORDER BY o."createdAt",o."id" LIMIT ${input.limit} FOR UPDATE OF o SKIP LOCKED`;
    const jobs=[];
    for(const candidate of candidates){
      const row=await tx.gatheringPushOutbox.findUniqueOrThrow({where:{id:candidate.id},include:{recipient:{include:{event:true}}}}),recipient=row.recipient,event=recipient.event;
      const touser=await identity(tx,recipient.userId,conf.appId);
      if(!touser){await tx.gatheringPushOutbox.update({where:{id:row.id},data:{status:'failed',lastErrorCode:40003}});continue;}
      const grant=row.grantId?await tx.gatheringSubscriptionGrant.findUnique({where:{id:row.grantId}}):await tx.gatheringSubscriptionGrant.findFirst({where:{userId:recipient.userId,gatheringId:event.gatheringId,scope:conf.scope,appId:conf.appId,templateId:conf.templateId,consumedAt:null,createdAt:{lte:event.createdAt}},orderBy:{createdAt:'asc'}});
      if(!grant)continue;
      const token=randomBytes(32).toString('base64url'),leaseExpiresAt=new Date(now.getTime()+45000);
      if(!grant.consumedAt)await tx.gatheringSubscriptionGrant.update({where:{id:grant.id},data:{consumedAt:now}});
      await tx.gatheringPushOutbox.update({where:{id:row.id},data:{status:'leased',grantId:grant.id,leaseTokenHash:hash(token),leaseExpiresAt,attempts:{increment:1}}});
      jobs.push({outbox_id:row.id,lease_token:token,lease_expires_at:leaseExpiresAt.toISOString(),touser,template_id:conf.templateId,event_kind:event.action,gathering_id:event.gatheringId,created_at:event.createdAt.toISOString()});
    }
    return {jobs};
  });
}
export async function acknowledgeGatheringNotification(request:Request){
  const source=await proof(request,'ack'),input=ackInput(source.payload);
  if(!input)throw new ServiceError('INVALID_INPUT',400,'通知回执参数不正确');
  if(input.outcome==='sent'&&input.err_code!==0||input.outcome==='failed'&&(!input.err_code||input.err_code<0))throw new ServiceError('INVALID_INPUT',400,'通知回执状态不一致');
  return mutation(async tx=>{
    await consumeNonce(tx,source);
    await tx.$queryRaw`SELECT "id" FROM "GatheringPushOutbox" WHERE "id"=${input.outbox_id}::uuid FOR UPDATE`;
    const row=await tx.gatheringPushOutbox.findUnique({where:{id:input.outbox_id},include:{grant:true}});
    if(!row||row.grant?.scope!==source.conf.scope||row.grant.appId!==source.conf.appId||row.grant.templateId!==source.conf.templateId||row.leaseTokenHash!==hash(input.lease_token))throw forbidden();
    if(row.status===input.outcome)return {recorded:true,status:row.status};
    if(row.status!=='leased'||!row.leaseExpiresAt||row.leaseExpiresAt.getTime()<=Date.now())throw new ServiceError('VERSION_CONFLICT',409,'通知发送状态已变化');
    const retry=input.outcome==='failed'&&input.err_code===45009&&row.attempts<3;
    const status=retry?'pending':input.outcome;
    await tx.gatheringPushOutbox.update({where:{id:row.id},data:{status,lastErrorCode:input.err_code,sentAt:status==='sent'?new Date():null,...(retry?{nextAttemptAt:new Date(Date.now()+180000),leaseTokenHash:null,leaseExpiresAt:null}:{})}});
    return {recorded:true,status};
  });
}

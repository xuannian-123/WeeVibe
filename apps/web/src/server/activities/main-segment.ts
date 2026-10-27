import { activityIdSchema,changeMainSegmentInputSchema,type ChangeMainSegmentInput,type ActivityDetail } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';
import { lockActivity } from './state';
import { replay,remember } from './idempotency';
import { checkManager,checkNotCancelled,checkRevision,requestFingerprint } from './rules';
import { activitySnapshot } from './snapshot';
const date=(value:unknown):value is Date=>value instanceof Date&&Number.isFinite(value.getTime());
const incrementable=(n:number)=>Number.isSafeInteger(n)&&n>0&&n<2_147_483_647;
function unavailable():never{throw new ServiceError('MAIN_SEGMENT_SCOPE_UNAVAILABLE',409,'当前直接换主首片仅支持原主与目标均未开始、未取消且来源完整的活动；其它来源范围暂未启用');}
/** Changes only main identity/revision and clears the previous formation proof.
 * Original segment plans, valid acceptance, seats, verification and bookings stay.
 */
export function changeMainSegment(rawId:string,rawActor:string,raw:ChangeMainSegmentInput):Promise<ActivityDetail>{
 const id=activityIdSchema.safeParse(rawId),actor=activityIdSchema.safeParse(rawActor),parsed=changeMainSegmentInputSchema.safeParse(raw);
 if(!id.success||!actor.success||!parsed.success)throw new ServiceError('INVALID_INPUT',400,'更换主环节的标识或内容不正确');
 const activityId=id.data,actorId=actor.data,input=parsed.data,scope=`main-segment:${activityId}`,fingerprint=requestFingerprint(actorId,scope,input);
 return mutation(async tx=>{
  const activity=await lockActivity(tx,activityId);
  // Historical keys never revive a former manager's permission. Successful
  // replay returns the CURRENT snapshot, not a command to switch back again.
  checkManager(activity.currentManagerId,actorId);
  if(await replay(tx,actorId,input.idempotency_key,scope,fingerprint))return activitySnapshot(tx,activityId,actorId);
  checkNotCancelled(activity.cancelledAt);checkRevision(activity.revision,input.expected_revision);
  if(!activity.mainSegmentId||!activity.segments.length||new Set(activity.segments.map(s=>s.id)).size!==activity.segments.length
   ||activity.segments.some(s=>s.activityId!==activityId||!activityIdSchema.safeParse(s.id).success)
   ||!incrementable(activity.mainRevision)||!incrementable(activity.revision))unavailable();
  const original=activity.segments.find(s=>s.id===activity.mainSegmentId);
  if(!original||original.cancelledAt)unavailable();
  if(activity.mainSegmentId!==input.expected_main_segment_id)throw new ServiceError('VERSION_CONFLICT',409,'当前主环节已变化，请刷新后重新查看');
  const target=activity.segments.find(s=>s.id===input.target_segment_id);
  if(!target)throw new ServiceError('INVALID_INPUT',400,'目标环节不属于此活动');
  if(target.id===original.id)throw new ServiceError('INVALID_INPUT',400,'目标已是主环节，请选择不同环节');
  const now=new Date(); // AFTER parent lock and awaited permission/key reads.
  if([original,target].some(s=>s.cancelledAt||!date(s.startsAt)||!date(s.endsAt)||!date(s.deadlineAt)||s.endsAt<=s.startsAt||s.deadlineAt>s.startsAt||now>=s.startsAt))unavailable();
  const changed=await tx.activity.updateMany({where:{id:activityId,currentManagerId:actorId,revision:activity.revision,mainRevision:activity.mainRevision,mainSegmentId:original.id,cancelledAt:null},data:{
   mainSegmentId:target.id,mainRevision:{increment:1},revision:{increment:1},confirmedAt:null,confirmedMainRevision:null,confirmedPlanRevision:null
  }});
  if(changed.count!==1)throw new ServiceError('CONCURRENT_MODIFICATION',409,'主环节或活动状态已变化，请刷新后重试');
  await tx.activityEvent.create({data:{activityId,actorUserId:actorId,type:'main_segment_changed',revision:activity.revision+1,detail:{from_segment_id:original.id,to_segment_id:target.id,from_main_revision:activity.mainRevision,main_revision:activity.mainRevision+1}}});
  await remember(tx,actorId,input.idempotency_key,scope,fingerprint,activityId);
  return activitySnapshot(tx,activityId,actorId);
 });
}

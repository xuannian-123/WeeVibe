import { Prisma } from '@prisma/client';
import { activityIdSchema, rebookSourceSchema, type RebookSource } from '@weevibe/contracts';
import { ServiceError } from '../http';
import { mutation } from './mutation';

// Do not reuse loadActivity: its participation include is unnecessary here.
// location/fee are existing public JSON columns; only the allowed output keys
// are projected. No profile, response, invitation or mutation-key reads.
const sourceSelect={id:true,currentManagerId:true,cancelledAt:true,revision:true,name:true,timezone:true,
 segments:{orderBy:{position:'asc' as const},select:{id:true,activityId:true,position:true,type:true,name:true,startsAt:true,endsAt:true,deadlineAt:true,cancelledAt:true,minimumParticipants:true,capacity:true,location:true,fee:true,requirements:true}}
} satisfies Prisma.ActivitySelect;
function unavailable():never{throw new ServiceError('REBOOK_SCOPE_UNAVAILABLE',409,'当前再约首片仅支持由当前管理者复制整场未取消、所有环节均已结束且来源完整的活动；其它来源范围暂未启用');}
function validDate(value:unknown):value is Date{return value instanceof Date&&Number.isFinite(value.getTime());}
function location(value:Prisma.JsonValue){if(!value||typeof value!=='object'||Array.isArray(value))return null;return{name:value.name,address:value.address};}
export function getRebookSource(rawId:string,rawActor:string):Promise<RebookSource>{
 const id=activityIdSchema.safeParse(rawId),actor=activityIdSchema.safeParse(rawActor);
 if(!id.success||!actor.success)throw new ServiceError('INVALID_INPUT',400,'再约活动或当前身份标识不正确');
 // Reuse the existing Serializable/whole-transaction retry mechanism. The body
 // only locks and reads; it never writes an activity, event, key or draft.
 return mutation(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${id.data}::uuid FOR UPDATE`;
  const source=await tx.activity.findUnique({where:{id:id.data},select:sourceSelect});
  if(!source)throw new ServiceError('NOT_FOUND',404,'未找到可再约的活动');
  if(source.currentManagerId!==actor.data)throw new ServiceError('FORBIDDEN',403,'仅当前管理者可以复制本活动为再约草稿');
  const now=new Date(); // Authoritative sample AFTER parent lock and source read.
  if(source.id!==id.data||source.cancelledAt||!source.segments.length
   ||new Set(source.segments.map(s=>s.id)).size!==source.segments.length
   ||new Set(source.segments.map(s=>s.position)).size!==source.segments.length
   ||source.segments.some(s=>s.activityId!==source.id||!activityIdSchema.safeParse(s.id).success||!Number.isInteger(s.position)||s.position<0
    ||!validDate(s.startsAt)||!validDate(s.endsAt)||!validDate(s.deadlineAt)||s.endsAt<=s.startsAt||s.deadlineAt>s.startsAt||now<s.endsAt))unavailable();
  const included=source.segments.filter(s=>!s.cancelledAt);
  if(!included.length)unavailable();
  const parsed=rebookSourceSchema.safeParse({source_activity_id:source.id,source_revision:source.revision,actor_id:actor.data,server_time:now.toISOString(),source_timezone:source.timezone,name:source.name,
   excluded_cancelled_count:source.segments.length-included.length,
   segments:included.map(s=>({source_segment_id:s.id,position:s.position,type:s.type,name:s.name,minimum_participants:s.minimumParticipants,capacity:s.capacity,location:location(s.location),fee:s.fee,requirements:s.requirements}))});
  if(!parsed.success)unavailable();
  return parsed.data;
 });
}

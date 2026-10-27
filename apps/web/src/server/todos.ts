import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { activityIdSchema, todoCursorSchema, todoPageSchema, type TodoActivity, type TodoItem, type TodoPage } from '@weevibe/contracts';
import { withDb } from './db';
import { ServiceError } from './http';
const cap=2000,pageSize=50;
type CursorState={v:1;actor:string;fingerprint:string;offset:number;valid_until:string|null};
function invalidCursor():never{throw new ServiceError('INVALID_INPUT',400,'待办分页标识不正确，请重新刷新');}
function changed():never{throw new ServiceError('TODOS_SNAPSHOT_CHANGED',409,'待办来源或时间状态已变化，请刷新后重新查看，不要拼接旧页');}
function oversized():never{throw new ServiceError('NOT_CONFIGURED',503,'当前待办完整元数据读取上限为2000个候选活动或相关待接交接，未截取或当作没有待办');}
function invalidSource():never{throw new ServiceError('INTERNAL_ERROR',500,'待办来源暂时无法完整核对，请刷新或检查后端版本');}
const validDate=(v:unknown):v is Date=>v instanceof Date&&Number.isFinite(v.getTime());
const positiveInt=(v:number)=>Number.isSafeInteger(v)&&v>0&&v<=2_147_483_647;
function validAcceptance(p:{status:string;acceptedPlanRevision:number|null}){return p.status==='joined'&&(p.acceptedPlanRevision===null||positiveInt(p.acceptedPlanRevision));}
function sameSegment(s:{id:string;startsAt:Date;endsAt:Date;deadlineAt:Date;cancelledAt:Date|null;planRevision:number},meta:{segments:Array<{id:string;startsAt:Date;endsAt:Date;deadlineAt:Date;cancelledAt:Date|null;planRevision:number}>}){const m=meta.segments.find(x=>x.id===s.id);return !!m&&validDate(s.startsAt)&&validDate(s.endsAt)&&validDate(s.deadlineAt)&&s.startsAt.getTime()===m.startsAt.getTime()&&s.endsAt.getTime()===m.endsAt.getTime()&&s.deadlineAt.getTime()===m.deadlineAt.getTime()&&s.planRevision===m.planRevision&&(s.cancelledAt===null?m.cancelledAt===null:validDate(s.cancelledAt)&&validDate(m.cancelledAt)&&s.cancelledAt.getTime()===m.cancelledAt.getTime());}
function parseCursor(raw:string|undefined,actor:string):CursorState|null{
 if(raw===undefined)return null;const parsed=todoCursorSchema.safeParse(raw);if(!parsed.success)invalidCursor();
 try{const decoded=Buffer.from(parsed.data,'base64url');if(decoded.toString('base64url')!==parsed.data)invalidCursor();const body:unknown=JSON.parse(decoded.toString('utf8'));
  if(!body||typeof body!=='object'||Array.isArray(body))invalidCursor();const o=body as Record<string,unknown>;
  if(Object.keys(o).length!==5||!['v','actor','fingerprint','offset','valid_until'].every(k=>Object.prototype.hasOwnProperty.call(o,k))||o.v!==1)invalidCursor();
  const owner=activityIdSchema.safeParse(o.actor),until=todoPageSchema.shape.page.shape.valid_until.safeParse(o.valid_until);
  if(!owner.success||owner.data!==actor||!until.success||typeof o.fingerprint!=='string'||!(/^[a-f0-9]{64}$/).test(o.fingerprint)||typeof o.offset!=='number'||!Number.isSafeInteger(o.offset)||o.offset<pageSize||o.offset>cap||o.offset%pageSize!==0)invalidCursor();
  return{v:1,actor:owner.data,fingerprint:o.fingerprint,offset:o.offset,valid_until:until.data};
 }catch{invalidCursor();}
}
const handoverSelect={id:true,activityId:true,fromUserId:true,toUserId:true,fromManagementRevision:true,status:true,activity:{select:{currentManagerId:true,managementRevision:true,cancelledAt:true}}} satisfies Prisma.ManagementHandoverSelect;
const segmentTimeSelect={id:true,startsAt:true,endsAt:true,deadlineAt:true,cancelledAt:true,planRevision:true} satisfies Prisma.SegmentSelect;
const indexSelect={id:true,createdAt:true,revision:true,membershipRevision:true,managementRevision:true,currentManagerId:true,cancelledAt:true,segments:{orderBy:{id:'asc' as const},select:segmentTimeSelect}} satisfies Prisma.ActivitySelect;
const bodySelect={id:true,name:true,revision:true,currentManagerId:true,cancelledAt:true} satisfies Prisma.ActivitySelect;
const managerSelect={id:true,revision:true,currentManagerId:true,cancelledAt:true,_count:{select:{applications:{where:{status:'pending' as const}}}},segments:{orderBy:{id:'asc' as const},select:{...segmentTimeSelect,minimumParticipants:true,participations:{where:{status:'joined' as const},select:{status:true,acceptedPlanRevision:true}}}}} satisfies Prisma.ActivitySelect;
function selfSelect(actor:string){return{id:true,revision:true,cancelledAt:true,segments:{where:{participations:{some:{userId:actor,status:'joined' as const}}},orderBy:{id:'asc' as const},select:{...segmentTimeSelect,participations:{where:{userId:actor,status:'joined' as const},select:{status:true,acceptedPlanRevision:true}}}}} satisfies Prisma.ActivitySelect;}
function activeSegment(segment:{startsAt:Date;endsAt:Date;cancelledAt:Date|null},now:Date){return !segment.cancelledAt&&now<segment.startsAt;}
/** Read-only, actor-authorized candidate pagination. Cursor is untrusted state,
 * never a credential. No model/provider calls, saved read marks or writes. */
export function getTodos(rawActor:string,rawCursor?:string):Promise<TodoPage>{
 const actorResult=activityIdSchema.safeParse(rawActor);if(!actorResult.success)throw new ServiceError('INVALID_INPUT',400,'待办身份标识不正确');const actor=actorResult.data,cursor=parseCursor(rawCursor,actor),offset=cursor?.offset??0;
 return withDb(async db=>{
  try{return await db.$transaction(async tx=>{
   // Always inspect this dependency, even for an otherwise empty account. Missing
   // migration10 must not masquerade as no pending handover or affect account GET.
   const offers=await tx.managementHandover.findMany({where:{status:'pending',OR:[{fromUserId:actor},{toUserId:actor}],activity:{cancelledAt:null}},orderBy:{id:'asc'},take:cap+1,select:handoverSelect});
   if(offers.length>cap)oversized();
   const relevant=offers.filter(o=>o.status==='pending'&&!o.activity.cancelledAt&&o.activity.currentManagerId===o.fromUserId&&o.activity.managementRevision===o.fromManagementRevision&&(o.fromUserId===actor||o.toUserId===actor));
   if(new Set(relevant.map(o=>o.activityId)).size!==relevant.length)invalidSource();
   const offeredIds=relevant.filter(o=>o.toUserId===actor).map(o=>o.activityId);
   const authorized:Prisma.ActivityWhereInput={cancelledAt:null,OR:[{currentManagerId:actor},{segments:{some:{participations:{some:{userId:actor,status:'joined'}}}}},...(offeredIds.length?[{id:{in:offeredIds}}]:[])]};
   const index=await tx.activity.findMany({where:authorized,orderBy:[{createdAt:'desc'},{id:'asc'}],take:cap+1,select:indexSelect});
   if(index.length>cap)oversized();
   if(new Set(index.map(a=>a.id)).size!==index.length)invalidSource();
   for(const a of index){if(!activityIdSchema.safeParse(a.id).success||!validDate(a.createdAt)||a.cancelledAt||!Number.isSafeInteger(a.revision)||a.revision<1||!Number.isSafeInteger(a.managementRevision)||a.managementRevision<1||!Number.isSafeInteger(a.membershipRevision)||a.membershipRevision<1||new Set(a.segments.map(s=>s.id)).size!==a.segments.length)invalidSource();for(const s of a.segments)if(!validDate(s.startsAt)||!validDate(s.endsAt)||!validDate(s.deadlineAt)||s.endsAt<=s.startsAt||s.deadlineAt>s.startsAt||!Number.isSafeInteger(s.planRevision)||s.planRevision<1)invalidSource();}
   index.sort((a,b)=>b.createdAt.getTime()-a.createdAt.getTime()||a.id.localeCompare(b.id));
   const pageIndex=index.slice(offset,offset+pageSize),ids=pageIndex.map(a=>a.id),managedIds=pageIndex.filter(a=>a.currentManagerId===actor).map(a=>a.id);
   const base=ids.length?await tx.activity.findMany({where:{AND:[authorized,{id:{in:ids}}]},select:bodySelect}):[];
   const managers=managedIds.length?await tx.activity.findMany({where:{id:{in:managedIds},currentManagerId:actor,cancelledAt:null},select:managerSelect}):[];
   const selves=ids.length?await tx.activity.findMany({where:{id:{in:ids},cancelledAt:null,segments:{some:{participations:{some:{userId:actor,status:'joined'}}}}},select:selfSelect(actor)}):[];
   // All reads share this RR snapshot, but passage of real time is not frozen.
   const now=new Date();
   const phases=index.map(a=>({id:a.id,createdAt:a.createdAt.toISOString(),revision:a.revision,membershipRevision:a.membershipRevision,managementRevision:a.managementRevision,currentManagerId:a.currentManagerId,segments:a.segments.map(s=>({id:s.id,revision:s.planRevision,cancelled:s.cancelledAt!==null,startsAt:s.startsAt.toISOString(),endsAt:s.endsAt.toISOString(),deadlineAt:s.deadlineAt.toISOString(),started:now>=s.startsAt,joinClosed:now>=s.deadlineAt})).sort((a,b)=>a.id.localeCompare(b.id))}));
   const fingerprint=createHash('sha256').update(JSON.stringify({v:1,actor,index:phases,offers:relevant.map(o=>({id:o.id,activityId:o.activityId,from:o.fromUserId,to:o.toUserId,revision:o.fromManagementRevision})).sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex');
   const boundaries=index.flatMap(a=>a.segments.filter(s=>!s.cancelledAt).flatMap(s=>[s.startsAt.getTime(),s.deadlineAt.getTime()])).filter(t=>t>now.getTime());
   const validUntil=boundaries.length?new Date(boundaries.reduce((min,t)=>Math.min(min,t),Infinity)).toISOString():null;
   if(cursor&&(cursor.fingerprint!==fingerprint||cursor.valid_until!==validUntil||cursor.valid_until!==null&&now.getTime()>=Date.parse(cursor.valid_until)))changed();
   if(offset>0&&offset>=index.length)invalidCursor();
   if(base.length!==pageIndex.length||new Set(base.map(a=>a.id)).size!==base.length||managers.length!==managedIds.length)changed();
   const result:TodoActivity[]=[];
   for(const meta of pageIndex){const row=base.find(a=>a.id===meta.id);if(!row||row.cancelledAt||row.revision!==meta.revision||row.currentManagerId!==meta.currentManagerId)changed();const items:TodoItem[]=[];
    const manager=managers.find(a=>a.id===meta.id);if(manager){if(manager.currentManagerId!==actor||manager.revision!==meta.revision||manager.cancelledAt)changed();if(!Number.isSafeInteger(manager._count.applications)||manager._count.applications<0||manager.segments.length!==meta.segments.length||new Set(manager.segments.map(s=>s.id)).size!==manager.segments.length||manager.segments.some(s=>!sameSegment(s,meta)||!positiveInt(s.minimumParticipants)||s.participations.some(p=>!validAcceptance(p))))invalidSource();if(manager._count.applications>0)items.push({kind:'applications',role:'manager',application_count:manager._count.applications});
     let missing=0,missingSeats=0,closed=0,review=0,reviewSlots=0;
     for(const s of manager.segments){if(!activeSegment(s,now))continue;const joined=s.participations.filter(p=>p.status==='joined');if(joined.length<s.minimumParticipants){missing++;missingSeats+=s.minimumParticipants-joined.length;if(now>=s.deadlineAt)closed++;}const pending=joined.filter(p=>p.acceptedPlanRevision!==s.planRevision).length;if(pending){review++;reviewSlots+=pending;}}
     if(missing)items.push({kind:'missing',role:'manager',segment_count:missing,missing_seat_count:missingSeats,closed_segment_count:closed});if(review)items.push({kind:'review',role:'manager',segment_count:review,participant_segment_count:reviewSlots});
    }
    const self=selves.find(a=>a.id===meta.id);if(self){if(self.revision!==meta.revision||self.cancelledAt)changed();if(new Set(self.segments.map(s=>s.id)).size!==self.segments.length||self.segments.some(s=>!sameSegment(s,meta)||s.participations.length!==1||s.participations.some(p=>!validAcceptance(p))))invalidSource();const count=self.segments.filter(s=>activeSegment(s,now)&&s.participations.some(p=>p.status==='joined'&&p.acceptedPlanRevision!==s.planRevision)).length;if(count)items.push({kind:'review',role:'self',segment_count:count,participant_segment_count:count});}
    const offer=relevant.find(o=>o.activityId===meta.id);if(offer&&offer.fromUserId===meta.currentManagerId&&offer.fromManagementRevision===meta.managementRevision){if(actor===meta.currentManagerId)items.push({kind:'handover',role:'manager',invitation_count:1});else if(actor===offer.toUserId)items.push({kind:'handover',role:'recipient',invitation_count:1});}
    if(items.length)result.push({activity_id:row.id,title:row.name,revision:row.revision,path:`/pages/activity/index?id=${row.id}`,items});
   }
   const hasMore=offset+pageIndex.length<index.length;
   const next=hasMore?Buffer.from(JSON.stringify({v:1,actor,fingerprint,offset:offset+pageIndex.length,valid_until:validUntil})).toString('base64url'):null;
   const parsed=todoPageSchema.safeParse({actor_id:actor,server_time:now.toISOString(),activities:result,page:{offset,page_size:pageSize,candidate_count:pageIndex.length,returned_activity_count:result.length,has_more:hasMore,next_cursor:next,scope:'authorized_candidates',snapshot_fingerprint:fingerprint,valid_until:validUntil}});
   if(!parsed.success)invalidSource();return parsed.data;
  },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});}
  catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2021','P2022'].includes(error.code)&&JSON.stringify(error.meta??{}).includes('ManagementHandover'))throw new ServiceError('NOT_CONFIGURED',503,'待办所需管理交接数据库版本尚未配置，请使用匹配后端和第10条迁移');throw error;}
 });
}

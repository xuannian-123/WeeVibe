import { vi } from 'vitest';
export const rebookId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const rebookIds={activity:rebookId(1),manager:rebookId(2),other:rebookId(3),main:rebookId(4),second:rebookId(5),cancelled:rebookId(6)};
const I=rebookIds;
function projection(row:any,select:any):any{if(!select)return structuredClone(row);const result:any={};for(const[k,v]of Object.entries(select)){if(v===true)result[k]=structuredClone(row[k]);else if(v&&typeof v==='object'&&'select'in v){const query=v as any;result[k]=Array.isArray(row[k])?[...row[k]].sort((a,b)=>query.orderBy?.position==='asc'?a.position-b.position:0).map((x:any)=>projection(x,query.select)):projection(row[k],query.select);}}return result;}
export function createRebookFixture(){
 const seg=(id:string,position:number)=>({id,activityId:I.activity,position,clientRef:`old-${position}`,type:'dinner',name:`public segment ${position}`,startsAt:new Date('2030-01-01T10:00:00Z'),endsAt:new Date('2030-01-01T12:00:00Z'),deadlineAt:new Date('2030-01-01T09:00:00Z'),minimumParticipants:2,capacity:8,location:{name:'public old venue',address:'public address',source_url:'https://example.org/OLD_SOURCE_URL',privateOrigin:'PRIVATE_LOCATION_SENTINEL'},fee:{kind:'total',amount_cents:24000,currency:'CNY',note:'quote to recheck'},requirements:'public participate requirements',planRevision:9,verificationStatus:'manual_checked',bookingStatus:'manual_booked',cancelledAt:null,participations:[{userId:I.other,status:'joined',acceptedPlanRevision:9,displayName:'PRIVATE_MEMBER_NAME'}]});
 const source={id:I.activity,name:'Old source activity',timezone:'America/New_York',currentManagerId:I.manager,revision:17,membershipRevision:9,managementRevision:4,mainRevision:5,mainSegmentId:I.main,confirmedAt:new Date('2030-01-01T09:00:00Z'),confirmedMainRevision:5,confirmedPlanRevision:9,cancelledAt:null,segments:[seg(I.main,0),seg(I.second,1),{...seg(I.cancelled,2),cancelledAt:new Date('2029-12-31T00:00:00Z')}],privateProfile:'PRIVATE_PROFILE_SENTINEL',publicAnswers:'PRIVATE_ANSWERS_SENTINEL'};
 const f:any={source,activities:new Map([[I.activity,source]]),keys:new Map(),events:[],order:[],lockTime:null,readTime:null};
 f.db={$transaction:vi.fn(async(action:any,_options:any)=>action(f.tx))};
 f.tx={
  $queryRaw:vi.fn(async()=>{f.order.push('lock');if(f.lockTime)vi.setSystemTime(f.lockTime);return[{id:I.activity}];}),
  activity:{findUnique:vi.fn(async({where,select}:any)=>{f.order.push('read');if(f.readTime)vi.setSystemTime(f.readTime);const row=f.activities.get(where.id);return row?projection(row,select):null;}),create:vi.fn(async({data}:any)=>{const row={revision:1,membershipRevision:1,managementRevision:1,mainRevision:1,mainSegmentId:null,confirmedAt:null,confirmedMainRevision:null,confirmedPlanRevision:null,cancelledAt:null,segments:[],...structuredClone(data)};f.activities.set(data.id,row);return row;}),update:vi.fn(async({where,data}:any)=>{const row=f.activities.get(where.id);Object.assign(row,structuredClone(data));return structuredClone(row);}),updateMany:vi.fn()},
  segment:{createMany:vi.fn(async({data}:any)=>{for(const d of data)f.activities.get(d.activityId).segments.push({planRevision:1,verificationStatus:'unknown',bookingStatus:'unknown',cancelledAt:null,participations:[],...structuredClone(d)});return{count:data.length};}),update:vi.fn(),updateMany:vi.fn()},
  participation:{createMany:vi.fn(async({data}:any)=>{for(const d of data)f.activities.get(d.activityId).segments.find((s:any)=>s.id===d.segmentId).participations.push({status:'joined',lateArrivalAt:null,lateNoticeAt:null,...structuredClone(d)});return{count:data.length};}),findMany:vi.fn(),updateMany:vi.fn()},
  activityEvent:{create:vi.fn(async({data}:any)=>{f.events.push(structuredClone(data));return data;})},
  activityMutationKey:{findUnique:vi.fn(async({where}:any)=>structuredClone(f.keys.get(where.actorUserId_key.actorUserId+':'+where.actorUserId_key.key)??null)),create:vi.fn(async({data}:any)=>{f.keys.set(data.actorUserId+':'+data.key,structuredClone(data));return data;})},
  activityApplication:{findMany:vi.fn(async()=>[]),create:vi.fn(),update:vi.fn()},
  privateProfile:{findMany:vi.fn()},requirementSubmission:{findMany:vi.fn()},invitationSource:{findMany:vi.fn()},managementHandover:{findMany:vi.fn()}
 };
 return f;
}

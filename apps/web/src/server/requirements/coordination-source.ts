import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { aiSnapshotSchema, coordinationContextSchema, requirementResponseInputSchema, requirementDraftSchema, validateQuestions, type AiSnapshot, type CoordinationContext, type CoordinationAggregate } from '@weevibe/contracts';
import { withDb } from '../db';
import { ServiceError } from '../http';
import type { Tx } from '../activities/state';
import { effectiveSurveyStatus } from './rules';

export type CoordinationSource={context:CoordinationContext;snapshot:AiSnapshot;validatorActorId:string};
export const COORDINATION_SOURCE_LIMITS={responses:500,segments:64,participationsPerSegment:500,totalParticipations:2000}as const;
const limits=COORDINATION_SOURCE_LIMITS;
const surveySelect={id:true,kind:true,ownerUserId:true,activityId:true,revision:true,status:true,draft:true,deadlineAt:true,closedAt:true,finalSelection:true} satisfies Prisma.RequirementSurveySelect;
const activitySelect={id:true,currentManagerId:true,revision:true,membershipRevision:true,managementRevision:true,mainRevision:true,mainSegmentId:true,confirmedAt:true,confirmedMainRevision:true,confirmedPlanRevision:true,cancelledAt:true,segments:{take:limits.segments+1,orderBy:{position:'asc' as const},select:{id:true,clientRef:true,position:true,type:true,name:true,startsAt:true,endsAt:true,deadlineAt:true,minimumParticipants:true,capacity:true,location:true,fee:true,requirements:true,planRevision:true,cancelledAt:true,verificationStatus:true,bookingStatus:true,participations:{take:limits.participationsPerSegment+1,orderBy:{userId:'asc' as const},select:{userId:true,status:true,acceptedPlanRevision:true,lateArrivalAt:true,lateNoticeAt:true}}}}} satisfies Prisma.ActivitySelect;
function canonical(value:unknown):string{
 if(value instanceof Date)return JSON.stringify(value.toISOString());
 if(Array.isArray(value))return`[${value.map(canonical).join(',')}]`;
 if(value!==null&&typeof value==='object')return`{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
 return JSON.stringify(value);
}
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
function sourceInvalid():never{throw new ServiceError('INTERNAL_ERROR',500,'需求来源数据不完整或不一致，未截取、忽略成员或生成建议');}
function oversized():never{throw new ServiceError('NOT_CONFIGURED',503,'当前资料准备仅支持最多500份答卷、64个环节及2000条参加记录；未截取成员或生成建议');}
const unique=(items:string[])=>new Set(items).size===items.length;

/** Fresh consistent read only. No writes, provider calls, privateOrigin or profile queries. */
export async function readCoordinationSourceTx(tx:Tx,collectionId:string,actorId:string):Promise<CoordinationSource>{
 const survey=await tx.requirementSurvey.findUnique({where:{id:collectionId},select:surveySelect});
 if(!survey)throw new ServiceError('NOT_FOUND',404,'未找到需求收集');
 if(survey.kind!=='friend')throw new ServiceError('NOT_FOUND',404,'未找到需求收集');
 if(!survey.activityId)throw new ServiceError('NOT_CONFIGURED',503,'此需求收集没有可核对的关联朋友活动');
 const activity=await tx.activity.findUnique({where:{id:survey.activityId},select:activitySelect});
 if(!activity)throw new ServiceError('NOT_FOUND',404,'关联活动不可用，无法核对当前管理权限');
 if(activity.currentManagerId!==actorId)throw new ServiceError('FORBIDDEN',403,'仅当前活动管理者可准备协调资料');
 if(activity.cancelledAt)throw new ServiceError('ACTIVITY_CANCELLED',409,'活动已取消，不能准备新的协调候选');
 if(survey.status==='draft')throw new ServiceError('VERSION_CONFLICT',409,'需求尚未发布，不能把私有草稿当作已收集需求');
 if(!['open','closed','finalized'].includes(survey.status)||!survey.deadlineAt)sourceInvalid();
 if(activity.segments.length>limits.segments || activity.segments.some(s=>s.participations.length>limits.participationsPerSegment)||activity.segments.reduce((n,s)=>n+s.participations.length,0)>limits.totalParticipations)oversized();
 if(!activity.mainSegmentId||!activity.segments.some(s=>s.id===activity.mainSegmentId&&!s.cancelledAt)||!unique(activity.segments.map(s=>s.id))||!unique(activity.segments.map(s=>String(s.position))))sourceInvalid();
 const parsedDraft=requirementDraftSchema.safeParse(survey.draft);if(!parsedDraft.success)sourceInvalid();const draft={...parsedDraft.data,questions:[...parsedDraft.data.questions].sort((a,b)=>a.id.localeCompare(b.id)).map(q=>({...q,options:[...q.options].sort((a,b)=>a.id.localeCompare(b.id))})),locations:[...parsedDraft.data.locations].sort((a,b)=>a.id.localeCompare(b.id))};
 activity.segments.sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));
 try{validateQuestions(draft.questions);}catch{sourceInvalid();}
 if(!draft.locations.length||!unique(draft.locations.map(l=>l.id))||!unique(draft.locations.map(l=>l.label.trim()))||draft.locations.some(l=>!l.label.trim())||draft.questions.some(q=>q.segment_id!==null&&!activity.segments.some(s=>s.id===q.segment_id)))sourceInvalid();
 const rows=await tx.requirementSubmission.findMany({where:{collectionId},take:limits.responses+1,orderBy:{userId:'asc'},select:{userId:true,revision:true,responseVersion:true,publicAnswers:true}});
 if(rows.length>limits.responses)oversized();
 if(!unique(rows.map(r=>r.userId)))sourceInvalid();
 const answers=rows.map(row=>{
  const parsed=requirementResponseInputSchema.omit({private_origin:true}).safeParse(row.publicAnswers);
  if(!parsed.success || !Number.isSafeInteger(row.responseVersion)||row.responseVersion<1||!Number.isSafeInteger(row.revision)||row.revision<1||row.revision>survey.revision)sourceInvalid();
  const a=parsed.data;
  if(!unique(a.selected_segment_ids)||a.selected_segment_ids.some(id=>!activity.segments.some(s=>s.id===id))||!unique(a.location_ids)||a.location_ids.some(id=>!draft.locations.some(l=>l.id===id))||!unique(a.answers.map(x=>x.question_id))||a.location_other!==null&&!a.location_other.trim())sourceInvalid();
  for(const answer of a.answers){const q=draft.questions.find(q=>q.id===answer.question_id);if(!q||q.segment_id!==null&&!a.selected_segment_ids.includes(q.segment_id)||!unique(answer.option_ids)||answer.option_ids.some(id=>!q.options.some(o=>o.id===id))||answer.other!==null&&!answer.other.trim()||!q.multiple&&answer.option_ids.length+(answer.other===null?0:1)>1||q.required&&answer.option_ids.length+(answer.other===null?0:1)===0)sourceInvalid();}
  if(draft.questions.some(q=>q.required&&(q.segment_id===null||a.selected_segment_ids.includes(q.segment_id))&&!a.answers.some(x=>x.question_id===q.id)))sourceInvalid();
  return{userId:row.userId,responseVersion:row.responseVersion,revision:row.revision,answer:{...a,selected_segment_ids:[...a.selected_segment_ids].sort(),location_ids:[...a.location_ids].sort(),answers:a.answers.map(x=>({...x,option_ids:[...x.option_ids].sort()})).sort((x,y)=>x.question_id.localeCompare(y.question_id))}};
 }).sort((a,b)=>a.userId.localeCompare(b.userId));
 // Server time is sampled after all state reads, not supplied by the caller.
 const now=new Date(),state=effectiveSurveyStatus(survey,now);if(state==='draft')sourceInvalid();
 const segmentRefs=new Map(activity.segments.map((s,i)=>[s.id,`s${i+1}`]));
 const currentJoined=new Set<string>();let joinedSeats=0;
 for(const s of activity.segments){if(!unique(s.participations.map(p=>p.userId))||s.participations.some(p=>!['joined','exited'].includes(p.status)||p.acceptedPlanRevision!==null&&(!Number.isSafeInteger(p.acceptedPlanRevision)||p.acceptedPlanRevision<1||p.acceptedPlanRevision>s.planRevision)))sourceInvalid();if(!s.cancelledAt)for(const p of s.participations)if(p.status==='joined'){currentJoined.add(p.userId);joinedSeats++;}}
 const respondents=new Set(answers.map(a=>a.userId)),respondentsJoined=answers.filter(a=>currentJoined.has(a.userId)).length;
 const counts=(s:typeof activity.segments[number])=>{const joined=s.participations.filter(p=>p.status==='joined');const accepted=joined.filter(p=>p.acceptedPlanRevision===s.planRevision).length;return{occupied:joined.length,accepted,pending:joined.length-accepted};};
 const aggregate:CoordinationAggregate={population:'all_recorded_responses',respondent_count:answers.length,joined_people_count:currentJoined.size,joined_seat_count:joinedSeats,respondents_with_active_seats:respondentsJoined,respondents_without_active_seats:answers.length-respondentsJoined,joined_people_without_response:[...currentJoined].filter(id=>!respondents.has(id)).length,
  segments:activity.segments.map(s=>{const c=counts(s);return{segment_ref:segmentRefs.get(s.id)!,state:s.cancelledAt?'cancelled' as const:now>=s.startsAt?'started' as const:'planned' as const,intent_respondent_count:answers.filter(a=>a.answer.selected_segment_ids.includes(s.id)).length,occupied_count:c.occupied,accepted_count:c.accepted,pending_acceptance_count:c.pending};}),
  questions:draft.questions.map((q,i)=>{const applicable=answers.flatMap(a=>a.answer.answers.filter(x=>x.question_id===q.id));return{question_ref:`q${i+1}`,segment_ref:q.segment_id===null?null:segmentRefs.get(q.segment_id)!,multiple:q.multiple,required:q.required,respondent_count:applicable.length,options:q.options.map((o,j)=>({option_ref:`q${i+1}_o${j+1}`,count:applicable.filter(a=>a.option_ids.includes(o.id)).length})),other_count:applicable.filter(a=>a.other!==null).length};}),
  locations:draft.locations.map((l,i)=>({location_ref:`l${i+1}`,count:answers.filter(a=>a.answer.location_ids.includes(l.id)).length})),
  free_text:{time_preferences_count:answers.filter(a=>a.answer.time_preferences.trim()).length,budget_note_count:answers.filter(a=>a.answer.budget_note.trim()).length,preferences_count:answers.filter(a=>a.answer.preferences.trim()).length,question_other_count:answers.reduce((n,a)=>n+a.answer.answers.filter(x=>x.other!==null).length,0),location_other_count:answers.filter(a=>a.answer.location_other!==null).length}
 };
 if(!Number.isFinite(Date.parse(draft.starts_at))||!Number.isFinite(Date.parse(draft.deadline_at))||!/(?:Z|[+-]\d{2}:\d{2})$/.test(draft.starts_at)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(draft.deadline_at))sourceInvalid();
 const normalizedDraft={...draft,starts_at:new Date(draft.starts_at).toISOString(),deadline_at:new Date(draft.deadline_at).toISOString()};
 const fingerprint=hash({version:'coordination-source-v1',privacy:'aggregate-no-free-text-v1',survey:{...survey,draft:normalizedDraft,effectiveStatus:state},activity:{...activity,segments:activity.segments.map(s=>({...s,participations:[...s.participations].sort((a,b)=>a.userId.localeCompare(b.userId)),hasStarted:now>=s.startsAt,joinClosed:!!s.cancelledAt||now>=s.deadlineAt||now>=s.startsAt}))},responses:answers.map(a=>({userId:a.userId,responseVersion:a.responseVersion,revision:a.revision,publicAnswersDigest:hash(a.answer)}))});
 const allJoined=new Set(activity.segments.flatMap(s=>s.participations.filter(p=>p.status==='joined').map(p=>p.userId)));
 const memberRefs=new Map([...allJoined].sort().map((id,i)=>[id,`p${i+1}`]));
 const validatorActorId=memberRefs.get(actorId)??'manager';
 const main=activity.segments.find(s=>s.id===activity.mainSegmentId)!;const mainCounts=counts(main);
 const primaryFormed=!!activity.confirmedAt&&activity.confirmedMainRevision===activity.mainRevision&&activity.confirmedPlanRevision===main.planRevision&&mainCounts.occupied>=main.minimumParticipants&&mainCounts.pending===0&&main.verificationStatus==='manual_checked';
 const snapshotResult=aiSnapshotSchema.safeParse({activity_id:'activity',revision:activity.revision,now:now.toISOString(),manager_id:validatorActorId,status:'active',primary_segment_id:segmentRefs.get(main.id),primary_formed:primaryFormed,
  segments:activity.segments.map(s=>{const c=counts(s);return{id:segmentRefs.get(s.id),revision:s.planRevision,status:s.cancelledAt?'cancelled':now>=s.startsAt?'started':'planned',starts_at:s.startsAt.toISOString(),ends_at:s.endsAt.toISOString(),deadline_at:s.deadlineAt.toISOString(),location:{id:`place_${segmentRefs.get(s.id)}`,label:'共同活动地点（名称未外发）'},locked:!!s.cancelledAt||now>=s.startsAt,location_locked:true,minimum:s.minimumParticipants,capacity:s.capacity,occupied:c.occupied,accepted:c.accepted,pending_acceptance:c.pending,member_ids:s.participations.filter(p=>p.status==='joined').map(p=>memberRefs.get(p.userId)!),fee_minor:null,verified:s.verificationStatus==='manual_checked',booked:s.bookingStatus==='manual_booked'};}),
  transfers:activity.segments.filter(s=>!s.cancelledAt).slice(1).map((s,i)=>({from:segmentRefs.get(activity.segments.filter(x=>!x.cancelledAt)[i].id),to:segmentRefs.get(s.id),minutes:null})),time_constraints:[]});
 if(!snapshotResult.success)sourceInvalid();
 const snapshot=snapshotResult.data;
 const contextResult=coordinationContextSchema.safeParse({source_fingerprint:fingerprint,collection_id:survey.id,activity_id:activity.id,server_time:now.toISOString(),collection_state:state,aggregate,
  limitations:['仅汇总全部有效答卷；填写意向不等于报名、席位或接受正式安排。取消段保留历史记录，已加入总人数和总席位仅计未取消段。','时间、预算及其他自由文字未结构化，也未外发；不能据计数证明全员约束兼容。','私人出发位置、路线、个人资料及逐人标识未纳入；不承诺聚合数据绝对无法重识别。','共同地点只用本源内占位引用，转场耗时未知；没有查地图、库存、报价或预订。','候选生成与应用能力未配置；不排序或舍弃成员，不自动更新活动。'],capabilities:{generate:false,apply:false}});
 if(!contextResult.success)sourceInvalid();
 const context=contextResult.data;
 return{context,snapshot,validatorActorId};
}
/** Each invocation starts a NEW RepeatableRead transaction. Rechecking this same tx is not freshness proof. */
export function readCoordinationSourceOnce(collectionId:string,actorId:string):Promise<CoordinationSource>{
 return withDb(db=>db.$transaction(tx=>readCoordinationSourceTx(tx,collectionId,actorId),{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead}));
}

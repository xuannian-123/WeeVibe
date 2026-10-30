import { createHash } from 'node:crypto';
import { gatheringQuestions,gatheringPublicBlocks, gatheringPublicIntakeSchema, gatheringAnswersSchema, privateGatheringQuestion, type GatheringDetails, type GatheringSnapshot } from '@weevibe/contracts';

export type PublicGatheringRow = {userId:string;publicIntake:unknown;answers:unknown;responseVersion:number};
/** No privateIntake, avatar, name, person IDs or raw questionnaire prose enters AI. */
export function gatheringModelSource(details: GatheringDetails, rows: PublicGatheringRow[],kind:string='friend') {
  return {date:details.date,start_time:details.start_time,end_date:details.end_date,end_time:details.end_time,
    title:details.title,description:details.description,place:details.place,address:details.address,
    candidate_places:details.candidate_places.map(p=>p.label),
    ...(kind==='team'?{question_summary:gatheringTeamStatistics(details,rows).questions.filter(q=>!q.private)}:{}),
    people:[...(kind==='team'?[]:rows)].sort((a,b)=>a.userId.localeCompare(b.userId)).filter(r=>r.responseVersion>0).map((row,index)=>({person_ref:`p${index+1}`,blocks:gatheringPublicBlocks(row.publicIntake)})),
  };
}
export function gatheringSourceFingerprint(details: GatheringDetails, rows: PublicGatheringRow[],kind:string='friend') {
  // Include even unsubmitted members: joining during generation must invalidate it.
  // The opaque fingerprint is manager-only; IDs and raw answers never enter AI.
  const roster=[...rows].sort((a,b)=>a.userId.localeCompare(b.userId)).map(row=>({userId:row.userId,version:row.responseVersion}));
  return createHash('sha256').update(JSON.stringify({details,roster,source:gatheringModelSource(details,rows,kind)})).digest('hex');
}
export function gatheringTeamStatistics(details: GatheringDetails, rows: PublicGatheringRow[]): NonNullable<GatheringSnapshot['stats']> {
  const submitted=rows.filter(r=>r.responseVersion>0);
  return {respondent_count:submitted.length,questions:gatheringQuestions(details).map(question=>{
    const hidden=privateGatheringQuestion(question);
    const answers=hidden?[]:submitted.flatMap(row=>gatheringAnswersSchema.parse(row.answers).filter(a=>a.question_id===question.id));
    return {id:question.id,title:question.title,type:question.type,private:hidden,
      response_count:answers.filter(a=>a.option_ids.length||a.other||a.text).length,
      options:hidden?[]:question.options.map(o=>({id:o.id,label:o.label,count:answers.filter(a=>a.option_ids.includes(o.id)).length})),
      other_count:answers.filter(a=>a.other).length};
  })};
}
export function parsePublicGatheringRow(row:PublicGatheringRow) {
  return {...row,publicIntake:gatheringPublicIntakeSchema.parse(row.publicIntake),answers:gatheringAnswersSchema.parse(row.answers)};
}

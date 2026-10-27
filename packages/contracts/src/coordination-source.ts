import { z } from 'zod';
import { activityIdSchema } from './activities';
const count=z.number().int().nonnegative();
const ref=z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
export const coordinationAggregateSchema=z.object({
 population:z.literal('all_recorded_responses'), respondent_count:count,
 joined_people_count:count, joined_seat_count:count,
 respondents_with_active_seats:count, respondents_without_active_seats:count, joined_people_without_response:count,
 segments:z.array(z.object({segment_ref:ref,state:z.enum(['planned','started','cancelled']),intent_respondent_count:count,occupied_count:count,accepted_count:count,pending_acceptance_count:count}).strict()).max(64),
 questions:z.array(z.object({question_ref:ref,segment_ref:ref.nullable(),multiple:z.boolean(),required:z.boolean(),respondent_count:count,options:z.array(z.object({option_ref:ref,count}).strict()).max(20),other_count:count}).strict()).max(20),
 locations:z.array(z.object({location_ref:ref,count}).strict()).max(20),
 free_text:z.object({time_preferences_count:count,budget_note_count:count,preferences_count:count,question_other_count:count,location_other_count:count}).strict()
}).strict().superRefine((a,ctx)=>{
 const bad=()=>ctx.addIssue({code:'custom',message:'聚合人数不一致'});
 if(a.respondents_with_active_seats+a.respondents_without_active_seats!==a.respondent_count || a.respondents_with_active_seats+a.joined_people_without_response!==a.joined_people_count || a.joined_people_count>a.joined_seat_count)bad();
 if(new Set(a.segments.map(s=>s.segment_ref)).size!==a.segments.length || new Set(a.questions.map(q=>q.question_ref)).size!==a.questions.length || new Set(a.locations.map(l=>l.location_ref)).size!==a.locations.length)bad();
 for(const s of a.segments)if(s.accepted_count+s.pending_acceptance_count!==s.occupied_count || s.intent_respondent_count>a.respondent_count)bad();
 for(const q of a.questions){if(q.respondent_count>a.respondent_count || q.other_count>q.respondent_count || q.segment_ref!==null&&!a.segments.some(s=>s.segment_ref===q.segment_ref) || new Set(q.options.map(o=>o.option_ref)).size!==q.options.length)bad();for(const o of q.options)if(o.count>q.respondent_count)bad();}
 for(const l of a.locations)if(l.count>a.respondent_count)bad();
 for(const k of ['time_preferences_count','budget_note_count','preferences_count','location_other_count']as const)if(a.free_text[k]>a.respondent_count)bad();
});
export type CoordinationAggregate=z.infer<typeof coordinationAggregateSchema>;
export const coordinationContextSchema=z.object({
 source_fingerprint:z.string().regex(/^[a-f0-9]{64}$/),collection_id:activityIdSchema,activity_id:activityIdSchema,
 server_time:z.iso.datetime({offset:true}),collection_state:z.enum(['open','closed','finalized']),
 aggregate:coordinationAggregateSchema,limitations:z.array(z.string().min(1).max(400)).min(1).max(20),
 capabilities:z.object({generate:z.literal(false),apply:z.literal(false)}).strict()
}).strict();
export type CoordinationContext=z.infer<typeof coordinationContextSchema>;
export const coordinationGenerateRequestSchema=z.object({expected_source_fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type CoordinationGenerateRequest=z.infer<typeof coordinationGenerateRequestSchema>;

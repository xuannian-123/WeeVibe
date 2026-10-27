import { z } from 'zod';
import { activityIdSchema, activityDetailSchema, idempotencyKeySchema } from './activities';
const revision=z.number().int().min(1).max(2_147_483_647);
const instant=z.iso.datetime({offset:true});
export const createHandoverInputSchema=z.object({target_user_id:activityIdSchema,expected_revision:revision,expected_management_revision:revision,idempotency_key:idempotencyKeySchema}).strict();
export const handoverCommandSchema=z.object({action:z.enum(['accept','reject','withdraw']),expected_revision:revision,expected_management_revision:revision,idempotency_key:idempotencyKeySchema}).strict();
export const handoverCandidateSchema=z.object({user_id:activityIdSchema,display_name:z.string().max(40).nullable(),segment_ids:z.array(activityIdSchema).min(1)}).strict().refine(x=>new Set(x.segment_ids).size===x.segment_ids.length,'Duplicate candidate segments');
export const handoverOfferSchema=z.object({
 handover_id:activityIdSchema,activity_id:activityIdSchema,from_user_id:activityIdSchema,to_user_id:activityIdSchema,from_management_revision:revision,
 status:z.enum(['pending','accepted','rejected','withdrawn','invalidated']),created_at:instant,resolved_at:instant.nullable(),
 can_accept:z.boolean(),can_reject:z.boolean(),can_withdraw:z.boolean(),blocked_reason:z.string().nullable()
}).strict().superRefine((x,c)=>{if(x.from_user_id===x.to_user_id)c.addIssue({code:'custom',message:'Cannot transfer to self'});if((x.status==='pending')!==(x.resolved_at===null))c.addIssue({code:'custom',message:'Invalid resolution time'});if(x.status!=='pending'&&(x.can_accept||x.can_reject||x.can_withdraw))c.addIssue({code:'custom',message:'Resolved offer cannot be acted on'});});
export const handoverStateSchema=z.object({activity:activityDetailSchema,management_revision:revision,can_create:z.boolean(),candidates:z.array(handoverCandidateSchema),pending:handoverOfferSchema.nullable(),offer:handoverOfferSchema.nullable(),scope_notice:z.string()}).strict().superRefine((x,c)=>{
 const actor=x.activity.viewer.user_id;
 if(!actor)c.addIssue({code:'custom',message:'Handover state requires an authenticated viewer'});
 if(!x.activity.viewer.is_manager&&(x.candidates.length||x.can_create))c.addIssue({code:'custom',message:'Candidates are manager-only'});
 if(new Set(x.candidates.map(v=>v.user_id)).size!==x.candidates.length)c.addIssue({code:'custom',message:'Duplicate candidates'});
 for(const offer of [x.pending,x.offer])if(offer){if(offer.activity_id!==x.activity.activity_id)c.addIssue({code:'custom',message:'Wrong activity'});if(offer.can_accept||offer.can_reject){if(offer.to_user_id!==actor)c.addIssue({code:'custom',message:'Wrong recipient'});}if(offer.can_withdraw&&(!x.activity.viewer.is_manager||offer.from_user_id!==actor))c.addIssue({code:'custom',message:'Wrong manager'});}
 for(const offer of [x.pending,x.offer])if(offer?.status==='accepted'){
  if(x.management_revision<=offer.from_management_revision)c.addIssue({code:'custom',message:'Accepted handover must advance management revision'});
  if(x.management_revision===offer.from_management_revision+1&&x.activity.viewer.is_manager!==(actor===offer.to_user_id))c.addIssue({code:'custom',message:'Accepted handover current role is inconsistent'});
 }
 if(x.pending&&!x.activity.viewer.is_manager&&x.pending.to_user_id!==actor)c.addIssue({code:'custom',message:'Private pending belongs to another recipient'});
 if(x.offer&&!x.activity.viewer.is_manager&&x.offer.to_user_id!==actor&&x.offer.from_user_id!==actor)c.addIssue({code:'custom',message:'Private historical offer belongs to another actor'});
 if(x.pending&&x.pending.status!=='pending')c.addIssue({code:'custom',message:'Pending field must be pending'});
 if(x.can_create&&(x.pending!==null||x.activity.cancelled_at!==null||!x.candidates.length))c.addIssue({code:'custom',message:'Cannot create now'});
});
export type CreateHandoverInput=z.infer<typeof createHandoverInputSchema>;
export type HandoverCommand=z.infer<typeof handoverCommandSchema>;
export type HandoverCandidate=z.infer<typeof handoverCandidateSchema>;
export type HandoverOffer=z.infer<typeof handoverOfferSchema>;
export type HandoverState=z.infer<typeof handoverStateSchema>;

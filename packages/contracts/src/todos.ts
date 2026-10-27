import { z } from 'zod';
import { activityIdSchema, activityDetailSchema, createActivityInputSchema } from './activities';
const count=z.number().int().min(0).max(2_147_483_647),positive=count.min(1);
const instant=z.iso.datetime({offset:true});
export const todoCursorSchema=z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/);
export const todoItemSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('applications'),role:z.literal('manager'),application_count:positive}).strict(),
 z.object({kind:z.literal('missing'),role:z.literal('manager'),segment_count:positive,missing_seat_count:positive,closed_segment_count:count}).strict().refine(x=>x.closed_segment_count<=x.segment_count&&x.missing_seat_count>=x.segment_count,'Invalid missing counts'),
 z.object({kind:z.literal('review'),role:z.enum(['manager','self']),segment_count:positive,participant_segment_count:positive}).strict().refine(x=>x.participant_segment_count>=x.segment_count&&(x.role!=='self'||x.segment_count===x.participant_segment_count),'Invalid review counts'),
 z.object({kind:z.literal('handover'),role:z.enum(['manager','recipient']),invitation_count:z.literal(1)}).strict()
]);
export const todoActivitySchema=z.object({activity_id:activityIdSchema,title:createActivityInputSchema.shape.name,revision:activityDetailSchema.shape.revision,path:z.string(),items:z.array(todoItemSchema).min(1)}).strict().superRefine((x,c)=>{
 if(x.path!==`/pages/activity/index?id=${x.activity_id}`)c.addIssue({code:'custom',message:'Invalid todo target'});
 if(new Set(x.items.map(i=>`${i.kind}:${i.role}`)).size!==x.items.length)c.addIssue({code:'custom',message:'Duplicate todo kind/role'});
});
export const todoPageSchema=z.object({actor_id:activityIdSchema,server_time:instant,activities:z.array(todoActivitySchema).max(50),page:z.object({
 offset:count.max(2000).refine(v=>v%50===0),page_size:z.literal(50),candidate_count:count.max(50),returned_activity_count:count.max(50),has_more:z.boolean(),next_cursor:todoCursorSchema.nullable(),scope:z.literal('authorized_candidates'),snapshot_fingerprint:z.string().regex(/^[a-f0-9]{64}$/),valid_until:instant.nullable()
}).strict()}).strict().superRefine((x,c)=>{
 if(new Set(x.activities.map(a=>a.activity_id)).size!==x.activities.length)c.addIssue({code:'custom',message:'Duplicate todo activity'});
 if(x.page.returned_activity_count!==x.activities.length||x.activities.length>x.page.candidate_count)c.addIssue({code:'custom',message:'Invalid page count'});
 if(x.page.has_more?(x.page.candidate_count!==50||!x.page.next_cursor):x.page.next_cursor!==null)c.addIssue({code:'custom',message:'Invalid next cursor'});
 if(x.page.offset>0&&x.page.candidate_count===0)c.addIssue({code:'custom',message:'Noninitial candidate page cannot be empty'});
 if(x.page.offset+x.page.candidate_count>2000)c.addIssue({code:'custom',message:'Candidate page exceeds supported complete index'});
 if(x.page.has_more&&x.page.offset+x.page.candidate_count>=2000)c.addIssue({code:'custom',message:'No continuation beyond candidate index limit'});
 if(x.page.valid_until!==null&&Date.parse(x.page.valid_until)<=Date.parse(x.server_time))c.addIssue({code:'custom',message:'Expired todo snapshot'});
});
export type TodoItem=z.infer<typeof todoItemSchema>;
export type TodoActivity=z.infer<typeof todoActivitySchema>;
export type TodoPage=z.infer<typeof todoPageSchema>;

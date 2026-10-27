import { z } from 'zod';
import { activityIdSchema, activityFeeSchema, activityLocationSchema, activityDetailSchema, createActivityInputSchema, createActivitySegmentSchema } from './activities';
// Source metadata binds the authorized preview; it is NOT a new-create payload.
// No dates, main selection, accepted members, status, verification or booking.
export const rebookSegmentSchema=z.object({
 source_segment_id:activityIdSchema,
 position:activityDetailSchema.shape.segments.element.shape.position,
 type:createActivitySegmentSchema.shape.type,
 name:createActivitySegmentSchema.shape.name,
 minimum_participants:createActivitySegmentSchema.shape.minimum_participants,
 capacity:createActivitySegmentSchema.shape.capacity,
 location:z.object({name:activityLocationSchema.shape.name,address:activityLocationSchema.shape.address}).strict(),
 fee:activityFeeSchema,
 requirements:createActivitySegmentSchema.shape.requirements
}).strict().refine(x=>x.minimum_participants<=x.capacity,'最低人数不能超过上限');
export const rebookSourceSchema=z.object({
 source_activity_id:activityIdSchema,
 source_revision:activityDetailSchema.shape.revision,
 actor_id:activityIdSchema,
 server_time:z.iso.datetime({offset:true}),
 source_timezone:createActivityInputSchema.shape.timezone,
 name:createActivityInputSchema.shape.name,
 excluded_cancelled_count:z.number().int().min(0).max(2_147_483_647),
 segments:z.array(rebookSegmentSchema).min(1)
}).strict().superRefine((x,c)=>{
 if(new Set(x.segments.map(s=>s.source_segment_id)).size!==x.segments.length)c.addIssue({code:'custom',message:'来源环节标识重复'});
 if(new Set(x.segments.map(s=>s.position)).size!==x.segments.length)c.addIssue({code:'custom',message:'来源环节位置重复'});
 if(x.segments.some((s,i)=>i>0&&s.position<=x.segments[i-1].position))c.addIssue({code:'custom',message:'来源环节顺序不正确'});
});
export type RebookSource=z.infer<typeof rebookSourceSchema>;
export type RebookSegment=z.infer<typeof rebookSegmentSchema>;

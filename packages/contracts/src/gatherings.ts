import { z } from 'zod';
import { avatarAssetSchema } from './avatar';
import { idempotencyKeySchema } from './activities';
import { venueSelectionSchema } from './venues';
import {gatheringAvatarKeySchema} from './gathering-avatars';

const id = z.uuid();
const text = (max: number) => z.string().trim().max(max);
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const gatheringDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const date = new Date(v + 'T00:00:00Z'); return Number(v.slice(0,4)) >= 1 && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, '请选择有效日期');
const optionalDate = z.union([z.literal(''), gatheringDateSchema]);
const clock = z.union([z.literal(''), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)]);
const money = z.number().min(0).max(1_000_000).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001);
// Friends share one complete recommendation round; collection must fit the generator.
export const gatheringFriendMemberLimit=50;
export const gatheringKindSchema = z.enum(['friend', 'team']);
export const gatheringAnimalIds=['cat','dog','fox','rabbit','bear','panda','koala','tiger','lion','penguin','owl','capybara'] as const;
export const gatheringAnimalIdSchema=z.enum(gatheringAnimalIds);
export type GatheringAnimalId=typeof gatheringAnimalIds[number];
export const gatheringDetailKeys = ['date', 'title', 'start_time', 'end_date', 'end_time', 'place', 'address', 'description', 'approximate_time', 'minimum', 'capacity', 'fee'] as const;
export const gatheringQuestionSchema = z.object({
  id: key, title: text(200).min(1), type: z.enum(['single', 'multiple', 'text']), required: z.boolean(),
  options: z.array(z.object({ id: key, label: text(100).min(1) }).strict()).max(20),
}).strict().superRefine((q, ctx) => {
  if (q.type !== 'text' && q.options.length < 1 || new Set(q.options.map(o => o.id)).size !== q.options.length || new Set(q.options.map(o => o.label)).size !== q.options.length) ctx.addIssue({code:'custom',message:'请检查问题选项'});
});
export const gatheringDetailsSchema = z.object({
  date: optionalDate, title: text(100), start_time: clock, end_date: optionalDate, end_time: clock,
  place: text(200), address: text(300), description: text(500), approximate_time: text(200),
  minimum: z.number().int().min(1).max(500).nullable(), capacity: z.number().int().min(1).max(500).nullable(),
  fee: z.object({kind:z.enum(['unknown','per_person','total','per_hour']),amount:money.nullable(),note:text(500)}).strict(),
  place_venue: venueSelectionSchema.optional(),
  candidate_places: z.array(z.object({id:key,label:text(200).min(1),venue:venueSelectionSchema.optional()}).strict()).max(20),
  questions: z.array(gatheringQuestionSchema).max(20), deadline_at: z.iso.datetime({offset:true}).nullable(),
  confirmed_details: z.array(z.enum(gatheringDetailKeys)).max(gatheringDetailKeys.length),
}).strict().superRefine((d,ctx) => {
  const bad = (message:string) => ctx.addIssue({code:'custom',message});
  if(d.place_venue&&(d.place!==d.place_venue.name||d.address!==(d.place_venue.address??'')))bad('集合地点与地图记录不一致，请重新选择地点');
  if(d.candidate_places.some(p=>p.venue&&p.label!==p.venue.name))bad('候选地点与地图记录不一致，请重新选择地点');
  if (d.minimum !== null && d.capacity !== null && d.minimum > d.capacity) bad('最多人数不能少于最低人数');
  if (d.date && d.end_date && d.end_date < d.date) bad('结束日期不能早于活动日期');
  if (d.start_time && d.end_time && (!d.end_date || d.end_date === d.date) && d.end_time <= d.start_time) bad('结束时间应晚于开始时间');
  if (new Set(d.questions.map(q=>q.id)).size !== d.questions.length || new Set(d.candidate_places.map(p=>p.id)).size !== d.candidate_places.length) bad('问题或地点编号重复');
  if(d.questions.some(q=>q.id==='candidate_place_choice'))bad('候选地点题由系统根据候选地点生成，请勿重复添加');
});
export type GatheringDetails = z.infer<typeof gatheringDetailsSchema>;
export const gatheringKeywordGroups = ['eat','drink','play','pace','atmosphere','experience','arrangement','venue','environment','travel','exertion'] as const;
export const gatheringPublicIntakeSchema = z.object({
  activity_nickname:text(32).default(''),
  date: optionalDate, availability: text(200), note: text(1000),
  keyword_notes:z.object({eat:text(500).optional(),drink:text(500).optional(),play:text(500).optional()}).strict().optional(),
  selected_places:z.array(z.object({group:z.enum(['eat','drink','play']),option:text(40).min(1),venue:venueSelectionSchema}).strict()).max(10).optional(),
  keywords: z.record(z.enum(gatheringKeywordGroups), z.array(text(40).min(1)).max(20)),
  confirmed_keys: z.array(key).max(100),
}).strict();
export const gatheringPrivateIntakeSchema = z.object({
  preference_memory: z.object({use_history:z.boolean(),retain_automatic:z.boolean().optional(),suppressed_categories:z.array(z.enum(['play','travel','pace'])).max(3).optional(),automatic:z.record(z.string(),z.array(z.string().max(40)).max(20))}).strict().optional(),
  budget_min: money.nullable(), budget_max: money.nullable(), budget_note: text(200),
  origin: z.object({label:text(300),latitude:z.number().min(-90).max(90).optional(),longitude:z.number().min(-180).max(180).optional(),crs:z.literal('GCJ-02').optional()}).strict().refine(origin => {
    const coordinates=origin.latitude!==undefined||origin.longitude!==undefined||origin.crs!==undefined;
    return coordinates?origin.latitude!==undefined&&origin.longitude!==undefined&&origin.crs==='GCJ-02':origin.label.length>0;
  },'请填写出发地点，坐标需成对提供').nullable(),
  confirmed_keys: z.array(z.enum(['budget','origin'])).max(2),
}).strict().refine(v => v.budget_min === null || v.budget_max === null || v.budget_min <= v.budget_max, '预算最高不能低于最低').refine(v=>new Set(v.confirmed_keys).size===v.confirmed_keys.length,'私人确定项不能重复');
export const gatheringAnswersSchema = z.array(z.object({
  question_id:key, option_ids:z.array(key).max(20), other:text(500), text:text(1000),
}).strict()).max(21);
export const gatheringIntakeSchema = z.object({public:gatheringPublicIntakeSchema,private:gatheringPrivateIntakeSchema,answers:gatheringAnswersSchema}).strict();
export type GatheringIntake = z.infer<typeof gatheringIntakeSchema>;
export const gatheringBlockSchema = z.object({id:key,label:text(80).min(1),value:text(1000).min(1),confirmed:z.boolean()}).strict();
export type GatheringBlock = z.infer<typeof gatheringBlockSchema>;
export const gatheringCreateSchema = z.object({kind:gatheringKindSchema,idempotency_key:idempotencyKeySchema,details:gatheringDetailsSchema,intake:gatheringIntakeSchema}).strict();
export const gatheringDetailsUpdateSchema=z.object({expected_revision:z.number().int().positive(),details:gatheringDetailsSchema}).strict();
export const gatheringMemberSaveSchema = z.object({expected_version:z.number().int().nonnegative(),expected_revision:z.number().int().positive(),idempotency_key:idempotencyKeySchema,join_if_needed:z.boolean().optional(),intake:gatheringIntakeSchema}).strict();
export const gatheringPlanSegmentSchema = z.object({
  id:key,title:text(100).min(1),description:text(1200),date:optionalDate,start_time:clock,end_time:clock,
  place:text(200),address:text(300),fee_note:text(300),unknowns:z.array(text(300).min(1)).max(10),
}).strict();
export const gatheringItinerarySchema = z.object({
  plans:z.array(z.object({
    id:key,title:text(100).min(1),summary:text(300),
    segments:z.array(gatheringPlanSegmentSchema).min(1).max(12),
    notes:z.array(text(300).min(1)).max(12),
  }).strict()).min(2).max(3),
  notes:z.array(text(300).min(1)).max(12),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.plans.map(p=>p.id)).size!==v.plans.length||v.plans.some(p=>new Set(p.segments.map(s=>s.id)).size!==p.segments.length))ctx.addIssue({code:'custom',message:'方案或环节编号重复'});
});
export type GatheringItinerary = z.infer<typeof gatheringItinerarySchema>;
export const gatheringGenerateSchema = z.object({expected_source:z.string().regex(/^[a-f0-9]{64}$/),idempotency_key:idempotencyKeySchema}).strict();
export const gatheringFinalizeSchema = z.object({expected_source:z.string().regex(/^[a-f0-9]{64}$/),generation_id:id,plan_id:key}).strict();
export const gatheringPersonSchema = z.object({user_id:id,nickname:text(32),avatar:avatarAssetSchema.nullable(),animal_id:gatheringAnimalIdSchema.optional(),avatar_key:gatheringAvatarKeySchema.optional()}).strict();
export const gatheringMemberPublicSchema = z.object({person:gatheringPersonSchema,blocks:z.array(gatheringBlockSchema).max(100),submitted:z.boolean()}).strict();
export const gatheringStatsSchema = z.object({
  respondent_count:z.number().int().nonnegative(),
  questions:z.array(z.object({id:key,title:text(200),type:z.enum(['single','multiple','text']),response_count:z.number().int().nonnegative(),private:z.boolean(),options:z.array(z.object({id:key,label:text(100),count:z.number().int().nonnegative()}).strict()),other_count:z.number().int().nonnegative()}).strict()),
}).strict();
export const gatheringSummarySchema = z.object({id,kind:gatheringKindSchema,title:text(100),date:optionalDate,stage:z.enum(['collecting','arranged']),is_owner:z.boolean(),has_responded:z.boolean(),member_count:z.number().int().positive(),updated_at:z.iso.datetime()}).strict();
export type GatheringSummary = z.infer<typeof gatheringSummarySchema>;
export const gatheringSnapshotSchema = z.object({
  gathering:gatheringSummarySchema.extend({details:gatheringDetailsSchema,owner:gatheringPersonSchema,revision:z.number().int().positive()}),
  viewer:z.object({is_owner:z.boolean(),is_member:z.boolean(),can_respond:z.boolean(),can_generate:z.boolean()}).strict(),
  own:z.object({version:z.number().int().nonnegative(),intake:gatheringIntakeSchema,blocks:z.array(gatheringBlockSchema).max(100)}).strict().nullable(),
  members:z.array(gatheringMemberPublicSchema).max(10).nullable(),next_member_cursor:id.nullable(),
  stats:gatheringStatsSchema.nullable(),source_fingerprint:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  itinerary:gatheringItinerarySchema.extend({generation_id:id,generated_at:z.iso.datetime(),stale:z.boolean()}).nullable(),
  final_choice:z.object({generation_id:id,plan_id:key,finalized_at:z.iso.datetime()}).strict().nullable(),
  generation:z.object({id,status:z.enum(['processing','ready','failed']),error:text(100).nullable()}).strict().nullable(),
  workflow:z.object({version:z.number().int().positive(),generation_id:id,phase:z.enum(['selecting','confirming','adjusting','completed']),stale:z.boolean(),proposal_plan_id:key.nullable(),proposal_version:z.number().int().nonnegative(),coordination_note:text(300),total:z.number().int().nonnegative(),selected_count:z.number().int().nonnegative(),accepted_count:z.number().int().nonnegative(),rejected_count:z.number().int().nonnegative(),own_selection:z.object({version:z.number().int().nonnegative(),plan_ids:z.array(key),note:text(300)}).nullable(),own_confirmation:z.object({version:z.number().int().nonnegative(),proposal_version:z.number().int().nonnegative(),decision:z.enum(['accept','reject']),note:text(300)}).nullable(),people:z.array(z.object({person:gatheringPersonSchema,plan_ids:z.array(key),note:text(300),decision:z.enum(['accept','reject']).nullable()})),final_plan:gatheringItinerarySchema.shape.plans.element.nullable()}).optional(),
  server_time:z.iso.datetime(),
}).strict().superRefine((value,ctx)=>{
  if(value.gathering.kind==='friend'&&[value.gathering.owner,...(value.members?.map(member=>member.person)??[])].some(person=>!person.animal_id||person.avatar!==null))ctx.addIssue({code:'custom',message:'朋友出游只展示活动昵称与动物头像'});
});
export type GatheringSnapshot = z.infer<typeof gatheringSnapshotSchema>;
export const gatheringListSchema=z.object({gatherings:z.array(gatheringSummarySchema).max(100)}).strict();
export const gatheringMembersPageSchema=z.object({members:z.array(gatheringMemberPublicSchema).max(10),next_cursor:id.nullable()}).strict().superRefine((value,ctx)=>{
  if(value.members.some(member=>!member.person.animal_id||member.person.avatar!==null))ctx.addIssue({code:'custom',message:'朋友出游只展示活动昵称与动物头像'});
});
export const gatheringOrganizePublicSchema=gatheringPublicIntakeSchema.omit({activity_nickname:true});
export const gatheringOrganizeSchema=z.object({public:gatheringOrganizePublicSchema}).strict();
export const gatheringOrganizedSchema=z.object({summary:text(1200),blocks:z.array(gatheringBlockSchema).max(100),source:z.literal('ai')}).strict();
export const gatheringSubscriptionConfigSchema=z.object({enabled:z.boolean(),template_id:text(200).min(1).nullable(),scope:text(100).min(1).nullable(),authorization:z.literal('one_time_intent')}).strict().refine(value=>value.enabled?value.template_id!==null&&value.scope!==null:value.template_id===null&&value.scope===null,'订阅配置不完整');
export const gatheringSubscriptionIntentSchema=z.object({gathering_id:id,authorization_key:idempotencyKeySchema,template_id:text(200).min(1),result:z.enum(['accept','reject','ban'])}).strict();
export const gatheringSubscriptionIntentResultSchema=z.object({recorded:z.boolean(),available_intents:z.number().int().nonnegative(),authorization:z.literal('one_time_intent')}).strict();

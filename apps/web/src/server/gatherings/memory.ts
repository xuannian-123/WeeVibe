import {preferenceMemoryCommandSchema} from '@weevibe/contracts';
import type {GatheringIntake} from '@weevibe/contracts';
import type {Tx} from '../activities/state';
import {mutation} from '../activities/mutation';
import {ServiceError} from '../http';
import {aggregate,allowed,categories,type Category,type Evidence} from './memory-rules';
type Settings={userId:string;learning:boolean;recommending:boolean;version:number;profileVersion:number;barriers:Partial<Record<Category,string>>;overrides:Partial<Record<Category,string[]>>};
export async function memorySettings(tx:Tx,actor:string,create=false){
 if(create)await tx.$executeRaw`INSERT INTO "PreferenceMemory" ("userId") VALUES (${actor}::uuid) ON CONFLICT DO NOTHING`;
 const rows=await tx.$queryRaw<Settings[]>`SELECT * FROM "PreferenceMemory" WHERE "userId"=${actor}::uuid FOR UPDATE`;return rows[0];
}
async function view(tx:Tx,actor:string){
 const s=await memorySettings(tx,actor);if(!s)return {learning:false,recommending:false,version:0,profile_version:0,profiles:[],pending:0,failed:0};
 const evidence=await tx.$queryRaw<(Evidence&{values:string[]})[]>`SELECT category, "values","sourceId","occurredAt" FROM "PreferenceEvidence" WHERE "userId"=${actor}::uuid`;
 const jobs=await tx.$queryRaw<{status:string;count:bigint}[]>`SELECT status,count(*) FROM "PreferenceLearningJob" WHERE "userId"=${actor}::uuid AND status IN ('pending','failed') GROUP BY status`;
 return {learning:s.learning,recommending:s.recommending,version:s.version,profile_version:s.profileVersion,profiles:aggregate(evidence,s.overrides),pending:Number(jobs.find(j=>j.status==='pending')?.count??0),failed:Number(jobs.find(j=>j.status==='failed')?.count??0)};
}
export const readMemory=(actor:string)=>mutation(tx=>view(tx,actor));
export async function changeMemory(actor:string,raw:unknown){
 const parsed=preferenceMemoryCommandSchema.safeParse(raw);if(!parsed.success)throw new ServiceError('INVALID_INPUT',400,'请检查偏好记忆操作');
 return mutation(async tx=>{const s=(await memorySettings(tx,actor,true))!,c=parsed.data;
 let learning=s.learning,recommending=s.recommending;const barriers={...s.barriers},overrides={...s.overrides};
 if(c.action==='settings'){learning=c.learning;recommending=c.recommending;}
 else for(const category of c.action==='clear'?categories:[c.category]){
  if(c.action==='correct'){const values=allowed(category,c.values);if(!values.length)throw new ServiceError('INVALID_INPUT',400,'请选择现有分类中的偏好');overrides[category]=values;}
  else {delete overrides[category];if(c.action!=='revoke'){barriers[category]=new Date().toISOString();await tx.$executeRaw`DELETE FROM "PreferenceEvidence" WHERE "userId"=${actor}::uuid AND category=${category}`;}}
 }
 await tx.$executeRaw`UPDATE "PreferenceMemory" SET learning=${learning},recommending=${recommending},version=version+1,"profileVersion"="profileVersion"+1,barriers=${JSON.stringify(barriers)}::jsonb,overrides=${JSON.stringify(overrides)}::jsonb WHERE "userId"=${actor}::uuid`;
 const result=await view(tx,actor);await tx.$executeRaw`UPDATE "PreferenceMemory" SET profile=${JSON.stringify(result.profiles)}::jsonb WHERE "userId"=${actor}::uuid`;return result;});
}
/** Queue only a reference after a successful structured save, within its business transaction. */
export async function enqueueMemory(tx:Tx,actor:string,source:string,version:number){
 const s=await memorySettings(tx,actor);if(!s?.learning)return;
 await tx.$executeRaw`INSERT INTO "PreferenceLearningJob" ("userId","sourceId","sourceVersion",epoch) VALUES (${actor}::uuid,${source}::uuid,${version},${s.version}) ON CONFLICT DO NOTHING`;
}
/** Remove unchanged autofill from the shared projection; retain provenance only in own private intake. */
export function separateAutomatic(intake:GatheringIntake){
 const automatic=intake.private.preference_memory?.automatic??{};
 for(const category of categories)if(automatic[category]&&JSON.stringify(intake.public.keywords[category])===JSON.stringify(automatic[category])&&!intake.public.selected_places?.some(p=>p.group===category)){intake.public.keywords[category]=[];intake.public.confirmed_keys=intake.public.confirmed_keys.filter(key=>!key.startsWith(category+'_'));}
 return intake;
}
export async function memoryDefaultsTx(tx:Tx,actor:string){const v=await view(tx,actor);return v.recommending?v.profiles:[];}
export async function processMemoryJob(id:string){
 return mutation(async tx=>{
 const jobs=await tx.$queryRaw<{userId:string;sourceId:string;sourceVersion:number;epoch:number;status:string}[]>`SELECT * FROM "PreferenceLearningJob" WHERE id=${id}::uuid`;const job=jobs[0];if(!job)return;
 const s=await memorySettings(tx,job.userId); // Same user lock as pause/delete, before writing anything.
 const locked=await tx.$queryRaw<{status:string;attempts:number}[]>`SELECT status,attempts FROM "PreferenceLearningJob" WHERE id=${id}::uuid FOR UPDATE`;
 if(locked[0]?.status!=='pending')return;
 const member=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:job.sourceId,userId:job.userId}}});
 const source=await tx.gathering.findUnique({where:{id:job.sourceId},select:{createdAt:true}});
 if(s?.learning&&s.version===job.epoch&&member?.responseVersion===job.sourceVersion&&source){
  const input=member.publicIntake as unknown as GatheringIntake['public'];
  for(const category of categories){
   if(s.barriers[category]&&source.createdAt<=new Date(s.barriers[category]!))continue;
   const values=allowed(category,input.keywords?.[category]);
   // Replace this source, never increment its weight. Unchanged values retain original time.
   if(values.length)await tx.$executeRaw`INSERT INTO "PreferenceEvidence" ("userId","sourceId",category,"sourceVersion","values","occurredAt") VALUES (${job.userId}::uuid,${job.sourceId}::uuid,${category},${job.sourceVersion},${JSON.stringify(values)}::jsonb,now()) ON CONFLICT ("userId","sourceId",category) DO UPDATE SET "sourceVersion"=EXCLUDED."sourceVersion","values"=EXCLUDED."values","occurredAt"=CASE WHEN "PreferenceEvidence"."values"=EXCLUDED."values" THEN "PreferenceEvidence"."occurredAt" ELSE EXCLUDED."occurredAt" END`;
   else await tx.$executeRaw`DELETE FROM "PreferenceEvidence" WHERE "userId"=${job.userId}::uuid AND "sourceId"=${job.sourceId}::uuid AND category=${category}`;
  }
  const result=await view(tx,job.userId);
  await tx.$executeRaw`UPDATE "PreferenceMemory" SET profile=${JSON.stringify(result.profiles)}::jsonb,"profileVersion"="profileVersion"+1 WHERE "userId"=${job.userId}::uuid`;
 }
 await tx.$executeRaw`UPDATE "PreferenceLearningJob" SET status='done' WHERE id=${id}::uuid`;
 });
}

/** Server-only minimal model projection. Never return other members' profiles to clients. */
export async function resolveMemoryRows(tx:Tx,rows:(import('./privacy').PublicGatheringRow&{gatheringId:string})[]){
 const resolved=[];const stamps=[];
 for(const row of rows){
  const member=await tx.gatheringMember.findUnique({where:{gatheringId_userId:{gatheringId:row.gatheringId,userId:row.userId}}});
  const context=(member?.privateIntake as unknown as GatheringIntake['private'])?.preference_memory;
  if(!context?.use_history){
   if(context?.retain_automatic){const input=JSON.parse(JSON.stringify(row.publicIntake)) as GatheringIntake['public'];for(const category of categories)if(!input.keywords[category].length)input.keywords[category]=allowed(category,context.automatic[category]);resolved.push({...row,publicIntake:input});}else resolved.push(row);continue;
  }
  const v=await view(tx,row.userId);stamps.push([row.userId,v.version,v.profile_version]);
  const input=JSON.parse(JSON.stringify(row.publicIntake)) as GatheringIntake['public'];
  const memoryCategories:string[]=[];
  if(v.recommending)for(const profile of v.profiles)if(!input.keywords[profile.category].length&&!context.suppressed_categories?.includes(profile.category)&&!input.keyword_notes?.[profile.category as 'play']){input.keywords[profile.category]=profile.values;memoryCategories.push(profile.category);}
  resolved.push({...row,publicIntake:input,memoryCategories});
 }
 return {rows:resolved,stamp:JSON.stringify(stamps)};
}

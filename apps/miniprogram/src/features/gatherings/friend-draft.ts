import {emptyGatheringDetails,gatheringDetailsSchema,type GatheringDetails,type GatheringIntake} from '@weevibe/contracts';
import {gatheringDetailsDraftSchema} from './details-validation';

/** New friend collections are built from preferences, never from hidden organizer settings. */
export function friendDetailsFromIntake(intake:GatheringIntake):GatheringDetails{
  return {...emptyGatheringDetails(),date:intake.public.date,confirmed_details:intake.public.date&&intake.public.confirmed_keys.includes('date')?['date']:[]};
}
/** Only for a fresh friend create. Retired questionnaire answers remain in the local draft. */
export function friendIntakeFromDraft(intake:GatheringIntake):GatheringIntake{
  return {...intake,answers:[]};
}
export function friendSupplement(raw:unknown):GatheringDetails|undefined{
  const details=gatheringDetailsDraftSchema.safeParse(raw).data;
  if(!details)return;
  if(details.title||details.start_time||details.end_date||details.end_time||details.place||details.address||details.description||details.approximate_time||details.place_venue||details.minimum!==null||details.capacity!==null||details.fee.amount!==null||details.fee.note||details.candidate_places.length||details.questions.length||details.deadline_at)return details;
}
/** Set order has no meaning; compare only normalized, schema-checked public values. */
export function sameGatheringDetails(left:GatheringDetails,right:GatheringDetails){
  const normalized=(value:GatheringDetails)=>{const details=gatheringDetailsSchema.parse(value);return {...details,confirmed_details:[...details.confirmed_details].sort()};};
  return JSON.stringify(normalized(left))===JSON.stringify(normalized(right));
}

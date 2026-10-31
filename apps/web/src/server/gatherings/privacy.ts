import { createHash } from 'node:crypto';
import { gatheringPublicBlocks, gatheringPublicIntakeSchema, gatheringAnswersSchema, type GatheringDetails } from '@weevibe/contracts';

export type PublicGatheringRow = {userId:string;publicIntake:unknown;answers:unknown;responseVersion:number};
export type GatheringRouteEvidence={from:string;to:string;distance_m:number;duration_seconds:number;source:{provider:'amap';source_api:string;checked_at:string};basis:'provider_estimate';includes_indoor_transfer:false;includes_activity_buffer:false;booking:'unknown'};
/** No privateIntake, avatar, name, person IDs or raw questionnaire prose enters AI. */
export function gatheringModelSource(details: GatheringDetails, rows: PublicGatheringRow[],kind:string='friend') {
  const venueEvidence=[
    details.place_venue&&details.place_venue.source.provider==='amap'?{label:details.place_venue.name,address:details.place_venue.address,source:details.place_venue.source}:null,
    ...details.candidate_places.map(place=>place.venue&&place.venue.source.provider==='amap'?{label:place.label,address:place.venue.address,source:place.venue.source}:null),
  ].filter((value):value is NonNullable<typeof value>=>value!==null);
  return {date:details.date,start_time:details.start_time,end_date:details.end_date,end_time:details.end_time,
    title:details.title,description:details.description,place:details.place,address:details.address,
    candidate_places:details.candidate_places.map(p=>p.label),
    // These are user-selected public map facts. Coordinates are GCJ-02 and
    // carry their provider source so the model can distinguish a selected
    // place from a name typed into the form.
    venue_evidence:venueEvidence,
    people:[...rows].sort((a,b)=>a.userId.localeCompare(b.userId)).filter(r=>r.responseVersion>0).map((row,index)=>({person_ref:`p${index+1}`,blocks:gatheringPublicBlocks(row.publicIntake)})),
  };
}
export function gatheringSourceFingerprint(details: GatheringDetails, rows: PublicGatheringRow[],kind:string='friend') {
  // Include even unsubmitted members: joining during generation must invalidate it.
  // The opaque fingerprint is manager-only; IDs and raw answers never enter AI.
  const roster=[...rows].sort((a,b)=>a.userId.localeCompare(b.userId)).map(row=>({userId:row.userId,version:row.responseVersion}));
  return createHash('sha256').update(JSON.stringify({details,roster,source:gatheringModelSource(details,rows,kind)})).digest('hex');
}
/** Public, provider-labelled venue pairs used as AI context. Coordinates stay
 * inside the server/provider boundary and are never sent to the model. */
export function gatheringVenuePairs(details:GatheringDetails){
  const venues=[
    details.place_venue&&details.place_venue.source.provider==='amap'?{label:details.place_venue.name,location:details.place_venue.location}:null,
    ...details.candidate_places.map(place=>place.venue&&place.venue.source.provider==='amap'?{label:place.label,location:place.venue.location}:null),
  ].filter((value):value is NonNullable<typeof value>=>value!==null);
  const unique=venues.filter((value,index)=>venues.findIndex(item=>item.label===value.label&&item.location.longitude===value.location.longitude&&item.location.latitude===value.location.latitude)===index).slice(0,6);
  return unique.length<2?[]:unique.slice(1).map(value=>({from:unique[0],to:value}));
}
export function parsePublicGatheringRow(row:PublicGatheringRow) {
  return {...row,publicIntake:gatheringPublicIntakeSchema.parse(row.publicIntake),answers:gatheringAnswersSchema.parse(row.answers)};
}

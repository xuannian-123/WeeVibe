import {classifyInspirationVenue,inspirationGroups} from './inspiration';
import {emptyGatheringIntake} from './gathering-rules';
import type {GatheringIntake} from './gatherings';
import {venueSchema,type Venue} from './venues';
export function inspirationConfirmedKeys(value:Pick<GatheringIntake['public'],'selected_places'|'keyword_notes'|'keywords'>){
 return (value.selected_places??[]).flatMap(place=>{
  const group=inspirationGroups.find(g=>g.id===place.group),index=group?.options.indexOf(place.option)??-1;
  return index>=0&&value.keywords[place.group].includes(place.option)&&value.keyword_notes?.[place.group]===`${place.option}：${place.venue.name}`?[`${place.group}_${index}`]:[];
 });
}
export function inspirationIntake(raw:Venue):GatheringIntake{
 const venue=venueSchema.parse(raw),choice=classifyInspirationVenue(venue),intake=emptyGatheringIntake();
 if(!choice){intake.public.note=`想去：${venue.name}`;intake.public.confirmed_keys=['note'];return intake;}
 intake.public.keywords[choice.group]=[choice.option];
 intake.public.keyword_notes={[choice.group]:`${choice.option}：${venue.name}`};
 intake.public.selected_places=[{...choice,venue:{name:venue.name,address:venue.address,location:venue.location,source:venue.source}}];
 intake.public.confirmed_keys=inspirationConfirmedKeys(intake.public);
 return intake;
}

import type {GatheringDetails} from '@weevibe/contracts';

/** Shared wording for the public reference values entered by the organizer. */
export function gatheringFeeLabel(fee:GatheringDetails['fee']):string{
  if(fee.amount===null)return '参考金额待商量';
  const amount=String(fee.amount);
  switch(fee.kind){
    case 'per_person':return `参考 ${amount} 元/人`;
    case 'total':return `参考总额 ${amount} 元`;
    case 'per_hour':return `参考 ${amount} 元/小时`;
    default:return `参考 ${amount} 元（口径待商量）`;
  }
}

export function gatheringPeopleLabel(details:GatheringDetails):string{
  const parts:string[]=[];
  if(details.minimum!==null)parts.push(`人数意向至少 ${details.minimum} 人`);
  if(details.capacity!==null)parts.push(`筹备填写上限 ${details.capacity} 人（含局头）`);
  return parts.join(' · ')||'人数待商量';
}

export function hasGatheringPublicDetails(details:GatheringDetails):boolean{
  return details.minimum!==null||details.capacity!==null||details.fee.amount!==null||!!details.fee.note.trim();
}

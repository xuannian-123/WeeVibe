import {z} from 'zod';
import {gatheringDetailsSchema,gatheringFriendMemberLimit,type GatheringDetails,type GatheringSnapshot} from '@weevibe/contracts';

// Retain incomplete cross-field drafts; every team save/preview still uses the full schema.
export const gatheringDetailsDraftSchema=z.object(gatheringDetailsSchema.shape).strict();

type TeamSection='details'|'questionnaire';
/** A team edit only publishes the fields actually offered by its page. */
export function gatheringConfirmedDetails(details:GatheringDetails,section:TeamSection){
  const keys:GatheringDetails['confirmed_details']=section==='questionnaire'
    ?['date','title','approximate_time']
    :['minimum','capacity','fee','start_time','place','address'];
  const hasValue=(key:GatheringDetails['confirmed_details'][number])=>key==='fee'?details.fee.amount!==null||!!details.fee.note:details[key]!==''&&details[key]!==null;
  return [...details.confirmed_details.filter(key=>!keys.includes(key)),...keys.filter(hasValue)];
}

/** Team editor errors remain readable without routing back to removed friend pages. */
export function gatheringDetailsIssue(details:GatheringDetails):{message:string}|undefined{
  const result=gatheringDetailsSchema.safeParse(details);
  if(!result.success){
    const issue=result.error.issues[0],field=String(issue.path[0]??'');
    const labels:Record<string,string>={date:'活动日期',end_date:'结束日期',start_time:'开始时间',end_time:'结束时间',title:'活动名称',description:'活动说明',place:'集合地点',address:'集合详细地址',minimum:'最低人数',capacity:'筹备人数上限',fee:'公开参考费用'};
    return {message:/[\u4e00-\u9fff]/.test(issue.message)?issue.message:`请检查${labels[field]||'团建安排'}的格式与范围。`};
  }
}

/** Validate team input before Number() can accept exponents, hex or fractional people. */
export function gatheringDetailNumberIssue({minimum,capacity,amount}:{minimum:string;capacity:string;amount:string},memberCount=1){
  for(const [label,raw]of[['人数意向',minimum],['筹备人数上限',capacity]]){
    const value=raw.trim();if(value&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>500))return `${label}请填写 1—500 的整数，或留空。`;
  }
  const money=amount.trim();if(money&&(!/^\d+(?:\.\d{0,2})?$/.test(money)||Number(money)>1_000_000))return '参考金额请填写 0—1000000 元的数字，最多保留两位小数，或留空。';
  if(capacity.trim()&&Number(capacity)<memberCount)return `筹备人数上限不能少于当前 ${memberCount} 位成员，包含发起人。`;
}

export function gatheringCapacityReached(snapshot:GatheringSnapshot){
  return snapshot.gathering.kind==='friend'&&!snapshot.viewer.is_member&&!snapshot.final_choice
    &&snapshot.gathering.member_count>=Math.min(snapshot.gathering.details.capacity??gatheringFriendMemberLimit,gatheringFriendMemberLimit);
}

import {Text,View} from '@tarojs/components';
import {gatheringQuestions,type GatheringDetails,type GatheringIntake} from '@weevibe/contracts';
import {gatheringFeeLabel,gatheringPeopleLabel} from './details-summary';
import {friendSupplement} from './friend-draft';

/** Only shown for pre-existing drafts or requests; it cannot edit or create conditions. */
export function GatheringSupplementRecord({details,title,pending=false,caption,answers=[]}:{details:GatheringDetails;title:string;pending?:boolean;caption?:string;answers?:GatheringIntake['answers']}){
  if(!friendSupplement(details)&&!answers.length)return null;
  const questions=gatheringQuestions(details);
  return <View className="gr-section gr-supplement-record">
    <Text className="gr-name">{title}</Text><Text className="gr-caption">{caption||(pending?'这些内容属于上次请求，将按原内容核对。':'本次只按偏好发起，以下单独填写的补充不会带入。')}</Text>
    {details.title&&<Text>名称：{details.title}</Text>}
    {(details.start_time||details.end_date||details.end_time)&&<Text>原时间：{[details.date,details.start_time].filter(Boolean).join(' ')}{details.end_date||details.end_time?` 至 ${[details.end_date||details.date,details.end_time].filter(Boolean).join(' ')}`:''}</Text>}
    {details.place&&<Text>原集合地点：{details.place}</Text>}{details.address&&<Text>{details.address}</Text>}{details.description&&<Text>{details.description}</Text>}{details.approximate_time&&<Text>{details.approximate_time}</Text>}
    {(details.minimum!==null||details.capacity!==null)&&<Text>{gatheringPeopleLabel(details)}</Text>}
    {(details.fee.amount!==null||details.fee.note)&&<><Text>{gatheringFeeLabel(details.fee)}</Text>{details.fee.note&&<Text>{details.fee.note}</Text>}</>}
    {details.candidate_places.length>0&&<Text>原地点候选：{details.candidate_places.map(place=>place.label).join('、')}</Text>}
    {details.questions.length>0&&<Text>原附加问题：{details.questions.map(question=>question.title).join('、')}</Text>}
    {answers.map(answer=>{const question=questions.find(question=>question.id===answer.question_id);const values=[...answer.option_ids.map(id=>question?.options.find(option=>option.id===id)?.label||`原选项 ${id}`),answer.other,answer.text].filter(Boolean);return <View className="gr-preference" key={answer.question_id}><Text className="gr-label">{question?.title||'原附加题回答'}</Text><Text>{values.join('、')||'未填写'}</Text></View>;})}
    {details.deadline_at&&<Text>原填写截止：{details.deadline_at}</Text>}
  </View>;
}

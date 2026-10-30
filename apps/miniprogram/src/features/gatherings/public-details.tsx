import {Text,View} from '@tarojs/components';
import type {GatheringDetails} from '@weevibe/contracts';
import {gatheringFeeLabel,gatheringPeopleLabel,hasGatheringPublicDetails} from './details-summary';
import './public-details.css';

/** Read-only public context; it does not calculate prices or alter participation. */
export function GatheringPublicDetails({details}:{details:GatheringDetails}){
  if(!hasGatheringPublicDetails(details))return null;
  const hasPeople=details.minimum!==null||details.capacity!==null;
  const hasFee=details.fee.amount!==null||!!details.fee.note.trim();
  return <View className="gp-panel gpd-panel">
    <Text className="gpd-title">人数与公开参考费用</Text>
    {hasPeople&&<View className="gpd-group">
      <Text className="gpd-label">人数</Text>
      <Text className="gpd-value">{gatheringPeopleLabel(details)}</Text>
      {details.minimum!==null&&<Text className="gpd-caption">人数意向供大家商量，不会自动成局。</Text>}
      {details.capacity!==null&&<Text className="gpd-caption">筹备上限约束本次提交填写的人数，包含局头。</Text>}
    </View>}
    {hasFee&&<View className="gpd-group">
      <Text className="gpd-label">发起人提供的公开参考</Text>
      <Text className="gpd-value">{gatheringFeeLabel(details.fee)}</Text>
      {!!details.fee.note.trim()&&<Text className="gpd-note">{details.fee.note}</Text>}
      <Text className="gpd-caption">各环节的实际费用仍需核实。个人预算仅在本人的填写中查看。</Text>
    </View>}
  </View>;
}

import { Text, View } from '@tarojs/components';
import type { RequirementSnapshot } from '@weevibe/contracts';
export function RequirementSummaryPanel({ snapshot }: { snapshot: RequirementSnapshot }) {
  const data = snapshot.aggregate;
  if (!data) return <View className="req-notice">当前后端未提供隐私汇总，请核对服务版本；不代表没有成员需求。</View>;
  return <View className="req-card mint"><Text className="req-heading">共同需求汇总</Text>
    <Text className="req-muted">{data.respondent_count} 人已提交，{data.time_respondent_count} 人填写时间意向。填写不等于报名。</Text>
    <Text className="req-label">预算上限意向</Text>
    <Text>{data.budget.structured_count ? `${data.budget.structured_count} 人填写的预算上限范围：¥${data.budget.min_max_yuan}–¥${data.budget.max_max_yuan}` : '尚无可汇总的数值预算'}</Text>
    <Text className="req-muted">这是预算上限的分布，不是活动报价，也不表示所有人都能接受范围的最高值。原文备注不公开。</Text>
    {data.budget.text_count > 0 && <Text className="req-muted">另有 {data.budget.text_count} 人填写预算备注；文字未被推断成金额。</Text>}
    <Text className="req-label">活动偏好</Text>{data.preferences.filter(x => x.count > 0).map(x => <Text key={x.label}>{x.label} · {x.count} 人</Text>)}
    <Text className="req-label">安排需注意</Text>{data.constraints.filter(x => x.count > 0).map(x => <Text key={x.label}>{x.label} · {x.count} 人</Text>)}
    {data.private_text_count > 0 && <Text className="req-muted">有 {data.private_text_count} 人补充私人文字；原文不向他人展示。可用上方选项表达需要共同遵守的限制。</Text>}
    {data.segments.map(s => <Text key={s.segment_id}>{snapshot.segments.find(x => x.id === s.segment_id)?.name || '环节'} · {s.count} 人有意向</Text>)}
    {data.questions.map(q => <View key={q.question_id}><Text className="req-label">{snapshot.collection.draft.questions.find(x => x.id === q.question_id)?.title || '问题'}</Text>{q.options.map(o => <Text key={o.option_id}>{snapshot.collection.draft.questions.find(x => x.id === q.question_id)?.options.find(x => x.id === o.option_id)?.label || '选项'} · {o.count} 人</Text>)}<Text className="req-muted">其他文字仅本人可见，不展示原文。</Text></View>)}
  </View>;
}

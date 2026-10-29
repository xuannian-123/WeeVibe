import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import { gatheringSections, type GatheringIntake } from '@weevibe/contracts';
import { GatheringOrigin } from '../gatherings/origin-search';
import './interview-inputs.css';

type Group = typeof gatheringSections[number]['groups'][number];
type Props = {
  index: number; value: GatheringIntake; session: string; disabled: boolean;
  budgetMin: string; budgetMax: string;
  publicChange: (patch: Partial<GatheringIntake['public']>) => void;
  privateChange: (patch: Partial<GatheringIntake['private']>) => void;
  minChange: (value: string) => void; maxChange: (value: string) => void;
  select: (group: Group, value: string) => void;
};
export function CInterviewInputs({ index, value, session, disabled, budgetMin, budgetMax, publicChange, privateChange, minChange, maxChange, select }: Props) {
  if (index === 0) return <View className="ci-inputs"><Text className="ci-field-label">出游日期</Text><Picker mode="date" value={value.public.date} disabled={disabled} onChange={event => publicChange({ date: String(event.detail.value) })}><View className="ci-control ci-picker">{value.public.date || '选择日期'}</View></Picker><Text className="ci-field-label">什么时间有空</Text><Input className="ci-control" value={value.public.availability} disabled={disabled} maxlength={200} adjustPosition cursorSpacing={24} placeholder="例如：下午2点后都可以" onInput={event => publicChange({ availability: event.detail.value })} /></View>;
  if (index === 1) return <GatheringOrigin appearance="c" session={session} value={value.private.origin} disabled={disabled} change={origin => privateChange({ origin })} />;
  if (index === 2) return <View className="ci-inputs"><Text className="ci-field-label">我的预算 · 仅本人</Text><View className="ci-money-row"><View><Text>最低（元）</Text><Input className="ci-control" type="digit" value={budgetMin} disabled={disabled} maxlength={12} placeholder="不限" adjustPosition cursorSpacing={24} onInput={event => minChange(event.detail.value)} /></View><View><Text>最高（元）</Text><Input className="ci-control" type="digit" value={budgetMax} disabled={disabled} maxlength={12} placeholder="不限" adjustPosition cursorSpacing={24} onInput={event => maxChange(event.detail.value)} /></View></View><Text className="ci-field-label">预算备注</Text><Input className="ci-control" value={value.private.budget_note} disabled={disabled} maxlength={200} adjustPosition cursorSpacing={24} placeholder="可以补充预算要求" onInput={event => privateChange({ budget_note: event.detail.value })} /><Text className="ci-input-hint">填 0 表示零元；选择愿意配合时不代填金额。</Text></View>;
  const sections = gatheringSections.filter(section => index === 3 ? section.id === 'do' : section.id !== 'do');
  return <View className="ci-inputs">{sections.map(section => <View className="ci-keyword-section" key={section.id}><Text className="ci-section-label">{section.title}</Text>{section.groups.map(group => <View key={group.id} className="ci-keyword-group"><Text className="ci-field-label">{group.title}</Text><View className="ci-keyword-options">{group.options.map(option => <Button className={value.public.keywords[group.id].includes(option) ? 'ci-keyword-selected' : ''} key={option} disabled={disabled} onClick={() => select(group, option)}>{option}</Button>)}</View></View>)}</View>)}{index === 4 && <><Text className="ci-field-label">补充想法</Text><Textarea className="ci-control ci-textarea" value={value.public.note} disabled={disabled} maxlength={1000} adjustPosition cursorSpacing={24} placeholder="补充公开偏好；预算和出发地请填私人项" onInput={event => publicChange({ note: event.detail.value })} /></>}</View>;
}


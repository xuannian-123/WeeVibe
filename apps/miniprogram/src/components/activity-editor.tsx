import { Button, Checkbox, CheckboxGroup, Label, Picker, Radio, RadioGroup, Text, View } from '@tarojs/components';
import { Field, Panel } from './ui';
import { emptySegment, feeOptions, typeOptions, type ActivityForm, type SegmentForm } from '../platform/activity-form';

export function ActivityEditor({ value, onChange, disabled }: { value: ActivityForm; onChange: (value: ActivityForm) => void; disabled: boolean }) {
  const changeSegment = (ref: string, patch: Partial<SegmentForm>) => onChange({ ...value, segments: value.segments.map(s => s.ref === ref ? { ...s, ...patch } : s) });
  function reorder(index: number, offset: number) {
    const items = [...value.segments]; const next = index + offset;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]]; onChange({ ...value, segments: items });
  }
  const dateTime = (s: SegmentForm, dateField: 'startDate' | 'endDate' | 'deadlineDate', timeField: 'startTime' | 'endTime' | 'deadlineTime', label: string) =>
    <View className="field"><Text>{label}（上海时间）</Text>
      <Picker mode="date" value={s[dateField]} disabled={disabled} onChange={e => changeSegment(s.ref, { [dateField]: e.detail.value })}><Button disabled={disabled}>{s[dateField] || '选择日期'}</Button></Picker>
      <Picker mode="time" value={s[timeField]} disabled={disabled} onChange={e => changeSegment(s.ref, { [timeField]: e.detail.value })}><Button disabled={disabled}>{s[timeField] || '选择时间'}</Button></Picker>
    </View>;
  return <View>
    <Panel title="活动与本人信息">
      <Field label="活动名称" value={value.name} disabled={disabled} onChange={name => onChange({ ...value, name })} />
      <Field label="本人活动昵称（只用于展示，不用于登录）" value={value.nickname} disabled={disabled} onChange={nickname => onChange({ ...value, nickname })} />
      <Text className="caption">日期时间统一 Asia/Shanghai（+08:00）。这是新建活动；添加或排序不会自动填写时间、费用或参加意愿。</Text>
    </Panel>
    {value.segments.map((s, index) => <Panel key={s.ref} title={`环节 ${index + 1}：${s.name || '待填写'}`}>
      <Picker mode="selector" range={typeOptions.map(t => t.label)} value={Math.max(0, typeOptions.findIndex(t => t.value === s.type))} disabled={disabled}
        onChange={e => changeSegment(s.ref, { type: typeOptions[Number(e.detail.value)].value })}><Button disabled={disabled}>类型：{typeOptions.find(t => t.value === s.type)?.label}</Button></Picker>
      <Field label="环节名称" value={s.name} disabled={disabled} onChange={name => changeSegment(s.ref, { name })} />
      {dateTime(s, 'startDate', 'startTime', '开始')}{dateTime(s, 'endDate', 'endTime', '结束')}{dateTime(s, 'deadlineDate', 'deadlineTime', '报名截止')}
      <Field label="地点名称（人工填写）" value={s.place} disabled={disabled} onChange={place => changeSegment(s.ref, { place })} />
      <Field label="明确地址" value={s.address} disabled={disabled} onChange={address => changeSegment(s.ref, { address })} />
      <Field label="参考费用（元，必须明确；确为免费才填0）" value={s.amount} numeric disabled={disabled || s.feeUnit === 'unknown'} onChange={amount => changeSegment(s.ref, { amount })} />
      <Picker mode="selector" range={feeOptions.map(f => f.label)} value={Math.max(0, feeOptions.findIndex(f => f.value === s.feeUnit))} disabled={disabled}
        onChange={e => changeSegment(s.ref, { feeUnit: feeOptions[Number(e.detail.value)].value })}><Button disabled={disabled}>费用单位：{feeOptions.find(f => f.value === s.feeUnit)?.label}</Button></Picker>
      <Field label="费用口径说明（例如参考人均／按多少人分摊，非已付款）" value={s.feeNote} disabled={disabled} onChange={feeNote => changeSegment(s.ref, { feeNote })} />
      <Field label="参加要求（无额外要求可明确填写“无”）" value={s.requirements} disabled={disabled} onChange={requirements => changeSegment(s.ref, { requirements })} />
      <Field label="最低成行人数" value={s.minimum} numeric disabled={disabled} onChange={minimum => changeSegment(s.ref, { minimum })} />
      <Field label="人数上限" value={s.capacity} numeric disabled={disabled} onChange={capacity => changeSegment(s.ref, { capacity })} />
      <Button disabled={disabled || index === 0} onClick={() => reorder(index, -1)}>上移</Button>
      <Button disabled={disabled || index === value.segments.length - 1} onClick={() => reorder(index, 1)}>下移</Button>
      <Button disabled={disabled || value.segments.length <= 1} onClick={() => {
        const segments = value.segments.filter(item => item.ref !== s.ref);
        onChange({ ...value, segments, attending: value.attending.filter(ref => ref !== s.ref), mainRef: value.mainRef === s.ref ? '' : value.mainRef });
      }}>删除未发布的此环节</Button>
    </Panel>)}
    <Button disabled={disabled} onClick={() => onChange({ ...value, segments: [...value.segments, emptySegment()] })}>添加环节</Button>
    <Panel title="唯一主环节（决定成局）">
      <RadioGroup onChange={e => onChange({ ...value, mainRef: e.detail.value })}>{value.segments.map((s, i) =>
        <Label key={s.ref} className="choice"><Radio value={s.ref} checked={value.mainRef === s.ref} disabled={disabled} /><Text>{s.name || `环节 ${i + 1}`}</Text></Label>)}</RadioGroup>
    </Panel>
    <Panel title="我本人参加哪些环节（可不参加而继续管理）">
      <CheckboxGroup onChange={e => onChange({ ...value, attending: e.detail.value })}>{value.segments.map((s, i) =>
        <Label key={s.ref} className="choice"><Checkbox value={s.ref} checked={value.attending.includes(s.ref)} disabled={disabled} /><Text>{s.name || `环节 ${i + 1}`}</Text></Label>)}</CheckboxGroup>
    </Panel>
  </View>;
}

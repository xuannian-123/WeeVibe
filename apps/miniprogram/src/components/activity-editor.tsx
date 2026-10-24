import { useState } from 'react';
import { Button, Checkbox, CheckboxGroup, Label, Picker, Radio, RadioGroup, Text, View } from '@tarojs/components';
import { Action, Field, Panel } from './ui';
import { emptySegment, feeOptions, segmentName, typeOptions, type ActivityForm, type SegmentForm } from '../platform/activity-form';
import './activity-editor.css';

export function ActivityEditor({ value, onChange, disabled }: { value: ActivityForm; onChange: (value: ActivityForm) => void; disabled: boolean }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const changeSegment = (ref: string, patch: Partial<SegmentForm>) => onChange({ ...value, segments: value.segments.map(s => s.ref === ref ? { ...s, ...patch } : s) });
  function reorder(index: number, offset: number) {
    const items = [...value.segments]; const next = index + offset;
    if (next < 0 || next >= items.length) return;
    [items[index], items[next]] = [items[next], items[index]]; onChange({ ...value, segments: items });
  }
  const dateTime = (s: SegmentForm, dateField: 'startDate' | 'endDate' | 'deadlineDate', timeField: 'startTime' | 'endTime' | 'deadlineTime', label: string) =>
    <View className="field"><Text className="field-label">{label}</Text><View className="date-time-row">
      <Picker mode="date" value={s[dateField] || (dateField === 'endDate' ? s.startDate : '')} disabled={disabled} onChange={e => changeSegment(s.ref, { [dateField]: e.detail.value })}>
        <Button className="picker-trigger" disabled={disabled}>{s[dateField] || (dateField === 'endDate' ? s.startDate : '') || '选择日期'}</Button>
      </Picker>
      <Picker mode="time" value={s[timeField]} disabled={disabled} onChange={e => changeSegment(s.ref, { [timeField]: e.detail.value })}>
        <Button className="picker-trigger" disabled={disabled}>{s[timeField] || '选择时间'}</Button>
      </Picker>
    </View></View>;
  return <View>
    <Panel title="这次想一起做什么？">
      <Field label="活动名称" value={value.name} disabled={disabled} onChange={name => onChange({ ...value, name })} placeholder="例如：周末打球，再一起吃饭" />
      <Text className="caption">先约一件事也可以。有后续安排时，再添加环节。</Text>
    </Panel>
    {value.segments.map((s, index) => {
      const customDeadline = !!s.deadlineDate || !!s.deadlineTime;
      const more = !!expanded[s.ref];
      return <Panel key={s.ref} title={value.segments.length === 1 ? '安排一下时间和地点' : `安排 ${index + 1} · ${segmentName(value, s) || '待填写'}`}>
        {value.segments.length > 1 && <Field label="这段做什么" value={s.name} disabled={disabled} onChange={name => changeSegment(s.ref, { name })} placeholder="例如：羽毛球、聚餐" />}
        {dateTime(s, 'startDate', 'startTime', '什么时候开始')}
        {dateTime(s, 'endDate', 'endTime', '预计什么时候结束')}
        <Text className="caption">结束默认同一天；跨天时可点日期修改。时间均为北京时间。</Text>
        <Field label="在哪里集合" value={s.place} disabled={disabled} onChange={place => changeSegment(s.ref, { place })} placeholder="填写大家能找到的场地或集合点" />
        <View className="form-pair">
          <Field label="至少几人成行" value={s.minimum} numeric disabled={disabled} onChange={minimum => changeSegment(s.ref, { minimum })} placeholder="人数" />
          <Field label="最多多少人" value={s.capacity} numeric disabled={disabled} onChange={capacity => changeSegment(s.ref, { capacity })} placeholder="人数" />
        </View>
        <View className="setting-summary">
          <Text>{s.feeUnit === 'unknown' ? '费用待确认' : '已设置参考费用'}</Text>
          <Text>{customDeadline ? `截止 ${s.deadlineDate} ${s.deadlineTime}` : '报名至本段开始时'}</Text>
        </View>
        <Button className="settings-toggle" onClick={() => setExpanded(current => ({ ...current, [s.ref]: !more }))}>{more ? '收起更多设置 −' : '费用、截止和更多设置 ＋'}</Button>
        {more && <View className="expanded-settings">
          {value.segments.length === 1 && <Field label="环节名称（可选）" value={s.name} disabled={disabled} onChange={name => changeSegment(s.ref, { name })} placeholder="不填则使用活动名称" />}
          <Text className="field-label">活动类型（可选）</Text>
          <Picker mode="selector" range={typeOptions.map(t => t.label)} value={Math.max(0, typeOptions.findIndex(t => t.value === s.type))} disabled={disabled}
            onChange={e => changeSegment(s.ref, { type: typeOptions[Number(e.detail.value)].value })}><Button className="picker-trigger" disabled={disabled}>{typeOptions.find(t => t.value === s.type)?.label}</Button></Picker>
          <Field label="详细地址（可选）" value={s.address} disabled={disabled} onChange={address => changeSegment(s.ref, { address })} placeholder="楼层、场地号或集合说明" />
          <Text className="field-label">参考费用</Text>
          <Picker mode="selector" range={feeOptions.map(f => f.label)} value={Math.max(0, feeOptions.findIndex(f => f.value === s.feeUnit))} disabled={disabled}
            onChange={e => changeSegment(s.ref, { feeUnit: feeOptions[Number(e.detail.value)].value })}><Button className="picker-trigger" disabled={disabled}>{feeOptions.find(f => f.value === s.feeUnit)?.label}</Button></Picker>
          {s.feeUnit !== 'unknown' && <Field label="参考金额（元）" value={s.amount} numeric disabled={disabled} onChange={amount => changeSegment(s.ref, { amount })} placeholder="实际免费才填 0" />}
          <Text className="caption">不确定可以保留“未知”，不会当成免费或已付款。</Text>
          <Field label="费用补充（可选）" value={s.feeNote} disabled={disabled} onChange={feeNote => changeSegment(s.ref, { feeNote })} placeholder="例如：按实际参加人数分摊" />
          <Field label="参加要求（可选）" value={s.requirements} disabled={disabled} onChange={requirements => changeSegment(s.ref, { requirements })} placeholder="需要自带什么、适合什么水平" />
          <View className="field"><Text className="field-label">报名截止</Text>
            {customDeadline ? <View>{dateTime(s, 'deadlineDate', 'deadlineTime', '自定义截止时间')}
              <Action variant="text" disabled={disabled} onClick={() => changeSegment(s.ref, { deadlineDate: '', deadlineTime: '' })}>恢复为本段开始时截止</Action>
            </View> : <View><Text className="caption">默认到本段开始时截止，也可以提前。</Text>
              <Action disabled={disabled || !s.startDate || !s.startTime} onClick={() => changeSegment(s.ref, { deadlineDate: s.startDate, deadlineTime: s.startTime })}>自定义截止时间</Action>
            </View>}
          </View>
          {value.segments.length > 1 && <View className="form-pair">
            <Action disabled={disabled || index === 0} onClick={() => reorder(index, -1)}>上移</Action>
            <Action disabled={disabled || index === value.segments.length - 1} onClick={() => reorder(index, 1)}>下移</Action>
          </View>}
          {value.segments.length > 1 && <Action variant="danger" disabled={disabled} onClick={() => {
            const segments = value.segments.filter(item => item.ref !== s.ref);
            onChange({ ...value, segments, attending: value.attending.filter(ref => ref !== s.ref), mainRef: value.mainRef === s.ref ? (segments.length === 1 ? segments[0].ref : '') : value.mainRef });
          }}>移除这段安排</Action>}
        </View>}
      </Panel>;
    })}
    <Action disabled={disabled} onClick={() => {
      const segments = value.segments.map(s => ({ ...s, name: segmentName(value, s) }));
      onChange({ ...value, segments: [...segments, emptySegment()] });
    }}>＋ 再加一段安排</Action>
    {value.segments.length > 1 && <Panel title="这次主要做什么？">
      <Text className="caption">选择主要环节，用它判断这场活动是否成局。其它环节可分别参加。</Text>
      <RadioGroup onChange={e => onChange({ ...value, mainRef: e.detail.value })}>{value.segments.map((s, i) =>
        <Label key={s.ref} className="choice"><Radio value={s.ref} checked={value.mainRef === s.ref} disabled={disabled} color="#27674f" /><Text>{s.name || `安排 ${i + 1}`}</Text></Label>)}</RadioGroup>
    </Panel>}
    <Panel title="我参加哪些安排？">
      <Text className="caption">勾选你本人参加的环节。不勾选时，你只负责组织，不占名额。</Text>
      <CheckboxGroup onChange={e => onChange({ ...value, attending: e.detail.value })}>{value.segments.map((s, i) =>
        <Label key={s.ref} className="choice"><Checkbox value={s.ref} checked={value.attending.includes(s.ref)} disabled={disabled} color="#27674f" /><Text>{segmentName(value, s) || `安排 ${i + 1}`}</Text></Label>)}</CheckboxGroup>
      <Field label="活动里的称呼（可选）" value={value.nickname} disabled={disabled} onChange={nickname => onChange({ ...value, nickname })} placeholder="方便朋友认出你" />
    </Panel>
  </View>;
}

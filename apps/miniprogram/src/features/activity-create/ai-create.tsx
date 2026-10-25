import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide } from '@tarojs/taro';
import { Button, Picker, Text, Textarea, View } from '@tarojs/components';
import type { AiCreateResponse } from '@weevibe/contracts';
import { api } from '../../platform/api';
import { Action, Notice, Panel } from '../../components/ui';
import { formatTime } from '../../platform/activities';
import { aiMissingSummary, formFromAiDraft } from './ai-form';
import type { ActivityForm } from './form';

export function AiCreate({ value, disabled, onApply }: { value: ActivityForm; disabled: boolean; onApply: (form: ActivityForm) => void }) {
  const [text, setText] = useState(''), [date, setDate] = useState('');
  const [result, setResult] = useState<AiCreateResponse>(), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const sequence = useRef(0), blocked = useRef(disabled); blocked.current = disabled;
  const invalidate = () => { sequence.current++; setBusy(false); setResult(undefined); setMessage(''); };
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => { if (disabled) invalidate(); }, [disabled]);
  useDidHide(invalidate);
  async function generate() {
    if (busy || disabled || !text.trim() || !date) return;
    const revision = ++sequence.current; setBusy(true); setResult(undefined); setMessage('');
    try {
      const data = await api.generateActivityDraft({ text: text.trim(), selected_date: date, source_revision: revision });
      if (revision !== sequence.current || blocked.current) return;
      if (data.draft.source_revision !== revision) throw new Error('草稿已过时，请重新生成。');
      setResult(data);
    } catch (error) { if (revision === sequence.current) setMessage(error instanceof Error ? error.message : '生成失败，原表单已保留。'); }
    finally { if (revision === sequence.current) setBusy(false); }
  }
  async function apply() {
    if (!result || disabled) return;
    const revision = sequence.current;
    const hasEdits = !!value.name || value.segments.length > 1 || value.segments.some(s => !!(s.name || s.place || s.startDate || s.startTime || s.minimum || s.capacity));
    if (hasEdits) {
      const answer = await Taro.showModal({ title: '用 AI 草稿替换当前安排？', content: '会替换当前活动名称和各段安排，并清空本人参加勾选。你的称呼会保留；确认后仍可修改。', confirmText: '替换安排' });
      if (!answer.confirm) return;
    }
    if (blocked.current || revision !== sequence.current) return;
    onApply(formFromAiDraft(result.draft, value.nickname)); setResult(undefined); setMessage('已填入表单，请补齐缺项、核对建议时间并勾选本人参加环节。');
  }
  return <Panel title="先说说你的想法">
    <Text className="caption">AI 帮你整理成草稿，也可以直接在下方手动填写。仅在你点击生成时，将这段描述交给模型服务处理。</Text>
    <Textarea className="create-ai-input" value={text} disabled={disabled} maxlength={1000} placeholder="例如：下午两点到四点打羽毛球，六点聚餐，以打球为主，至少4人、最多6人" onInput={e => { invalidate(); setText(e.detail.value); }} />
    <Picker mode="date" value={date} disabled={disabled} onChange={e => { invalidate(); setDate(e.detail.value); }}><Button className="picker-trigger" disabled={disabled}>活动日期：{date || '请选择'}</Button></Picker>
    <Action disabled={disabled || busy || !text.trim() || !date} onClick={() => { void generate(); }}>{busy ? '正在整理草稿…' : '让 AI 整理草稿'}</Action>
    {result && <View>
      <Text className="create-assist-title">{result.draft.name || '活动名称待补充'}</Text>
      {result.draft.segments.map((s, i) => <View key={s.ref} className="create-ai-segment">
        <Text className="create-assist-title">{i + 1}. {s.name || '安排待命名'}{s.ref === result.draft.primary_segment_ref ? ' · 建议主环节' : ''}</Text>
        <Text className="caption">{s.starts_at ? formatTime(s.starts_at) : '开始时间待补'} — {s.ends_at ? formatTime(s.ends_at) : '结束时间待补'}</Text>
        <Text className="caption">{s.location?.label || '地点待选择'} · 最低 {s.minimum ?? '待补'} 人 / 上限 {s.capacity ?? '待补'} 人</Text>
      </View>)}
      {result.notices.map(notice => <Text key={notice} className="caption">{notice}</Text>)}
      {aiMissingSummary(result.draft).map(item => <Text key={item} className="caption">待补充：{item}</Text>)}
      <Action disabled={disabled} onClick={() => { void apply().catch(() => setMessage('暂时无法填入草稿，原表单已保留。')); }}>确认填入表单</Action>
      <Action variant="text" disabled={disabled} onClick={() => setResult(undefined)}>放弃这份建议</Action>
    </View>}
    {message && <Notice>{message}</Notice>}
  </Panel>;
}

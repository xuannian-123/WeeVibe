import { useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import type { InvitationSourceView } from '@weevibe/contracts/src/invitations';
import { Action, Notice } from '../../components/ui';
import { formationProgress } from '../formation/progress';
import { ActivityArrangement } from './ActivityArrangement';
import { overviewModel, type DetailSection } from './overview-model';
import './invitation-overview.css';

type Props = {
  detail: ActivityDetail; sourceId?: string; source?: InvitationSourceView;
  sourceLoading?: boolean; sourceError?: string; busy: boolean;
  open: (section: DetailSection) => void; retrySource: () => void; refresh: () => void;
  suggest: () => void;
};
function localTime(value: string, date = false) {
  const parsed = new Date(Date.parse(value) + 8 * 3600000);
  if (!Number.isFinite(parsed.getTime())) return '时间待确认';
  const hhmm = parsed.toISOString().slice(11, 16);
  return date ? `${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日 ${hhmm}` : hhmm;
}
export function ActivityOverview({ detail, sourceId, source, sourceLoading, sourceError, busy, open, retrySource, refresh, suggest }: Props) {
  const [expanded, setExpanded] = useState(false);
  const model = overviewModel(detail), progress = formationProgress(detail);
  const segments = detail.segments;
  const first = segments[0], last = segments[segments.length - 1];
  const shareName = source?.inviter_display_name;
  const title = detail.cancelled_at ? '活动已取消' : detail.viewer.is_manager ? '我组织的活动' : sourceId ? '朋友的邀请' : '一起出发';
  return <View className="invitation-v1">
    <View className="iv-top"><Text className="iv-brand">wee<Text className="iv-brand-green">vibe</Text><Text className="iv-brand-star">*</Text></Text><Text className="iv-pill">{title}</Text></View>
    <Text className="iv-eyebrow">{detail.viewer.is_manager ? 'LET’S GET TOGETHER!' : "YOU’RE INVITED!"}</Text>
    <Text className="iv-title">{detail.name}</Text>
    <Text className="iv-subtitle">{detail.cancelled_at ? '保留原安排和参加记录' : '一场由朋友发起的活动'}</Text>
    <View className="iv-event-card">
      <View className="iv-host"><View className="iv-host-symbol"><Text>↗</Text></View><View className="iv-host-copy"><Text className="iv-small">{shareName ? '邀请分享者' : '发起人'}</Text><Text className="iv-host-name">{shareName || '昵称暂未公开'}{detail.viewer.is_manager && <Text className="iv-role"> · 你是当前管理者</Text>}</Text></View></View>
      <View className="iv-meta"><View className="iv-icon-calendar"/><Text>{first && last ? `${localTime(first.starts_at, true)}—${localTime(last.ends_at, first.starts_at.slice(0,10) !== last.ends_at.slice(0,10))}` : '时间待确认'}</Text></View>
      <View className="iv-meta"><View className="iv-icon-pin"/><Text>{segments.map(s => s.location.name).join(' → ') || '地点待确认'}</Text></View>
      <View className="iv-card-foot"><Text>{model.status}</Text><Text>{detail.cancelled_at ? '主环节历史占位' : '主环节'} {model.main?.counts.occupied_count ?? '—'} / {model.main?.capacity ?? '—'} 人</Text></View>
    </View>
    {detail.viewer.is_manager && <View className="iv-management-note"><Text>{progress.label}</Text><Text>{progress.guidance}</Text></View>}
    {sourceId !== undefined && !source && <View className="iv-source-notice"><Notice>{sourceLoading ? '正在核验邀请来源…' : sourceError || '邀请来源尚未核验，暂不能通过此入口申请。'}</Notice>{!sourceLoading && <Action disabled={busy} onClick={retrySource}>重新核验邀请来源</Action>}</View>}
    {source?.cancelled && <Notice>邀请对应活动已取消，请刷新核对当前安排。</Notice>}
    <Text className="iv-section-title">这次都玩些什么？</Text>
    <View className="iv-segments">{segments.map((s, index) => <View key={s.segment_id} className={`iv-segment ${s.segment_id === detail.main_segment_id ? 'iv-segment-main' : 'iv-segment-extra'} ${s.cancelled_at || detail.cancelled_at ? 'iv-segment-cancelled' : ''}`}>
      <Text className="iv-segment-name">{String(index + 1).padStart(2, '0')} · {s.name}{s.segment_id === detail.main_segment_id && <Text className="iv-main-label"> 主环节</Text>}</Text>
      <Text className="iv-segment-meta">{localTime(s.starts_at)}–{localTime(s.ends_at, s.starts_at.slice(0,10) !== s.ends_at.slice(0,10))} · {s.counts.occupied_count}/{s.capacity} 人{s.cancelled_at || detail.cancelled_at ? ' · 已取消' : s.has_started ? ' · 已开始' : !s.is_join_open ? ' · 暂不开放报名' : ''}</Text>
    </View>)}</View>
    <View className="iv-suggestions"><View className="iv-suggestion-heading"><Text>你有什么好主意？</Text><Text className="iv-small">OPTIONAL</Text></View><Text className="iv-suggestion-description">时间、地点、活动内容，可前往需求页填写</Text><View className="iv-suggestion-actions">{[{symbol:'◷',text:'改时间'},{symbol:'⌖',text:'推荐地点'},{symbol:'✧',text:'推荐活动'}].map(item => <Button key={item.text} disabled={busy || !!detail.cancelled_at} onClick={suggest}><Text className="iv-suggestion-symbol">{item.symbol}</Text><Text>{item.text}</Text></Button>)}</View></View>
    <View className="iv-primary-area"><Button className="iv-primary-button" disabled={busy} onClick={() => open(model.primary.section)}>{model.primary.label}<Text> →</Text></Button><Text className="iv-application-note">{model.open ? '申请获批后才占用名额，费用与完整安排请先核对' : model.status}</Text></View>
    {detail.viewer.is_manager && <Button className="iv-manager-button" disabled={busy} onClick={() => open('approval')}>处理参加申请{model.approvals ? `（${model.approvals}）` : ''} →</Button>}
    <View className="iv-bottom-links"><Button disabled={busy} onClick={() => setExpanded(v => !v)}>{expanded ? '收起完整安排' : '查看完整安排'}{expanded ? ' −' : ' ＋'}</Button><Button disabled={busy} onClick={() => open('invitation')}>分享邀请 ↗</Button><Button disabled={busy} onClick={refresh}>刷新安排</Button></View>
    {expanded && <View className="iv-expanded"><ActivityArrangement detail={detail}/><View className="iv-people"><Text className="iv-small">活动状态</Text><Text>{progress.label}</Text><Text className="iv-small">{progress.guidance}</Text><Text className="iv-small">原发起人</Text><Text>公开昵称暂未提供</Text><Text className="iv-small">当前管理者</Text><Text>{detail.viewer.is_manager ? '你正在负责此活动' : '由当前管理者处理申请与安排'}</Text><Text className="iv-small">邀请分享者</Text><Text>{shareName || (sourceId ? '未提供公开昵称' : '公开活动入口，未附邀请来源')}</Text><Text className="iv-small">邀请分享者不一定是原发起人；时间均为北京时间。</Text></View></View>}
  </View>;
}

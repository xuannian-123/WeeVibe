import { useEffect, useRef, useState } from 'react';
import { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import type { ActivityDetail, PublicRosterSnapshot } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../activity-entry/ActivityUI';
import { getToken } from '../../platform/api';
import { readActivityRoster, rosterError } from './api';

type Props = { detail: ActivityDetail; session?: string; fresh: boolean; refresh: () => unknown };
export function RosterPanel({ detail, session, fresh, refresh }: Props) {
  // Clock-only polling does not discard a verified list. Material source changes do.
  const source = JSON.stringify([session, detail.activity_id, detail.revision, detail.viewer.user_id, detail.cancelled_at,
    detail.segments.map(s => [s.segment_id, s.position, s.name, s.plan_revision, s.cancelled_at, s.counts.occupied_count, s.counts.accepted_count, s.counts.pending_acceptance_count])]);
  const latest = useRef({ source, session, fresh }); latest.current = { source, session, fresh };
  const observed = useRef(source), epoch = useRef(0), active = useRef(true), mounted = useRef(true), operation = useRef<symbol>();
  if (observed.current !== source) { observed.current = source; epoch.current++; operation.current = undefined; }
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [stored, setStored] = useState<{ source: string; epoch: number; data: PublicRosterSnapshot }>();
  const invalidate = () => { active.current = false; epoch.current++; operation.current = undefined; setBusy(false); setStored(undefined); setMessage(''); };
  useDidHide(invalidate); useUnload(invalidate); useDidShow(() => { active.current = true; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; operation.current = undefined; }; }, []);
  useEffect(() => { setBusy(false); setStored(undefined); setMessage(''); }, [source]);
  const current = fresh && stored && stored.source === source && stored.epoch === epoch.current && active.current && session === getToken() ? stored.data : undefined;
  async function read() {
    if (operation.current || !fresh || session !== getToken() || !active.current || !mounted.current) return;
    const ticket = epoch.current, op = Symbol('roster'); operation.current = op; setBusy(true); setStored(undefined); setMessage('');
    const owned = () => mounted.current && active.current && epoch.current === ticket && operation.current === op && latest.current.source === source && latest.current.session === session && getToken() === session;
    const assertCurrent = () => { if (!owned() || !latest.current.fresh) throw new ApiClientError('INVALID_RESPONSE', '页面或活动已变化，未显示旧名单。', 0); };
    try {
      assertCurrent(); const data = await readActivityRoster(detail, session, assertCurrent); assertCurrent();
      setStored({ source, epoch: ticket, data });
    } catch (error) { if (owned()) setMessage(rosterError(error)); }
    finally { if (operation.current === op) { operation.current = undefined; if (mounted.current) setBusy(false); } }
  }
  return <Panel title="分段参加名单">
    <Text className="caption">组织者和已加入成员可看报名名；游客和尚未加入者仅看人数。保位待接受不等于已接受，待审批申请不占位。</Text>
    <Action disabled={busy || !fresh || session !== getToken()} onClick={() => { void read(); }}>{busy ? '读取名单中…' : '查看当前分段名单'}</Action>
    {!current && !busy && !message && <Text className="caption">尚未读取完整名单，不按人数推造姓名。已取消活动或环节的历史名单本片暂不展示。</Text>}
    {message && <Notice>{message}</Notice>}
    {message && <Action variant="text" disabled={!fresh || busy || session !== getToken()} onClick={() => { if (mounted.current && active.current && latest.current.source === source && getToken() === session) { setStored(undefined); void refresh(); } }}>先刷新活动安排</Action>}
    {current && <View>{current.segments.map(s => <View key={s.segment_id} className="itinerary-card">
      <Text className="field-label">{s.name}</Text>
      {s.availability === 'cancelled_history_not_exposed' ? <Notice>此活动或环节已取消；历史名单本片暂不展示，不表示没有历史成员。</Notice> : <View>
        <Text>当前占位 {s.counts!.occupied_count} · 已接受 {s.counts!.accepted_count} · 保位待接受 {s.counts!.pending_acceptance_count}</Text>
        {s.members === null && <Text className="caption">当前仅提供人数；组织者和已加入成员可查看报名名。</Text>}
        {s.members?.length === 0 && <Text>此环节当前没有占位成员。</Text>}
        {s.members?.map((m, index) => <View key={index}><Text>{m.display_name || '未填写报名名'}</Text><Text> · {m.status === 'joined' ? '已加入 · 已接受当前安排' : '保位待接受当前安排'}</Text></View>)}
      </View>}
    </View>)}</View>}
  </Panel>;
}

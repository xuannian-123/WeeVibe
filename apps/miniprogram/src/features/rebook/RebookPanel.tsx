import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { Checkbox, CheckboxGroup, Label, Text, View } from '@tarojs/components';
import type { ActivityDetail, RebookSource } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../activity-entry/ActivityUI';
import { getToken } from '../../platform/api';
import { feeText } from '../../platform/activities';
import { readRebookSource, rebookError } from './api';
import { draftFromRebookSource, hasLocalRebook, rebookKeys } from './draft';

export function RebookPanel({ detail, session, fresh, anyBusy, onBusyChange }: { detail: ActivityDetail; session?: string; fresh: boolean; anyBusy: boolean; onBusyChange: (busy: boolean) => void }) {
  const actor = detail.viewer.user_id;
  const snapshot = JSON.stringify([detail.activity_id, detail.revision, detail.name, detail.timezone, detail.cancelled_at, detail.viewer.user_id, detail.viewer.is_manager,
    detail.segments.map(s => [s.segment_id, s.position, s.type, s.name, s.minimum_participants, s.capacity, s.location.name, s.location.address, s.fee, s.requirements, s.cancelled_at, s.starts_at, s.ends_at])]);
  const latest = useRef({ detail, session, fresh, anyBusy, snapshot }); latest.current = { detail, session, fresh, anyBusy, snapshot };
  const active = useRef(true), mounted = useRef(true), epoch = useRef(0), lock = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [selected, setSelected] = useState<string[]>([]); const selectedRef = useRef(selected); selectedRef.current = selected;
  const [preview, setPreview] = useState<{ data: RebookSource; snapshot: string; session: string }>();
  const invalidate = () => { active.current = false; epoch.current++; setPreview(undefined); };
  useDidHide(invalidate); useUnload(invalidate); useDidShow(() => { active.current = true; });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; onBusyChange(false); }; }, []);
  const currentPreview = preview && preview.snapshot === snapshot && preview.session === session && session === getToken() ? preview.data : undefined;
  const assertCurrent = (ticket: number) => {
    const now = latest.current;
    if (!actor || !session || getToken() !== session || !mounted.current || !active.current || ticket !== epoch.current || now.snapshot !== snapshot || now.session !== session || !now.fresh) throw new ApiClientError('INVALID_RESPONSE', '页面、来源或身份已变化，未确认复制。', 0);
  };
  const navigate = (ticket: number) => { assertCurrent(ticket); void Taro.navigateTo({ url: `/pages/editor/index?rebook=${encodeURIComponent(detail.activity_id)}` }).catch(() => { if (mounted.current && active.current) setMessage('本机草稿已保留，页面暂时无法打开，请从本活动再次进入恢复。'); }); };
  async function run(copy: boolean) {
    if (lock.current || anyBusy || !fresh || !actor) return;
    const ticket = epoch.current; lock.current = true; setBusy(true); onBusyChange(true); setMessage('');
    try {
      assertCurrent(ticket);
      // Existing pending/completed/draft always wins; reading a source never overwrites it.
      if (hasLocalRebook(actor, detail.activity_id)) { navigate(ticket); return; }
      if (!copy) {
        const data = await readRebookSource(detail.activity_id, actor, detail.revision, session, () => assertCurrent(ticket));
        assertCurrent(ticket); setSelected([]); setPreview({ data, snapshot, session: session! }); return;
      }
      if (!currentPreview) throw new ApiClientError('INVALID_RESPONSE', '请重新读取再约来源。', 0);
      const chosen = [...selectedRef.current];
      if (!chosen.length) { setMessage('请先明确选择至少一个要再约的环节。'); return; }
      const answer = await Taro.showModal({ title: '仅复制到本机新草稿？', content: '不会发布、邀请或继承旧成员。全部时间及截止重新设置，地点与费用须逐段核对。普通创建草稿不会覆盖。', confirmText: '复制草稿' });
      assertCurrent(ticket); if (!answer.confirm) return;
      // Revalidate the server source after confirmation; no mutation API is called.
      const data = await readRebookSource(detail.activity_id, actor, detail.revision, session, () => assertCurrent(ticket));
      assertCurrent(ticket);
      if (JSON.stringify(chosen) !== JSON.stringify(selectedRef.current)) throw new ApiClientError('INVALID_RESPONSE', '选择已变化，请重新核对。', 0);
      if (!hasLocalRebook(actor, detail.activity_id)) {
        const draft = draftFromRebookSource(data, chosen); assertCurrent(ticket);
        Taro.setStorageSync(rebookKeys(actor, detail.activity_id).draft, draft);
      }
      assertCurrent(ticket); navigate(ticket);
    } catch (error) { if (mounted.current && active.current && ticket === epoch.current) setMessage(error instanceof ApiClientError ? rebookError(error) : '读取或保存本机再约草稿未完成，已有内容不会被覆盖。请核对本机存储后重试。'); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); onBusyChange(false); } }
  }
  if (!actor || !session || session !== getToken() || !detail.viewer.is_manager) return null;
  return <Panel title="一键再约 · 新的本机草稿">
    <Text className="caption">本片只从当前管理的未取消、全部环节已结束活动复制。原申请、成员、同意、核实及预订均不继承；其它来源范围暂未启用。</Text>
    <Action disabled={busy || anyBusy || !fresh} onClick={() => { void run(false); }}>再约：读取来源／恢复本机草稿</Action>
    {currentPreview && <View>
      <Text>{currentPreview.name} · 请主动选择要复制的环节，排除已取消 {currentPreview.excluded_cancelled_count} 段。</Text>
      <CheckboxGroup onChange={event => { if (!lock.current && fresh && session === getToken()) setSelected(event.detail.value); }}>{currentPreview.segments.map(s => <Label key={s.source_segment_id}><Checkbox value={s.source_segment_id} checked={selected.includes(s.source_segment_id)} disabled={busy || anyBusy || !fresh} /><View><Text>{s.name} · {s.location.name}{s.location.address ? ` · ${s.location.address}` : ''}</Text><Text>{feeText(s.fee)}</Text></View></Label>)}</CheckboxGroup>
      <Notice>尚未写入本机草稿。旧活动时区为 {currentPreview.source_timezone}；新草稿的日期需重新按北京时间填写，多段须重新选主环节。旧核实和预订不代表新日期可用。</Notice>
      <Action disabled={busy || anyBusy || !fresh || !selected.length} onClick={() => { void run(true); }}>复制到本机新草稿</Action>
      <Action disabled={busy} variant="text" onClick={() => setPreview(undefined)}>暂不复制</Action>
    </View>}
    {message && <Notice>{message}</Notice>}
  </Panel>;
}

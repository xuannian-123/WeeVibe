import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { arrangementPlanSchema, normalizeArrangementReview, reacceptArrangementCommandSchema, type ActivityDetail, type ArrangementAgreementV3, type ArrangementReviewView } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { rememberActivity } from '../../platform/activities';
import { newKey } from '../../platform/local-id';
import { errorText } from '../../platform/page-state';
import { useStoredWrite } from '../../platform/write-state';
import { formatActivityTime } from '../shell/activity-time';
import { arrangementErrorMessage, readArrangement, reacceptArrangement } from './api';

type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; anyBusy: boolean; refresh: () => Promise<void>; onBusyChange?: (busy: boolean) => void };
const own = (detail: ActivityDetail, id: string) => detail.viewer.participations.find(p => p.segment_id === id && p.status !== 'exited');
const segment = (detail: ActivityDetail, id: string) => detail.segments.find(s => s.segment_id === id);
const isCancelled = (detail: ActivityDetail, id: string) => !!detail.cancelled_at || !!segment(detail, id)?.cancelled_at;
const snapshot = (detail: ActivityDetail, id: string) => JSON.stringify([detail.activity_id, detail.revision, detail.viewer.user_id, detail.cancelled_at, own(detail, id), segment(detail, id)]);
const closed = (detail: ActivityDetail, id: string) => { const item = segment(detail, id); return !item || !!detail.cancelled_at || !!item.cancelled_at || item.has_started || Date.parse(detail.server_time) >= Date.parse(item.starts_at); };
type Plan = ArrangementAgreementV3;
function planRows(plan: Plan, timezone: string): [string, string][] {
  return [ ['名称', plan.name], ['类型', plan.type], ['顺序', String(plan.position + 1)], ['环节引用', plan.client_ref],
    ['开始', formatActivityTime(plan.starts_at, timezone)], ['结束', formatActivityTime(plan.ends_at, timezone)],
    ['最低人数', String(plan.minimum_participants)], ['地点', plan.location.name], ['地址', plan.location.address ?? '未提供'], ['地点来源', plan.location.source_url ?? '未提供'],
    ['费用', plan.fee.kind === 'unknown' ? `未知；${plan.fee.note || '待核实'}` : `${plan.fee.kind} ${(plan.fee.amount_cents! / 100).toFixed(2)} ${plan.fee.currency}；${plan.fee.note}`], ['要求', plan.requirements || '无'] ];
}
function publicPlan(item: ActivityDetail['segments'][number]) {
  const { segment_id, client_ref, position, type, name, starts_at, ends_at, deadline_at, minimum_participants, capacity, location, fee, requirements } = item;
  return arrangementPlanSchema.parse({ segment_id, client_ref, position, type, name, starts_at, ends_at, deadline_at, minimum_participants, capacity, location, fee, requirements });
}
function Changes({ review, timezone }: { review: ArrangementReviewView; timezone: string }) {
  return <View>{review.changes.map(change => {
    const before = planRows(change.before, timezone), after = planRows(change.after, timezone);
    return <View key={change.activity_revision ?? `${change.from_plan_revision}:${change.to_plan_revision}`}><Text>参加条件版本 {change.from_plan_revision} → {change.to_plan_revision} · {formatActivityTime(change.changed_at, timezone)}</Text>
      {after.map(([label, value], index) => before[index][1] !== value ? <Text className="caption" key={label}>{label}：{before[index][1]} → {value}</Text> : null)}
    </View>;
  })}</View>;
}
export function ArrangementPanel(props: Props) {
  const { detail, session } = props;
  const [selected, setSelected] = useState(''), [working, setWorking] = useState(false);
  const candidates = detail.segments.filter(item => own(detail, item.segment_id));
  const current = candidates.find(item => item.segment_id === selected) ?? candidates.find(item => own(detail, item.segment_id)?.status === 'awaiting_acceptance') ?? candidates[0];
  if (!detail.viewer.user_id || !current) return null;
  if (!session || getToken() !== session) return <Notice>登录账号已变化，旧的本人安排已隐藏，请重新读取。</Notice>;
  return <Panel title="本人安排版本与重新接受">
    <Text className="caption">仅核对本人参加记录；已取消的记录只作历史查看。未回复不等于同意；重新接受不会新增席位、替别人接受或自动成局。</Text>
    <Text className="caption">当前提供版本核验与重新接受基础能力；人数上限和报名截止可独立调整，其他安排修改入口尚未启用，不会伪造变更记录。</Text>
    {candidates.length > 1 && <View>{candidates.map(item => <Action key={item.segment_id} disabled={working || props.anyBusy || current.segment_id === item.segment_id} onClick={() => setSelected(item.segment_id)}>{item.name}{isCancelled(detail, item.segment_id) ? ' · 已取消（历史记录）' : own(detail, item.segment_id)?.status === 'awaiting_acceptance' ? ' · 待重新接受' : ''}</Action>)}</View>}
    <ArrangementItem key={`${detail.activity_id}:${detail.viewer.user_id}:${current.segment_id}`} {...props} segmentId={current.segment_id} onWorking={setWorking} />
  </Panel>;
}
function ArrangementItem({ detail, session, fresh, anyBusy, refresh, onBusyChange, segmentId, onWorking }: Props & { segmentId: string; onWorking: (value: boolean) => void }) {
  const actor = detail.viewer.user_id!, item = segment(detail, segmentId)!, participation = own(detail, segmentId)!;
  const [reviewState, setReview] = useState<{ data: ArrangementReviewView; source: string; session: string; epoch: number }>();
  const [reading, setReading] = useState(false), [confirming, setConfirming] = useState(false), [notice, setNotice] = useState('');
  const lock = useRef(false), mounted = useRef(true), visible = useRef(true), epoch = useRef(0), resultSession = useRef<string>();
  const completionGuard = useRef<() => void>(() => {});
  const latest = useRef({ detail, session, fresh }); latest.current = { detail, session, fresh };
  // A source/session observed changing and returning is not the original review.
  // Keep a monotonic epoch without clearing pending requests or self-locking on busy.
  const observedSource = JSON.stringify([session, fresh, snapshot(detail, segmentId)]);
  const observed = useRef(observedSource);
  if (observed.current !== observedSource) { observed.current = observedSource; epoch.current++; }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { visible.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { visible.current = true; setReview(undefined); });
  const active = () => mounted.current && visible.current;
  function guard(ticket: number, source: string) {
    const current = latest.current;
    if (!active() || ticket !== epoch.current || !session || getToken() !== session || current.session !== session || !current.fresh || !own(current.detail, segmentId) || snapshot(current.detail, segmentId) !== source)
      throw new ApiClientError('INVALID_RESPONSE', '本人安排、账号或页面已变化，结果未确认；原请求保留。', 0);
  }
  const state = useStoredWrite({ storageKey: `weevibe-reaccept-v1:${detail.activity_id}:${segmentId}:${actor}`, userId: actor,
    parse: value => reacceptArrangementCommandSchema.parse(value), execute: async input => {
      const ticket = epoch.current, source = snapshot(detail, segmentId);
      const assertCurrent = () => guard(ticket, source); completionGuard.current = assertCurrent;
      assertCurrent();
      try {
        const result = await reacceptArrangement(detail.activity_id, segmentId, input, actor, session, assertCurrent);
        assertCurrent();
        if (result.revision < latest.current.detail.revision) throw new ApiClientError('INVALID_RESPONSE', '响应早于当前活动，接受结果尚未确认。', 200);
        resultSession.current = session; return result;
      } catch (error) { if (active() && ticket === epoch.current) setNotice(arrangementErrorMessage(error) ?? ''); throw error; }
    }, committed: result => { completionGuard.current(); rememberActivity(actor, result); setReview(undefined); void refresh(); }
  });
  useEffect(() => { const value = state.busy || confirming || reading; onBusyChange?.(value); onWorking(value); return () => { onBusyChange?.(false); onWorking(false); }; }, [state.busy, confirming, reading, onBusyChange, onWorking]);
  const review = reviewState?.source === snapshot(detail, segmentId) && reviewState.session === session && reviewState.epoch === epoch.current ? reviewState.data : undefined;
  const pending = state.pending?.userId === actor ? state.pending : undefined;
  const result = state.result?.activity_id === detail.activity_id && state.result.viewer.user_id === actor && state.result.revision >= detail.revision && resultSession.current === session ? state.result : undefined;
  // Cancellation is a terminal display state, not a rewrite of the stored acceptance.
  // A processed old key may return a newer cancelled snapshot before its caller refreshes.
  const cancelled = isCancelled(detail, segmentId) || !!result && isCancelled(result, segmentId);
  const busy = anyBusy || reading || confirming || state.busy;
  const canAccept = review?.state === 'ready' && review.can_reaccept && review.accepted_plan_revision !== null && !!review.history_digest && !cancelled && !closed(detail, segmentId);
  async function load() {
    if (lock.current || !active() || !fresh || busy) return;
    lock.current = true; setReading(true); setNotice(''); setReview(undefined);
    const ticket = epoch.current, source = snapshot(detail, segmentId);
    try {
      const data = normalizeArrangementReview(await readArrangement(detail.activity_id, segmentId, actor, session, () => guard(ticket, source)));
      guard(ticket, source);
      if (data.revision !== detail.revision || data.current_plan_revision !== item.plan_revision || data.accepted_plan_revision !== participation.accepted_plan_revision || JSON.stringify(data.current_plan) !== JSON.stringify(publicPlan(item)))
        throw new ApiClientError('VERSION_CONFLICT', '活动版本已更新，请刷新活动后重新查看本人差异。', 409);
      setReview({ data, source, session: session!, epoch: ticket });
    } catch (error) { if (active() && ticket === epoch.current) setNotice(arrangementErrorMessage(error) ?? errorText(error)); }
    finally { lock.current = false; if (mounted.current) setReading(false); }
  }
  async function accept() {
    if (lock.current || !active() || !fresh || busy || state.blocked || pending || !canAccept || !review) return;
    const input = reacceptArrangementCommandSchema.parse({ action: 'reaccept', idempotency_key: newKey(), expected_revision: review.revision, expected_plan_revision: review.current_plan_revision, from_accepted_plan_revision: review.accepted_plan_revision, history_digest: review.history_digest });
    const ticket = epoch.current, source = snapshot(detail, segmentId);
    lock.current = true; setConfirming(true); setNotice('');
    try {
      guard(ticket, source);
      const answer = await Taro.showModal({ title: '接受已核验的当前安排？', content: `仅接受本人「${item.name}」从版本 ${review.accepted_plan_revision} 到 ${review.current_plan_revision} 的上述连续参加条件变更。人数上限单独调整，不作为重新接受条件。报名截止也只属新人申请与批准窗口，不作为重新接受条件。保留原席位，不代表替其他人接受或自动成局。` });
      if (!answer.confirm) return;
      guard(ticket, source);
      if (closed(latest.current.detail, segmentId)) throw new ApiClientError('ARRANGEMENT_ACCEPTANCE_CLOSED', '环节已经开始或取消。', 409);
      state.resetResult(); await state.send(input);
    } catch (error) { if (active() && ticket === epoch.current) setNotice(arrangementErrorMessage(error) ?? '确认未完成或页面状态已变化；请重新核对，本次未继续提交。'); }
    finally { lock.current = false; if (mounted.current) setConfirming(false); }
  }
  async function retry() {
    if (lock.current || !active() || !fresh || busy || state.blocked || !pending) return;
    lock.current = true; setNotice(''); state.resetResult();
    try { await state.send(); } finally { lock.current = false; }
  }
  const resultParticipation = result && own(result, segmentId), resultSegment = result && segment(result, segmentId);
  const nowAccepted = !cancelled && !!resultParticipation && resultParticipation.status === 'joined' && resultParticipation.accepted_plan_revision === resultSegment?.plan_revision;
  if (!session || getToken() !== session) return <Notice>登录身份已变化，旧安排差异已隐藏。</Notice>;
  return <View>
    {cancelled && <Notice>已取消 · 历史安排与接受记录。以下原记录保留供核对，不表示当前仍可参加、待本人接受或已自动退订退款。</Notice>}
    <Text>{item.name} · {cancelled ? '所示历史版本' : '当前版本'} {item.plan_revision} · {cancelled ? '历史已接受版本' : '本人已接受版本'} {participation.accepted_plan_revision ?? '无法核验'}</Text>
    <Action disabled={!fresh || busy} onClick={() => { void load(); }}>{reading ? '正在核验版本…' : '查看本人版本差异'}</Action>
    {review?.state === 'up_to_date' && <Notice>{cancelled ? '历史接受记录与所示版本一致；这不表示已取消的环节仍有有效参加确认。' : '本人已接受当前版本，暂无待重新接受的变更记录。'}</Notice>}
    {review?.state === 'unavailable' && <Notice>{cancelled ? '已取消；历史接受条件无法核验。缺少连续、可信的安排历史，不会根据所示安排猜测旧承诺，请联系组织者核对。' : '缺少连续、可信的安排历史，无法核验旧版与新版差异，暂不能重新接受。请联系组织者核对，不会猜测旧安排。'}</Notice>}
    {review?.state === 'ready' && <View><Notice>{cancelled ? '以下为服务端核验的历史参加条件差异，仅供核对；已取消，不再请求本人接受，不包含人数上限或报名截止。' : '以下为服务端核验的连续参加条件差异，请逐项查看后决定；不包含人数上限或报名截止。'}</Notice><Changes review={review} timezone={detail.timezone} /></View>}
    {review && <View><Text>{cancelled ? '历史记录人数上限' : '当前人数上限'}：{review.current_plan.capacity} 人</Text><Text className="caption">人数上限单独调整，不作为重新接受条件；{cancelled ? '所示历史上限' : '当前上限'}不是本人此前接受时的上限承诺。</Text>
      {review.history_format !== 'legacy_v1' && review.state === 'up_to_date' && review.capacity_changes.length === 0 && <Notice>{cancelled ? '本次不查询独立容量操作记录或延期记录，所示历史上限不代表本人接受时上限。' : '已接受当前安排；本次不查询独立容量操作记录或延期记录，当前上限不代表本人接受时上限。'}</Notice>}
      {review.history_format === 'legacy_v1' && <Notice>旧版本记录未提供独立容量历史，不据此推断人数上限操作或本人当时接受的上限。</Notice>}
      <Text>{cancelled ? '历史记录报名截止' : '当前报名截止'}：{formatActivityTime(review.current_plan.deadline_at, detail.timezone)}</Text>
      <Text className="caption">报名截止仅限制新人申请与批准；原成员在环节开始前仍可接受新版。所示截止不代表本人此前接受时的截止承诺。</Text>
      {review.history_format !== 'verified_v3' && <Notice>旧 v1/v2 格式未提供独立延期历史；已接受条件展示不含报名截止，不据当前截止或旧版本字段猜测本人当时的报名窗口。</Notice>}
      {review.history_format === 'verified_v3' && review.deadline_changes.length > 0 && <View><Text>报名截止延期记录（非重新接受条件）</Text><Text className="caption">以下仅为服务端可串联核验的运营记录，不是本人接受时点，也不声称覆盖更早全部延期。</Text>
        {review.history_anchor && <Text className="caption">历史起点：活动记录 {review.history_anchor.activity_revision} 之前的快照（非本人接受时点）</Text>}
        {review.deadline_changes.map(change => <View key={change.activity_revision}><Text>报名截止：{formatActivityTime(change.before_deadline_at, detail.timezone)} → {formatActivityTime(change.deadline_at, detail.timezone)}</Text><Text className="caption">活动记录 {change.activity_revision} · 参加条件版本 {change.plan_revision} 不变 · {formatActivityTime(change.changed_at, detail.timezone)}</Text></View>)}
      </View>}

      {review.capacity_changes.length > 0 && <View><Text>人数上限操作记录（非重新接受条件）</Text><Text className="caption">以下为所示历史起点之后可串联核验的容量操作，可能早于本人在同版本的接受；不代表本人当时接受的容量，也不声称覆盖更早全部记录。</Text>
        {review.history_anchor && <Text className="caption">历史起点：活动记录 {review.history_anchor.activity_revision} 之前的快照（非本人接受时点）</Text>}
        {review.capacity_changes.map(change => <View key={change.activity_revision}><Text>人数上限：{change.before_capacity} → {change.capacity} 人 · {formatActivityTime(change.changed_at, detail.timezone)}</Text><Text className="caption">活动记录 {change.activity_revision} · 参加条件版本 {change.plan_revision} 不变</Text></View>)}
      </View>}
    </View>}
    {(cancelled || review?.reason === 'CANCELLED' || review?.reason === 'SEGMENT_STARTED' || closed(detail, segmentId)) && <Notice>环节已开始或活动／环节已取消，不能新增重新接受；原未知请求只能核对原结果。</Notice>}
    <Action variant="primary" disabled={!fresh || busy || state.blocked || !!pending || !canAccept} onClick={() => { void accept(); }}>确认接受当前安排</Action>
    {notice && <Notice>{notice}</Notice>}{state.message && (!state.result || result) && <Notice>{result && cancelled ? '服务端已返回原请求对应的当前快照；不代表新增接受已取消的安排。' : state.message}</Notice>}
    {result && <Notice>服务器当前状态：{cancelled ? '活动或本环节已取消，仅保留历史接受记录' : nowAccepted ? '本人已接受当前安排' : '本人尚未接受当前安排或已不再占位'}。以当前快照为准，不会因原请求返回而自动接受后续新版本。</Notice>}
    {pending && <View><Notice>上次接受结果未确认。先刷新核对；重试沿用本人原内容和请求标识，若此前未成功，服务端将重新核对当前条件。</Notice>
      <Action disabled={busy} onClick={() => { void refresh(); }}>刷新活动核对</Action><Action disabled={!fresh || busy || state.blocked} onClick={() => { void retry(); }}>核对并重试原接受</Action></View>}
  </View>;
}

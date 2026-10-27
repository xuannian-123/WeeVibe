import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { activityIdSchema, createActivityInputSchema, type CreateActivityInput } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { newKey, useLogin, usePageRead } from '../../platform/page-state';
import { useStoredWrite } from '../../platform/write-state';
import { feeText, formatTime, rememberActivity } from '../../platform/activities';
import { createActivityForIdentity, readCreationIdentity } from '../activity-create/api';
import { ActivityEditor } from '../activity-create/activity-editor';
import { buildRebookInput, confirmRebookField, parseRebookDraft, rebookKeys, updateRebookForm, type RebookDraft } from './draft';

function readOwnPending(key: string, actor: string): CreateActivityInput | undefined {
  const raw: unknown = Taro.getStorageSync(key);
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 2 ||
      (raw as { userId?: unknown }).userId !== actor) throw new Error('原请求记录无法验证');
  return createActivityInputSchema.parse((raw as { input?: unknown }).input);
}

export function RebookEditor({ sourceId: rawSourceId }: { sourceId: string }) {
  const parsedSource = activityIdSchema.safeParse(rawSourceId), sourceId = parsedSource.success ? parsedSource.data : undefined;
  const identity = usePageRead(readCreationIdentity, !!sourceId); const login = useLogin(identity.refresh);
  const source = identity.data?.session === getToken() ? identity.data : undefined;
  const actor = source?.user_id, owner = actor && sourceId ? `${actor}:${sourceId}` : undefined;
  const keys = actor && sourceId ? rebookKeys(actor, sourceId) : { draft: 'weevibe-rebook-disabled-draft', pending: 'weevibe-rebook-disabled-pending', completed: 'weevibe-rebook-disabled-completed' };
  const [stored, setStored] = useState<{ owner: string; draft: RebookDraft }>(), [loaded, setLoaded] = useState('');
  const [message, setMessage] = useState(''), [storageIssue, setStorageIssue] = useState('');
  const [pendingIssue, setPendingIssue] = useState('');
  const [completion, setCompletion] = useState<{ owner: string; activityId: string }>();
  const [review, setReview] = useState<{ owner: string; input: CreateActivityInput }>();
  const anotherLock = useRef(false); const [anotherBusy, setAnotherBusy] = useState(false);
  const active = useRef(true), mounted = useRef(true), epoch = useRef(0), completionGuard = useRef<() => void>(() => { throw new Error('未验证来源'); });
  const firstDispatch = useRef<string>();
  const latest = useRef({ source, owner, loading: identity.loading, error: identity.error }); latest.current = { source, owner, loading: identity.loading, error: identity.error };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const deactivate = () => { active.current = false; epoch.current++; };
  useDidHide(deactivate); useUnload(deactivate); useDidShow(() => { active.current = true; });
  function guard(ticket = epoch.current) {
    const current = latest.current;
    if (!source || !owner || getToken() !== source.session || current.source?.session !== source.session || current.owner !== owner || current.loading || current.error || !mounted.current || !active.current || ticket !== epoch.current) throw new ApiClientError('INVALID_RESPONSE', '页面或身份已变化，原账号再约草稿不会提交到其它账号。', 0);
  }
  useEffect(() => {
    if (!actor || !sourceId || !owner || loaded === owner) return;
    setStored(undefined); setReview(undefined); setCompletion(undefined); setStorageIssue(''); setPendingIssue(''); setMessage('');
    try { readOwnPending(keys.pending, actor); }
    catch { setPendingIssue('本机原请求非空但无法验证或读取，已阻止新发布；不会覆盖或删除该记录，请先核对已创建活动。'); }
    try {
      const raw: unknown = Taro.getStorageSync(keys.draft);
      if (raw !== undefined && raw !== null && raw !== '') setStored({ owner, draft: parseRebookDraft(raw, actor, sourceId) });
      const done: unknown = Taro.getStorageSync(keys.completed);
      if (done !== undefined && done !== null && done !== '') {
        const id = activityIdSchema.safeParse((done as { activityId?: unknown }).activityId);
        if (!id.success || id.data === sourceId) throw new Error('完成记录无法验证');
        setCompletion({ owner, activityId: id.data });
      }
    } catch { setStorageIssue('本机再约草稿或完成记录无法恢复，未覆盖原内容。请保留记录并核对已发起活动。'); }
    setLoaded(owner);
  }, [actor, sourceId, owner, loaded, keys.draft, keys.completed, keys.pending]);
  const draft = stored && stored.owner === owner ? stored.draft : undefined;
  const write = useStoredWrite({ storageKey: keys.pending, userId: actor,
    parse: raw => createActivityInputSchema.parse(raw),
    execute: async input => {
      const isFirstDispatch = firstDispatch.current === input.idempotency_key; firstDispatch.current = undefined;
      const ticket = epoch.current; const assertCurrent = () => guard(ticket); completionGuard.current = assertCurrent;
      assertCurrent(); const result = await createActivityForIdentity(input, source, assertCurrent, isFirstDispatch ? () => {
        const now = Date.now();
        if (input.segments.some(s => [s.starts_at, s.ends_at, s.deadline_at].some(value => Date.parse(value) <= now))) {
          setReview(undefined); setMessage('首次发送前再约时间已过，请重新设置全部日期、时间与截止。本次尚未发送创建请求，草稿保留。');
          throw new ApiClientError('INVALID_INPUT', '再约首次创建发送前时间已过', 400);
        }
      } : undefined); assertCurrent();
      if (result.activity_id === sourceId) throw new ApiClientError('INVALID_RESPONSE', '再约创建响应不能指向原活动，请保留原请求核对。', 200);
      return result;
    },
    committed: detail => {
      completionGuard.current(); Taro.setStorageSync(keys.completed, { activityId: detail.activity_id });
      rememberActivity(actor ?? null, detail); Taro.removeStorageSync(keys.draft); setCompletion({ owner: owner!, activityId: detail.activity_id });
    },
  });
  const pending = source && write.pending?.userId === actor ? write.pending : undefined;
  const completedId = source && completion && completion.owner === owner ? completion.activityId : undefined;
  const preview = source && review && review.owner === owner ? review.input : undefined;
  const displayed = pending?.input ?? preview;
  const disabled = write.busy || !!pending || write.blocked || !!pendingIssue || !!completedId || !!storageIssue || !source || loaded !== owner || identity.loading || !!identity.error;
  function assertPending(expected?: CreateActivityInput) {
    guard();
    try {
      const current = readOwnPending(keys.pending, actor!);
      if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('原请求已变化');
    } catch {
      setPendingIssue('本机原请求无法验证、读取或已变化，已停止发布；保留原记录，请重新进入并核对。');
      throw new ApiClientError('INVALID_RESPONSE', '原请求状态尚未确认，不会覆盖。', 0);
    }
  }
  function persist(next: RebookDraft) {
    guard(); if (disabled) return;
    // Keep visible edits on storage failure; never report that they were saved.
    setStored({ owner: owner!, draft: next }); setReview(undefined);
    try { guard(); Taro.setStorageSync(keys.draft, next); setMessage('仅在本机自动保存，尚未发布或邀请。'); }
    catch { setMessage('本机保存未完成，请保持页面并重试，不代表已经发布。'); }
  }
  function prepare() {
    if (disabled || !draft) return;
    try { guard(); assertPending(); const input = buildRebookInput(draft, newKey(), Date.now()); setReview({ owner: owner!, input }); setMessage(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '请重新核对再约草稿'); }
  }
  function publish() {
    if (disabled || !preview || !draft) return;
    try { guard(); buildRebookInput(draft, preview.idempotency_key, Date.now()); assertPending(); firstDispatch.current = preview.idempotency_key; void write.send(preview); }
    catch (error) { setReview(undefined); setMessage(error instanceof Error ? error.message : '请重新核对再约时间'); }
  }
  async function another() {
    if (anotherLock.current || write.busy || pending || !completedId) return;
    const ticket = epoch.current; anotherLock.current = true; setAnotherBusy(true);
    try {
      guard(ticket); const result = await Taro.showModal({ title: '重新准备另一份再约？', content: '这次已成功创建的新活动不会删除。将清除本机完成入口，回原活动重新读取；不会覆盖普通创建草稿。', confirmText: '重新准备' });
      guard(ticket); if (!result.confirm) return;
      assertPending();
      Taro.removeStorageSync(keys.completed); Taro.removeStorageSync(keys.draft); guard(ticket);
      setCompletion(undefined); setStored(undefined);
      await Taro.redirectTo({ url: `/pages/activity/index?id=${sourceId}` });
    } catch { if (mounted.current && active.current && ticket === epoch.current) setMessage('重新准备未完成，本机入口可能已部分更新，请重新进入核对；已创建的新活动不受影响。'); }
    finally { anotherLock.current = false; if (mounted.current) setAnotherBusy(false); }
  }
  if (!sourceId) return <Panel title="再约入口无效"><Notice>来源活动标识不完整，没有读取、覆盖或发布任何草稿。</Notice></Panel>;
  return <View className="screen">
    <Panel title={completedId && !pending ? '这份再约已创建新活动' : '再约 · 独立本机草稿'}>
      <Notice>不继承旧成员、同意、审批、核实或预订；仅本机保存，明确确认发起后才创建新活动和新链接。普通创建草稿保持不变。</Notice>
      {source && draft && <Text>旧来源时区：{draft.source_timezone}。本次全部日期重新按北京时间设置。</Text>}
      {!source && <Notice>请确认本人的登录身份；不同账号不能恢复他人的再约草稿。</Notice>}
      {(identity.error || login.error) && <Notice>{identity.error || login.error}</Notice>}
      {(!source || identity.error) && <Action disabled={login.busy || write.busy} onClick={() => { void login.login(); }}>微信登录</Action>}
      {storageIssue && <Notice>{storageIssue}</Notice>}
      {pendingIssue && <Notice>{pendingIssue}</Notice>}
    </Panel>
    {completedId && !pending ? <Panel title="服务端已确认新活动">
      <Action disabled={anotherBusy} onClick={() => { try { guard(); void Taro.redirectTo({ url: `/pages/activity/index?id=${completedId}` }); } catch { setMessage('账号或页面已变化，请重新读取本人记录。'); } }}>查看再约新活动</Action>
      <Action disabled={write.busy || anotherBusy} onClick={() => { void another(); }}>重新准备另一份再约草稿</Action>
    </Panel> : displayed ? <Panel title={displayed.name}>
      {displayed.segments.map(s => <View key={s.client_ref}><Text>{s.name}{displayed.main_segment_ref === s.client_ref ? ' · 主环节' : ''}</Text><Text>{formatTime(s.starts_at)} — {formatTime(s.ends_at)}；截止 {formatTime(s.deadline_at)}</Text><Text>{s.location.name} · {s.location.address ?? ''}</Text><Text>{feeText(s.fee)}</Text></View>)}
      <Notice>{displayed.participating_segment_refs.length ? '本人参加以本次重新勾选为准。' : '本次未选择本人参加，不占席位。'}</Notice>
    </Panel> : source && draft ? <ActivityEditor value={draft.form} disabled={disabled} onChange={form => { try { persist(updateRebookForm(draft, form)); } catch { setMessage('账号或页面已变化，旧稿停止编辑。'); } }}
      rebook={{ checks: draft.checks, confirm: (ref, kind) => { try { persist(confirmRebookField(draft, ref, kind)); } catch { setMessage('账号或页面已变化，请重新读取。'); } } }} /> : source && loaded === owner && !storageIssue ? <Notice>本机没有这份再约草稿。请回原活动读取来源并明确选择复制，不会自动从旧活动导入。</Notice> : null}
    {source && pending && <Panel title="上次再约发布结果待核对"><Notice>沿用本账号原内容和请求标识，只手动恢复，不重新复制来源或自动发送。独立草稿损坏不覆盖这份已验证的原请求。</Notice><Action disabled={write.busy || write.blocked || !!pendingIssue || !!identity.error || identity.loading} onClick={() => { try { guard(); assertPending(pending.input); firstDispatch.current = undefined; void write.send(); } catch { setMessage('身份、页面或原请求状态变化，原记录保留。'); } }}>核对并重试再约发布</Action></Panel>}
    {source && draft && !completedId && !pending && <Action disabled={disabled} onClick={preview ? publish : prepare}>{preview ? '确认发起再约新活动' : '预览再约新活动'}</Action>}
    {preview && !pending && <Action disabled={write.busy} onClick={() => { try { guard(); setReview(undefined); } catch { setMessage('页面或身份已变化。'); } }}>返回修改再约</Action>}
    {message && <Notice>{message}</Notice>}{source && write.message && <Notice>{write.message}</Notice>}
    <Action disabled={write.busy || anotherBusy} onClick={() => { void Taro.navigateBack(); }}>返回</Action>
  </View>;
}

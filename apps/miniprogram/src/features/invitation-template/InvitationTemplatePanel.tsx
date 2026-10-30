import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Text, Textarea, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../activity-entry/ActivityUI';
import { getToken } from '../../platform/api';
import { invitationTemplateModel, MAX_TEMPLATE_CHARACTERS } from './model';

type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; anyBusy?: boolean; verifiedOutgoingInvitationId?: string };
type Model = ReturnType<typeof invitationTemplateModel>;
type Draft = { owner: string; source: string; epoch: number; text: string; original: string };
/** Public snapshot text only. There is no model call, storage, invitation creation or implicit sharing. */
export function InvitationTemplatePanel(props: Props) {
  let model: Model | undefined;
  try { model = invitationTemplateModel(props.detail, props.verifiedOutgoingInvitationId); } catch { /* Do not render invalid or incomplete facts as a template. */ }
  const owner = JSON.stringify([props.detail.activity_id, props.detail.viewer.user_id, props.session]);
  const observed = JSON.stringify([owner, model?.sourceKey, props.fresh, !!props.anyBusy]);
  const source = useRef(observed), epoch = useRef(0), mounted = useRef(true), visible = useRef(true);
  const lock = useRef<number | null>(null), sequence = useRef(0);
  if (source.current !== observed) { source.current = observed; epoch.current++; lock.current = null; }
  const [draft, setDraft] = useState<Draft>(); const draftRef = useRef(draft); draftRef.current = draft;
  const [busy, setBusy] = useState<'generate' | 'copy' | ''>(''); const [message, setMessage] = useState('');
  const latest = useRef({ props, model, owner }); latest.current = { props, model, owner };
  const clock = useRef({ source: model?.sourceKey, remote: Date.parse(model?.snapshotAt ?? ''), local: Date.now() });
  if (clock.current.source !== model?.sourceKey || Date.parse(model?.snapshotAt ?? '') > clock.current.remote) clock.current = { source: model?.sourceKey, remote: Date.parse(model?.snapshotAt ?? ''), local: Date.now() };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; lock.current = null; }; }, []);
  // Same-owner refresh preserves editable text as stale; a different account/activity never sees it.
  useEffect(() => { if (draftRef.current?.owner !== owner) { draftRef.current = undefined; setDraft(undefined); } setMessage(''); setBusy(''); }, [owner]);
  useEffect(() => { setBusy(''); }, [observed]);
  function hide() { visible.current = false; epoch.current++; lock.current = null; setBusy(''); setMessage('页面已离开，回来后请重新生成并核对文案。'); }
  useDidHide(hide); useUnload(hide); useDidShow(() => { visible.current = true; });
  const renderEpoch = epoch.current;
  const allowed = !!model && props.fresh && !props.anyBusy && getToken() === props.session;
  const currentDraft = draft?.owner === owner && getToken() === props.session ? draft : undefined;
  const current = !!currentDraft && currentDraft.source === model?.sourceKey && currentDraft.epoch === renderEpoch;
  function guard(ticket: number, expectedOwner: string, expectedSource: string) {
    const now = latest.current;
    if (!mounted.current || !visible.current || ticket !== epoch.current || now.owner !== expectedOwner || now.model?.sourceKey !== expectedSource || !now.props.fresh || now.props.anyBusy || getToken() !== now.props.session) throw new Error('TEMPLATE_STALE');
    const boundary = now.model.nextBoundaryAt;
    const serverNow = clock.current.remote + Math.max(0, Date.now() - clock.current.local);
    if (boundary !== null && serverNow >= Date.parse(boundary)) throw new Error('TEMPLATE_TIME_CHANGED');
  }
  function publishDraft(value: Draft | undefined) { draftRef.current = value; setDraft(value); }
  async function generate() {
    if (!allowed || !model || lock.current !== null) return;
    const ticket = renderEpoch, expectedOwner = owner, expectedSource = model.sourceKey;
    try { guard(ticket, expectedOwner, expectedSource); } catch { if (mounted.current && visible.current && ticket === epoch.current && latest.current.owner === expectedOwner) setMessage('页面或时间状态已变化，请刷新安排后再生成。'); return; }
    const operation = ++sequence.current; lock.current = operation; setBusy('generate'); setMessage('');
    try {
      if (draftRef.current?.owner === owner && draftRef.current.text) {
        const answer = await Taro.showModal({ title: '重新生成固定文案', content: '这会替换本页当前编辑的文字。取消可保留原稿；原稿不会自动保存到服务器。' });
        if (!answer.confirm) return;
      }
      guard(ticket, expectedOwner, expectedSource);
      // A replacement has a new edit generation, even when its public source is identical.
      publishDraft({ owner, source: expectedSource, epoch: ++epoch.current, text: model.text, original: model.text });
      setMessage('已按当前公开快照生成固定模板，未调用 AI，也未复制或发送。');
    } catch {
      if (mounted.current && visible.current && ticket === epoch.current && latest.current.owner === expectedOwner) setMessage('生成未完成，原稿仍保留。请重新核对后再试。');
    } finally { if (lock.current === operation) { lock.current = null; if (mounted.current) setBusy(''); } }
  }
  function edit(value: unknown) {
    const d = draftRef.current;
    if (!d || !current || lock.current !== null) return;
    try { guard(renderEpoch, owner, d.source); } catch { return; }
    if (typeof value !== 'string' || value.length > MAX_TEMPLATE_CHARACTERS) { setMessage('文案过长，未替换当前输入。'); return; }
    publishDraft({ ...d, text: value }); setMessage('');
  }
  async function copy() {
    const d = draftRef.current;
    if (!allowed || !current || !d || !d.text.trim() || lock.current !== null) return;
    const ticket = renderEpoch, expectedOwner = owner, expectedSource = d.source;
    try { guard(ticket, expectedOwner, expectedSource); } catch { if (mounted.current && visible.current && ticket === epoch.current && latest.current.owner === expectedOwner) setMessage('页面或时间状态已变化，请刷新安排后重新生成；原稿仍保留。'); return; }
    const operation = ++sequence.current; lock.current = operation; setBusy('copy'); setMessage('');
    try {
      guard(ticket, expectedOwner, expectedSource);
      const result = await Taro.setClipboardData({ data: d.text });
      guard(ticket, expectedOwner, expectedSource);
      if (result.errMsg !== 'setClipboardData:ok') throw new Error('COPY_UNCONFIRMED');
      setMessage('文案已复制。请自行核对后发送，并使用原生分享按钮附上最新活动入口。');
    } catch {
      if (mounted.current && visible.current && ticket === epoch.current && latest.current.owner === expectedOwner) setMessage('复制未确认，请检查剪贴板后自行重试；文字仍保留，不会自动发送。');
    } finally { if (lock.current === operation) { lock.current = null; if (mounted.current) setBusy(''); } }
  }
  return <Panel title="邀请／补位固定文案">
    <Text className="caption">固定模板，非 AI 生成。不读取成员名单、个人出发地或答卷；人数只是所示快照，不是实时空位或占位承诺。</Text>
    {!model && <Notice>公开行程数据不完整或文案超出本片容量，暂不能生成；仍可使用原生分享入口。</Notice>}
    <Action disabled={!allowed || !!busy} onClick={() => { void generate(); }}>{busy === 'generate' ? '正在核对…' : currentDraft ? '重新生成固定文案' : '生成固定邀请文案'}</Action>
    {currentDraft && <View>
      {!current && <Notice>原稿已过时，仅保留供你核对。请先刷新安排并明确重新生成，不会静默覆盖你的修改。</Notice>}
      <Textarea value={currentDraft.text} maxlength={MAX_TEMPLATE_CHARACTERS} disabled={!allowed || !current || !!busy} onInput={event => edit(event.detail.value)} style={{ width: '100%', minHeight: '240px' }} />
      <Text className="caption">自行修改的文字未经过事实校验；请核对时间、费用和人数后发送。报名入口请用上方原生分享按钮，内部小程序路径不是网页链接。</Text>
      <Action disabled={!allowed || !current || !!busy || !currentDraft.text.trim()} onClick={() => { void copy(); }}>{busy === 'copy' ? '正在复制…' : '复制当前文案'}</Action>
      <Action variant="text" disabled={!allowed || !current || !!busy} onClick={() => edit('')}>清空文案</Action>
    </View>}
    {message && <Notice>{message}</Notice>}
  </Panel>;
}

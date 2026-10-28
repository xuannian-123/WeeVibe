import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { Canvas, Image, Text, View } from '@tarojs/components';
import type { ActivityDetail } from '@weevibe/contracts';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import { ACTIVITY_SHARE_CANVAS, renderActivityCard } from './canvas';
import { activityCardModel, cardLayout, QR_UNAVAILABLE } from './model';
import './share-card.css';

let instanceSequence = 0;
/** Source may only come from the existing verified createInvitationSource result, never URL incomingId. */
type Props = { detail: ActivityDetail; session: string | undefined; fresh: boolean; verifiedOutgoingInvitationId?: string; anyBusy?: boolean };
export function ActivityShareCard(props: Props) {
  let card: ReturnType<typeof activityCardModel> | undefined;
  let layout: ReturnType<typeof cardLayout> | undefined;
  try { card = activityCardModel(props.detail, props.verifiedOutgoingInvitationId); layout = cardLayout(card); } catch { /* Fail closed on oversized/invalid public data. */ }
  const instance = useRef(0); if (!instance.current) instance.current = ++instanceSequence;
  const key = JSON.stringify([card, props.session, props.detail.viewer.user_id, props.fresh, !!props.anyBusy]);
  const owner = useRef(key), epoch = useRef(0), mounted = useRef(true), visible = useRef(true), lock = useRef<'generate' | 'save' | ''>('');
  // Increment during render so A→B→A ownership changes cannot revive old async tickets.
  if (owner.current !== key) { owner.current = key; epoch.current++; lock.current = ''; }
  const latest = useRef(props); latest.current = props;
  const [image, setImage] = useState<{ path: string; key: string; epoch: number }>();
  const [busy, setBusy] = useState<'generate' | 'save' | ''>('');
  const [message, setMessage] = useState('');
  useEffect(() => { setImage(undefined); setBusy(''); setMessage(''); }, [key]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const invalidate = () => { visible.current = false; epoch.current++; lock.current = ''; setImage(undefined); setBusy(''); setMessage(''); };
  useDidHide(invalidate); useUnload(invalidate); useDidShow(() => { visible.current = true; });
  function guard(ticket: number, expectedKey: string) {
    const current = latest.current;
    if (!mounted.current || !visible.current || epoch.current !== ticket || owner.current !== expectedKey || !current.fresh || current.anyBusy || getToken() !== current.session) throw new Error('CARD_STALE');
  }
  const allowed = !!card && !!layout && props.fresh && !props.anyBusy && getToken() === props.session;
  const currentImage = allowed && image?.key === key && image.epoch === epoch.current ? image : undefined;
  const renderEpoch = epoch.current;
  const canvasId = `${ACTIVITY_SHARE_CANVAS}-${instance.current}-${renderEpoch}`;
  function cancel() {
    // Native save has already been handed off; even an old close handler cannot cancel it.
    if (lock.current === 'save') return;
    try { guard(renderEpoch, key); } catch { return; }
    epoch.current++; lock.current = ''; setImage(undefined); setBusy(''); setMessage('已关闭图片预览，不会自动保存或发送。');
  }
  async function generate() {
    if (!allowed || !card || lock.current) return;
    try { guard(renderEpoch, key); } catch { return; }
    const ticket = ++epoch.current; const expectedKey = key;
    const assertCurrent = () => guard(ticket, expectedKey);
    lock.current = 'generate'; setBusy('generate'); setImage(undefined); setMessage('');
    try {
      assertCurrent(); const path = await renderActivityCard(card, assertCurrent, `${ACTIVITY_SHARE_CANVAS}-${instance.current}-${ticket}`); assertCurrent();
      setImage({ path, key: expectedKey, epoch: ticket });
    } catch {
      if (mounted.current && visible.current && epoch.current === ticket && owner.current === expectedKey) setMessage('图片生成未完成，请重新生成；仍可使用原生分享链接。');
    } finally {
      if (epoch.current === ticket && owner.current === expectedKey) { lock.current = ''; if (mounted.current) setBusy(''); }
    }
  }
  async function save() {
    if (!allowed || !currentImage || lock.current) return;
    const ticket = currentImage.epoch; const expectedKey = key; const assertCurrent = () => guard(ticket, expectedKey);
    try { assertCurrent(); } catch { return; }
    lock.current = 'save'; setBusy('save'); setMessage('');
    try {
      assertCurrent();
      // Only this explicit user action invokes album save; no authorize/openSetting or auto-retry.
      const result = await Taro.saveImageToPhotosAlbum({ filePath: currentImage.path });
      assertCurrent();
      if (result.errMsg !== 'saveImageToPhotosAlbum:ok') throw new Error('SAVE_UNCONFIRMED');
      setMessage('已保存到相册。图片是快照，请同时分享活动链接以便查看最新安排。');
    } catch {
      if (mounted.current && visible.current && epoch.current === ticket && owner.current === expectedKey) setMessage('保存未确认：可能已取消或相册权限未允许。请检查相册后自行重试，不会自动打开设置。');
    } finally {
      if (epoch.current === ticket && owner.current === expectedKey) { lock.current = ''; if (mounted.current) setBusy(''); }
    }
  }
  return <Panel title="把这次安排分享给朋友" className="wv-share-card">
    <Text className="caption">单张公开行程快照，不含成员名单、个人出发地或答卷。不会自动发送。</Text>
    <Notice>{QR_UNAVAILABLE}。图片不提供可扫码报名入口。</Notice>
    {!layout && <Notice tone="error">行程暂不能生成单张可读图片，请使用原生分享链接。</Notice>}
    <Action variant="primary" disabled={!allowed || !!busy} onClick={() => { void generate(); }}>{busy === 'generate' ? '正在生成…' : '生成行程图片'}</Action>
    {layout && <Canvas canvasId={canvasId} id={canvasId} style={{ position: 'fixed', left: '-10000px', top: 0, width: `${layout.width}px`, height: `${layout.height}px` }} />}
    {currentImage && <View className="wv-share-preview"><Image src={currentImage.path} mode="widthFix" style={{ width: '100%' }} /><Action variant="primary" disabled={!allowed || !!busy} onClick={() => { void save(); }}>{busy === 'save' ? '正在保存…' : '保存图片到相册'}</Action></View>}
    {(!!busy || !!currentImage) && <Action variant="text" disabled={busy === 'save'} onClick={cancel}>{busy === 'generate' ? '取消生成' : '关闭图片预览'}</Action>}
    {message && <Notice>{message}</Notice>}
  </Panel>;
}

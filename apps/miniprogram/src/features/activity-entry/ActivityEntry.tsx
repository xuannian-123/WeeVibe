import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useRouter, useUnload } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { ApiClientError } from '@weevibe/api-client';
import { Action, Notice, Panel } from '../../components/ui';
import { getToken } from '../../platform/api';
import ActivityDetail from '../activity-detail';
import { activityEntryFromParams } from '../invitations/scene';
import { readSceneInvitation, sceneEntryErrorText } from './scene-client';

type Source = { scene: string; invitationId: string; session: string | undefined };
type Operation = Source & { epoch: number; request: number; redirectStarted: boolean };
type Display = { epoch: number; phase: 'loading' | 'error' | 'cancelled' | 'navigating'; message: string };
const sameSource = (a: Source, b: Source) => a.scene === b.scene && a.invitationId === b.invitationId && a.session === b.session;

function EntryBack({ beforeBack }: { beforeBack?: () => boolean }) {
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const mounted = useRef(true), visible = useRef(true), unloaded = useRef(false), epoch = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const stop = () => { visible.current = false; epoch.current++; };
  useDidHide(stop);
  useUnload(() => { unloaded.current = true; stop(); });
  useDidShow(() => { if (!unloaded.current) visible.current = true; });
  return <View><Action variant="text" onClick={() => {
    if (!mounted.current || !visible.current || unloaded.current || busy.current || (beforeBack && !beforeBack())) return;
    const ticket = epoch.current;
    busy.current = true;
    void Taro.navigateBack().catch(() => {
      if (mounted.current && visible.current && ticket === epoch.current) setMessage('返回未完成，请使用微信返回操作或从首页重新打开。');
    }).finally(() => { busy.current = false; });
  }}>返回</Action>{message && <Notice>{message}</Notice>}</View>;
}

function SceneEntry({ scene, invitationId }: { scene: string; invitationId: string }) {
  const session = getToken();
  const currentSource = { scene, invitationId, session };
  const observed = useRef<Source>(currentSource);
  const epoch = useRef(0), request = useRef(0);
  const operation = useRef<Operation>();
  const mounted = useRef(true), visible = useRef(true), unloaded = useRef(false);
  // Observe changes before effects run. A -> B -> A cannot revive an old ticket.
  if (!sameSource(observed.current, currentSource)) {
    observed.current = currentSource;
    epoch.current++;
    operation.current = undefined;
  }
  const renderEpoch = epoch.current;
  const [display, setDisplay] = useState<Display>({ epoch: renderEpoch, phase: 'loading', message: '正在核验公开邀请来源…' });
  const active = () => mounted.current && visible.current && !unloaded.current;
  const owns = (op: Operation) => active() && operation.current === op && epoch.current === op.epoch && sameSource(observed.current, op);
  const invalidate = () => { epoch.current++; operation.current = undefined; };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; invalidate(); };
  }, []);
  const stop = () => {
    visible.current = false;
    invalidate();
    if (mounted.current) setDisplay({ epoch: epoch.current, phase: 'cancelled', message: '入口读取已停止；返回此页后可手动重试。' });
  };
  useDidHide(stop);
  useUnload(() => { unloaded.current = true; stop(); });
  useDidShow(() => { if (!unloaded.current) visible.current = true; });

  async function begin(expectedEpoch: number) {
    if (!active() || operation.current || expectedEpoch !== epoch.current || !sameSource(observed.current, currentSource) || getToken() !== session) return;
    const op: Operation = { ...currentSource, epoch: epoch.current, request: ++request.current, redirectStarted: false };
    operation.current = op; // synchronous single-flight lock, before any await
    setDisplay({ epoch: op.epoch, phase: 'loading', message: '正在核验公开邀请来源…' });
    const check = () => {
      const token = getToken();
      if (token !== observed.current.session) {
        const held = active() && operation.current === op && epoch.current === op.epoch;
        observed.current = { ...observed.current, session: token };
        invalidate();
        if (held) setDisplay({ epoch: epoch.current, phase: 'error', message: sceneEntryErrorText(new ApiClientError('SESSION_CHANGED', '账号已变化', 409)) });
      }
      if (token !== op.session) throw new ApiClientError('SESSION_CHANGED', '账号已变化', 409);
      if (!owns(op)) throw new ApiClientError('ENTRY_CHANGED', '入口已变化', 409);
    };
    let navigated = false;
    try {
      const source = await readSceneInvitation(invitationId, session, check);
      check();
      // IDs come only from the strict public source contract; no title, token,
      // recipient identity or guessed revision is copied into the destination.
      const url = `/pages/activity/index?id=${source.activity_id}&invitation_id=${source.invitation_id}`;
      setDisplay({ epoch: op.epoch, phase: 'navigating', message: '正在打开活动，当前安排以活动详情为准…' });
      check();
      op.redirectStarted = true;
      const result = await Taro.redirectTo({ url });
      check();
      if (result?.errMsg !== 'redirectTo:ok') throw new ApiClientError('NAVIGATION_FAILED', '导航未确认', 0);
      navigated = true;
    } catch (error) {
      if (owns(op)) setDisplay({ epoch: op.epoch, phase: 'error', message: sceneEntryErrorText(op.redirectStarted ? new ApiClientError('NAVIGATION_FAILED', '导航未确认', 0) : error) });
      else if (active() && operation.current === op) setDisplay({ epoch: epoch.current, phase: 'error', message: sceneEntryErrorText(error) });
    } finally {
      // An old response/finally never releases a newer request's lock.
      // A successful native handoff remains locked until the page leaves.
      if (!navigated && operation.current === op) operation.current = undefined;
    }
  }
  // A newly supplied scene gets one read. Session changes stop the old read and
  // require an explicit retry; cancellation/hide/show never automatically retry.
  useEffect(() => { void begin(epoch.current); }, [scene, invitationId]);

  function cancel() {
    if (!active() || renderEpoch !== epoch.current || !sameSource(observed.current, currentSource) || operation.current?.redirectStarted) return false;
    invalidate();
    setDisplay({ epoch: epoch.current, phase: 'cancelled', message: '已停止本页后续打开；未自动登录、保存邀请或报名。' });
    return true;
  }
  const view = display.epoch === epoch.current ? display : { phase: 'cancelled', message: '账号或邀请入口已变化，请重新核验。' };
  const busy = !!operation.current;
  return <View className="page"><Panel title="打开邀请活动">
    <Notice tone={view.phase === 'error' ? 'error' : 'info'}>{view.message}</Notice>
    <Text className="caption">仅核验可转发的公开邀请来源；不会自动登录、保存邀请或报名，也不授予席位、群资格或管理权限。</Text>
    <Action disabled={busy} onClick={() => { void begin(renderEpoch); }}>重新核验</Action>
    <Action disabled={!!operation.current?.redirectStarted} onClick={() => { cancel(); }}>取消打开</Action>
    {operation.current?.redirectStarted && <Text className="caption">导航已交给微信，无法保证撤回已经发出的跳转。</Text>}
    <EntryBack beforeBack={cancel} />
  </Panel></View>;
}

/** Ordinary id/invitation_id entry still mounts the original detail controller once. */
export default function ActivityEntry() {
  const entry = activityEntryFromParams(useRouter().params);
  if (entry.kind === 'standard') return <ActivityDetail />;
  if (entry.kind === 'invalid') return <View className="page"><Panel title="邀请入口无法识别"><Notice tone="error">邀请入口格式无效或包含混合参数，请核对原入口；尚未读取邀请或活动。</Notice><EntryBack /></Panel></View>;
  return <SceneEntry scene={entry.scene} invitationId={entry.invitationId} />;
}

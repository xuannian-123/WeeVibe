import { useEffect, useRef, useState } from 'react';
import Taro, { useDidShow, useDidHide, useUnload } from '@tarojs/taro';
import { errorText, uncertain } from './page-state';

export type StoredWrite<I> = { userId: string; input: I };
// A pending request is persisted before sending. Reopening never replays it automatically.
export function useStoredWrite<I, O>({ storageKey, userId, parse, execute, committed }: {
  storageKey: string; userId?: string; parse: (input: unknown) => I;
  execute: (input: I) => Promise<O>; committed: (result: O) => void;
}) {
  const [pending, setPending] = useState<StoredWrite<I>>();
  const [result, setResult] = useState<O>(); const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const lock = useRef(false); const visible = useRef(true); const actor = useRef(userId); actor.current = userId;
  const pendingRef = useRef<StoredWrite<I>>();
  function restore() {
    setBusy(lock.current); setBlocked(false);
    try {
      const raw: unknown = Taro.getStorageSync(storageKey);
      if (!raw || typeof raw !== 'object') { pendingRef.current = undefined; setPending(undefined); return; }
      const stored = raw as { userId?: unknown; input?: unknown };
      if (stored.userId !== actor.current) { pendingRef.current = undefined; setPending(undefined); return; }
      const next = { userId: String(stored.userId), input: parse(stored.input) };
      pendingRef.current = next; setPending(next);
      setMessage('上次提交结果还未确认，请先刷新查看。需要重试时会沿用原来的内容，不会自动再次发送。');
    } catch { setBlocked(true); setMessage('无法恢复上次请求，请先核对服务端活动记录，不要重复创建。'); }
  }
  useEffect(() => { setResult(undefined); setMessage(''); restore(); }, [storageKey, userId]);
  useDidShow(() => { visible.current = true; restore(); });
  useDidHide(() => { visible.current = false; }); useUnload(() => { visible.current = false; });
  async function send(input?: I) {
    if (blocked || lock.current || !userId || actor.current !== userId) return;
    const operation = pendingRef.current ?? (input ? { userId, input: parse(input) } : undefined);
    if (!operation || operation.userId !== userId) return;
    lock.current = true; setBusy(true); setMessage('正在提交，请勿重复点击。');
    try {
      // If persistence fails, do not send an operation whose key could be lost.
      Taro.setStorageSync(storageKey, operation); pendingRef.current = operation; setPending(operation);
    } catch { lock.current = false; setBusy(false); setMessage('无法保存原请求，本次没有发送。请检查本机存储后重试。'); return; }
    try {
      const result = await execute(operation.input);
      // Persist acknowledgement (for create: activity reference) before dropping the retry key.
      committed(result);
      Taro.removeStorageSync(storageKey); pendingRef.current = undefined;
      if (visible.current && actor.current === userId) { setPending(undefined); setResult(result); setMessage('服务端已确认本次操作。'); }
    } catch (error) {
      if (!uncertain(error)) {
        try { Taro.removeStorageSync(storageKey); pendingRef.current = undefined; } catch { if (visible.current) setBlocked(true); }
        if (visible.current && actor.current === userId) setPending(undefined);
      }
      if (visible.current && actor.current === userId) setMessage(errorText(error) + (uncertain(error) ? ' 原内容已保留，请先刷新核对，再决定是否重试。' : ' 草稿和所选环节已保留。'));
    } finally { lock.current = false; if (visible.current) setBusy(false); }
  }
  return { pending, busy, blocked, result, message, send, resetResult: () => { setResult(undefined); setMessage(''); } };
}

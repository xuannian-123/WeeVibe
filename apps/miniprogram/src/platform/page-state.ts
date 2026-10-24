import { useCallback, useRef, useState } from 'react';
import Taro, { useDidHide, useDidShow, useUnload } from '@tarojs/taro';
import { ApiClientError } from '@weego/api-client';
import { api, establishSession, forgetSession, getToken } from './api';

export function errorText(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '请求结果无法确认，请刷新核对。若是写入，请保留原请求后重试。';
  const messages: Record<string, string> = {
    NOT_CONFIGURED: '尚未配置正式 API 或数据库。不会使用本地活动伪装成功。',
    UNAUTHENTICATED: '尚未登录或会话失效，请重新登录；当前目标和草稿保留。',
    FORBIDDEN: '当前身份没有此操作权限，请刷新查看当前管理归属。',
    NOT_FOUND: '未找到活动或无法访问，请核对活动入口。体验成员资格由微信平台单独检查。',
    CAPACITY_FULL: '所选环节名额已变化，本次组合未获批准，请刷新核对。',
    APPLICATION_CLOSED: '所选环节已有报名截止或开始，请刷新查看逐段状态。',
    SEGMENT_APPLICATION_CLOSED: '所选环节已截止、开始或取消，本次组合不能新加入。',
    ALREADY_JOINED: '所选环节已有本人席位，请只选择本次新增环节。',
    APPLICATION_ALREADY_PENDING: '所选环节已有本人待处理申请，请刷新核对。',
    APPLICATION_ALREADY_DECIDED: '该申请已被处理，请刷新查看实际结果。',
    CONCURRENT_MODIFICATION: '有其他操作同时更新活动，请刷新核对后再操作。',
    ACTIVITY_STARTED: '相关环节已开始，线上加入或修改已关闭。',
    ACTIVITY_CANCELLED: '活动已取消，不能继续加入或批准。',
    ARRANGEMENT_STALE: '安排版本已变化，请重新查看并接受当前安排。',
    VERSION_CONFLICT: '活动有更新，请刷新后核对，本次未自动重放。',
    IDEMPOTENCY_CONFLICT: '原请求与幂等键不一致，请保留原请求并核对结果。',
    INVALID_INPUT: '输入或所选组合不符合服务端规则，请核对字段、版本和参加环节。',
    INVALID_STATE: '当前状态不允许此操作，请刷新核对。',
    NETWORK_ERROR: '网络请求未完成，结果待核对。请恢复网络后刷新，不要重复创建。',
    DATABASE_UNAVAILABLE: '正式数据库暂不可用，业务结果尚未核实。',
    UPSTREAM_UNAVAILABLE: '上游服务暂不可用，请稍后重试。',
    INTERNAL_ERROR: '服务暂时异常，请保留请求并刷新核对。'
  };
  return messages[error.code] ?? '服务请求未完成，请刷新核对，不会以静态样例代替。';
}

// Visible-page generation guards both lifecycle changes and out-of-order reads.
export function usePageRead<T>(loader: () => Promise<T>, enabled = true) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const visible = useRef(false); const seq = useRef(0); const failures = useRef(0);
  const loadRef = useRef(loader); loadRef.current = loader;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const clear = () => { if (timer.current) clearTimeout(timer.current); };
  const refresh = useCallback(async () => {
    clear();
    if (!visible.current || !enabledRef.current) return;
    const epoch = ++seq.current; setLoading(true);
    try {
      const next = await loadRef.current();
      if (!visible.current || epoch !== seq.current) return;
      setData(next); setError(''); failures.current = 0;
    } catch (e) {
      if (!visible.current || epoch !== seq.current) return;
      if (e instanceof ApiClientError && e.code === 'UNAUTHENTICATED') forgetSession();
      setError(errorText(e)); failures.current++;
    } finally {
      if (visible.current && epoch === seq.current) {
        setLoading(false);
        timer.current = setTimeout(() => { void refresh(); }, Math.min(30000, 5000 * 2 ** Math.min(failures.current, 3)));
      }
    }
  }, []);
  const stop = () => { visible.current = false; seq.current++; clear(); };
  useDidShow(() => { visible.current = true; void refresh(); });
  useDidHide(stop); useUnload(stop);
  return { data, loading, error, refresh };
}

export function useLogin(onSuccess: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const locked = useRef(false);
  const alive = useRef(true);
  useDidShow(() => { alive.current = true; setBusy(locked.current); }); useDidHide(() => { alive.current = false; }); useUnload(() => { alive.current = false; });
  async function login() {
    if (locked.current) return; locked.current = true; setBusy(true); setError('');
    try { await establishSession(); if (alive.current) await onSuccess(); }
    catch (e) { if (alive.current) setError(errorText(e)); }
    finally { locked.current = false; if (alive.current) setBusy(false); }
  }
  return { busy, error, login };
}

export async function requireUser() {
  if (!getToken()) throw new ApiClientError('UNAUTHENTICATED', '尚未登录', 401);
  return api.me();
}

export { newKey } from './local-id';
export type PendingWrite<T> = { key: string; input: T };
export function readSaved<T>(key: string): T | undefined {
  try { const value: unknown = Taro.getStorageSync(key); return value && typeof value === 'object' ? value as T : undefined; } catch { return undefined; }
}
export function save(key: string, value: unknown) { Taro.setStorageSync(key, value); }
export function clearSaved(key: string) { Taro.removeStorageSync(key); }
export { uncertain } from './write-policy';

import Taro from '@tarojs/taro';
import { ApiClientError } from '@weevibe/api-client';
import { api, establishSession, forgetSession, getToken } from './api';

const pauseKey = 'weevibe_auto_login_paused_v1';
let revision = 0;
let paused = false;
let pending: Promise<{ user: Awaited<ReturnType<typeof api.me>>; session: string }> | undefined;
let pendingSource: string | undefined;

export function pauseAutomaticLogin() {
  revision++; paused = true; pending = undefined;
  Taro.setStorageSync(pauseKey, true);
}
export function resumeAutomaticLogin() {
  revision++; paused = false; pending = undefined;
  if (Taro.getStorageSync(pauseKey) === true) Taro.setStorageSync(pauseKey, false);
}

/** Read identity only. Never retry or replay a business mutation here. */
export function automaticUser() {
  const source = getToken(), epoch = revision;
  if (pending && pendingSource === source) return pending;
  const assertSource = () => {
    if (epoch !== revision || getToken() !== source) {
      throw new ApiClientError('UNAUTHENTICATED', '登录来源已变化，请刷新核对。', 401);
    }
  };
  const task = (async () => {
    if (source) {
      try { const user = await api.me(); assertSource(); return { user, session: source }; }
      catch (error) {
        assertSource();
        // Network/configuration/permission errors must not discard a valid token.
        if (!(error instanceof ApiClientError) || error.code !== 'UNAUTHENTICATED') throw error;
      }
    }
    if (paused || Taro.getStorageSync(pauseKey) === true) {
      throw new ApiClientError('UNAUTHENTICATED', '已退出登录，请点击微信登录。', 401);
    }
    assertSource();
    // Keep the expired token until a guarded replacement is ready, so concurrent
    // readers share this single attempt and late responses cannot clear a new one.
    const user = await establishSession(assertSource);
    const session = getToken();
    if (!session) throw new ApiClientError('UNAUTHENTICATED', '会话未保存，请重试。', 401);
    const verified = await api.me();
    if (revision !== epoch || getToken() !== session || verified.user_id !== user.user_id) {
      throw new ApiClientError('UNAUTHENTICATED', '登录来源已变化，请刷新核对。', 401);
    }
    return { user: verified, session };
  })();
  pending = task;
  pendingSource = source;
  const clear = () => { if (pending === task) pending = undefined; };
  void task.then(clear, clear);
  return task;
}

export function logoutAutomaticSession() {
  pauseAutomaticLogin();
  forgetSession();
}

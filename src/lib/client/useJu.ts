"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JuState } from "@/lib/types";
import { api, ApiError, type JoinBody } from "./api";
import { store } from "./storage";

/** 页面组件只依赖这组动作；gallery 用假实现替换 */
export type JuActions = {
  join: (body: JoinBody) => Promise<void>;
  leave: () => Promise<void>;
  rejoin: () => Promise<void>;
  plan: () => Promise<void>;
  vote: (poiId: string) => Promise<void>;
  confirm: (poiId: string) => Promise<void>;
  settle: (total: number) => Promise<void>;
  seed: (count?: number) => Promise<void>;
  refresh: () => Promise<void>;
};

const POLL_MS = 2000;

export function useJu(id: string) {
  const [state, setState] = useState<JuState | null>(null);
  const [loadError, setLoadError] = useState<{ msg: string; status: number } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  // 每次写操作 +1；写操作期间发出的轮询结果作废，避免旧数据覆盖新数据
  const seq = useRef(0);
  const hasState = useRef(false);

  useEffect(() => {
    setMemberId(store.getMember(id));
    setAdminToken(store.getAdmin(id));
    setReady(true);
  }, [id]);

  const fetchOnce = useCallback(async () => {
    const mySeq = seq.current;
    try {
      const s = await api.getJu(id);
      if (mySeq !== seq.current) return;
      hasState.current = true;
      setState(s);
      setLoadError(null);
      setOffline(false);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("网络开小差了", 0);
      if (!hasState.current) setLoadError({ msg: err.message, status: err.status });
      else setOffline(true); // 已有数据时静默重试，只亮一个小提示
    }
  }, [id]);

  // 轮询：只在页面可见时请求
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;

    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && !inflight) {
        inflight = true;
        await fetchOnce();
        inflight = false;
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();

    const onVis = () => {
      if (document.visibilityState === "visible" && !inflight) {
        clearTimeout(timer);
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchOnce]);

  const apply = useCallback((s: JuState) => {
    seq.current++;
    hasState.current = true;
    setState(s);
  }, []);

  const requireAdmin = useCallback(() => {
    if (!adminToken) throw new ApiError("只有局长才能这么做", 403);
    return adminToken;
  }, [adminToken]);

  const actions: JuActions = {
    refresh: async () => {
      seq.current++;
      await fetchOnce();
    },
    join: async (body) => {
      seq.current++;
      const { memberId: mid } = await api.join(id, body);
      store.setMember(id, mid);
      store.setName(body.name);
      if (body.avatar) store.setAvatar(body.avatar);
      setMemberId(mid);
      await fetchOnce();
    },
    leave: async () => {
      if (!memberId) return;
      seq.current++;
      await api.patchMember(id, memberId, { status: "out" });
      await fetchOnce();
    },
    rejoin: async () => {
      if (!memberId) return;
      seq.current++;
      await api.patchMember(id, memberId, { status: "in" });
      await fetchOnce();
    },
    plan: async () => apply(await api.plan(id, requireAdmin())),
    vote: async (poiId) => {
      if (!memberId) throw new ApiError("先入局才能投票", 400);
      // 乐观更新：点下去立刻看到自己的票
      seq.current++;
      setState((s) => (s ? { ...s, ju: { ...s.ju, votes: { ...s.ju.votes, [memberId]: poiId } } } : s));
      try {
        apply(await api.vote(id, memberId, poiId));
      } catch (e) {
        await fetchOnce();
        throw e;
      }
    },
    confirm: async (poiId) => apply(await api.confirm(id, requireAdmin(), poiId)),
    settle: async (total) => apply(await api.settle(id, total)),
    seed: async (count) => apply(await api.seed(id, requireAdmin(), count)),
  };

  return { state, loadError, offline, memberId, adminToken, ready, actions };
}

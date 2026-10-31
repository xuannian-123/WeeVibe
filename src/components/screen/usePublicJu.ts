"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JuState } from "@/lib/types";
import { ApiError, organizerApi } from "@/components/organizer/api";

/** 大屏专用：只拉公开视图（不带任何 token），保证大屏上不可能出现私密 / 发起人信息 */
export function usePublicJu(id: string, pollMs = 2000) {
  const [state, setState] = useState<JuState | null>(null);
  const [loadError, setLoadError] = useState<{ msg: string; status: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const has = useRef(false);
  // 分身们正在谈（实时）时每秒拉一次
  const live = useRef(false);

  const fetchOnce = useCallback(async () => {
    try {
      const s = await organizerApi.getJu(id, null);
      has.current = true;
      live.current = s.ju.plan?.negotiation?.status === "live";
      setState(s);
      setLoadError(null);
      setOffline(false);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("网络开小差了", 0);
      if (!has.current) setLoadError({ msg: err.message, status: err.status });
      else setOffline(true);
    }
  }, [id]);

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
      if (!stopped) timer = setTimeout(tick, live.current ? Math.min(1000, pollMs) : pollMs);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [fetchOnce, pollMs]);

  return { state, loadError, offline, refresh: fetchOnce };
}

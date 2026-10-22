"use client";

import { useEffect, useRef, useState } from "react";
import type { Stats } from "@/lib/types";
import { api } from "@/lib/client/api";
import { Stage } from "@/components/screen/bits";
import { StatsScreen } from "@/components/stats/StatsScreen";

const REFRESH_MS = 5000;

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && !inflight.current) {
        inflight.current = true;
        try {
          const s = await api.stats();
          if (!stopped) {
            setStats(s);
            setError(false);
          }
        } catch {
          if (!stopped) setError(true); // 保留上一次的数据，静默重试
        } finally {
          inflight.current = false;
        }
      }
      if (!stopped) timer = setTimeout(tick, REFRESH_MS);
    };
    tick();
    const onVis = () => {
      if (document.visibilityState === "visible") {
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
  }, []);

  return (
    <Stage>
      <StatsScreen stats={stats} error={error} />
    </Stage>
  );
}

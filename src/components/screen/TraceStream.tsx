"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@/lib/types";
import { hhmm } from "./fmt";

const KIND: Record<TraceEvent["kind"], [string, string]> = {
  listen: ["👂", "#a89a88"],
  search: ["🔍", "#f2b530"],
  filter: ["🧹", "#f2b530"],
  compute: ["🧮", "#7cc4ff"],
  decide: ["⚖️", "#e2412e"],
  warn: ["⚠️", "#e2412e"],
  done: ["✅", "#3ecf8e"],
};

const CHAR_MS = 38;

/**
 * 局长思考流：新来的条目逐条打字机播放（一条打完再打下一条），
 * 首次加载时已有的条目直接显示，避免刷新页面时重播一遍。
 */
export function TraceStream({ trace, max = 9, size = "lg" }: { trace: TraceEvent[]; max?: number; size?: "lg" | "md" }) {
  const seen = useRef<Set<string> | null>(null);
  const [typed, setTyped] = useState<Record<string, number>>({}); // id -> 已打出的字数
  const [queue, setQueue] = useState<string[]>([]);

  // 记录首屏已有的条目；之后新增的进打字队列
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(trace.map((t) => t.id));
      return;
    }
    const fresh = trace.filter((t) => !seen.current!.has(t.id));
    if (!fresh.length) return;
    for (const t of fresh) seen.current.add(t.id);
    setQueue((q) => [...q, ...fresh.map((t) => t.id)]);
    setTyped((m) => ({ ...m, ...Object.fromEntries(fresh.map((t) => [t.id, 0])) }));
  }, [trace]);

  const head = queue[0];
  const headText = trace.find((t) => t.id === head)?.text ?? "";
  useEffect(() => {
    if (!head) return;
    const n = typed[head] ?? 0;
    if (n >= headText.length) {
      const t = setTimeout(() => setQueue((q) => q.slice(1)), 260);
      return () => clearTimeout(t);
    }
    // 队列积压时打快一点，别让大屏落后太多
    const t = setTimeout(() => setTyped((m) => ({ ...m, [head]: n + (queue.length > 3 ? 3 : 1) })), CHAR_MS);
    return () => clearTimeout(t);
  }, [head, headText, typed, queue.length]);

  // 还在队列里但没轮到的条目先不显示
  const waiting = new Set(queue.slice(1));
  const shown = trace.filter((t) => !waiting.has(t.id)).slice(-max);
  const big = size === "lg";

  if (!shown.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-cream-faint">
        <span className="animate-wiggle text-[44px]">🧠</span>
        <span className="text-[20px] font-bold">局长在听大家说…</span>
      </div>
    );
  }

  return (
    <ol className="flex h-full flex-col justify-end gap-3 overflow-hidden" aria-live="polite" style={{ maskImage: "linear-gradient(transparent, #000 18%)" }}>
      {shown.map((t, i) => {
        const [icon, color] = KIND[t.kind] ?? KIND.listen;
        const typing = t.id === head;
        const text = typing ? t.text.slice(0, typed[t.id] ?? 0) : t.text;
        const last = i === shown.length - 1;
        return (
          <li key={t.id} className={`flex items-start gap-3 ${last ? "" : "opacity-75"}`}>
            <span className={`${big ? "text-[24px]" : "text-[19px]"} leading-[1.35]`}>{icon}</span>
            <div className="min-w-0 flex-1">
              <p className={`${big ? "text-[22px]" : "text-[18px]"} font-semibold leading-[1.35]`} style={{ color: last ? "#f3e7d3" : undefined }}>
                {text}
                {typing && <span className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-[3px] animate-pulse" style={{ background: color }} />}
              </p>
            </div>
            <span className="font-num shrink-0 pt-1 text-[14px] text-cream-faint">{hhmm(t.at)}</span>
          </li>
        );
      })}
    </ol>
  );
}

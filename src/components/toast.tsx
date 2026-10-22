"use client";

import { useEffect, useState } from "react";

type Toast = { id: number; msg: string; kind: "info" | "error" | "ok" };
type Listener = (t: Toast) => void;

const listeners = new Set<Listener>();
let nextId = 1;

export function toast(msg: string, kind: Toast["kind"] = "info") {
  const t = { id: nextId++, msg, kind };
  listeners.forEach((l) => l(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => {
    const l: Listener = (t) => {
      setItems((xs) => [...xs.slice(-2), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 2800);
    };
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4"
      style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}
    >
      {items.map((t) => (
        <div
          key={t.id}
          className={`animate-rise max-w-[420px] rounded-xl border-2 border-ink px-4 py-2.5 text-[15px] font-semibold shadow-sticker ${
            t.kind === "error"
              ? "bg-cinnabar text-white"
              : t.kind === "ok"
                ? "bg-mustard text-ink"
                : "bg-card text-ink"
          }`}
        >
          {t.msg}
        </div>
      ))}
    </div>
  );
}

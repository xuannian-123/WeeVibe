"use client";

import { useEffect, useMemo, useState } from "react";
import type { JuState, JuStatus, Notice } from "@/lib/types";
import { ago } from "@/lib/client/format";
import { ApiError } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Sheet } from "../ui";

export const NOTICE_ICON: Record<Notice["kind"], string> = {
  nudge: "👋",
  depart: "🚇",
  eta: "⏱️",
  match: "👀",
  promoted: "🎟️",
  revision: "🔄",
  quorum: "🎉",
  autofill: "✍️",
  payment: "🧾",
  recap: "📸",
};

/** 站内信：JuState.me.private.inbox 为主，另外每 10 秒轮询一次 /inbox（页面隐藏时停） */
export function useInbox(state: JuState, actions: JuActions, enabled: boolean) {
  const [polled, setPolled] = useState<Notice[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await actions.inbox();
          if (!stop && Array.isArray(r)) setPolled(r);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return; // 接口还没上线
        }
      }
      if (!stop) timer = setTimeout(tick, 10000);
    };
    void tick();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, actions]);

  const base = state.me?.private?.inbox;
  const notices = useMemo(() => {
    const map = new Map<string, Notice>();
    for (const n of polled ?? []) map.set(n.id, n);
    for (const n of base ?? []) {
      const p = map.get(n.id);
      map.set(n.id, p ? { ...n, read: n.read || p.read } : n);
    }
    return [...map.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [base, polled]);

  const markRead = async () => {
    try {
      const r = await actions.inboxRead();
      if (Array.isArray(r)) setPolled(r);
    } catch {
      setPolled((xs) => (xs ?? notices).map((n) => ({ ...n, read: true })));
    }
  };

  const status = state.ju.status;
  return { notices, unread: notices.filter((n) => !n.read && !stale(n, status)).length, markRead };
}

export function InboxBell({ unread, onClick }: { unread: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={unread ? `局长的私信，${unread} 条未读` : "局长的私信"}
      className="pressable relative flex size-10 items-center justify-center rounded-full border-2 border-ink bg-card text-[18px] shadow-sticker-sm"
    >
      ✉️
      {unread > 0 && (
        <span className="font-num animate-pop-in absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-ink bg-cinnabar px-1 text-[11px] font-bold text-white">
          {unread}
        </span>
      )}
    </button>
  );
}

/** 催入局 / 催投票的私信，局定了或散了就过期，不再挂在顶上 */
function stale(n: Notice, status: JuStatus): boolean {
  return n.kind === "nudge" && (status === "confirmed" || status === "cancelled");
}

export function InboxBanner({ notices, status, onOpen }: { notices: Notice[]; status: JuStatus; onOpen: () => void }) {
  const n = notices.find((x) => !x.read && !stale(x, status));
  if (!n) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable animate-rise sticker mt-3 flex w-full items-center gap-3 bg-ink p-3 text-left text-paper"
    >
      <span className="animate-wiggle text-2xl" aria-hidden>
        {NOTICE_ICON[n.kind] ?? "✉️"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11.5px] font-bold text-mustard">局长私信你 · {ago(n.at)}</span>
        <span className="line-clamp-2 block text-[14px] leading-snug">{n.text}</span>
      </span>
      <span className="text-cream-faint">›</span>
    </button>
  );
}

export function InboxDrawer({ open, onClose, notices }: { open: boolean; onClose: () => void; notices: Notice[] }) {
  return (
    <Sheet open={open} onClose={onClose} title="局长的私信" subtitle="只发给你，别人看不到">
      {notices.length === 0 ? (
        <p className="py-10 text-center text-ink-faint">还没有私信。有事局长会第一时间告诉你。</p>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-line pb-4">
          {notices.map((n) => (
            <li key={n.id} className="flex gap-3 py-3">
              <span className="text-2xl" aria-hidden>
                {NOTICE_ICON[n.kind] ?? "✉️"}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[15px] leading-relaxed ${n.read ? "text-ink-soft" : "font-semibold"}`}>{n.text}</p>
                <p className="mt-0.5 text-[12px] text-ink-faint">{ago(n.at)}</p>
              </div>
              {!n.read && <span className="mt-2 size-2.5 shrink-0 rounded-full bg-cinnabar" aria-label="未读" />}
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

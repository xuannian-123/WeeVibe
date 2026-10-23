"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { JuState, Member } from "@/lib/types";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { OrganizerPanel } from "@/components/organizer/OrganizerPanel";
import { Button, SealLogo, Sheet, StatusBadge } from "../ui";
import { toast } from "../toast";
import { JuHeader } from "./JuHeader";
import { EntryView } from "./Entry";
import { ChatView } from "./Chat";
import { SwipeView } from "./Swipe";
import { LeaveLink, WaitingView } from "./Waiting";
import { PlansView } from "./Plans";
import { ConfirmedView } from "./Confirmed";
import { InboxBanner, InboxBell, InboxDrawer, useInbox } from "./Inbox";

export function TopBar({ status, offline, right }: { status?: string; offline?: boolean; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pb-2" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
      <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="AI 局长首页">
        <SealLogo size={34} />
        <span className="text-[17px] font-black tracking-wide">AI 局长</span>
      </Link>
      <div className="flex items-center gap-2">
        {offline && <span className="text-[12px] text-ink-faint">重连中…</span>}
        {status && <StatusBadge status={status} />}
        {right}
      </div>
    </div>
  );
}

function CancelledView({ state }: { state: JuState }) {
  const failed = state.ju.quorum?.state === "failed";
  return (
    <section className="sticker p-7 text-center">
      <div className="mb-2 text-5xl">🍂</div>
      <p className="text-[22px] font-black">{failed ? "这次没凑齐" : "这个局散了"}</p>
      <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
        {failed ? "局长悄悄把局收了。谁说了来、谁没说，永远没人知道，谁也不尴尬。" : "下次再约！"}
      </p>
      <Link href="/" className="mt-5 inline-flex min-h-11 items-center font-bold underline underline-offset-4">
        换个时间，我来发起 →
      </Link>
    </section>
  );
}

/** #5 体面的缺席 */
function DeclinedView({ me, actions }: { me: Member; actions: JuActions }) {
  const [busy, setBusy] = useState(false);
  const saidNo = me.private?.rsvp === "no";
  const lastJz = [...(me.private?.chat ?? [])].reverse().find((t) => t.role === "juzhang");
  const back = async () => {
    setBusy(true);
    try {
      await actions.setStatus("in");
      if (saidNo) await actions.chat({ rsvp: "yes" }).catch(() => {});
      await actions.refresh();
      toast("欢迎回来 🎉", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4 pb-10">
      {saidNo && lastJz && (
        <div className="flex items-end gap-2">
          <SealLogo size={30} />
          <p className="bubble-jz max-w-[80%] px-3.5 py-2.5 text-[15.5px] leading-relaxed">{lastJz.text}</p>
        </div>
      )}
      <section className="sticker p-6 text-center">
        <div className="animate-float mb-2 text-5xl">🤫</div>
        <h2 className="text-[22px] font-black">{saidNo ? "收到，这事只有我知道" : "你已经悄悄退出了"}</h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
          群里不会出现你的名字，也看不出你是没空、不想去，还是没回。
        </p>
        <p className="mt-1 text-[14.5px] leading-relaxed text-ink-soft">下次有局，局长再悄悄问你。</p>
        <Button variant="secondary" className="mt-5" loading={busy} onClick={back}>
          改主意了，我能去
        </Button>
      </section>
    </div>
  );
}

type View = "cancelled" | "entry" | "declined" | "chat" | "swipe" | "waiting" | "plans" | "confirmed";

export function JuView({
  state,
  actions,
  adminToken,
  tierToken = null,
  offline,
}: {
  state: JuState;
  actions: JuActions;
  adminToken: string | null;
  tierToken?: string | null;
  offline?: boolean;
}) {
  const { ju } = state;
  const me = state.me ?? null;
  const isAdmin = !!adminToken && state.isAdmin !== false;
  const [forceSwipe, setForceSwipe] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const inbox = useInbox(state, actions, !!me);

  let view: View;
  if (ju.status === "cancelled") view = "cancelled";
  else if (!me) view = ju.status === "confirmed" ? "confirmed" : "entry";
  else if (me.status === "out") view = "declined";
  else if (ju.status !== "confirmed" && me.intake === "chatting" && !forceSwipe) view = "chat";
  else if (ju.status !== "confirmed" && me.intake !== "done") view = "swipe";
  else if (ju.status === "collecting") view = "waiting";
  else if (ju.status === "voting") view = "plans";
  else view = "confirmed";

  const immersive = view === "chat" || view === "swipe";

  let body: ReactNode;
  switch (view) {
    case "cancelled":
      body = <CancelledView state={state} />;
      break;
    case "entry":
      body = <EntryView state={state} actions={actions} isAdmin={isAdmin} tierToken={tierToken} />;
      break;
    case "declined":
      body = <DeclinedView me={me!} actions={actions} />;
      break;
    case "chat":
      body = <ChatView state={state} me={me!} actions={actions} onSwipe={() => setForceSwipe(true)} />;
      break;
    case "swipe":
      body = <SwipeView state={state} me={me!} actions={actions} />;
      break;
    case "waiting":
      body = <WaitingView state={state} me={me!} actions={actions} />;
      break;
    case "plans":
      body = <PlansView state={state} me={me} actions={actions} />;
      break;
    case "confirmed":
      body = <ConfirmedView state={state} me={me} actions={actions} />;
      break;
  }

  const panel = isAdmin && adminToken ? <OrganizerPanel state={state} adminToken={adminToken} onState={actions.apply} /> : null;

  return (
    <main className="mx-auto w-full max-w-[480px] overflow-x-clip px-4">
      <TopBar
        status={immersive ? undefined : ju.status}
        offline={offline}
        right={
          <>
            {panel && immersive && (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="pressable min-h-10 rounded-full border-2 border-ink bg-mustard px-3 text-[13px] font-black shadow-sticker-sm"
              >
                👑 控制台
              </button>
            )}
            {me && <InboxBell unread={inbox.unread} onClick={() => setInboxOpen(true)} />}
          </>
        }
      />
      <JuHeader state={state} compact={immersive} />
      {me && !immersive && <InboxBanner notices={inbox.notices} onOpen={() => setInboxOpen(true)} />}

      <div className="mt-4">{body}</div>

      {panel && !immersive && (
        <div className="mb-10 mt-2">
          <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-bold text-ink-faint">
            <span className="h-0.5 flex-1 bg-line" />
            发起人才看得到
            <span className="h-0.5 flex-1 bg-line" />
          </div>
          {panel}
        </div>
      )}
      {me && me.status === "in" && (view === "waiting" || view === "plans") && (
        <LeaveLink actions={actions} planned={ju.status !== "collecting"} />
      )}
      {view === "plans" && <div className="h-28" aria-hidden />}

      <InboxDrawer
        open={inboxOpen}
        onClose={() => {
          setInboxOpen(false);
          if (inbox.unread) void inbox.markRead();
        }}
        notices={inbox.notices}
      />
      {panel && (
        <Sheet open={panelOpen && immersive} onClose={() => setPanelOpen(false)} title="👑 发起人控制台">
          <div className="pb-4">{panel}</div>
        </Sheet>
      )}
    </main>
  );
}

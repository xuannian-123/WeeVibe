"use client";

import Link from "next/link";
import { useState } from "react";
import type { JuState } from "@/lib/types";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Button, SealLogo, Sheet, StatusBadge } from "../ui";
import { toast } from "../toast";
import { JuHeader } from "./JuHeader";
import { JoinForm } from "./JoinForm";
import { WaitingPanel } from "./WaitingPanel";
import { VotingPanel } from "./VotingPanel";
import { ConfirmedPanel } from "./ConfirmedPanel";

export function TopBar({ status, offline }: { status?: string; offline?: boolean }) {
  return (
    <div className="flex items-center justify-between pb-2" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
      <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="AI 局长首页">
        <SealLogo size={34} />
        <span className="text-[17px] font-black tracking-wide">AI 局长</span>
      </Link>
      <div className="flex items-center gap-2">
        {offline && <span className="text-[12px] text-ink-faint">网络重连中…</span>}
        {status && <StatusBadge status={status} />}
      </div>
    </div>
  );
}

function LeaveLink({ actions, planned }: { actions: JuActions; planned: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="flex justify-center pb-6">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          我去不了了…
        </Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="真的不去了？🥲">
        <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">
          局长会很难过的。{planned ? "退出后方案会按剩下的人重新算。" : "你的时间和出发地不会再参与计算。"}
        </p>
        <div className="mb-2 grid grid-cols-2 gap-3">
          <Button variant="gold" onClick={() => setOpen(false)}>
            算了，我去
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await actions.leave();
                setOpen(false);
                toast("已退出，下次一定 👋");
              } catch (e) {
                toast(errMsg(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            确定不去
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function JuView({
  state,
  memberId,
  isAdmin,
  actions,
  offline,
}: {
  state: JuState;
  memberId: string | null;
  isAdmin: boolean;
  actions: JuActions;
  offline?: boolean;
}) {
  const { ju } = state;
  const me = state.members.find((m) => m.id === memberId) ?? null;
  const joined = !!me;
  const isOut = me?.status === "out";

  let body: React.ReactNode;
  if (ju.status === "cancelled") {
    body = (
      <div className="sticker p-8 text-center">
        <div className="mb-2 text-5xl">🍂</div>
        <p className="text-xl font-black">这个局散了</p>
        <p className="mt-1 text-ink-soft">下次再约！</p>
      </div>
    );
  } else if (ju.status === "confirmed") {
    body = <ConfirmedPanel state={state} actions={actions} />;
  } else if (!joined) {
    body = (
      <>
        {ju.status === "voting" && (
          <div className="mb-5 opacity-90">
            <VotingPanel state={state} me={null} isAdmin={isAdmin} actions={actions} />
            <p className="-mt-3 text-center text-[14px] font-semibold text-ink-soft">👇 方案已经出了，入局后就能投票</p>
          </div>
        )}
        <JoinForm ju={ju} isAdmin={isAdmin} onSubmit={actions.join} />
      </>
    );
  } else if (ju.status === "voting") {
    body = <VotingPanel state={state} me={me} isAdmin={isAdmin} actions={actions} />;
  } else {
    body = <WaitingPanel state={state} me={me} isAdmin={isAdmin} actions={actions} />;
  }

  return (
    <main className="mx-auto w-full max-w-[480px] overflow-x-clip px-4">
      <TopBar status={ju.status} offline={offline} />
      <JuHeader state={state} />
      {isOut && ju.status !== "confirmed" && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border-2 border-ink bg-paper-deep px-4 py-2">
          <span className="flex-1 text-[14px] font-semibold">你已经退出了这个局</span>
          <Button
            size="sm"
            variant="gold"
            onClick={() => actions.rejoin().catch((e) => toast(errMsg(e), "error"))}
          >
            我又能去了
          </Button>
        </div>
      )}
      <div className="mt-5">{body}</div>
      {joined && !isOut && ju.status !== "cancelled" && (
        <LeaveLink actions={actions} planned={ju.status !== "collecting"} />
      )}
      {joined && isAdmin && ju.status === "collecting" && <div className="h-24" aria-hidden />}
    </main>
  );
}

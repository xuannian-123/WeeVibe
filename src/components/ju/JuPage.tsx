"use client";

import { useJu, type JuHook } from "@/lib/client/useJu";
import { useMockJu } from "@/lib/client/mockJu";
import { JuView } from "./JuView";
import { ErrorJu, LoadingJu } from "./PageStates";

function Render({ hook }: { hook: JuHook }) {
  const { state, loadError, offline, adminToken, tierToken, ready, actions } = hook;
  if (!state || !ready) {
    if (loadError) return <ErrorJu msg={loadError.msg} status={loadError.status} onRetry={actions.refresh} />;
    return <LoadingJu />;
  }
  return <JuView state={state} actions={actions} adminToken={adminToken} tierToken={tierToken} offline={offline} />;
}

function Live({ id }: { id: string }) {
  return <Render hook={useJu(id)} />;
}

function Mock({ id, fixture }: { id: string; fixture: string }) {
  return (
    <>
      <Render hook={useMockJu(id, fixture)} />
      <div className="pointer-events-none fixed left-2 top-2 z-[90] rounded bg-ink/80 px-1.5 text-[10px] font-bold text-mustard">
        MOCK · {fixture}
      </div>
    </>
  );
}

/** 局页入口。mock 只在开发环境由 page.tsx 传进来 */
export function JuPage({ id, mock }: { id: string; mock?: string }) {
  return mock ? <Mock key={mock} id={id} fixture={mock} /> : <Live id={id} />;
}

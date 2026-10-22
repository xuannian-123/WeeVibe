"use client";

import { useParams } from "next/navigation";
import { useJu } from "@/lib/client/useJu";
import { JuView } from "@/components/ju/JuView";
import { ErrorJu, LoadingJu } from "@/components/ju/PageStates";

export default function JuPage() {
  const { id } = useParams<{ id: string }>();
  const { state, loadError, offline, memberId, adminToken, ready, actions } = useJu(id);

  if (!state || !ready) {
    if (loadError) return <ErrorJu msg={loadError.msg} status={loadError.status} onRetry={actions.refresh} />;
    return <LoadingJu />;
  }
  return <JuView state={state} memberId={memberId} isAdmin={!!adminToken} actions={actions} offline={offline} />;
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useJu } from "@/lib/client/useJu";
import { BigScreen } from "@/components/screen/BigScreen";
import { Stage } from "@/components/screen/bits";
import { ErrorJu, LoadingJu } from "@/components/ju/PageStates";

export default function ScreenPage() {
  const { id } = useParams<{ id: string }>();
  const { state, loadError, offline, adminToken, actions } = useJu(id);
  const [joinUrl, setJoinUrl] = useState("");

  useEffect(() => {
    // 路演时 localhost 手机扫不到：支持 ?origin=http://192.168.x.x:3000 覆盖二维码域名
    const q = new URLSearchParams(window.location.search).get("origin");
    const origin = (q || window.location.origin).replace(/\/$/, "");
    setJoinUrl(`${origin}/j/${id}`);
  }, [id]);

  if (!state) {
    if (loadError) return <ErrorJu msg={loadError.msg} status={loadError.status} onRetry={actions.refresh} />;
    return <LoadingJu dark />;
  }
  return (
    <Stage>
      <BigScreen state={state} isAdmin={!!adminToken} actions={actions} joinUrl={joinUrl} />
      {offline && <div className="absolute left-12 top-3 text-[15px] text-cream-faint">网络重连中…</div>}
    </Stage>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { store } from "@/lib/client/storage";
import { BigScreen, type ScreenAdmin } from "@/components/screen/BigScreen";
import { Stage } from "@/components/screen/bits";
import { usePublicJu } from "@/components/screen/usePublicJu";
import { useSelfTest } from "@/components/screen/PlanPanels";
import { TIER_PARAM, organizerApi, tierUrl } from "@/components/organizer/api";
import { SealLogo } from "@/components/ui";

function Center({ children }: { children: React.ReactNode }) {
  return <div className="fixed inset-0 flex flex-col items-center justify-center gap-5 bg-night text-cream">{children}</div>;
}

export default function ScreenPage() {
  const { id } = useParams<{ id: string }>();
  const { state, loadError, offline, refresh } = usePublicJu(id);
  const { test } = useSelfTest();
  const [origin, setOrigin] = useState("");
  const [tier, setTier] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const joinUrl = origin ? tierUrl(origin, id, tier ?? undefined) : "";

  useEffect(() => {
    // 路演时 localhost 手机扫不到：支持 ?origin=http://192.168.x.x:3003 覆盖二维码域名
    const sp = new URLSearchParams(window.location.search);
    let o = window.location.origin;
    const q = sp.get("origin");
    if (q) {
      try {
        const u = new URL(q);
        if (u.protocol === "http:" || u.protocol === "https:") o = u.origin;
      } catch {
        /* 非法参数忽略 */
      }
    }
    setOrigin(o);
    setTier(sp.get(TIER_PARAM));
    const at = store.getAdmin(id);
    setAdminToken(at);
    // 发起人本机：二维码带上核心圈的邀请 token（不带的话名额满后扫码的人会进候补）。
    // 只取这一个 token，发起人视图的其余内容一律不上大屏。
    if (at && !sp.get(TIER_PARAM)) {
      organizerApi
        .getJu(id, at)
        .then((s) => {
          const t = s.ju.admin?.tiers.slice().sort((a, b) => a.tier - b.tier)[0]?.token;
          if (t) setTier(t);
        })
        .catch(() => {});
    }
  }, [id]);

  // 发起人本机打开大屏时才有隐藏按钮；动作返回的发起人视图一律丢弃，只刷新公开视图
  const admin = useMemo<ScreenAdmin | undefined>(() => {
    if (!adminToken) return undefined;
    return {
      seed: async () => {
        await organizerApi.devSeed(id, adminToken);
        await refresh();
      },
      plan: async () => {
        await organizerApi.plan(id, adminToken);
        await refresh();
      },
      confirm: async (pid) => {
        await organizerApi.confirm(id, adminToken, pid);
        await refresh();
      },
      seedClub: async () => {
        await organizerApi.devSeed(id, adminToken, undefined, "club");
        await refresh();
      },
      seat: async () => {
        await organizerApi.seating(id, adminToken, { rounds: 3 });
        await refresh();
      },
      nextRound: async () => {
        await organizerApi.nextRound(id, adminToken);
        await refresh();
      },
    };
  }, [adminToken, id, refresh]);

  if (!state) {
    return (
      <Center>
        <SealLogo size={72} dark />
        {loadError ? (
          <>
            <p className="text-[28px] font-black">{loadError.msg}</p>
            <button onClick={refresh} className="rounded-full border-2 border-night-line px-6 py-2 text-[18px] font-bold text-cream-faint">
              再试一次
            </button>
          </>
        ) : (
          <p className="animate-pulse text-[22px] font-bold text-cream-faint">局长正在上台…</p>
        )}
      </Center>
    );
  }

  return (
    <Stage>
      <BigScreen state={state} joinUrl={joinUrl} admin={admin} selfTest={test} />
      {offline && <div className="absolute left-12 top-3 text-[15px] text-cream-faint">网络重连中…</div>}
    </Stage>
  );
}

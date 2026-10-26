"use client";

// v5 协商：局长私下问你一件事（是 / 否）。只有本人看得到，谁被问了、答了什么，群里都看不出来。
import { useState } from "react";
import type { Member } from "@/lib/types";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Button, LockNote } from "../ui";
import { toast } from "../toast";

export function AskCard({ me, actions }: { me: Member; actions: JuActions }) {
  const ask = (me.private?.asks ?? []).find((a) => a.status === "pending");
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  if (!ask) return null;
  const answer = async (yes: boolean) => {
    setBusy(yes ? "yes" : "no");
    try {
      await actions.answerAsk(ask.id, yes);
      toast(yes ? "谢谢你！局长这就重新排一遍 🙏" : "没问题，局长再想别的办法", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="sticker animate-pop-in mt-4 border-cinnabar bg-cinnabar-soft p-4" data-tour="ask">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[22px]" aria-hidden>
          🙋
        </span>
        <h3 className="flex-1 text-[17px] font-black">局长私下问你一件事</h3>
        <LockNote>只有你看得到</LockNote>
      </div>
      <p className="text-[15px] leading-relaxed">{ask.text}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-soft">说不行完全没关系，局长会想别的办法。谁被问了、怎么答的，群里看不出来。</p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button variant="secondary" loading={busy === "no"} disabled={!!busy} onClick={() => answer(false)}>
          这次不行
        </Button>
        <Button loading={busy === "yes"} disabled={!!busy} onClick={() => answer(true)}>
          可以
        </Button>
      </div>
    </section>
  );
}

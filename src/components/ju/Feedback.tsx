"use client";

// v6 局后一键反馈（docs/AVATAR.md 5.3）：第二天在局页面出现"昨晚怎么样？"，点一下写进本人档案。
// 要不要出现由服务端判断（GET /feedback：局结束后的第二天、一周内、还没反馈过），同时会发一条站内信。
import { useEffect, useState } from "react";
import type { FeedbackVerdict } from "@/lib/types";
import { api, errMsg, type FeedbackStatus } from "@/lib/client/api";
import { LockNote, SealLogo } from "../ui";
import { toast } from "../toast";

const OPTIONS: [FeedbackVerdict, string, string][] = [
  ["great", "😄", "很棒"],
  ["tired", "😮‍💨", "太累"],
  ["pricey", "💸", "太贵"],
  ["far", "🚇", "太远"],
  ["loud", "🔊", "太吵"],
];

export function FeedbackCard({ juId }: { juId: string }) {
  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [busy, setBusy] = useState<FeedbackVerdict | null>(null);
  const [reply, setReply] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    api
      .feedbackStatus(juId)
      .then((s) => !stop && setStatus(s))
      .catch(() => {}); // 接口没上线 / 没有身份：不显示
    return () => {
      stop = true;
    };
  }, [juId]);

  const send = async (v: FeedbackVerdict) => {
    if (busy) return;
    setBusy(v);
    try {
      const r = await api.feedback(juId, v);
      setReply(r.reply);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };

  if (reply)
    return (
      <div className="animate-rise mt-4 flex items-end gap-2">
        <SealLogo size={28} />
        <p className="bubble-jz max-w-[84%] px-3.5 py-2.5 text-[14.5px] leading-relaxed">{reply}</p>
      </div>
    );
  if (!status?.due) return null;
  return (
    <section className="sticker animate-rise mt-4 p-4" aria-label="局后反馈">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[18px] font-black">昨晚怎么样？</h2>
        <LockNote>只有你的分身知道</LockNote>
      </div>
      <p className="mt-1 text-[13px] text-ink-soft">点一下就好，下次分身替你安排得更合心意。</p>
      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {OPTIONS.map(([v, emoji, label]) => (
          <button
            key={v}
            type="button"
            disabled={!!busy}
            onClick={() => void send(v)}
            className={`pressable flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 border-ink text-[13px] font-black disabled:opacity-50 ${busy === v ? "bg-mustard" : "bg-card"}`}
          >
            <span className="text-[22px] leading-none" aria-hidden>{emoji}</span>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

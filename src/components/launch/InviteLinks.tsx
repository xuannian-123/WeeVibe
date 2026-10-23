"use client";

import { useEffect, useState } from "react";
import { copyText } from "@/components/ui";
import { toast } from "@/components/toast";
import { QrSvg } from "@/components/screen/bits";
import { tierUrl, type TierLink } from "@/components/organizer/api";

/** 发到群里的那段话。注意：第二圈的人拿到的话里也不出现"第二圈" */
export function inviteMessage(o: { title: string; organizerName?: string; url: string; quorumMin?: number; deadline?: string }) {
  const who = o.organizerName ? `${o.organizerName}在组局` : "在组局";
  const lines = [
    `【${o.title}】${who}，点开跟 AI 局长私聊 10 秒就行：`,
    o.url,
    "预算、几点得回、来不来，都可以只跟局长说，群里看不到。",
  ];
  if (o.quorumMin) lines.push(`凑够 ${o.quorumMin} 人才成局，凑不够就悄悄作废，没人知道谁没来。`);
  return lines.join("\n");
}

export function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

/** 每一圈一个链接 + 二维码 + 一键复制群消息 */
export function InviteLinks({
  id,
  title,
  organizerName,
  links,
  quorumMin,
  compact,
}: {
  id: string;
  title: string;
  organizerName?: string;
  links: (TierLink & { openedAt?: string; locked?: boolean })[];
  quorumMin?: number;
  compact?: boolean;
}) {
  const origin = useOrigin();
  const [qrOpen, setQrOpen] = useState<number | null>(compact ? null : (links[0]?.tier ?? null));
  const many = links.length > 1;

  return (
    <ul className="space-y-3">
      {links.map((l, i) => {
        const url = origin ? tierUrl(origin, id, l.token) : "";
        const msg = inviteMessage({ title, organizerName, url, quorumMin });
        return (
          <li key={l.token} className={`rounded-xl border-2 border-ink bg-card p-3 ${l.locked ? "opacity-70" : ""}`}>
            <div className="flex items-center gap-2">
              <span
                className={`font-num flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
                  i === 0 ? "bg-cinnabar text-white" : "border-2 border-ink bg-paper"
                }`}
              >
                {l.tier}
              </span>
              <b className="text-[16px]">{many ? l.label : "邀请链接"}</b>
              {many && (
                <span className="text-[12px] text-ink-faint">
                  {l.locked ? "还没开放 · 前一圈有空位才放出来" : i === 0 ? "先发这一圈" : "已开放"}
                </span>
              )}
              <button
                type="button"
                className="ml-auto min-h-9 rounded-full border-2 border-ink px-2.5 text-[12px] font-bold"
                onClick={() => setQrOpen((q) => (q === l.tier ? null : l.tier))}
                aria-expanded={qrOpen === l.tier}
              >
                {qrOpen === l.tier ? "收起码" : "二维码"}
              </button>
            </div>
            <div className="font-num mt-2 truncate rounded-lg bg-paper-deep px-2.5 py-1.5 text-[12px] text-ink-soft">{url || "…"}</div>
            {qrOpen === l.tier && url && (
              <div className="animate-rise mx-auto mt-3 w-44 rounded-xl border-2 border-ink bg-white p-3">
                <QrSvg text={url} className="aspect-square w-full" />
              </div>
            )}
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className="pressable min-h-11 rounded-[var(--radius-btn)] border-2 border-ink bg-mustard text-[14px] font-bold shadow-sticker-sm"
                onClick={async () => toast((await copyText(msg)) ? "群消息已复制，去群里粘贴吧" : "复制失败，长按链接手动复制", "ok")}
              >
                复制群消息
              </button>
              <button
                type="button"
                className="pressable min-h-11 rounded-[var(--radius-btn)] border-2 border-ink bg-card text-[14px] font-bold shadow-sticker-sm"
                onClick={async () => toast((await copyText(url)) ? "链接已复制" : "复制失败", "ok")}
              >
                只复制链接
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

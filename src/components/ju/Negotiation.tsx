"use client";

// v6 本人视图「谈判过程」：手机上看同一份公开谈判记录（紧凑版）。
// 和你有关的结论只用本人自己的 avatarLog 解释 —— 公开记录里哪个代号是你，界面不推断、也不标出来。
import { useState } from "react";
import type { JuState, Member } from "@/lib/types";
import { LockNote } from "../ui";
import { focusProposal } from "../screen/fmt";
import { AVATAR_KIND, JUZHANG, KIND_STYLE, ROUNDS, avatarSentence, groupByRound, negotiationStats, speakerTone } from "../screen/negotiation";
import { useAvatarName } from "./AvatarLog";

function SpeakerDot({ speaker }: { speaker: string }) {
  const tone = speakerTone(speaker);
  if (speaker === JUZHANG) {
    return (
      <span className="flex size-6 shrink-0 rotate-[-5deg] items-center justify-center rounded-[5px] border-2 border-ink bg-cinnabar text-[11px] font-black text-white" aria-label="局长">
        局
      </span>
    );
  }
  return (
    <span className="font-num flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[12px] font-black text-ink" style={{ background: tone.bg }} aria-label={speaker}>
      {tone.letter}
    </span>
  );
}

/** showMine：页面上已经有「我的分身」卡片时传 false，不再重复"和你有关的结论" */
export function NegotiationCard({ state, me, defaultOpen = false, showMine = true }: { state: JuState; me: Member | null; defaultOpen?: boolean; showMine?: boolean }) {
  const neg = state.ju.plan?.negotiation;
  const [open, setOpen] = useState(defaultOpen);
  const name = useAvatarName(me);
  if (!neg?.events.length) return null;
  const s = negotiationStats(neg, focusProposal(state.ju));
  const groups = groupByRound(neg.events);
  const mine = showMine ? (me?.private?.avatarLog ?? []).filter((e) => e.kind !== "ask").slice(0, 4) : [];
  const chips: [string, number, string][] = [
    ["自动让步", s.autoConcessions, KIND_STYLE.concede.soft],
    ["交换", s.trades, KIND_STYLE.trade.soft],
    ["补偿", s.compensations, KIND_STYLE.compensate.soft],
    [s.asked ? "私下问了" : "打扰本人", s.asked, "var(--color-paper-deep)"],
  ];

  return (
    <section className="sticker overflow-hidden" data-tour="negotiation">
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2">
          <h3 className="flex-1 text-lg font-black">🤝 分身们是怎么谈的</h3>
          {s.cared !== undefined && s.total > 0 && (
            <span className="font-num shrink-0 rounded-full border-2 border-ink bg-jade px-2.5 py-0.5 text-[13px] font-black text-white">
              照顾到 {s.cared}/{s.total}
            </span>
          )}
        </div>
        <p className="text-[14px] leading-relaxed text-ink-soft">{neg.outcome}</p>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {chips.map(([l, n, bg]) => (
            <div key={l} className="min-w-0 rounded-lg border-2 border-ink px-1 py-1.5 text-center" style={{ background: bg }}>
              <div className="font-num text-[18px] font-bold leading-none">{n}</div>
              <div className="mt-0.5 truncate text-[11px] font-bold text-ink-soft">{l}</div>
            </div>
          ))}
        </div>

        {mine.length > 0 && (
          <div className="mt-3 rounded-xl border-2 border-ink bg-mustard-soft p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex-1 text-[13.5px] font-black">和你有关的结论</span>
              <LockNote>只有你看得到</LockNote>
            </div>
            <ul className="space-y-1">
              {mine.map((e) => (
                <li key={e.id} className={`flex gap-2 text-[13.5px] leading-snug ${e.revoked ? "text-ink-faint line-through" : ""}`}>
                  <span aria-hidden>{AVATAR_KIND[e.kind].icon}</span>
                  <span className="min-w-0 flex-1 break-words">{avatarSentence(e, name)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[11.5px] text-ink-faint">只用你自己的分身记录解释；下面的公开记录里谁是谁，局长不会说。</p>
          </div>
        )}
      </div>

      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((x) => !x)}
        className="flex min-h-12 w-full items-center gap-2 border-t-2 border-dashed border-line px-4 text-left text-[14px] font-bold text-ink-soft"
      >
        <span className="flex-1">{open ? "收起谈判记录" : `看完整谈判记录（${groups.length} 轮 · ${neg.events.length} 句）`}</span>
        <span aria-hidden className="transition-transform duration-300" style={{ transform: open ? "rotate(180deg)" : undefined }}>
          ▾
        </span>
      </button>

      {open && (
        <ol className="space-y-4 px-4 pb-4 pt-1">
          {groups.map((g, gi) => (
            <li key={`${g.round}-${gi}`} className="animate-rise" style={{ animationDelay: `${gi * 70}ms` }}>
              <div className="mb-2 flex items-center gap-2">
                <span className="font-num flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-paper">{g.round + 1}</span>
                <span className="text-[14px] font-black">{g.label}</span>
                <span className="h-0.5 flex-1 bg-line" />
                <span className="font-num text-[11.5px] text-ink-faint">
                  {g.round + 1}/{ROUNDS.length}
                </span>
              </div>
              <ul className="relative space-y-2 pl-3">
                <span aria-hidden className="absolute bottom-1 left-[2px] top-1 w-0.5 bg-line" />
                {g.events.map((e) => {
                  const ks = KIND_STYLE[e.kind];
                  return (
                    <li key={e.index} className="relative flex items-start gap-2">
                      <SpeakerDot speaker={e.speaker} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[12.5px] font-black">{e.speaker}</span>
                          <span className="rounded-full border border-ink/20 px-1.5 text-[11px] font-bold" style={{ background: ks.soft }}>
                            {ks.icon} {ks.label}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[13.5px] leading-snug break-words">{e.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          <li className="text-[11.5px] leading-relaxed text-ink-faint">🔒 这份记录和大屏上的一模一样：只有代号和聚合数，任何人看了都推不出谁有什么底线。</li>
        </ol>
      )}
    </section>
  );
}

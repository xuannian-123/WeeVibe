"use client";

// v6 手机上的分身谈判直播（竖屏全屏）。和大屏用同一份播放时间表（screen/negotiation.ts 的 buildSchedule / playhead）：
// 播放状态只是"从谈判开始过了多久"的函数，所以以 plan.computedAt 为起点，大家同时打开看到的是同一句话；
// 打开时谈判还在播 = 从当前进度接着看（LIVE），已经播完 = 从头重播。
// 只读公开的 Plan.negotiation：座位上只有代号，不显示真名 / 分身名；"你的分身替你做了什么"只来自本人的 avatarLog。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JuState, Member, NegotiationEvent } from "@/lib/types";
import { SealLogo } from "../ui";
import { focusProposal } from "../screen/fmt";
import { useReducedMotion } from "../screen/NegotiationLive";
import { JUZHANG, KIND_STYLE, ROUNDS, avatarSentence, buildSchedule, negotiationStats, playhead, roundLabel, seatCodes, seatStates, speakerTone } from "../screen/negotiation";

const CSS = `
@keyframes ln-bubble { 0% { transform: translateY(12px) scale(.97); opacity: 0 } 62% { transform: translateY(-2px); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes ln-card { 0% { transform: translateY(24px) scale(.94); opacity: 0 } 60% { transform: translateY(-4px) scale(1.01); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes ln-ripple { 0% { transform: scale(.8); opacity: .85 } 100% { transform: scale(1.8); opacity: 0 } }
`;

/** 谈判桌：代号围成一圈，局长在中间；说话的人亮起来、其他人变暗，卡在底线上的标红、让过步的挂标 */
function MiniTable({ codes, events, step, phase, reduced }: { codes: string[]; events: NegotiationEvent[]; step: number; phase: string; reduced: boolean }) {
  const size = 236;
  const r = 92;
  const cur = step >= 0 ? events[step] : undefined;
  const speaking = cur && phase !== "intro" && phase !== "banner" && phase !== "done" ? cur.speaker : undefined;
  const states = seatStates(events, phase === "anticipate" ? step - 1 : step);
  const done = phase === "done";
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-[34px] rounded-full border border-night-line bg-night-3/60" />
      <div className={`absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-opacity ${speaking && speaking !== JUZHANG ? "opacity-50" : ""}`}>
        <SealLogo size={speaking === JUZHANG ? 54 : 46} dark />
        <span className="mt-0.5 text-[10px] font-bold text-cream-faint">局长 · 主持</span>
      </div>
      {codes.map((code, i) => {
        const a = -Math.PI / 2 + (Math.PI * 2 * (i + 0.5)) / Math.max(1, codes.length);
        const x = size / 2 + r * Math.cos(a);
        const y = size / 2 + r * Math.sin(a);
        const tone = speakerTone(code);
        const st = states[code];
        const on = speaking === code;
        const dim = !!speaking && !on;
        const ring = done ? "#3ecf8e" : st?.blocked ? "#ff6b5b" : tone.fg;
        return (
          <div
            key={code}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center transition-all duration-300"
            style={{ left: x, top: y, opacity: dim ? 0.35 : 1, transform: `translate(-50%, -50%) scale(${on ? 1.18 : 1})` }}
          >
            {on && !reduced && <span className="absolute size-11 rounded-full border-2" style={{ borderColor: tone.fg, animation: "ln-ripple 1.1s ease-out infinite" }} />}
            <span className="font-num relative flex size-11 items-center justify-center rounded-full border-[3px] bg-night-2 text-[18px] font-black" style={{ borderColor: ring, color: tone.fg }}>
              {tone.letter}
              {st?.marks.length ? (
                <span className="absolute -right-1.5 -top-1.5 text-[13px]">{KIND_STYLE[st.marks.at(-1)!].icon}</span>
              ) : st?.blocked && !done ? (
                <span className="absolute -right-1.5 -top-1.5 text-[13px]">⛔</span>
              ) : done ? (
                <span className="absolute -right-1.5 -top-1.5 text-[12px]">✅</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Bubbles({ events, step, phase, typed, reduced }: { events: NegotiationEvent[]; step: number; phase: string; typed: number; reduced: boolean }) {
  const upto = phase === "anticipate" ? step - 1 : step;
  const tail = events.slice(0, upto + 1).map((e, i) => ({ e, i })).slice(-4);
  if (!tail.length) return <p className="py-6 text-center text-[15px] font-bold text-cream-faint">🪑 分身们正在入座…</p>;
  return (
    <ol className="flex flex-col justify-end gap-2.5" aria-live="polite">
      {tail.map(({ e, i }, k) => {
        const isCur = i === step && phase === "typing";
        const tone = speakerTone(e.speaker);
        const ks = KIND_STYLE[e.kind];
        const jz = e.speaker === JUZHANG;
        const last = k === tail.length - 1;
        return (
          <li key={i} className={`flex items-start gap-2 ${last ? "" : "opacity-60"}`} style={{ animation: reduced ? undefined : "ln-bubble 360ms cubic-bezier(.2,.8,.2,1) both" }}>
            {jz ? (
              <span className="mt-0.5 shrink-0"><SealLogo size={30} dark /></span>
            ) : (
              <span className="font-num mt-0.5 flex size-[30px] shrink-0 items-center justify-center rounded-full border-2 bg-night-2 text-[14px] font-black" style={{ borderColor: tone.fg, color: tone.fg }}>
                {tone.letter}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex items-center gap-1.5">
                <span className="text-[12.5px] font-black" style={{ color: jz ? "#ff8a78" : tone.fg }}>{e.speaker}</span>
                <span className="rounded-full px-1.5 text-[11px] font-black" style={{ background: `${ks.color}26`, color: ks.color }}>{ks.icon} {ks.label}</span>
              </div>
              <p className="rounded-2xl rounded-tl-sm border-2 bg-night-3 px-3 py-2 text-[15px] font-semibold leading-snug text-cream" style={{ borderColor: last ? `${ks.color}99` : "transparent" }}>
                {isCur ? e.text.slice(0, typed) : e.text}
                {isCur && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse" style={{ background: ks.color }} />}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Result({ state, me, reduced }: { state: JuState; me: Member | null; reduced: boolean }) {
  const neg = state.ju.plan!.negotiation!;
  const s = negotiationStats(neg, focusProposal(state.ju));
  const decide = neg.events.filter((e) => e.kind === "decide").find((e) => /拍板/.test(e.text));
  const mine = (me?.private?.avatarLog ?? []).filter((e) => e.kind === "concede" || e.kind === "held" || e.kind === "compensated").slice(0, 3);
  const chips = ([[s.autoConcessions, "次自动让步", KIND_STYLE.concede.color], [s.trades, "次交换", KIND_STYLE.trade.color], [s.compensations, "次补偿", KIND_STYLE.compensate.color]] as [number, string, string][])
    .filter(([n]) => n > 0)
    .concat([[s.asked, s.asked ? "人被私下问" : "人被打扰", "#f3e7d3"]]);
  return (
    <div className="rounded-3xl border-2 border-[#3ecf8e] bg-night p-4" style={{ animation: reduced ? undefined : "ln-card 640ms cubic-bezier(.2,.8,.2,1) both" }} role="status">
      <div className="flex items-end gap-2">
        <span className="font-num text-[64px] font-black leading-[.85] text-[#3ecf8e]">
          {s.cared ?? "—"}
          <span className="text-[30px] text-cream-faint">/{s.total || "—"}</span>
        </span>
        <span className="pb-1 text-[17px] font-black text-cream">{s.cared !== undefined && s.cared >= s.total ? "个人都照顾到了" : "人照顾到了"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {chips.map(([n, l, c]) => (
          <span key={l} className="rounded-full border px-2.5 py-0.5 text-[13px] font-bold" style={{ borderColor: `${c}88`, color: c }}>
            <b className="font-num">{n}</b> {l}
          </span>
        ))}
      </div>
      {decide && <p className="mt-3 border-l-4 border-cinnabar pl-2.5 text-[15.5px] font-black leading-snug text-cream">⚖️ {decide.text}</p>}
      {mine.length > 0 && (
        <div className="mt-3 rounded-2xl bg-night-3 p-3">
          <p className="mb-1 text-[12px] font-bold text-mustard">🔒 只有你看得到 · 你的分身</p>
          <ul className="space-y-1 text-[13.5px] leading-snug text-cream">
            {mine.map((e) => (
              <li key={e.id}>{avatarSentence(e)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 全屏直播。live：按 plan.computedAt 同步（谈判还在播就从当前进度接着看，播完了就从头播） */
export function LiveNegotiation({ state, me, onClose, live = true }: { state: JuState; me: Member | null; onClose: () => void; live?: boolean }) {
  const neg = state.ju.plan?.negotiation;
  const events = useMemo(() => neg?.events ?? [], [neg]);
  const reduced = useReducedMotion();
  const schedule = useMemo(() => buildSchedule(events, { reduced }), [events, reduced]);
  const computedAt = state.ju.plan?.computedAt;
  const talking = neg?.status === "live";
  // 正在谈：从最近两句接着看（新的话一到就接着播）；谈完了：按开谈时刻同步，过了直播时长就从头回放
  const [t, setT] = useState(() => {
    if (talking) return schedule.beats.length > 2 ? schedule.beats[schedule.beats.length - 2].anticipate[0] : 0;
    const elapsed = live && computedAt ? Date.now() - Date.parse(computedAt) : 0;
    return elapsed > 0 && elapsed < schedule.total ? elapsed : 0;
  });
  const [synced] = useState(() => talking || (live && !!computedAt && Date.now() - Date.parse(computedAt) < schedule.total));
  const [playing, setPlaying] = useState(true);
  const last = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - (last.current ?? now);
      last.current = now;
      setT((x) => Math.min(schedule.total, x + dt));
    }, 40);
    return () => clearInterval(id);
  }, [playing, schedule.total]);

  // 打开时锁住背景滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const codes = useMemo(() => seatCodes(events, focusProposal(state.ju)?.experiences.length ?? state.counts.in), [events, state.ju, state.counts.in]);
  if (!neg) return null;
  const ph = playhead(schedule, t, events);
  // 播到最新一句、分身们还在谈：等下一句，不出结果卡
  const waiting = ph.phase === "done" && talking;
  const done = ph.phase === "done" && !talking;
  const pct = talking ? 100 : Math.round((t / Math.max(1, schedule.total)) * 100);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-night text-cream" role="dialog" aria-modal="true" aria-label="分身谈判直播">
      <style>{CSS}</style>
      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(12px,env(safe-area-inset-top))]">
        <h2 className="flex flex-1 items-center gap-2 text-[17px] font-black">
          🤝 分身谈判直播
          {!done && playing && (
            <span className="flex items-center gap-1 rounded-full bg-cinnabar px-2 py-px text-[11px] font-black text-white">
              <span className="size-1.5 animate-pulse rounded-full bg-white" />
              {synced ? "LIVE" : "回放"}
            </span>
          )}
        </h2>
        <button type="button" onClick={onClose} aria-label="关闭直播" className="flex size-10 items-center justify-center rounded-full border border-night-line text-[18px] text-cream-faint">✕</button>
      </header>

      <ol className="grid grid-cols-5 gap-1 px-4" aria-label="谈判轮次">
        {ROUNDS.map((r) => {
          const on = done || (ph.round !== null && r.round <= ph.round);
          const now = !done && ph.round === r.round;
          return (
            <li key={r.round} className="min-w-0">
              <div className={`h-1.5 rounded-full ${on ? (now ? "bg-mustard" : "bg-[#3ecf8e]") : "bg-night-line"}`} />
              <div className={`mt-1 truncate text-center text-[10.5px] font-bold ${now ? "text-mustard" : on ? "text-cream" : "text-cream-faint"}`}>{r.short}</div>
            </li>
          );
        })}
      </ol>

      <div className="relative mt-2 shrink-0">
        <MiniTable codes={codes} events={events} step={ph.step} phase={ph.phase} reduced={reduced} />
        {ph.phase === "banner" && ph.round !== null && (
          <div key={ph.round} className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
            <div className="rounded-2xl border-2 border-mustard bg-night/95 px-5 py-2 text-center shadow-[0_8px_30px_rgb(0_0_0/.5)]">
              <div className="font-num text-[11px] font-bold text-mustard">ROUND {ph.round + 1} / 5</div>
              <div className="text-[22px] font-black leading-tight">{roundLabel(ph.round)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-4 pt-2" style={{ maskImage: done ? undefined : "linear-gradient(transparent, #000 18%)" }}>
        <div className="flex h-full flex-col justify-end">
          {done ? <Result state={state} me={me} reduced={reduced} /> : <Bubbles events={events} step={ph.step} phase={waiting ? "hold" : ph.phase} typed={ph.typed} reduced={reduced} />}
          {waiting && <p className="mt-2 text-center text-[13px] font-bold text-cream-faint"><span className="animate-pulse">💬</span> 分身们正在想下一句…</p>}
        </div>
      </div>

      <footer className="px-4 pb-[max(14px,env(safe-area-inset-bottom))] pt-3">
        <div className="mb-2 h-1 overflow-hidden rounded-full bg-night-line">
          <div className="h-full bg-cream-faint transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-2">
          {!done && (
            <button type="button" className="min-h-11 flex-1 rounded-full border border-night-line text-[14px] font-bold text-cream-faint" onClick={() => setPlaying((x) => !x)}>
              {playing ? "⏸ 暂停" : "▶ 继续"}
            </button>
          )}
          {!done && (
            <button type="button" className="min-h-11 flex-1 rounded-full border border-night-line text-[14px] font-bold text-cream-faint" onClick={() => setT(schedule.total)}>
              {talking ? "⏭ 跳到最新" : "⏭ 看结果"}
            </button>
          )}
          <button type="button" className="min-h-11 flex-1 rounded-full border border-night-line text-[14px] font-bold text-cream-faint" onClick={() => { setT(0); setPlaying(true); }}>
            ↻ 从头看
          </button>
          {done && (
            <button type="button" className="min-h-11 flex-1 rounded-full bg-cinnabar text-[14px] font-black text-white" onClick={onClose}>
              去看方案
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** 方案页上的入口：谈判还在直播窗口里时标 LIVE（大家正在一起看），播完了就是回放 */
export function LiveEntry({ state, me }: { state: JuState; me: Member | null }) {
  const [open, setOpen] = useState(false);
  const neg = state.ju.plan?.negotiation;
  const computedAt = state.ju.plan?.computedAt;
  const talking = neg?.status === "live";
  const liveNow = talking || (!!neg && !!computedAt && Date.now() - Date.parse(computedAt) < buildSchedule(neg.events).total);
  // 分身们一开谈，在看页面的人自动弹出直播（每场只弹一次，关掉就不再弹）
  useEffect(() => {
    if (!talking || !computedAt) return;
    const key = `jz:live-seen:${state.ju.id}:${computedAt}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* 隐私模式读不了就照常弹 */
    }
    setOpen(true);
  }, [talking, computedAt, state.ju.id]);
  if (!neg || (!neg.events.length && !talking)) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="pressable flex w-full items-center gap-3 rounded-[var(--radius-card)] border-2 border-ink bg-night px-4 py-3 text-left text-cream shadow-sticker-sm"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-cinnabar text-[18px] text-white">▶</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[16px] font-black">
            {talking ? "分身们正在谈判" : "看分身谈判直播"}
            {liveNow && <span className="rounded-full bg-cinnabar px-1.5 py-px text-[10.5px] font-black text-white">LIVE</span>}
          </span>
          <span className="block truncate text-[12.5px] text-cream-faint">{talking ? `已经说了 ${neg.events.length} 句，点开一起看` : neg.outcome}</span>
        </span>
      </button>
      {open && <LiveNegotiation state={state} me={me} onClose={() => setOpen(false)} />}
    </>
  );
}

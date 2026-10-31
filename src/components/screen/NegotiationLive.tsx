"use client";

// v6 大屏：分身谈判直播（docs/AVATAR.md 第 4 节）。
// 只读公开的 Plan.negotiation 和聚合数：座位上只有代号（"分身 A"…），不显示真名 / 分身名 / 头像。
// 动效：发言人先微微下沉（预备）再升起说话；气泡落下有一点点回弹（跟随）；其他座位变暗（布景）；
// 拍板时座位依次亮成绿色，结果卡带重量落下。prefers-reduced-motion 下不打字、不位移，只按节拍换内容。
import { useEffect, useMemo, useRef, useState } from "react";
import type { JuState, NegotiationEvent } from "@/lib/types";
import { SealLogo } from "../ui";
import { focusProposal } from "./fmt";
import {
  JUZHANG,
  KIND_STYLE,
  ROUNDS,
  buildSchedule,
  mentionedCodes,
  negotiationStats,
  playhead,
  roundLabel,
  seatCodes,
  seatStates,
  speakerTone,
} from "./negotiation";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const CSS = `
@keyframes nl-seat-in { 0% { transform: translateY(18px) scale(.55); opacity: 0 } 70% { transform: translateY(-2px) scale(1.04); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes nl-bubble { 0% { transform: translateY(16px) scale(.96); opacity: 0 } 62% { transform: translateY(-3px) scale(1.008); opacity: 1 } 100% { transform: none; opacity: 1 } }
@keyframes nl-banner { 0% { transform: translateX(-36px); opacity: 0 } 22% { transform: translateX(4px); opacity: 1 } 32% { transform: none } 80% { opacity: 1 } 100% { opacity: 0; transform: translateX(10px) } }
@keyframes nl-card { 0% { transform: translateY(28px) scale(.92); opacity: 0 } 55% { transform: translateY(-5px) scale(1.015); opacity: 1 } 78% { transform: translateY(1px) scale(.997) } 100% { transform: none; opacity: 1 } }
@keyframes nl-ripple { 0% { transform: scale(.8); opacity: .9 } 100% { transform: scale(1.9); opacity: 0 } }
@keyframes nl-beam { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes nl-float-up { 0% { transform: translate(-50%, 6px) scale(.6); opacity: 0 } 60% { transform: translate(-50%, -3px) scale(1.06); opacity: 1 } 100% { transform: translate(-50%, 0) scale(1); opacity: 1 } }
`;

const TABLE = 600;
const RX = 228;
const RY = 214;

function seatPos(i: number, n: number) {
  // 从正上方偏一点开始，顺时针均匀分布；局长在圆心
  const a = -Math.PI / 2 + (Math.PI * 2 * (i + 0.5)) / Math.max(1, n);
  return { x: TABLE / 2 + RX * Math.cos(a), y: TABLE / 2 + RY * Math.sin(a) };
}

/* ───────── 轮次进度条 ───────── */
function RoundBar({ round, done }: { round: number | null; done: boolean }) {
  return (
    <ol className="grid grid-cols-5 gap-2" aria-label="谈判轮次">
      {ROUNDS.map((r) => {
        const past = done || (round !== null && r.round < round);
        const now = !done && round === r.round;
        return (
          <li key={r.round} className="min-w-0">
            <div className="relative h-2.5 overflow-hidden rounded-full bg-night-3">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: past ? "100%" : now ? "62%" : "0%",
                  background: past ? "#3ecf8e" : "#f2b530",
                  boxShadow: now ? "0 0 14px rgb(242 181 48 / .7)" : undefined,
                  transition: "width 700ms cubic-bezier(.45,0,.2,1)",
                }}
              />
            </div>
            <div className={`mt-1.5 flex items-baseline gap-1.5 truncate text-[16px] font-bold ${now ? "text-mustard" : past ? "text-cream" : "text-cream-faint"}`}>
              <span className="font-num text-[13px] opacity-70">{r.round + 1}</span>
              {r.label}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────── 谈判桌 ───────── */
function Table({
  codes,
  events,
  step,
  phase,
  reduced,
}: {
  codes: string[];
  events: NegotiationEvent[];
  step: number;
  phase: string;
  reduced: boolean;
}) {
  const cur = step >= 0 ? events[step] : undefined;
  const speaking = cur && (phase === "anticipate" || phase === "typing" || phase === "hold") ? cur : undefined;
  const states = useMemo(() => seatStates(events, phase === "anticipate" ? step - 1 : step), [events, step, phase]);
  const done = phase === "done";
  const pos = new Map(codes.map((c, i) => [c, seatPos(i, codes.length)]));
  const center = { x: TABLE / 2, y: TABLE / 2 };
  const kind = speaking ? KIND_STYLE[speaking.kind] : undefined;
  const from = speaking && speaking.speaker !== JUZHANG ? pos.get(speaking.speaker) : undefined;
  const linked = speaking ? mentionedCodes(speaking).filter((c) => pos.has(c)) : [];
  // 光束：分身发言 → 指向局长；局长点名 → 指向被点到的分身；交换 → 两个分身之间
  const beams: { a: { x: number; y: number }; b: { x: number; y: number } }[] = [];
  if (speaking && phase !== "anticipate") {
    if (from) beams.push({ a: from, b: center });
    if (speaking.kind === "trade" && linked.length >= 2 && !from) beams.push({ a: pos.get(linked[0])!, b: pos.get(linked[1])! });
    else for (const c of linked) beams.push({ a: center, b: pos.get(c)! });
  }

  return (
    <div className="relative shrink-0" style={{ width: TABLE, height: TABLE }}>
      {/* 桌面 */}
      <div
        aria-hidden
        className="absolute rounded-[50%] border-2 border-night-line"
        style={{
          left: TABLE / 2 - RX + 58,
          top: TABLE / 2 - RY + 58,
          width: (RX - 58) * 2,
          height: (RY - 58) * 2,
          background: "radial-gradient(ellipse at 50% 40%, rgb(242 181 48 / .10), rgb(29 24 21 / .9) 70%)",
          boxShadow: done ? "0 0 80px rgb(62 207 142 / .25), inset 0 0 40px rgb(62 207 142 / .12)" : "inset 0 0 40px rgb(0 0 0 / .5)",
          transition: "box-shadow 900ms ease-in-out",
        }}
      />
      <svg className="pointer-events-none absolute inset-0" width={TABLE} height={TABLE} aria-hidden>
        {beams.map((bm, i) => (
          <path
            key={`${step}-${i}`}
            // 交换：两人之间画一道向上拱起的弧，绕开居中的局长
            d={
              speaking?.kind === "trade" && !from
                ? `M ${bm.a.x} ${bm.a.y} Q ${(bm.a.x + bm.b.x) / 2} ${Math.min(bm.a.y, bm.b.y) - 150} ${bm.b.x} ${bm.b.y}`
                : `M ${bm.a.x} ${bm.a.y} L ${bm.b.x} ${bm.b.y}`
            }
            fill="none"
            pathLength={1}
            stroke={kind?.color ?? "#f2b530"}
            strokeWidth={speaking?.kind === "trade" ? 4 : 3}
            strokeLinecap="round"
            strokeDasharray={speaking?.kind === "trade" ? "0.04 0.03" : "1"}
            opacity={0.85}
            style={reduced || speaking?.kind === "trade" ? undefined : { strokeDasharray: 1, animation: "nl-beam 420ms cubic-bezier(.45,0,.2,1) both" }}
          />
        ))}
      </svg>

      {/* 局长居中 */}
      <div className="absolute flex flex-col items-center" style={{ left: center.x, top: center.y, transform: "translate(-50%, -50%)" }}>
        <div
          className="rounded-[14px]"
          style={{
            transform: speaking?.speaker === JUZHANG && phase !== "anticipate" ? "scale(1.1)" : phase === "anticipate" && speaking?.speaker === JUZHANG ? "scale(.95)" : "scale(1)",
            transition: "transform 260ms cubic-bezier(.3,1.35,.5,1)",
            boxShadow: speaking?.speaker === JUZHANG ? "0 0 46px rgb(226 65 46 / .55)" : "none",
          }}
        >
          <SealLogo size={96} dark />
        </div>
        <span className="mt-3 rounded-full bg-night-3 px-3 py-0.5 text-[15px] font-bold text-cream-faint">局长 · 主持</span>
      </div>

      {/* 分身座位 */}
      {codes.map((c, i) => {
        const p = pos.get(c)!;
        const tone = speakerTone(c);
        const st = states[c];
        const isSpeaker = speaking?.speaker === c;
        const isLinked = linked.includes(c);
        const dim = !!speaking && !isSpeaker && !isLinked && !done;
        const wind = isSpeaker && phase === "anticipate";
        const scale = wind ? 0.92 : isSpeaker ? 1.14 : isLinked ? 1.05 : 1;
        const ok = done;
        return (
          <div
            key={c}
            className="absolute"
            style={{
              left: p.x,
              top: p.y,
              transform: "translate(-50%, -50%)",
              animation: reduced ? undefined : `nl-seat-in 560ms cubic-bezier(.2,.8,.2,1) ${i * 90}ms both`,
            }}
          >
            <div
              className="relative flex size-[86px] flex-col items-center justify-center rounded-full border-[3px] bg-night-2"
              style={{
                borderColor: ok ? "#3ecf8e" : st?.blocked ? "#ff6b57" : tone.fg,
                opacity: dim ? 0.38 : 1,
                transform: `scale(${scale})`,
                boxShadow: isSpeaker ? `0 0 34px ${tone.fg}99` : ok ? "0 0 22px rgb(62 207 142 / .35)" : "none",
                // 拍板时座位依次变绿（错开 70ms，像涟漪传过一圈）
                transition: `transform ${wind ? 180 : 300}ms cubic-bezier(.3,1.3,.5,1), opacity 320ms ease-in-out, border-color 500ms ease-in-out ${ok ? i * 70 : 0}ms, box-shadow 400ms ease-in-out ${ok ? i * 70 : 0}ms`,
              }}
            >
              <span className="font-num text-[36px] font-black leading-none" style={{ color: tone.fg }}>
                {tone.letter}
              </span>
              <span className="mt-0.5 text-[12px] font-bold text-cream-faint">分身</span>
              {ok && !reduced && (
                <span
                  aria-hidden
                  className="absolute inset-0 rounded-full border-2 border-[#3ecf8e]"
                  style={{ animation: `nl-ripple 900ms ease-out ${i * 70}ms both` }}
                />
              )}
              {/* 状态角标：卡点 / 让步 / 交换 / 补偿 */}
              <span className="absolute -right-3 -top-2 flex flex-col gap-0.5">
                {st?.blocked && !ok && <Badge icon={KIND_STYLE.block.icon} color={KIND_STYLE.block.color} />}
                {st?.marks.map((m) => <Badge key={m} icon={KIND_STYLE[m].icon} color={KIND_STYLE[m].color} />)}
                {ok && !st?.marks.length && <Badge icon="✓" color="#3ecf8e" />}
              </span>
            </div>
            {isSpeaker && kind && phase !== "anticipate" && (
              <span
                className="absolute -top-9 left-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[15px] font-black text-night"
                style={{ background: kind.color, animation: reduced ? undefined : "nl-float-up 320ms cubic-bezier(.2,.8,.2,1) both", transform: "translateX(-50%)" }}
              >
                {kind.icon} {kind.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Badge({ icon, color }: { icon: string; color: string }) {
  return (
    <span className="flex size-[26px] items-center justify-center rounded-full border-2 bg-night text-[13px] font-black" style={{ borderColor: color, color }}>
      {icon}
    </span>
  );
}

/* ───────── 对话流 ───────── */
function Transcript({ events, step, phase, typed, reduced }: { events: NegotiationEvent[]; step: number; phase: string; typed: number; reduced: boolean }) {
  // 显示到当前这条（预备阶段只亮座位，气泡还没出来）
  const upto = phase === "anticipate" ? step - 1 : step;
  const shown = events.slice(0, upto + 1).map((e, i) => ({ e, i }));
  const tail = shown.slice(-8);
  if (!tail.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-cream-faint">
        <span className="text-[44px]">🪑</span>
        <span className="text-[22px] font-bold">分身们正在入座…</span>
      </div>
    );
  }
  return (
    <ol className="flex h-full flex-col justify-end gap-3.5 overflow-hidden" aria-live="polite" style={{ maskImage: "linear-gradient(transparent, #000 22%)" }}>
      {tail.map(({ e, i }, k) => {
        const isCur = i === step && phase !== "done";
        const text = isCur && phase === "typing" ? e.text.slice(0, typed) : e.text;
        const tone = speakerTone(e.speaker);
        const ks = KIND_STYLE[e.kind];
        const jz = e.speaker === JUZHANG;
        const newRound = i === 0 || events[i - 1].round !== e.round;
        const last = k === tail.length - 1;
        return (
          <li key={i} className={last ? "" : "opacity-70"}>
            {newRound && (
              <div className="mb-2 flex items-center gap-3 text-[15px] font-bold text-cream-faint">
                <span className="h-px flex-1 bg-night-line" />第 {e.round + 1} 轮 · {roundLabel(e.round)}
                <span className="h-px flex-1 bg-night-line" />
              </div>
            )}
            <div className="flex items-start gap-3" style={{ animation: reduced ? undefined : "nl-bubble 420ms cubic-bezier(.2,.8,.2,1) both" }}>
              {jz ? (
                <span className="mt-1 shrink-0">
                  <SealLogo size={42} dark />
                </span>
              ) : (
                <span
                  className="font-num mt-1 flex size-[42px] shrink-0 items-center justify-center rounded-full border-[3px] bg-night-2 text-[20px] font-black"
                  style={{ borderColor: tone.fg, color: tone.fg }}
                >
                  {tone.letter}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[16px] font-black" style={{ color: jz ? "#ff8a78" : tone.fg }}>
                    {e.speaker}
                  </span>
                  <span className="rounded-full px-2 py-px text-[13px] font-black" style={{ background: `${ks.color}26`, color: ks.color }}>
                    {ks.icon} {ks.label}
                  </span>
                </div>
                <p
                  className="rounded-2xl rounded-tl-sm border-2 bg-night-3 px-4 py-2.5 text-[21px] font-semibold leading-[1.45] text-cream"
                  style={{ borderColor: isCur || last ? `${ks.color}aa` : "transparent" }}
                >
                  {text}
                  {isCur && phase === "typing" && <span className="ml-0.5 inline-block h-[1em] w-[3px] translate-y-[3px] animate-pulse" style={{ background: ks.color }} />}
                </p>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────── 结果卡 ───────── */
function ResultCard({ state, reduced }: { state: JuState; reduced: boolean }) {
  const neg = state.ju.plan!.negotiation!;
  const p = focusProposal(state.ju);
  const s = negotiationStats(neg, p);
  const decides = neg.events.filter((e) => e.kind === "decide");
  const decide = decides.find((e) => /拍板/.test(e.text)) ?? decides.at(-1);
  // 0 次的不摆出来（"0 次交换"只会显得弱）；"0 人被打扰"是好事，一直留着
  const chips = (
    [
      [s.autoConcessions, "次自动让步", KIND_STYLE.concede.color],
      [s.trades, "次交换", KIND_STYLE.trade.color],
      [s.compensations, "次补偿", KIND_STYLE.compensate.color],
    ] as [number, string, string][]
  )
    .filter(([n]) => n > 0)
    .map(([n, l, c]): [string, string, string] => [String(n), l, c])
    .concat([[String(s.asked), s.asked ? "人被私下问" : "人被打扰", "#f3e7d3"]]);
  return (
    <div className="flex h-full flex-col justify-center">
      <div
        className="rounded-[28px] border-2 border-[#3ecf8e] bg-night p-8 shadow-[0_0_80px_rgb(62_207_142/.18)]"
        style={{ animation: reduced ? undefined : "nl-card 720ms cubic-bezier(.2,.8,.2,1) both" }}
        role="status"
      >
        <div className="flex items-end gap-4">
          <div className="font-num text-[120px] font-black leading-[.85] text-[#3ecf8e]">
            {s.cared ?? "—"}
            <span className="text-[56px] text-cream-faint">/{s.total || "—"}</span>
          </div>
          <div className="pb-2 text-[26px] font-black leading-tight text-cream">
            {s.cared !== undefined && s.total > 0 && s.cared >= s.total ? (
              <>
                个人
                <br />
                都照顾到了
              </>
            ) : (
              "人照顾到了"
            )}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2.5">
          {chips.map(([n, l, c]) => (
            <span key={l} className="rounded-full border-2 px-4 py-1 text-[19px] font-bold" style={{ borderColor: `${c}88`, color: c }}>
              <b className="font-num text-[24px]">{n}</b> {l}
            </span>
          ))}
        </div>
        {decide && <p className="mt-6 border-l-[6px] border-cinnabar pl-4 text-[25px] font-black leading-snug text-cream">⚖️ {decide.text}</p>}
        <p className="mt-4 text-[17px] leading-relaxed text-cream-faint">{neg.outcome}</p>
      </div>
    </div>
  );
}

const btn =
  "rounded-full border border-night-line px-4 py-1.5 text-[16px] font-bold text-cream-faint transition-colors hover:border-cream-faint hover:text-cream";

/** 大屏谈判直播：自动播放，可暂停 / 重播 / 跳到结果。父组件用 key 换一份谈判就会从头播 */
export function NegotiationLive({ state, right }: { state: JuState; right?: React.ReactNode }) {
  const neg = state.ju.plan?.negotiation;
  const events = useMemo(() => neg?.events ?? [], [neg]);
  const reduced = useReducedMotion();
  const schedule = useMemo(() => buildSchedule(events, { reduced }), [events, reduced]);
  const [t, setT] = useState(0);
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

  const ph = playhead(schedule, t, events);
  const done = ph.phase === "done";
  const p = focusProposal(state.ju);
  const codes = useMemo(() => seatCodes(events, p?.experiences.length ?? state.counts.in), [events, p, state.counts.in]);
  if (!neg) return null;

  const replay = () => {
    setT(0);
    setPlaying(true);
  };

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border-2 border-night-line bg-night-2 p-7">
      <style>{CSS}</style>
      <div className="mb-4 flex shrink-0 items-center gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-3 text-[28px] font-black text-cream">
            🤝 分身谈判直播
            {!done && playing && (
              <span className="flex items-center gap-1.5 rounded-full bg-cinnabar px-2.5 py-0.5 text-[14px] font-black text-white">
                <span className="size-2 animate-pulse rounded-full bg-white" />
                LIVE
              </span>
            )}
          </h3>
          <p className="mt-0.5 truncate text-[17px] text-cream-faint">每个分身只替本人说话，局长主持公平 · 代号与身份无关，谁是谁只有本人知道</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!done && (
            <button className={btn} onClick={() => setPlaying((x) => !x)}>
              {playing ? "⏸ 暂停" : "▶ 继续"}
            </button>
          )}
          {!done && (
            <button className={btn} onClick={() => setT(schedule.total)}>
              ⏭ 看结果
            </button>
          )}
          <button className={btn} onClick={replay}>
            ↻ 重播
          </button>
          {right}
        </div>
      </div>
      <div className="mb-5 shrink-0">
        <RoundBar round={ph.round} done={done} />
      </div>

      <div className="relative flex min-h-0 flex-1 gap-8">
        <div className="flex shrink-0 items-center justify-center">
          <Table codes={codes} events={events} step={ph.step} phase={ph.phase} reduced={reduced} />
        </div>
        <div className="relative min-h-0 min-w-0 flex-1">
          {done ? <ResultCard state={state} reduced={reduced} /> : <Transcript events={events} step={ph.step} phase={ph.phase} typed={ph.typed} reduced={reduced} />}
        </div>
        {ph.phase === "banner" && ph.round !== null && (
          <div key={ph.round} className="pointer-events-none absolute left-0 top-2 z-10" style={{ animation: reduced ? undefined : `nl-banner ${1100}ms cubic-bezier(.45,0,.2,1) both` }}>
            <div className="rounded-2xl border-2 border-mustard bg-night/90 px-6 py-3 shadow-[0_10px_40px_rgb(0_0_0/.5)]">
              <div className="font-num text-[16px] font-bold text-mustard">ROUND {ph.round + 1} / 5</div>
              <div className="text-[34px] font-black leading-tight text-cream">{roundLabel(ph.round)}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

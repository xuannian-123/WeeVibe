"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { JuState, Member, Poi, SwipeVerdict } from "@/lib/types";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Button, Spinner } from "../ui";
import { toast } from "../toast";
import { categoryEmoji } from "./JuHeader";

const VERDICT_TEXT: Record<SwipeVerdict, string> = { love: "超想去", like: "想去", pass: "不想" };
const THRESH = 90;

/** 每家店一个稳定的底色 */
function tint(id: string): string {
  const palette = ["#f2b530", "#e2412e", "#2e8b6a", "#f3e8d6", "#1f1a17", "#fde9b8"];
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function PoiCard({ poi, guess, category }: { poi: Poi; guess?: SwipeVerdict; category: string }) {
  const bg = tint(poi.id);
  const dark = bg === "#1f1a17" || bg === "#e2412e" || bg === "#2e8b6a";
  return (
    <div className="sticker flex h-full flex-col overflow-hidden">
      <div className="relative flex h-[46%] shrink-0 items-center justify-center border-b-2 border-ink" style={{ background: bg }}>
        {poi.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poi.photoUrl} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
        ) : (
          <span className="text-[84px] drop-shadow-[3px_3px_0_rgba(31,26,23,.25)]" aria-hidden>
            {categoryEmoji(category)}
          </span>
        )}
        {poi.rating != null && (
          <span className="font-num absolute left-3 top-3 rounded-lg border-2 border-ink bg-card px-2 py-0.5 text-[14px] font-bold">
            ★ {poi.rating.toFixed(1)}
          </span>
        )}
        {guess && (
          <span
            className={`absolute right-3 top-3 rotate-3 rounded-lg border-2 border-dashed px-2 py-0.5 text-[13px] font-black ${
              dark ? "border-paper bg-ink/70 text-paper" : "border-ink bg-card/90 text-ink"
            }`}
          >
            🔮 局长猜你：{VERDICT_TEXT[guess]}
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        <h3 className="text-[22px] font-black leading-snug break-words">{poi.name}</h3>
        <div className="font-num mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[15px] font-semibold text-ink-soft">
          {poi.costPerPerson != null && <span className="text-ink">¥{poi.costPerPerson}/人</span>}
          {poi.openTime && <span>🕘 {poi.openTime}</span>}
        </div>
        <p className="mt-2 line-clamp-2 text-[14px] leading-relaxed text-ink-soft">📍 {poi.address}</p>
        <p className="mt-auto pt-2 text-[12px] text-ink-faint">你的选择只有局长知道，群里只会看到“3 人刷卡点了想去”。</p>
      </div>
    </div>
  );
}

export function SwipeView({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const [deck, setDeck] = useState<Poi[] | null>(null);
  const [predicted, setPredicted] = useState<Record<string, SwipeVerdict>>({});
  const [idx, setIdx] = useState(0);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [fly, setFly] = useState<SwipeVerdict | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const already = useRef(me.private?.swipes ?? {});
  const inflight = useRef<Promise<unknown>[]>([]);

  const load = async () => {
    setLoadErr(null);
    try {
      const r = await actions.deck();
      const rest = r.deck.filter((p) => !already.current[p.id]);
      setDeck(rest);
      setPredicted(r.predicted ?? {});
      setIdx(0);
    } catch (e) {
      setLoadErr(errMsg(e));
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = deck?.length ?? 0;
  const done = deck != null && idx >= total;
  const cur = deck?.[idx];
  const next = deck?.[idx + 1];

  // 刷完：等最后几张提交完，刷新状态进等待室
  useEffect(() => {
    if (!done || finishing) return;
    setFinishing(true);
    Promise.allSettled(inflight.current).then(() => actions.refresh().catch(() => {}));
  }, [done, finishing, actions]);

  const commit = (v: SwipeVerdict) => {
    if (!cur || fly) return;
    setFly(v);
    const poiId = cur.id;
    const p = actions.swipe(poiId, v).catch((e) => toast(errMsg(e), "error"));
    inflight.current.push(p);
    setTimeout(() => {
      setFly(null);
      setDrag(null);
      setIdx((i) => i + 1);
    }, 260);
  };

  const acceptGuesses = () => {
    if (!deck) return;
    for (const p of deck.slice(idx)) {
      inflight.current.push(actions.swipe(p.id, predicted[p.id] ?? "like").catch((e) => toast(errMsg(e), "error")));
    }
    setIdx(deck.length);
  };

  const onDown = (e: RPointerEvent) => {
    if (fly) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    setDrag({ x: 0, y: 0 });
  };
  const onMove = (e: RPointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    const d = drag ?? { x: 0, y: 0 };
    if (d.y < -THRESH && Math.abs(d.y) > Math.abs(d.x)) commit("love");
    else if (d.x > THRESH) commit("like");
    else if (d.x < -THRESH) commit("pass");
    else setDrag(null);
  };

  const d = drag ?? { x: 0, y: 0 };
  const hint: SwipeVerdict | null =
    fly ?? (d.y < -40 && Math.abs(d.y) > Math.abs(d.x) ? "love" : d.x > 40 ? "like" : d.x < -40 ? "pass" : null);
  const flyTo = fly === "like" ? "translate(140%, 0) rotate(18deg)" : fly === "pass" ? "translate(-140%, 0) rotate(-18deg)" : fly === "love" ? "translate(0, -130%) rotate(-4deg)" : null;
  const transform = flyTo ?? `translate(${d.x}px, ${Math.min(40, d.y)}px) rotate(${d.x / 18}deg)`;
  const hasGuess = deck?.slice(idx).some((p) => predicted[p.id]);

  return (
    <div className="pb-8">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="text-[22px] font-black">刷几家店</h2>
          <p className="text-[13px] text-ink-soft">右滑想去 · 上滑超想去 · 左滑不想</p>
          <p className="mt-0.5 text-[12px] text-ink-faint">这不是投票，是告诉局长你的口味；方案出来后再一起投票。</p>
        </div>
        {deck && total > 0 && (
          <span className="font-num text-[15px] font-bold">
            {Math.min(idx + 1, total)}/{total}
          </span>
        )}
      </div>

      {deck && total > 0 && (
        <div className="mb-3 flex gap-1" aria-hidden>
          {deck.map((p, i) => (
            <span key={p.id} className={`h-1.5 flex-1 rounded-full ${i < idx ? "bg-ink" : i === idx ? "bg-cinnabar" : "bg-line"}`} />
          ))}
        </div>
      )}

      <div className="relative mx-auto h-[min(64dvh,470px)] w-full select-none">
        {!deck && !loadErr && (
          <div className="sticker flex h-full flex-col items-center justify-center gap-3 text-ink-soft">
            <Spinner />
            局长在挑附近的店…
          </div>
        )}
        {loadErr && (
          <div className="sticker flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="font-semibold">{loadErr}</p>
            <Button onClick={load}>再试一次</Button>
          </div>
        )}
        {done && (
          <div className="sticker animate-pop-in flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-5xl">🙌</span>
            <p className="text-[20px] font-black">刷完了！</p>
            <p className="text-[14px] text-ink-soft">局长都记下了，等大家说完就出方案。</p>
            <Button variant="secondary" onClick={() => actions.refresh()}>
              去等待室 →
            </Button>
          </div>
        )}
        {next && !done && (
          <div className="absolute inset-0 scale-[0.95] opacity-80" style={{ transform: `translateY(10px) scale(${0.95 + Math.min(1, Math.abs(d.x) / 300) * 0.05})` }}>
            <PoiCard poi={next} category={state.ju.spec.category} />
          </div>
        )}
        {cur && !done && (
          <div
            key={cur.id}
            className="absolute inset-0 touch-none"
            style={{
              transform,
              transition: drag && !fly ? "none" : "transform 260ms cubic-bezier(.3,.8,.4,1)",
              cursor: "grab",
            }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <PoiCard poi={cur} guess={predicted[cur.id]} category={state.ju.spec.category} />
            {hint && (
              <span
                className={`pointer-events-none absolute top-[18%] rounded-xl border-4 px-3 py-1 text-[28px] font-black ${
                  hint === "like"
                    ? "left-5 -rotate-12 border-jade text-jade"
                    : hint === "pass"
                      ? "right-5 rotate-12 border-ink-soft text-ink-soft"
                      : "left-1/2 -translate-x-1/2 -rotate-6 border-cinnabar text-cinnabar"
                }`}
                style={{ background: "rgb(255 253 248 / .9)" }}
              >
                {VERDICT_TEXT[hint]}
              </span>
            )}
          </div>
        )}
      </div>

      {cur && !done && (
        <>
          <div className="mt-5 flex items-center justify-center gap-5">
            <button
              type="button"
              aria-label="不想去"
              onClick={() => commit("pass")}
              className="pressable flex size-16 items-center justify-center rounded-full border-2 border-ink bg-card text-[26px] shadow-sticker"
            >
              ✕
            </button>
            <button
              type="button"
              aria-label="超想去"
              onClick={() => commit("love")}
              className="pressable flex size-14 items-center justify-center rounded-full border-2 border-ink bg-mustard text-[24px] shadow-sticker"
            >
              ★
            </button>
            <button
              type="button"
              aria-label="想去"
              onClick={() => commit("like")}
              className="pressable flex size-16 items-center justify-center rounded-full border-2 border-ink bg-cinnabar text-[26px] text-white shadow-sticker"
            >
              ♥
            </button>
          </div>
          {hasGuess && (
            <div className="mt-4 text-center">
              <button type="button" onClick={acceptGuesses} className="min-h-11 px-3 text-[14px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4">
                🔮 懒得刷？就按局长猜的来
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

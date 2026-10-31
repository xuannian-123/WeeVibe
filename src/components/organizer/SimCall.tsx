"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GroupMessages } from "@/lib/types";

type Line = NonNullable<GroupMessages["reservationDialog"]>[number];

/** 两个角色用不同的嗓音：有两个以上中文语音就分开用，否则同一个语音靠音调区分 */
function pickVoices(): { juzhang?: SpeechSynthesisVoice; clerk?: SpeechSynthesisVoice } {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return {};
  const all = window.speechSynthesis.getVoices();
  const zh = all.filter((v) => /^zh[-_]CN/i.test(v.lang) || /Chinese.*Mainland|普通话|中文/.test(v.name));
  const pool = zh.length ? zh : all.filter((v) => /^zh/i.test(v.lang));
  if (!pool.length) return {};
  const male = pool.find((v) => /Yunxi|Yunyang|Kangkang|male|男/i.test(v.name));
  const female = pool.find((v) => /Xiaoxiao|Xiaoyi|Huihui|Yaoyao|Ting|female|女/i.test(v.name));
  const juzhang = male ?? pool[0];
  const clerk = female && female !== juzhang ? female : (pool.find((v) => v !== juzhang) ?? juzhang);
  return { juzhang, clerk };
}

const fmtSec = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/**
 * #13 模拟订位通话：按 reservationDialog 逐句播放（speechSynthesis zh-CN），局长和店员不同音调，
 * 逐句字幕 + 通话动画。不会真的拨号 —— 界面上必须醒目标注"模拟演示"。
 */
export function SimCall({
  dialog,
  shopName,
  tel,
  onDone,
}: {
  dialog: Line[];
  shopName: string;
  tel?: string;
  onDone?: () => void;
}) {
  const phone = tel?.split(/[;,，、/\s]+/).find((x) => /\d{5,}/.test(x));
  const [cur, setCur] = useState(-1); // -1 = 未开始；dialog.length = 结束
  const [sec, setSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const playing = cur >= 0 && cur < dialog.length;
  const token = useRef(0);
  const hold = useRef<SpeechSynthesisUtterance | null>(null); // Safari 会回收没被引用的 utterance
  const guard = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const listRef = useRef<HTMLOListElement>(null);
  const voices = useRef<ReturnType<typeof pickVoices>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => (voices.current = pickVoices());
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => {
      window.speechSynthesis.removeEventListener?.("voiceschanged", load);
      window.speechSynthesis.cancel();
      clearTimeout(guard.current);
    };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [playing]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cur]);

  const speak = useCallback(
    (i: number, my: number) => {
      if (my !== token.current) return;
      if (i >= dialog.length) {
        setCur(dialog.length);
        onDone?.();
        return;
      }
      setCur(i);
      const line = dialog[i];
      const next = () => {
        clearTimeout(guard.current);
        if (my === token.current) setTimeout(() => speak(i + 1, my), 380);
      };
      // 兜底：语音没触发 onend（或没有语音能力 / 静音）就按字数估时
      const est = 700 + line.text.length * (muted ? 170 : 330);
      const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
      if (!synth || muted) {
        guard.current = setTimeout(next, est);
        return;
      }
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = "zh-CN";
      const isJu = line.who === "局长";
      const v = isJu ? voices.current.juzhang : voices.current.clerk;
      if (v) u.voice = v;
      const sameVoice = voices.current.juzhang === voices.current.clerk;
      u.pitch = isJu ? 0.85 : sameVoice ? 1.55 : 1.15;
      u.rate = isJu ? 1.05 : 1.15;
      u.onend = next;
      u.onerror = next;
      hold.current = u;
      guard.current = setTimeout(next, est + 4000);
      synth.speak(u);
    },
    [dialog, muted, onDone],
  );

  const start = () => {
    token.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setSec(0);
    const my = token.current;
    setCur(-2); // 拨号中
    setTimeout(() => speak(0, my), 1200);
  };
  const hangup = () => {
    token.current++;
    clearTimeout(guard.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setCur(-1);
  };

  const dialing = cur === -2;
  const active = dialing || playing;
  const ended = cur === dialog.length;
  const who = playing ? dialog[cur].who : null;

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border-2 border-ink bg-night text-cream shadow-sticker">
      <div className="flex items-center gap-2 bg-mustard px-3 py-1.5 text-[13px] font-black text-ink">
        <span className="rounded bg-ink px-1.5 py-px text-[11px] tracking-widest text-mustard">模拟演示</span>
        语音合成播放，没有真的拨出去
      </div>

      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <Party label="局长" icon="🧑‍⚖️" speaking={who === "局长"} />
        <div className="flex flex-1 flex-col items-center">
          <Wave on={active} />
          <span className="font-num mt-1 text-[13px] text-cream-faint">
            {dialing ? "拨号中…" : playing ? fmtSec(sec) : ended ? `通话结束 ${fmtSec(sec)}` : "未接通"}
          </span>
        </div>
        <Party label="店员" icon="🏪" speaking={who === "店员"} />
      </div>
      <div className="mt-1 truncate px-4 text-center text-[13px] text-cream-faint">{shopName}</div>

      <ol ref={listRef} className="mt-3 max-h-[220px] space-y-2 overflow-y-auto px-4 pb-1" aria-live="polite">
        {dialog.map((l, i) => {
          const shown = cur >= i || ended;
          if (!shown) return null;
          const now = i === cur;
          const ju = l.who === "局长";
          return (
            <li key={i} data-i={i} className={`animate-rise flex ${ju ? "justify-start" : "justify-end"}`}>
              <span
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-[14px] leading-snug transition-opacity ${
                  ju ? "rounded-bl-sm bg-cinnabar text-white" : "rounded-br-sm bg-night-3 text-cream"
                } ${now ? "opacity-100" : "opacity-60"}`}
              >
                <b className="mr-1 text-[12px] opacity-80">{l.who}</b>
                {l.text}
              </span>
            </li>
          );
        })}
        {cur === -1 && <li className="py-3 text-center text-[14px] text-cream-faint">点下面的按钮，听局长替你订位</li>}
      </ol>

      <div className="flex gap-2 p-3">
        {active ? (
          <button onClick={hangup} className="pressable min-h-11 flex-1 rounded-[var(--radius-btn)] border-2 border-cream bg-cinnabar font-bold text-white">
            挂断
          </button>
        ) : (
          <button onClick={start} className="pressable min-h-11 flex-1 rounded-[var(--radius-btn)] border-2 border-cream bg-[var(--color-jade)] font-bold text-white">
            {ended ? "再听一遍" : "▶ 播放模拟通话"}
          </button>
        )}
        <button
          onClick={() => setMuted((m) => !m)}
          aria-pressed={muted}
          className="min-h-11 rounded-[var(--radius-btn)] border-2 border-night-line px-3 text-[14px] font-semibold text-cream-faint"
        >
          {muted ? "🔇 只看字幕" : "🔊 有声"}
        </button>
      </div>
      {phone && (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="flex min-h-12 items-center justify-center gap-2 border-t-2 border-night-line text-[15px] font-bold text-mustard"
        >
          📞 真的打给店家 <span className="font-num">{phone}</span>
        </a>
      )}
    </div>
  );
}

function Party({ label, icon, speaking }: { label: string; icon: string; speaking: boolean }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <span className="relative flex size-14 items-center justify-center rounded-full border-2 border-cream bg-night-3 text-[26px]">
        {speaking && <span className="animate-pulse-ring absolute inset-0 rounded-full border-2 border-mustard" />}
        {icon}
      </span>
      <span className={`text-[12px] font-bold ${speaking ? "text-mustard" : "text-cream-faint"}`}>{label}</span>
    </div>
  );
}

function Wave({ on }: { on: boolean }) {
  return (
    <div className="flex h-8 items-center gap-[3px]" aria-hidden>
      {Array.from({ length: 13 }, (_, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-mustard"
          style={{
            height: on ? undefined : 4,
            animation: on ? `sim-wave 0.9s ease-in-out ${(i % 5) * 0.12}s infinite alternate` : undefined,
            opacity: on ? 1 : 0.35,
          }}
        />
      ))}
      <style>{`@keyframes sim-wave{from{height:4px}to{height:28px}}`}</style>
    </div>
  );
}

"use client";

// v6 谈判桌场景：一张有透视的长桌，分身们是围坐的卡通人物，局长坐在桌首主持。手机直播和大屏共用。
// 人物外形（发型 / 肤色 / 衣服颜色）只由代号决定，和成员身份无关——匿名性和以前的"字母圆圈"一样。
// 说话的人亮起来、嘴巴一张一合、头顶冒气泡，其他人变暗；没说话的人轻轻呼吸、偶尔眨眼；
// 卡在底线上的标红、让过步的挂标，谈成后大家都笑。prefers-reduced-motion 下不做循环动画。
import type { NegotiationEvent } from "@/lib/types";
import { JUZHANG, KIND_STYLE, seatStates, speakerTone } from "./negotiation";

const CSS = `
@keyframes ns-breathe { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.2px) } }
@keyframes ns-talk { 0%,100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
@keyframes ns-blink { 0%,92%,100% { transform: scaleY(1) } 95% { transform: scaleY(.1) } }
@keyframes ns-bob { 0%,100% { transform: translateY(0) rotate(0) } 50% { transform: translateY(-2px) rotate(-1.5deg) } }
@keyframes ns-pop { 0% { transform: translate(-50%, 6px) scale(.5); opacity: 0 } 70% { transform: translate(-50%, -2px) scale(1.06); opacity: 1 } 100% { transform: translate(-50%, 0) scale(1); opacity: 1 } }
@keyframes ns-gavel { 0%,100% { transform: rotate(0) } 40% { transform: rotate(-38deg) } 60% { transform: rotate(6deg) } }
@keyframes ns-glow { 0%,100% { opacity: .55 } 50% { opacity: .95 } }
`;

const SKINS = ["#f6d2b4", "#e9b58f", "#d39a72", "#f1c7a2", "#c98a63"];
const HAIRS = ["#2b2118", "#5a3a22", "#1d1d24", "#8a5a2b", "#3c2c4a"];

/** 代号里的字母序号（"分身 C" → 2）；局长 = -1 */
function codeIndex(code: string): number {
  const m = /分身 (?:Z(\d+)|([A-Z]))/.exec(code);
  if (!m) return -1;
  return m[1] ? 24 + Number(m[1]) : m[2].charCodeAt(0) - 65;
}

type Mood = "idle" | "talk" | "happy" | "worried";

/** 一个卡通半身像（viewBox 64×72）。variant 决定发型 / 肤色 / 发色，shirt 是代号的颜色 */
export function AvatarFigure({ variant, shirt, mood, reduced, chief = false }: { variant: number; shirt: string; mood: Mood; reduced: boolean; chief?: boolean }) {
  const skin = SKINS[variant % SKINS.length];
  const hairC = HAIRS[(variant * 3 + 1) % HAIRS.length];
  const style = variant % 5;
  const talk = mood === "talk";
  const anim = (a: string) => (reduced ? undefined : a);
  return (
    <svg viewBox="0 0 64 72" className="block h-full w-full overflow-visible" aria-hidden>
      <g style={{ animation: anim(talk ? "ns-bob .9s ease-in-out infinite" : "ns-breathe 3.6s ease-in-out infinite"), transformOrigin: "32px 60px" }}>
        {/* 身体 / 衣服 */}
        <path d="M7 72 C7 54 18 46 32 46 C46 46 57 54 57 72 Z" fill={shirt} />
        <path d="M24 47 L32 56 L40 47" fill="none" stroke="rgb(255 255 255 / .55)" strokeWidth="2" strokeLinecap="round" />
        {chief && (
          <g transform="translate(37 58)">
            <rect x="-6" y="-6" width="12" height="12" rx="2.5" fill="#e2412e" stroke="#fff" strokeWidth="1.2" />
            <text x="0" y="2.6" textAnchor="middle" fontSize="6.5" fontWeight="900" fill="#fff">局</text>
          </g>
        )}
        <rect x="27.5" y="38" width="9" height="10" rx="3" fill={skin} />
        {/* 头 */}
        <circle cx="32" cy="27" r="14" fill={skin} />
        {/* 发型 */}
        {style === 0 && <path d="M18 26 C18 13 46 11 46 26 C42 19 24 19 18 26 Z" fill={hairC} />}
        {style === 1 && <path d="M17 30 C14 12 50 10 47 30 L45 37 C44 24 21 24 19 37 Z" fill={hairC} />}
        {style === 2 && <path d="M18 24 L21 14 L25 19 L28 11 L32 18 L36 11 L39 19 L43 14 L46 24 C40 18 24 18 18 24 Z" fill={hairC} />}
        {style === 3 && (
          <>
            <circle cx="32" cy="11" r="5.5" fill={hairC} />
            <path d="M18 26 C18 14 46 14 46 26 C40 20 24 20 18 26 Z" fill={hairC} />
          </>
        )}
        {style === 4 && <path d="M18 27 C17 14 40 10 46 22 C38 18 30 19 26 25 C24 22 21 23 18 27 Z" fill={hairC} />}
        {chief && <rect x="20" y="22" width="24" height="5" rx="2.5" fill="none" stroke="#2b2118" strokeWidth="1.6" />}
        {/* 眼睛（偶尔眨） */}
        <g style={{ animation: anim(`ns-blink ${4 + (variant % 3)}s ease-in-out infinite`), transformOrigin: "32px 28px", transformBox: "fill-box" }}>
          {mood === "happy" ? (
            <>
              <path d="M24.5 28 Q26.5 25.5 28.5 28" stroke="#2b2118" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              <path d="M35.5 28 Q37.5 25.5 39.5 28" stroke="#2b2118" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </>
          ) : (
            <>
              <ellipse cx="26.5" cy="28" rx="1.9" ry="2.2" fill="#2b2118" />
              <ellipse cx="37.5" cy="28" rx="1.9" ry="2.2" fill="#2b2118" />
            </>
          )}
        </g>
        {mood === "worried" && (
          <>
            <path d="M23.5 23 L28.5 24.5" stroke="#2b2118" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M40.5 23 L35.5 24.5" stroke="#2b2118" strokeWidth="1.4" strokeLinecap="round" />
          </>
        )}
        <circle cx="23" cy="32.5" r="2.4" fill="#ff8a78" opacity=".35" />
        <circle cx="41" cy="32.5" r="2.4" fill="#ff8a78" opacity=".35" />
        {/* 嘴：说话时一张一合 */}
        {talk ? (
          <ellipse cx="32" cy="35" rx="3" ry="2.6" fill="#7a2e22" style={{ animation: anim("ns-talk .26s ease-in-out infinite"), transformOrigin: "32px 35px", transformBox: "fill-box" }} />
        ) : mood === "happy" ? (
          <path d="M27 33.5 Q32 39 37 33.5" stroke="#7a2e22" strokeWidth="1.8" fill="#fff" strokeLinecap="round" />
        ) : mood === "worried" ? (
          <path d="M28.5 36 Q32 33.5 35.5 36" stroke="#7a2e22" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        ) : (
          <path d="M28.5 34.5 Q32 37 35.5 34.5" stroke="#7a2e22" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
}

/** 一个座位在长桌边上的位置：桌首留给局长，其余沿桌边从近处绕一圈；depth 0 = 最远，1 = 最近 */
function seatAt(i: number, n: number, w: number, h: number) {
  const cx = w / 2;
  const cy = h * 0.6;
  // 座位在桌沿稍外一圈：两边的人坐在桌子侧面，不压在桌面上
  const rx = w * 0.44;
  const ry = h * 0.25;
  // 从局长右手边（约 -55°）顺时针绕到左手边（约 235°），桌首正上方留空
  const deg = -55 + (290 * (i + 0.5)) / Math.max(1, n);
  const a = (deg * Math.PI) / 180;
  const x = cx + rx * Math.cos(a);
  const y = cy + ry * Math.sin(a);
  const depth = (Math.sin(a) + 1) / 2;
  return { x, y, depth };
}

export function NegotiationScene({
  codes,
  events,
  step,
  phase,
  reduced,
  width,
  bubble,
}: {
  codes: string[];
  events: NegotiationEvent[];
  step: number;
  phase: string;
  reduced: boolean;
  width: number;
  /** 正在说的话（已经打出来的部分）：画成说话人头顶的漫画气泡 */
  bubble?: string;
}) {
  const h = Math.round(width * 0.78);
  const cur = step >= 0 ? events[step] : undefined;
  const speaking = cur && phase !== "intro" && phase !== "banner" && phase !== "done" ? cur.speaker : undefined;
  const states = seatStates(events, phase === "anticipate" ? step - 1 : step);
  const done = phase === "done";
  const fig = Math.round(width * 0.17);
  const chiefSpeaking = speaking === JUZHANG;
  const gavel = chiefSpeaking && cur?.kind === "decide";
  const seats = codes.map((code, i) => ({ code, ...seatAt(i, codes.length, width, h) })).sort((a, b) => a.depth - b.depth);
  const cx = width / 2;
  const cy = h * 0.6;
  // 气泡挂在说话人头顶（局长在桌首），左右夹在场景里不出界
  const anchor = chiefSpeaking
    ? { x: cx, y: cy - h * 0.24 - fig * 1.18 }
    : (() => {
        const s = seats.find((x) => x.code === speaking);
        if (!s) return undefined;
        const size = fig * (0.86 + s.depth * 0.26);
        return { x: s.x, y: s.y - size * 1.02 + size * (s.depth < 0.45 ? 0.34 : 0.16) };
      })();
  const bw = Math.min(width * 0.62, 340);
  // 字号跟着场景大小走：手机上 12.5px，大屏上更大
  const fs = Math.max(12.5, Math.round(width * 0.026));
  const bLeft = anchor ? Math.max(4, Math.min(width - bw - 4, anchor.x - bw / 2)) : 0;

  const renderSeat = ({ code, x, y, depth }: (typeof seats)[number]) => {
        const tone = speakerTone(code);
        const st = states[code];
        const on = speaking === code;
        const dim = !!speaking && !on;
        const scale = 0.86 + depth * 0.26;
        // 远处的人坐在桌子后面（桌子挡住下半身），近处的人坐在桌子前面
        const sink = depth < 0.45 ? 0.34 : 0.16;
        const size = fig * scale;
        const mood: Mood = done ? "happy" : on ? "talk" : st?.blocked ? "worried" : "idle";
        const badge = st?.marks.length ? KIND_STYLE[st.marks.at(-1)!].icon : st?.blocked && !done ? "⛔" : done ? "✅" : "";
        return (
          <div
            key={code}
            className="absolute"
            style={{ left: x - size / 2, top: y - size * 1.02 + size * sink, width: size, height: size * 1.12, opacity: dim ? 0.42 : 1, zIndex: Math.round(depth * 100), transition: "opacity .3s, transform .3s", transform: on ? "translateY(-3px) scale(1.08)" : undefined }}
          >
            {on && !reduced && <div className="absolute -inset-2 rounded-full" style={{ background: `radial-gradient(closest-side, ${tone.fg}66, transparent)`, animation: "ns-glow 1.2s ease-in-out infinite" }} />}
            <AvatarFigure variant={codeIndex(code) + 1} shirt={tone.fg} mood={mood} reduced={reduced} />
            {/* 头顶：说话的气泡 / 状态标 */}
            {on && cur && (
              <span className="absolute left-1/2 -top-3 rounded-full border border-white/70 bg-white px-1.5 py-px text-[12px] shadow" style={{ animation: reduced ? undefined : "ns-pop .3s cubic-bezier(.2,.8,.2,1) both", transform: reduced ? "translateX(-50%)" : undefined }}>
                {KIND_STYLE[cur.kind].icon}
              </span>
            )}
            {!on && badge && <span className="absolute -right-1 -top-1 text-[13px] drop-shadow">{badge}</span>}
            {/* 桌前的名牌 */}
            <span
              className="font-num absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded-md border px-1.5 font-black"
              style={{ marginTop: -size * 0.12, borderColor: tone.fg, color: tone.fg, background: "rgb(20 16 14 / .85)", fontSize: Math.round(fs * 0.88), lineHeight: 1.4 }}
            >
              {tone.letter}
            </span>
          </div>
        );
  };
  const back = seats.filter((s) => s.depth < 0.45);
  const front = seats.filter((s) => s.depth >= 0.45);

  return (
    <div className="relative mx-auto select-none" style={{ width, height: h }} aria-hidden>
      <style>{CSS}</style>
      {/* 地上的光 */}
      <div className="absolute rounded-[50%]" style={{ left: cx - width * 0.47, top: cy - h * 0.06, width: width * 0.94, height: h * 0.5, background: "radial-gradient(closest-side, rgb(255 190 120 / .14), transparent)" }} />

      {/* 局长（桌首，桌子后面） */}
      <div className="absolute" style={{ left: cx - fig * 0.62, top: cy - h * 0.24 - fig * 1.18, width: fig * 1.24, height: fig * 1.4, opacity: speaking && !chiefSpeaking ? 0.6 : 1, transition: "opacity .3s" }}>
        {chiefSpeaking && !reduced && <div className="absolute -inset-3 rounded-full" style={{ background: "radial-gradient(closest-side, rgb(255 120 90 / .5), transparent)", animation: "ns-glow 1.4s ease-in-out infinite" }} />}
        <AvatarFigure variant={7} shirt="#2b2f3a" mood={chiefSpeaking ? "talk" : done ? "happy" : "idle"} reduced={reduced} chief />
        <span className="absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded-full bg-cinnabar px-2 py-px text-[10px] font-black text-white" style={{ marginTop: -fig * 0.08 }}>
          局长 · 主持
        </span>
      </div>

      {/* 桌子对面的分身（先画，桌子挡住下半身） */}
      {back.map(renderSeat)}

      {/* 桌子：椭圆桌面 + 桌沿 */}
      <div className="absolute rounded-[50%]" style={{ left: cx - width * 0.4, top: cy - h * 0.24 + h * 0.035, width: width * 0.8, height: h * 0.48, background: "#2a1d14" }} />
      <div
        className="absolute rounded-[50%] border border-[#7a5536]/60"
        style={{ left: cx - width * 0.4, top: cy - h * 0.24, width: width * 0.8, height: h * 0.48, background: "radial-gradient(120% 90% at 50% 35%, #8a5e3b, #5c3c25 62%, #3b2616)", boxShadow: "inset 0 2px 10px rgb(255 220 180 / .18), 0 12px 30px rgb(0 0 0 / .45)" }}
      />
      {/* 桌上的方案卡片 / 法槌 */}
      <div className="absolute" style={{ left: cx - width * 0.08, top: cy - h * 0.07, width: width * 0.16, height: h * 0.11 }}>
        <div className="absolute inset-0 rotate-[-6deg] rounded-md border border-white/40 bg-[#f6efe4] shadow" />
        <div className="absolute inset-0 rotate-[5deg] translate-x-2 rounded-md border border-white/40 bg-[#fffaf2] shadow" />
      </div>
      <div className="absolute" style={{ left: cx + width * 0.1, top: cy - h * 0.11, width: width * 0.1, height: width * 0.1, transformOrigin: "20% 80%", animation: gavel && !reduced ? "ns-gavel .7s ease-in-out" : undefined }}>
        <svg viewBox="0 0 40 40" className="h-full w-full">
          <rect x="16" y="14" width="4" height="22" rx="2" fill="#6b4226" transform="rotate(-35 18 25)" />
          <rect x="6" y="6" width="22" height="10" rx="3" fill="#8b5a33" transform="rotate(-35 17 11)" />
        </svg>
      </div>

      {/* 桌子这一侧的分身 */}
      {front.map(renderSeat)}

      {/* 说话人头顶的漫画气泡 */}
      {anchor && bubble && (
        <div className="absolute" style={{ left: bLeft, top: anchor.y, width: bw, zIndex: 300, transform: "translateY(calc(-100% - 6px))" }}>
          <div className="relative rounded-2xl border-2 border-ink bg-[#fffaf2] px-2.5 py-1.5 font-bold leading-snug text-ink shadow-[0_4px_14px_rgb(0_0_0/.35)]" style={{ fontSize: fs }}>
            {bubble.length > 46 ? `${bubble.slice(0, 45)}…` : bubble}
            <span className="absolute -bottom-[7px] size-3 rotate-45 border-b-2 border-r-2 border-ink bg-[#fffaf2]" style={{ left: Math.max(10, Math.min(bw - 22, anchor.x - bLeft - 6)) }} />
          </div>
        </div>
      )}

    </div>
  );
}

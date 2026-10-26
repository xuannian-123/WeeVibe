"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JuState, PrivacySelfTest } from "@/lib/types";
import type { VerifyResult } from "@/components/organizer/api";
import { SealLogo, RotatingText } from "../ui";
import { StampSlam } from "../Stamp";
import { AbstractMap } from "./AbstractMap";
import { Odometer, QrSvg } from "./bits";
import { categoryEmoji, confirmedProposal, dayLabel, focusProposal, slotLabel, trunc } from "./fmt";
import { AuditPanel, ExperienceMatrix, Panel, PrivacyPanel } from "./PlanPanels";
import { BondPanel, SeatingBoard } from "./SeatingPanels";
import { TraceStream } from "./TraceStream";

const STATUS_TEXT: Record<string, string> = {
  collecting: "扫码入局中",
  voting: "投票进行中",
  confirmed: "已盖章成局",
  cancelled: "局已散",
};

/** 发起人在大屏上的隐藏按钮（只有本机存了 admin token 才出现）。动作完成后只刷新公开视图 */
export type ScreenAdmin = {
  seed: () => Promise<void>;
  plan: () => Promise<void>;
  confirm: (proposalId: string) => Promise<void>;
  /** v4：社团团建演示（9 个半生不熟的朋友 + 前两局圈子历史） */
  seedClub?: () => Promise<void>;
  /** v4：局长排座 / 开始下一轮 */
  seat?: () => Promise<void>;
  nextRound?: () => Promise<void>;
  /** v5：冲突演示 / 替被问的演示朋友回答 */
  seedConflict?: () => Promise<void>;
  demoAnswer?: () => Promise<void>;
};

/* ───────── 左上：二维码 + 进度 ───────── */
function QuorumRing({ have, need }: { have: number; need: number }) {
  const r = 82;
  const c = 2 * Math.PI * r;
  const pct = need > 0 ? Math.min(1, have / need) : 0;
  return (
    <svg viewBox="0 0 200 200" className="size-[180px] shrink-0" role="img" aria-label={`${have}/${need}`}>
      <circle cx="100" cy="100" r={r} fill="none" stroke="#2a231f" strokeWidth="18" />
      <circle
        cx="100"
        cy="100"
        r={r}
        fill="none"
        stroke="#e2412e"
        strokeWidth="18"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 100 100)"
        style={{ transition: "stroke-dasharray .8s cubic-bezier(.2,.9,.25,1.1)", filter: "drop-shadow(0 0 10px rgb(226 65 46 / .6))" }}
      />
      <text x="100" y="108" textAnchor="middle" fill="#f3e7d3" fontSize="58" fontWeight="800" style={{ fontFamily: "var(--font-num)" }}>
        {have}
        <tspan fill="#a89a88" fontSize="30">
          /{need}
        </tspan>
      </text>
      <text x="100" y="140" textAnchor="middle" fill="#a89a88" fontSize="16" fontWeight="700">
        人说了来
      </text>
    </svg>
  );
}

function Progress({ state }: { state: JuState }) {
  const { ju, counts, members } = state;
  const q = ju.quorum;
  if (q?.state === "pending") {
    const need = counts.quorumNeed ?? q.min;
    const have = counts.quorumHave ?? 0;
    return (
      <div className="flex-1 rounded-[28px] border-2 border-cinnabar/60 bg-night-2 px-6 py-5">
        <div className="flex items-center gap-4">
          <QuorumRing have={have} need={need} />
          <div className="min-w-0">
            <div className="text-[30px] font-black leading-tight text-cream">还差 {Math.max(0, need - have)} 人</div>
            <div className="mt-1 text-[18px] leading-snug text-cream-faint">凑够 {need} 人才公开成局</div>
          </div>
        </div>
        <p className="mt-3 text-[17px] leading-relaxed text-cream-faint">
          🤫 谁说了来、谁拒绝了，<b className="text-cream">连发起人都看不到</b>。凑不够就悄悄作废。
        </p>
      </div>
    );
  }
  return (
    <div className="flex-1 rounded-[28px] border-2 border-night-line bg-night-2 px-6 py-5">
      <div className="flex items-end gap-3">
        <span className="pb-1 text-[22px] font-bold text-cream-faint">已入局</span>
        <Odometer value={counts.in} className="text-[104px] font-bold text-mustard" />
        <span className="pb-2 text-[22px] font-bold text-cream-faint">
          人{ju.capacity ? <span className="font-num"> / {ju.capacity}</span> : ju.spec.headcount ? <span className="font-num"> / {ju.spec.headcount}</span> : null}
        </span>
      </div>
      <div className="font-num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[18px] text-cream-faint">
        <span>
          <b className="text-cream">{counts.done}</b> 人聊完了
        </span>
        {counts.waitlist > 0 && (
          <span>
            <b className="text-cream">{counts.waitlist}</b> 人候补
          </span>
        )}
        {counts.matchPairs > 0 && (
          <span>
            <b className="text-cinnabar">{counts.matchPairs}</b> 对互选成功 💞
          </span>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {members.map((m) => (
          <span
            key={m.id}
            title={m.name}
            className={`animate-pop-in relative flex size-12 items-center justify-center rounded-full border-2 bg-night-3 text-[26px] ${
              m.intake === "done" ? "border-mustard" : "border-night-line"
            }`}
          >
            {m.avatar}
            {m.intake !== "done" && <span className="absolute -bottom-1 -right-1 rounded-full bg-night px-1 text-[12px]">💬</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────── 中下：推荐理由 / 定局卡 / 回顾 ───────── */
function Recommendation({ state }: { state: JuState }) {
  const plan = state.ju.plan!;
  const p = focusProposal(state.ju);
  return (
    <Panel title="⚖️ 局长为什么这么排" className="shrink-0">
      <p className="text-[21px] font-semibold leading-relaxed text-cream">{plan.recommendation}</p>
      {p?.blurb && <p className="mt-2 border-l-4 border-mustard pl-3 text-[18px] text-cream-faint">“{p.blurb}”</p>}
      {plan.caredFor && (
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-cinnabar/15 px-4 py-2 text-[18px] font-bold text-[#ff8a78]">
          <span>🤝</span>
          {plan.caredFor}
        </div>
      )}
      {plan.constraintSummaries.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {plan.constraintSummaries.slice(0, 4).map((t) => (
            <span key={t} className="rounded-full border border-night-line px-3 py-1 text-[15px] text-cream-faint">
              {t}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ConfirmedCard({ state }: { state: JuState }) {
  const { ju } = state;
  const p = confirmedProposal(ju);
  if (!p) return null;
  const s = ju.settlement;
  const r = ju.reservation;
  return (
    <section className="relative shrink-0 overflow-hidden rounded-[28px] border-2 border-cinnabar/70 bg-night-2 p-6">
      <div className="absolute -right-4 -top-6 opacity-90">
        <StampSlam size={150} play={false} onDark text="定局" />
      </div>
      <div className="font-num text-[34px] font-bold text-mustard">{slotLabel(p.slot)}</div>
      <div className="mt-1 pr-36 text-[32px] font-black leading-tight text-cream">{p.poi.name}</div>
      <div className="mt-1 truncate pr-36 text-[17px] text-cream-faint">{p.poi.address}</div>
      <div className="mt-4 flex flex-wrap gap-3 text-[18px] font-bold">
        <span className="rounded-full bg-night-3 px-4 py-1.5 text-cream">👥 {p.attendCount} 人</span>
        {r && r.status !== "none" && (
          <span className={`rounded-full px-4 py-1.5 ${r.status === "booked" ? "bg-[#3ecf8e] text-night" : "bg-night-3 text-cream"}`}>
            {r.status === "booked" ? `✓ 已订位${r.tableSize ? ` · ${r.tableSize} 位` : ""}` : r.status === "called" ? "📞 已打过电话" : "📝 订位话术已备好"}
          </span>
        )}
        {s && (
          <span className={`font-num rounded-full px-4 py-1.5 ${s.paidCount >= s.payCount ? "bg-[#3ecf8e] text-night" : "bg-mustard text-night"}`}>
            💸 已转 {s.paidCount}/{s.payCount}
          </span>
        )}
      </div>
      {ju.revisions.length > 0 && (
        <p className="mt-3 truncate text-[16px] text-cream-faint">🔄 {ju.revisions.at(-1)!.changes.join("；")}</p>
      )}
    </section>
  );
}

function PhotoWall({ state }: { state: JuState }) {
  const recap = state.ju.recap!;
  const photos = recap.photos.slice(0, 6);
  const slots = photos.length ? photos : ["🍲", "🥂", "📸"];
  return (
    <div className="flex h-full flex-col p-7">
      <div className="mb-5 flex items-baseline gap-3">
        <h3 className="text-[26px] font-black text-cream">📸 局后回顾</h3>
        <span className="text-[17px] text-cream-faint">{recap.photos.length ? `${recap.photos.length} 张照片` : "等大家传照片"}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        {slots.map((src, i) => {
          const isEmoji = !photos.length;
          const pos = [
            [6, 4, -6],
            [38, 0, 4],
            [66, 8, -3],
            [14, 46, 5],
            [46, 42, -4],
            [70, 50, 6],
          ][i];
          return (
            <figure
              key={i}
              className="animate-pop-in absolute w-[34%] rounded-md bg-cream p-2.5 pb-8 shadow-[0_10px_30px_rgb(0_0_0/.45)]"
              style={{ left: `${pos[0]}%`, top: `${pos[1]}%`, transform: `rotate(${pos[2]}deg)`, animationDelay: `${i * 140}ms` }}
            >
              {isEmoji ? (
                <div className="flex aspect-[4/3] items-center justify-center bg-night-3 text-[64px]">{src}</div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt={`照片 ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
              )}
            </figure>
          );
        })}
      </div>
      <blockquote className="mt-4 shrink-0 rounded-2xl border-l-[6px] border-mustard bg-night-3 px-5 py-4 text-[21px] leading-relaxed text-cream">{recap.text}</blockquote>
    </div>
  );
}

/* ───────── 盖章动画 ───────── */
function StampOverlay({ state, kind, onClose }: { state: JuState; kind: "quorum" | "confirmed"; onClose: () => void }) {
  const p = confirmedProposal(state.ju);
  useEffect(() => {
    const t = setTimeout(onClose, kind === "quorum" ? 5000 : 7000);
    return () => clearTimeout(t);
  }, [onClose, kind]);
  if (kind === "quorum") {
    return (
      <button onClick={onClose} aria-label="关闭成局动画" className="animate-fade-in absolute inset-0 z-40 flex flex-col items-center justify-center bg-night/85 backdrop-blur-sm">
        <StampSlam size={420} onDark text="成局" />
        <div className="animate-rise mt-10 text-center" style={{ animationDelay: "800ms" }}>
          <div className="text-[64px] font-black text-cream">人凑够了，局成了！</div>
          <div className="mt-3 text-[26px] text-cream-faint">之前谁说了来、谁拒绝了 —— 这件事永远只有局长知道</div>
        </div>
      </button>
    );
  }
  return (
    <button onClick={onClose} aria-label="关闭定局动画" className="animate-fade-in absolute inset-0 z-40 flex flex-col items-center justify-center bg-night/85 backdrop-blur-sm">
      <StampSlam size={460} onDark text="定局" sub={p ? p.slot.start.slice(0, 10).replace(/-/g, ".") : undefined} />
      <div className="animate-rise mt-10 text-center" style={{ animationDelay: "800ms" }}>
        <div className="font-num text-[44px] font-bold text-mustard">{slotLabel(p?.slot)}</div>
        <div className="mt-2 text-[64px] font-black text-cream">{p?.poi.name}</div>
        <div className="mt-3 text-[24px] text-cream-faint">局长拍的板，任何人都能复算</div>
      </div>
    </button>
  );
}

const PLAN_LINES = ["局长正在掐指一算…", "在帕累托前沿上挑方案…", "核对每个人的通勤…"];

function AdminBar({ state, admin }: { state: JuState; admin: ScreenAdmin }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "出错了");
    } finally {
      setBusy(null);
    }
  };
  const st = state.ju.status;
  const seat = state.ju.seating;
  const rec = state.ju.plan?.proposals.find((p) => p.recommended) ?? state.ju.plan?.proposals[0];
  const btn =
    "max-w-[320px] truncate rounded-full border border-night-line px-4 py-2 text-[15px] font-semibold text-cream-faint transition hover:border-cream-faint hover:text-cream disabled:opacity-40";
  return (
    <div className="flex shrink-0 items-center gap-2 opacity-40 transition-opacity focus-within:opacity-100 hover:opacity-100">
      {err && <span className="max-w-[260px] truncate text-[14px] text-cinnabar">{err}</span>}
      {st === "collecting" && (
        <>
          <button className={btn} disabled={!!busy} onClick={run("seed", admin.seed)}>
            {busy === "seed" ? "拉人中…" : "演示：加入朋友"}
          </button>
          {admin.seedClub && (
            <button className={btn} disabled={!!busy} onClick={run("club", admin.seedClub)}>
              {busy === "club" ? "拉人中…" : "演示：社团 9 人"}
            </button>
          )}
          {admin.seedConflict && (
            <button className={btn} disabled={!!busy} onClick={run("conflict", admin.seedConflict)}>
              {busy === "conflict" ? "拉人中…" : "演示：冲突局"}
            </button>
          )}
          <button className={btn} disabled={!!busy || state.ju.quorum?.state === "pending"} onClick={run("plan", admin.plan)}>
            {busy === "plan" ? <RotatingText lines={PLAN_LINES} /> : "出方案"}
          </button>
        </>
      )}
      {st === "voting" && (state.ju.plan?.diagnosis?.coordinating ?? 0) > 0 && admin.demoAnswer && (
        <button className={btn} disabled={!!busy} onClick={run("answer", admin.demoAnswer)}>
          {busy === "answer" ? "回答中…" : "演示：被问的人说「可以」"}
        </button>
      )}
      {st === "voting" && rec && (
        <button className={btn} disabled={!!busy} onClick={run("confirm", () => admin.confirm(rec.id))}>
          {busy === "confirm" ? "盖章中…" : `拍板：${trunc(rec.poi.name, 10)}`}
        </button>
      )}
      {st === "confirmed" && !seat && admin.seat && (
        <button className={btn} disabled={!!busy} onClick={run("seat", admin.seat)}>
          {busy === "seat" ? "排座中…" : "局长排座"}
        </button>
      )}
      {st === "confirmed" && seat && seat.current < seat.rounds.length && admin.nextRound && (
        <button className={btn} disabled={!!busy} onClick={run("round", admin.nextRound)}>
          {busy === "round" ? "换桌中…" : seat.current < 0 ? "开始第 1 轮" : seat.current + 1 >= seat.rounds.length ? "散场" : `下一轮（第 ${seat.current + 2} 轮）`}
        </button>
      )}
    </div>
  );
}

/* ───────── 主体 ───────── */
export function BigScreen({
  state,
  joinUrl,
  admin,
  selfTest,
  verify,
  playStamp = true,
}: {
  /** 必须是公开视图 */
  state: JuState;
  joinUrl: string;
  admin?: ScreenAdmin;
  selfTest: PrivacySelfTest | null;
  verify?: (id: string) => Promise<VerifyResult>;
  playStamp?: boolean;
}) {
  const { ju } = state;
  const [overlay, setOverlay] = useState<"quorum" | "confirmed" | null>(null);
  const prevStatus = useRef(ju.status);
  const prevQuorum = useRef(ju.quorum?.state);
  const closeOverlay = useCallback(() => setOverlay(null), []);

  // 只在"眼看着"成局 / 定局时砸章；刷新页面时不重播
  useEffect(() => {
    if (playStamp && prevStatus.current !== "confirmed" && ju.status === "confirmed") setOverlay("confirmed");
    else if (playStamp && prevQuorum.current === "pending" && ju.quorum?.state === "met") setOverlay("quorum");
    prevStatus.current = ju.status;
    prevQuorum.current = ju.quorum?.state;
  }, [ju.status, ju.quorum?.state, playStamp]);

  const s = ju.spec;
  const chips = [
    s.dates?.length ? `📅 ${s.dates.map((d) => dayLabel(d)).join("、")}` : null,
    s.earliest && s.latest ? `⏰ ${s.earliest}–${s.latest}` : null,
    s.budgetPerPerson ? `💰 人均 ≤${s.budgetPerPerson}` : null,
  ].filter(Boolean) as string[];

  const collecting = ju.status === "collecting";
  const hasPlan = !!ju.plan && (ju.status === "voting" || ju.status === "confirmed");
  // v4：定局并排了座，现场最要紧的是"这一轮坐哪"和"大家熟起来了多少"
  const seating = ju.status === "confirmed" && !!ju.seating?.rounds.length;

  return (
    <div className="relative h-full w-full overflow-hidden bg-night text-cream">
      <div aria-hidden className="pointer-events-none absolute -left-40 -top-40 size-[700px] rounded-full" style={{ background: "radial-gradient(circle, rgb(226 65 46 / .16), transparent 65%)" }} />
      <div aria-hidden className="pointer-events-none absolute -bottom-60 right-20 size-[800px] rounded-full" style={{ background: "radial-gradient(circle, rgb(242 181 48 / .09), transparent 65%)" }} />

      {/* 头部 */}
      <header className="relative flex h-[140px] items-center gap-6 px-12">
        <SealLogo size={74} dark />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-3 text-[21px] font-bold text-cream-faint">
            <span>AI 局长</span>
            <span className="text-night-line">/</span>
            <span>
              {categoryEmoji(s.category)} {s.category}
            </span>
            {chips.map((c) => (
              <span key={c} className="font-num rounded-lg bg-night-3 px-3 py-0.5 text-[18px]">
                {c}
              </span>
            ))}
          </div>
          <h1 className="truncate text-[56px] font-black leading-tight tracking-tight">{ju.title}</h1>
        </div>
        {admin && <AdminBar state={state} admin={admin} />}
        {!collecting && ju.status !== "cancelled" && joinUrl && (
          <div className="flex shrink-0 items-center gap-3 rounded-2xl bg-cream py-2 pl-2 pr-4">
            <QrSvg text={joinUrl} className="size-[92px]" />
            <span className="text-[18px] font-black leading-tight text-night">
              扫码
              <br />
              看方案
            </span>
          </div>
        )}
        <div
          className={`flex shrink-0 items-center gap-3 rounded-full px-6 py-3 text-[24px] font-black ${
            ju.status === "confirmed" ? "bg-cinnabar text-white" : ju.status === "voting" ? "bg-mustard text-night" : "border-2 border-night-line"
          }`}
        >
          {collecting && <span className="size-3.5 animate-pulse rounded-full bg-cinnabar" />}
          {ju.quorum?.state === "pending" && collecting ? "悄悄凑人中" : (STATUS_TEXT[ju.status] ?? ju.status)}
        </div>
      </header>

      {ju.status === "cancelled" ? (
        <div className="relative flex h-[900px] flex-col items-center justify-center gap-6 text-center">
          <span className="text-[120px]">🍃</span>
          <p className="text-[56px] font-black">这次没凑成，局长悄悄散了</p>
          <p className="text-[28px] text-cream-faint">谁说了来、谁没来，没有人知道。下次再约。</p>
        </div>
      ) : collecting ? (
        <div className="relative grid h-[900px] grid-cols-[420px_minmax(0,1fr)_600px] gap-7 px-12 pb-10">
          <div className="flex min-h-0 flex-col gap-6">
            <div className="rounded-[28px] bg-cream p-6 shadow-[0_0_60px_rgb(242_181_48/.18)]">
              <QrSvg text={joinUrl} className="aspect-square w-full" />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-[36px] font-black text-night">扫码入局</span>
                <span className="rounded-lg bg-cinnabar px-3 py-1 text-[16px] font-bold text-white">私聊局长</span>
              </div>
            </div>
            <Progress state={state} />
          </div>
          <MapBox state={state} />
          <div className="flex min-h-0 flex-col gap-6">
            <Panel title="🧠 局长在想什么" right="实时" className="flex-1">
              <TraceStream trace={ju.trace} />
            </Panel>
            <PrivacyPanel state={state} test={selfTest} className="shrink-0" />
          </div>
        </div>
      ) : (
        <div className="relative grid h-[900px] grid-cols-[440px_minmax(0,1fr)_720px] gap-7 px-12 pb-10">
          <div className="flex min-h-0 flex-col gap-6">
            <Panel title="🧠 局长在想什么" className="flex-1">
              <TraceStream trace={ju.trace} size="md" max={10} />
            </Panel>
            <PrivacyPanel state={state} test={selfTest} className="shrink-0" />
          </div>
          <div className="flex min-h-0 flex-col gap-6">
            {ju.recap ? (
              <div className="dot-grid-night relative min-h-0 flex-1 overflow-hidden rounded-[28px] border-2 border-night-line bg-night-2">
                <PhotoWall state={state} />
              </div>
            ) : seating ? (
              <SeatingBoard state={state} />
            ) : (
              <MapBox state={state} />
            )}
            {ju.status === "confirmed" ? <ConfirmedCard state={state} /> : hasPlan && <Recommendation state={state} />}
          </div>
          <div className="flex min-h-0 flex-col gap-6">
            {seating ? (
              <BondPanel state={state} className="flex-1" />
            ) : (
              <>
                {hasPlan && (
                  <Panel title="👥 每个人 × 每个方案" right="公开满意度 · 只由通勤和时段算出" className="flex-1">
                    <ExperienceMatrix state={state} />
                  </Panel>
                )}
                {hasPlan && <AuditPanel state={state} verify={verify} className="shrink-0" />}
              </>
            )}
          </div>
        </div>
      )}

      {overlay && <StampOverlay state={state} kind={overlay} onClose={closeOverlay} />}
    </div>
  );
}

function MapBox({ state }: { state: JuState }) {
  const { ju } = state;
  const pending = ju.quorum?.state === "pending";
  return (
    <div className="dot-grid-night relative min-h-0 flex-1 overflow-hidden rounded-[28px] border-2 border-night-line bg-night-2">
      <AbstractMap state={state} />
      <div className="absolute left-7 top-6 text-[22px] font-black text-cream">🗺️ 谁从哪来{ju.plan ? " · 去哪最公平" : ""}</div>
      {pending && (
        <div className="absolute inset-x-7 bottom-16 rounded-2xl border border-night-line bg-night/80 px-5 py-3 text-[18px] text-cream-faint">
          凑够人之前，地图上只有发起人 —— 谁在局里，现在谁也不知道。
        </div>
      )}
      <div className="absolute bottom-5 left-7 flex gap-5 text-[15px] text-cream-faint">
        <span>
          <span className="text-mustard">●</span> 成员
        </span>
        {ju.plan && (
          <>
            <span>
              <span className="text-cinnabar">◆</span> 候选店
            </span>
            <span>
              <span className="text-mustard">◎</span> 公平中心
            </span>
          </>
        )}
        <span className="opacity-70">抽象地图 · 非真实比例</span>
      </div>
    </div>
  );
}

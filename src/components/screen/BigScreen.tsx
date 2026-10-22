"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JuState, Member } from "@/lib/types";
import {
  activeMembers,
  dayLabel,
  groupSlots,
  leadingOption,
  mostVoted,
  shortPlace,
  slotCounts,
  slotLabel,
  slotTime,
  specChips,
  voteTally,
} from "@/lib/client/format";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { SealLogo, RotatingText } from "../ui";
import { StampSlam } from "../Stamp";
import { toast } from "../toast";
import { categoryEmoji } from "../ju/JuHeader";
import { AbstractMap } from "./AbstractMap";
import { Odometer, QrSvg } from "./bits";

const STATUS_TEXT: Record<string, string> = {
  collecting: "扫码入局中",
  voting: "投票进行中",
  confirmed: "已盖章成局",
  cancelled: "局已散",
};

function Panel({ title, right, children, className = "" }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-[28px] border-2 border-night-line bg-night-2 p-7 ${className}`}>
      <div className="mb-5 flex items-baseline justify-between">
        <h3 className="text-[26px] font-black text-cream">{title}</h3>
        {right && <span className="text-[18px] text-cream-faint">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function SlotHeat({ state, compact }: { state: JuState; compact?: boolean }) {
  const counts = slotCounts(state);
  const max = Math.max(1, ...Object.values(counts));
  const best = state.ju.plan?.slotId ?? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const groups = groupSlots(state.ju.slots);
  const n = activeMembers(state).length;
  return (
    <Panel title="⏰ 时间热力" right={n ? `${n} 人投了时间` : "等人填"}>
      <div className={compact ? "space-y-3" : "space-y-4"}>
        {groups.map((g) => (
          <div key={g.date}>
            <div className="font-num mb-2 text-[18px] font-bold text-cream-faint">{dayLabel(g.date)}</div>
            <div className="grid grid-cols-6 gap-2">
              {g.slots.map((s) => {
                const c = counts[s.id] ?? 0;
                const isBest = s.id === best && c > 0;
                return (
                  <div
                    key={s.id}
                    className={`font-num relative flex flex-col items-center justify-center rounded-xl ${compact ? "h-[56px]" : "h-[70px]"}`}
                    style={{
                      background: c ? `rgb(242 181 48 / ${0.12 + 0.88 * (c / max)})` : "#2a231f",
                      color: c / max > 0.5 ? "#14110f" : "#f3e7d3",
                      outline: isBest ? "3px solid #e2412e" : undefined,
                      outlineOffset: 2,
                      boxShadow: isBest ? "0 0 22px rgb(226 65 46 / .55)" : undefined,
                      transition: "background .5s",
                    }}
                  >
                    <span className={`${compact ? "text-[21px]" : "text-[26px]"} font-bold leading-none`}>{c}</span>
                    <span className="mt-1 text-[13px] font-semibold opacity-80">{slotTime(s)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DietRadar({ state }: { state: JuState }) {
  const members = activeMembers(state);
  const counts = new Map<string, number>();
  for (const m of members) for (const t of m.dietTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  const recent = [...members].sort((a, b) => b.joinedAt.localeCompare(a.joinedAt)).slice(0, 4);
  return (
    <Panel title="📡 实时动态" className="flex-1">
      <div className="mb-5 flex flex-wrap gap-2.5">
        {counts.size === 0 ? (
          <span className="text-[18px] text-cream-faint">暂无忌口，百无禁忌 🍻</span>
        ) : (
          [...counts.entries()].map(([t, c]) => (
            <span key={t} className="rounded-full border-2 border-cinnabar px-4 py-1.5 text-[18px] font-bold text-cinnabar">
              {t} <span className="font-num">×{c}</span>
            </span>
          ))
        )}
      </div>
      <ul className="space-y-3">
        {recent.map((m) => (
          <li key={m.id} className="animate-rise flex items-center gap-3 text-[19px] text-cream">
            <span className="text-[28px]">{m.avatar}</span>
            <b>{m.name}</b>
            <span className="truncate text-cream-faint">从 {shortPlace(m.location.label, 12)} 出发</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function VoteBoard({ state }: { state: JuState }) {
  const { ju } = state;
  const plan = ju.plan!;
  const tally = voteTally(ju);
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const total = Math.max(1, plan.attendeeIds.length);
  const voted = Object.keys(ju.votes ?? {}).length;
  return (
    <Panel title="🗳️ 实时投票" right={<span className="font-num">{voted}/{plan.attendeeIds.length} 已投</span>} className="flex-1">
      <div className="space-y-5">
        {plan.options.map((o, i) => {
          const voters = (tally[o.poi.id] ?? []).map((id) => byId.get(id)).filter(Boolean) as Member[];
          const pct = (voters.length / total) * 100;
          const lead = mostVoted(ju)?.poi.id === o.poi.id && voters.length > 0;
          return (
            <div key={o.poi.id}>
              <div className="mb-2 flex items-center gap-3">
                <span
                  className={`font-num flex size-10 shrink-0 -rotate-6 items-center justify-center rounded-lg text-[20px] font-bold ${
                    i === 0 ? "bg-cinnabar text-white" : "border-2 border-night-line text-cream"
                  }`}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[23px] font-black text-cream">{o.poi.name}</span>
                <span className="font-num text-[38px] font-bold leading-none text-mustard">{voters.length}</span>
              </div>
              <div className="font-num mb-2 flex gap-4 pl-[52px] text-[16px] text-cream-faint">
                {o.poi.costPerPerson != null && <span>¥{o.poi.costPerPerson}/人</span>}
                {o.poi.rating != null && <span>★{o.poi.rating.toFixed(1)}</span>}
                <span>最远 {o.maxCommute}′</span>
                {o.conflicts.length > 0 && <span className="text-cinnabar">⚠ {o.conflicts.length} 处忌口</span>}
              </div>
              <div className="relative ml-[52px] h-[30px] overflow-hidden rounded-full bg-night-3">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.max(pct, voters.length ? 6 : 0)}%`,
                    background: lead ? "#e2412e" : "#f2b530",
                    boxShadow: lead ? "0 0 20px rgb(226 65 46 / .6)" : undefined,
                    transition: "width .7s cubic-bezier(.2,.9,.25,1.1)",
                  }}
                />
                <div className="absolute inset-y-0 left-3 flex items-center gap-0.5 text-[20px]">
                  {voters.map((m) => (
                    <span key={m.id} className="animate-pop-in">
                      {m.avatar}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ConfirmedCard({ state }: { state: JuState }) {
  const { ju } = state;
  const opt = leadingOption(ju);
  if (!opt) return null;
  return (
    <Panel title="✅ 定局" className="relative flex-1 overflow-hidden">
      <div className="absolute -right-6 -top-4 opacity-90">
        <StampSlam size={170} play={false} onDark />
      </div>
      <div className="font-num mb-3 text-[40px] font-bold text-mustard">{slotLabel(ju, ju.plan?.slotId)}</div>
      <div className="mb-2 pr-32 text-[36px] font-black leading-tight text-cream">{opt.poi.name}</div>
      <div className="mb-5 text-[18px] text-cream-faint">{opt.poi.address}</div>
      {opt.blurb && <p className="border-l-4 border-mustard pl-4 text-[20px] leading-relaxed text-cream">“{opt.blurb}”</p>}
    </Panel>
  );
}

function StampOverlay({ state, onClose }: { state: JuState; onClose: () => void }) {
  const opt = leadingOption(state.ju);
  const slot = state.ju.slots.find((s) => s.id === state.ju.plan?.slotId);
  useEffect(() => {
    const t = setTimeout(onClose, 7000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <button
      onClick={onClose}
      aria-label="关闭定局动画"
      className="animate-fade-in absolute inset-0 z-40 flex flex-col items-center justify-center bg-night/85 backdrop-blur-sm"
    >
      <StampSlam size={480} onDark sub={slot ? slot.start.slice(0, 10).replace(/-/g, ".") : undefined} />
      <div className="animate-rise mt-10 text-center" style={{ animationDelay: "800ms" }}>
        <div className="font-num text-[44px] font-bold text-mustard">{slotLabel(state.ju, state.ju.plan?.slotId)}</div>
        <div className="mt-2 text-[64px] font-black text-cream">{opt?.poi.name}</div>
      </div>
    </button>
  );
}

const PLAN_LINES = ["局长正在掐指一算…", "寻找对所有人最公平的点…", "翻遍附近的店…", "核对忌口…"];

function AdminBar({ state, actions }: { state: JuState; actions: JuActions }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = (key: string, fn: () => Promise<void>) => async () => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };
  const st = state.ju.status;
  const btn =
    "max-w-[340px] truncate rounded-full border border-night-line px-4 py-2 text-[15px] font-semibold text-cream-faint transition hover:border-cream-faint hover:text-cream disabled:opacity-40";
  return (
    <div className="flex shrink-0 gap-2 opacity-45 transition-opacity hover:opacity-100 focus-within:opacity-100">
      {st === "collecting" && (
        <>
          <button className={btn} disabled={!!busy} onClick={run("seed", () => actions.seed(6))}>
            {busy === "seed" ? "拉人中…" : "演示：加入 6 位朋友"}
          </button>
          <button className={btn} disabled={!!busy} onClick={run("plan", actions.plan)}>
            {busy === "plan" ? <RotatingText lines={PLAN_LINES} /> : "出方案"}
          </button>
        </>
      )}
      {st === "voting" && (
        <button
          className={btn}
          disabled={!!busy}
          onClick={run("confirm", async () => {
            const o = mostVoted(state.ju);
            if (o) await actions.confirm(o.poi.id);
          })}
        >
          {busy === "confirm" ? "盖章中…" : `拍板：${mostVoted(state.ju)?.poi.name ?? ""}`}
        </button>
      )}
    </div>
  );
}

export function BigScreen({
  state,
  isAdmin,
  actions,
  joinUrl,
  playStamp = true,
}: {
  state: JuState;
  isAdmin: boolean;
  actions: JuActions;
  joinUrl: string;
  playStamp?: boolean;
}) {
  const { ju } = state;
  const members = activeMembers(state);
  const [overlay, setOverlay] = useState(false);
  const stampShown = useRef(false);
  const closeOverlay = useCallback(() => setOverlay(false), []);

  useEffect(() => {
    if (ju.status === "confirmed" && !stampShown.current && playStamp) {
      stampShown.current = true;
      setOverlay(true);
    }
  }, [ju.status, playStamp]);

  const chips = useMemo(() => specChips(ju).filter((c) => c.icon !== "📍"), [ju]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-night text-cream">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 -top-40 size-[700px] rounded-full"
        style={{ background: "radial-gradient(circle, rgb(226 65 46 / .16), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-60 right-20 size-[800px] rounded-full"
        style={{ background: "radial-gradient(circle, rgb(242 181 48 / .09), transparent 65%)" }}
      />

      {/* 头部 */}
      <header className="relative flex h-[150px] items-center gap-7 px-12">
        <SealLogo size={78} dark />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-4 text-[22px] font-bold text-cream-faint">
            <span>AI 局长</span>
            <span className="text-night-line">/</span>
            <span>
              {categoryEmoji(ju.spec.category)} {ju.spec.category}
            </span>
            {chips.map((c) => (
              <span key={c.icon} className="font-num rounded-lg bg-night-3 px-3 py-0.5 text-[19px]">
                {c.icon} {c.text}
              </span>
            ))}
          </div>
          <h1 className="truncate text-[60px] font-black leading-tight tracking-tight">{ju.title}</h1>
        </div>
        {isAdmin && <AdminBar state={state} actions={actions} />}
        <div
          className={`flex shrink-0 items-center gap-3 rounded-full px-7 py-3 text-[26px] font-black ${
            ju.status === "confirmed" ? "bg-cinnabar text-white" : ju.status === "voting" ? "bg-mustard text-night" : "border-2 border-night-line"
          }`}
        >
          {ju.status === "collecting" && <span className="size-3.5 animate-pulse rounded-full bg-cinnabar" />}
          {STATUS_TEXT[ju.status] ?? ju.status}
        </div>
      </header>

      {/* 主体 */}
      <div className="relative grid h-[880px] grid-cols-[440px_760px_560px] gap-8 px-12 pb-12">
        {/* 左：二维码 + 人数 */}
        <div className="flex flex-col gap-6">
          <div className="rounded-[28px] bg-cream p-7 shadow-[0_0_60px_rgb(242_181_48/.18)]">
            <QrSvg text={joinUrl} className="aspect-square w-full" />
            <div className="mt-5 flex items-center justify-between">
              <span className="text-[40px] font-black text-night">扫码入局</span>
              <span className="rounded-lg bg-cinnabar px-3 py-1 text-[17px] font-bold text-white">10 秒填完</span>
            </div>
          </div>
          <div className="flex-1 rounded-[28px] border-2 border-night-line bg-night-2 px-7 py-6">
            <div className="flex items-end gap-3">
              <span className="text-[24px] font-bold text-cream-faint">已入局</span>
              <Odometer value={members.length} className="text-[120px] font-bold text-mustard" />
              <span className="pb-2 text-[24px] font-bold text-cream-faint">
                人{ju.spec.headcount ? <span className="font-num"> / {ju.spec.headcount}</span> : null}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {members.map((m) => (
                <span key={m.id} className="animate-pop-in flex size-12 items-center justify-center rounded-full border-2 border-night-line bg-night-3 text-[26px]" title={m.name}>
                  {m.avatar}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* 中：抽象地图 */}
        <div className="dot-grid-night relative overflow-hidden rounded-[28px] border-2 border-night-line bg-night-2">
          <AbstractMap state={state} />
          <div className="absolute left-7 top-6 text-[22px] font-black text-cream">
            🗺️ 谁从哪来{ju.plan ? " · 去哪最公平" : ""}
          </div>
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

        {/* 右：时间热力 + 方案 */}
        <div className="flex min-h-0 flex-col gap-6">
          <SlotHeat state={state} compact={ju.status !== "collecting"} />
          {ju.status === "collecting" && <DietRadar state={state} />}
          {ju.status === "voting" && ju.plan && <VoteBoard state={state} />}
          {ju.status === "confirmed" && <ConfirmedCard state={state} />}
        </div>
      </div>

      {overlay && <StampOverlay state={state} onClose={closeOverlay} />}
    </div>
  );
}

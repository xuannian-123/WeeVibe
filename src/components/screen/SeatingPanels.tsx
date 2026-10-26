"use client";

// v4 大屏：局内编排。座位板（当前这一轮每桌坐谁、玩什么、话题卡）+ 关系升级（聚合数字 + 圈子时间线 + 可复核）。
// 大屏只吃公开视图：座位本来就是现场看得见的，其余全是对数，没有"谁和谁熟"。
import { useEffect, useState } from "react";
import type { JuState, Seating } from "@/lib/types";
import { organizerApi, type VerifyResult } from "@/components/organizer/api";
import { CircleBars, useCircle } from "@/components/ju/Social";
import { Odometer } from "./bits";
import { Panel } from "./PlanPanels";

const tableNo = (id: string) => Number(id.split("t").at(-1)) + 1;

function shownRound(s: Seating): number {
  if (s.current < 0) return 0;
  return Math.min(s.current, s.rounds.length - 1);
}

export function SeatingBoard({ state }: { state: JuState }) {
  const s = state.ju.seating;
  if (!s || !s.rounds.length) return null;
  const idx = shownRound(s);
  const r = s.rounds[idx];
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const finished = s.current >= s.rounds.length;
  const cols = r.tables.length === 1 ? "grid-cols-1" : r.tables.length === 2 || r.tables.length === 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className="dot-grid-night relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border-2 border-night-line bg-night-2 p-7">
      <div className="mb-3 flex shrink-0 items-center gap-4">
        <h3 className="min-w-0 truncate whitespace-nowrap text-[28px] font-black text-cream">💺 第 {idx + 1} 轮「{r.format.name}」</h3>
        <span
          className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1 text-[18px] font-black ${
            r.status === "live" ? "bg-cinnabar text-white" : finished ? "bg-[#3ecf8e] text-night" : "border-2 border-night-line text-cream-faint"
          }`}
        >
          {r.status === "live" ? "● 进行中" : finished ? "全部结束" : "即将开始"}
        </span>
        <span className="ml-auto shrink-0 whitespace-nowrap font-num text-[18px] text-cream-faint">
          {s.rounds.length} 轮 · {r.tables.length} 桌
        </span>
      </div>
      <p className="mb-3 line-clamp-2 shrink-0 text-[19px] leading-snug text-cream-faint">{r.format.how}</p>
      {r.adjust && <p className="mb-4 line-clamp-2 shrink-0 rounded-2xl border-l-[6px] border-mustard bg-night-3 px-5 py-3 text-[19px] leading-snug text-cream">🧭 {r.adjust}</p>}
      <div className={`grid min-h-0 flex-1 content-start gap-4 overflow-hidden ${cols}`}>
        {r.tables.map((t) => (
          <div key={t.id} className="flex flex-col rounded-2xl border-2 border-night-line bg-night/70 p-4">
            <div className="mb-2 text-[18px] font-black text-mustard">{tableNo(t.id)} 号桌</div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {t.memberIds.map((id) => {
                const m = byId.get(id);
                return m ? (
                  <span key={id} className="inline-flex items-center gap-2 text-[22px] font-bold text-cream">
                    <span className="text-[30px] leading-none" aria-hidden>
                      {m.avatar}
                    </span>
                    {m.name}
                  </span>
                ) : null;
              })}
            </div>
            {t.topics.length > 0 && (
              <ul className="mt-3 space-y-0.5 border-t border-dashed border-night-line pt-2">
                {t.topics.slice(0, 2).map((x) => (
                  <li key={x} className="line-clamp-2 text-[15px] leading-snug text-cream-faint">
                    💬 {x}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function shortHash(h: string, n = 16) {
  return h.length > n ? `${h.slice(0, n)}…` : h;
}

export function BondPanel({ state, className = "" }: { state: JuState; className?: string }) {
  const s = state.ju.seating;
  const steps = useCircle(state);
  const [v, setV] = useState<VerifyResult | null>(null);
  const id = state.ju.id;
  const version = s?.version;
  useEffect(() => {
    if (!version) return;
    let alive = true;
    setV(null);
    const t = setTimeout(() => {
      organizerApi
        .verifySeating(id)
        .then((r) => alive && setV(r))
        .catch(() => {});
    }, 900);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id, version]);
  if (!s) return null;
  const m = s.metrics;
  const lastDone = [...s.rounds].reverse().find((r) => r.status === "done" && r.feedback);
  return (
    <Panel title="🌱 关系升级" right="只统计对数，不看谁和谁" className={className}>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["本来就认识", m.knownBefore, "text-cream"],
          ["这次新认识", m.newPairs, "text-mustard"],
          ["一共", m.pairs, "text-cream-faint"],
        ].map(([l, n, cls]) => (
          <div key={String(l)} className="rounded-2xl bg-night-3 px-3 py-2">
            <Odometer value={Number(n)} className={`text-[36px] font-bold ${cls}`} />
            <div className="mt-0.5 text-[14px] text-cream-faint">{l} · 对</div>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-[17px] text-cream">
        {m.everyoneAnchored && <li>✓ 第一轮每个人桌上都有认识的人</li>}
        {m.matchPairs > 0 && (
          <li>
            ✓ 互相想认识的 {m.matchPairs} 对，{m.matchesSeated} 对已同桌
          </li>
        )}
        <li className="text-cream-faint">🤫 悄悄的要求藏在 {m.neverTogether} 对“从没同桌”里，旁人分不出来</li>
        {lastDone?.feedback && (
          <li className="font-num text-cream-faint">
            第 {lastDone.index + 1} 轮私下反馈：😶 {lastDone.feedback.stiff} · 🙂 {lastDone.feedback.ok} · 🔊 {lastDone.feedback.loud}
          </li>
        )}
      </ul>
      {steps.length >= 2 && (
        <div className="mt-4 border-t-2 border-dashed border-night-line pt-3">
          <div className="mb-2 text-[18px] font-black text-cream">这个圈子，一局比一局熟</div>
          <CircleBars steps={steps} dark />
        </div>
      )}
      <dl className="font-num mt-4 space-y-1 border-t-2 border-dashed border-night-line pt-3 text-[15px]">
        <div className="flex gap-3">
          <dt className="w-[88px] shrink-0 text-cream-faint">座位哈希</dt>
          <dd className="truncate text-cream">{shortHash(s.audit.outputHash, 24)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[88px] shrink-0 text-cream-faint">复算</dt>
          <dd className={v ? (v.ok ? "text-[#3ecf8e]" : "text-cinnabar") : "text-cream-faint"}>
            {v ? (v.ok ? "✓ 一致：同样的输入一定得到同样的座位" : "✗ 不一致") : "复算中…"}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

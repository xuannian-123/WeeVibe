"use client";

// v5 决定书的界面部分（docs/DECISION.md 第 7 节）：
// - NeedsChecklist：你跟局长说的每一条，在这个方案里 ✓ 满足 / △ 部分满足 / ✗ 没满足 / ? 不确定（只给本人）
// - RisksList：会在现场翻车的风险 + 每条的应对办法 + 室内备案（公开）
// - DecisionCard：定局后的"为什么 + 注意事项 + 我的待办"
import type { JuState, Member, NeedResult, Proposal } from "@/lib/types";
import { decisionOf } from "@/lib/decision";
import { LockNote } from "../ui";

const MARK: Record<NeedResult["result"], { icon: string; cls: string; label: string }> = {
  met: { icon: "✓", cls: "bg-jade text-white", label: "满足" },
  partial: { icon: "△", cls: "bg-mustard text-ink", label: "部分满足" },
  unmet: { icon: "✗", cls: "bg-cinnabar text-white", label: "没满足" },
  unknown: { icon: "?", cls: "bg-paper-deep text-ink-soft", label: "不确定" },
  noted: { icon: "·", cls: "bg-paper-deep text-ink-soft", label: "记下了" },
};

export function NeedsChecklist({ needs, title = "你跟局长说的" }: { needs: NeedResult[]; title?: string }) {
  if (!needs.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-black">{title}</div>
      <ul className="space-y-1">
        {needs.map((n, i) => {
          const m = MARK[n.result];
          return (
            <li key={`${n.text}-${i}`} className="flex items-start gap-2 text-[13px] leading-snug">
              <span aria-label={m.label} className={`mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-black ${m.cls}`}>
                {m.icon}
              </span>
              <span className="min-w-0 flex-1">
                <b className="font-bold">{n.text}</b>
                {n.detail && <span className="text-ink-soft"> —— {n.detail}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function RisksList({ p }: { p: Proposal }) {
  const risks = p.risks ?? [];
  if (!risks.length && !p.fallback) return null;
  return (
    <div className="rounded-lg border-2 border-ink bg-paper px-3 py-2">
      <div className="mb-1 text-[13px] font-black">⚠️ 注意</div>
      <ul className="space-y-1">
        {risks.map((r) => (
          <li key={r.text} className="text-[13px] leading-snug">
            <span className="font-semibold">{r.text}</span>
            <span className="text-ink-soft"> → {r.mitigation}</span>
          </li>
        ))}
        {p.fallback && (
          <li className="text-[13px] leading-snug">
            <span className="font-semibold">☂️ 备案</span>
            <span className="text-ink-soft">
              {" "}
              → 如果{p.fallback.trigger}，改去「{p.fallback.poi.name}」
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

/** 定局后：为什么 + 注意事项 + 大家要做的 + 你跟局长说的每一条 */
export function DecisionCard({ state, me }: { state: JuState; me: Member | null }) {
  const d = decisionOf(state.ju);
  if (!d || !d.final) return null;
  const mine = me ? state.mine?.experiences.find((x) => x.proposalId === d.proposal.id) : undefined;
  return (
    <section className="sticker space-y-3 p-4" data-tour="decision">
      <div>
        <h3 className="text-lg font-black">局长为什么这么定</h3>
        <ul className="mt-1 space-y-0.5">
          {d.why.map((w) => (
            <li key={w} className="flex gap-2 text-[14px]">
              <span className="font-black text-jade">✓</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </div>
      {state.ju.weatherAlert && (
        <p className="rounded-lg bg-paper-deep px-3 py-2 text-[13px]">
          🌦️ 局长刚复查了天气：{state.ju.weatherAlert.label}
          {state.ju.weatherAlert.text}
          {state.ju.weatherAlert.switched ? "，已经换到室内" : state.ju.weatherAlert.kind === "light" || state.ju.weatherAlert.kind === "heavy" ? "，记得带伞" : "，放心出发"}
        </p>
      )}
      <RisksList p={d.proposal} />
      {d.groupActions.length > 0 && (
        <p className="text-[13.5px]">
          <b>大家记得：</b>
          {d.groupActions.join("；")}
        </p>
      )}
      {mine?.needs?.length ? (
        <div className="border-t-2 border-dashed border-line pt-3">
          <div className="mb-1 flex items-center gap-2">
            <span className="flex-1" />
            <LockNote>只有你看得到</LockNote>
          </div>
          <NeedsChecklist needs={mine.needs} />
          {mine.cared === false && (
            <p className="mt-2 rounded-lg bg-mustard-soft px-3 py-2 text-[13px] leading-relaxed">
              {/* 有档案才有跨局记忆（公平账本），没档案就不许诺"下次" */}
              {me?.profileId ? "这次没能把你照顾好，局长记下了：下次排方案，你会被优先照顾。" : "这次没能把你照顾好，局长很抱歉。"}
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

"use client";

// v5 决定书的界面部分（docs/DECISION.md 第 7 节）：
// - NeedsChecklist：你跟局长说的每一条，在这个方案里 ✓ 满足 / △ 部分满足 / ✗ 没满足 / ? 不确定（只给本人）
// - RisksList：会在现场翻车的风险 + 每条的应对办法 + 室内备案（公开）
// - DecisionCard：定局后的"为什么 + 注意事项 + 我的待办"
// v6：
// - SegmentsTimeline：两段式方案的时间线（"15:00 攀岩 → 步行 6 分钟 → 18:00 家常菜，21:00 前结束"）
// - MyDeal：决定书里的逐人解释 —— 你得到了什么 / 你的分身替你让了什么 / 为什么（只用本人的 avatarLog + mine）
import type { JuState, Member, NeedResult, Proposal } from "@/lib/types";
import { decisionOf } from "@/lib/decision";
import type { JuActions } from "@/lib/client/useJu";
import { LockNote } from "../ui";
import { avatarCall, explainForMe, segmentTimeline } from "../screen/negotiation";
import { AvatarLogRow, useAvatarName, useNow, useRevoke } from "./AvatarLog";

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

/** v6 两段式时间线；一段时返回 null（界面照旧显示时间 + 店名） */
export function SegmentsTimeline({ p, dark }: { p: Proposal; dark?: boolean }) {
  const tl = segmentTimeline(p.segments);
  if (!tl) return null;
  const faint = dark ? "text-cream-faint" : "text-ink-soft";
  return (
    <ol className="relative mt-1 space-y-1" aria-label="两段式行程">
      <span aria-hidden className={`absolute bottom-12 left-[15px] top-4 w-0 border-l-2 border-dashed ${dark ? "border-cream-faint/50" : "border-ink/30"}`} />
      {tl.items.map((x, i) =>
        x.t === "seg" ? (
          <li key={i} className="relative flex items-start gap-2.5">
            <span className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[16px] ${dark ? "border-mustard bg-night-3" : "border-ink bg-card"}`} aria-hidden>
              {x.emoji}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={`font-num text-[20px] font-bold ${dark ? "text-mustard" : ""}`}>{x.time}</span>
                <span className="text-[18px] font-black">{x.name}</span>
              </div>
              <div className={`truncate text-[13px] font-semibold ${faint}`}>@ {x.poi}</div>
            </div>
          </li>
        ) : (
          <li key={i} className={`relative flex items-center gap-2.5 pl-[7px] text-[12.5px] font-bold ${faint}`}>
            <span className="z-10 text-[13px]" aria-hidden>
              🚶
            </span>
            {x.minutes <= 25 ? `步行 ${x.minutes} 分钟` : `路上约 ${x.minutes} 分钟`}
          </li>
        ),
      )}
      <li className={`font-num pl-[42px] text-[13px] font-bold ${faint}`}>{tl.endsAt} 前结束</li>
    </ol>
  );
}

/** v6 逐人解释：你得到了什么 / 你的分身替你让了什么 / 为什么（只给本人） */
export function MyDeal({ state, me, actions, p }: { state: JuState; me: Member; actions?: JuActions; p: Proposal }) {
  const name = useAvatarName(me);
  const now = useNow();
  const revoke = useRevoke(state.ju.id, actions ?? ({ refresh: async () => {} } as unknown as JuActions));
  const log = me.private?.avatarLog ?? [];
  const mine = state.mine?.experiences.find((x) => x.proposalId === p.id);
  if (!log.length) return null;
  const met = (mine?.needs ?? []).filter((n) => n.result === "met").map((n) => (n.detail ? `${n.text}（${n.detail}）` : n.text));
  const ex = explainForMe(log, met, { cared: p.cared, total: p.experiences.length, why: state.ju.plan?.why });
  return (
    <div className="space-y-3 rounded-xl border-2 border-ink bg-paper p-3" data-tour="my-deal">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[15px] font-black">{avatarCall(name)}替你谈下来的</span>
        <LockNote>只有你看得到</LockNote>
      </div>
      {ex.got.length > 0 && (
        <div>
          <div className="mb-1 text-[12.5px] font-black text-jade">✨ 你得到了什么</div>
          <ul className="space-y-0.5">
            {ex.got.map((g) => (
              <li key={g} className="flex gap-2 text-[13.5px] leading-snug">
                <span className="font-black text-jade">✓</span>
                <span className="min-w-0 flex-1 break-words">{g}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <div className="mb-1 text-[12.5px] font-black text-[#2f6fa8]">🤝 {avatarCall(name)}替你让了什么</div>
        {ex.gave.length ? (
          <ul className="space-y-2.5">
            {ex.gave.map((e) => (
              <AvatarLogRow key={e.id} entry={e} name={name} now={now} onRevoke={actions ? revoke : undefined} />
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-ink-soft">一步都没让。</p>
        )}
      </div>
      {ex.why.length > 0 && (
        <div>
          <div className="mb-1 text-[12.5px] font-black text-ink-soft">💡 为什么</div>
          <ul className="space-y-0.5">
            {ex.why.map((w) => (
              <li key={w} className="text-[13.5px] leading-snug text-ink-soft">
                · {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 定局后：为什么 + 注意事项 + 大家要做的 + 你跟局长说的每一条（v6：+ 你的分身替你谈下来的） */
export function DecisionCard({ state, me, actions }: { state: JuState; me: Member | null; actions?: JuActions }) {
  const d = decisionOf(state.ju);
  if (!d || !d.final) return null;
  const mine = me ? state.mine?.experiences.find((x) => x.proposalId === d.proposal.id) : undefined;
  const hasDeal = !!me?.private?.avatarLog?.length;
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
      {me && hasDeal && <MyDeal state={state} me={me} actions={actions} p={d.proposal} />}
      {mine?.needs?.length ? (
        <div className="border-t-2 border-dashed border-line pt-3">
          {!hasDeal && (
            <div className="mb-1 flex items-center gap-2">
              <span className="flex-1" />
              <LockNote>只有你看得到</LockNote>
            </div>
          )}
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

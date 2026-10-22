"use client";

import { useState } from "react";
import type { JuState, Member, PlanOption } from "@/lib/types";
import { slotLabel, voteTally } from "@/lib/client/format";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { AvatarStack, Button, Sheet } from "../ui";
import { toast } from "../toast";

function CommuteBars({ option, members, scaleMax }: { option: PlanOption; members: Map<string, Member>; scaleMax: number }) {
  const rows = [...option.commutes].sort((a, b) => b.minutes - a.minutes);
  return (
    <ul className="space-y-1.5" aria-label="每个人的通勤时间">
      {rows.map((c) => {
        const m = members.get(c.memberId);
        const isMax = c.minutes === option.maxCommute;
        return (
          <li key={c.memberId} className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-[15px]" aria-hidden>
              {m?.avatar ?? "🙂"}
            </span>
            <span className="w-12 shrink-0 truncate text-[12px] text-ink-soft">{m?.name ?? "?"}</span>
            <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-paper-deep">
              <span
                className={`absolute inset-y-0 left-0 rounded-full ${isMax ? "bg-cinnabar" : "bg-ink"}`}
                style={{ width: `${Math.max(6, (c.minutes / scaleMax) * 100)}%` }}
              />
            </span>
            <span className={`font-num w-10 shrink-0 text-right text-[13px] font-bold ${isMax ? "text-cinnabar" : ""}`}>
              {c.minutes}′
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PlanCard({
  option,
  rank,
  members,
  voterIds,
  mine,
  canVote,
  isAdmin,
  scaleMax,
  onVote,
  onConfirm,
}: {
  option: PlanOption;
  rank: number;
  members: Map<string, Member>;
  voterIds: string[];
  mine: boolean;
  canVote: boolean;
  isAdmin: boolean;
  scaleMax: number;
  onVote?: () => void;
  onConfirm?: () => void;
}) {
  const { poi } = option;
  const voters = voterIds.map((id) => members.get(id)).filter(Boolean) as Member[];
  return (
    <article
      className={`sticker relative overflow-hidden transition-colors ${mine ? "bg-mustard-soft" : ""}`}
      style={{ animationDelay: `${rank * 90}ms` }}
    >
      {/* 整卡可点投票 */}
      <button
        type="button"
        disabled={!canVote}
        onClick={onVote}
        className="block w-full p-4 pb-3 text-left disabled:cursor-default"
        aria-label={`投给 ${poi.name}`}
      >
        <div className="mb-2 flex items-start gap-3">
          <span
            className={`font-num flex size-11 shrink-0 -rotate-6 items-center justify-center rounded-lg border-2 border-ink text-lg font-bold ${
              rank === 1 ? "bg-cinnabar text-white" : "bg-paper"
            }`}
          >
            {rank}
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[19px] font-black leading-snug break-words">{poi.name}</h3>
            <div className="font-num mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] font-semibold text-ink-soft">
              {poi.rating != null && <span>★ {poi.rating.toFixed(1)}</span>}
              {poi.costPerPerson != null && <span>¥{poi.costPerPerson}/人</span>}
              <span>最远 {option.maxCommute}′</span>
            </div>
          </div>
        </div>

        {option.blurb && (
          <p className="mb-3 border-l-4 border-mustard pl-3 text-[15px] leading-relaxed">“{option.blurb}”</p>
        )}

        {option.reasons.length > 0 && (
          <ul className="mb-3 flex flex-wrap gap-1.5">
            {option.reasons.map((r) => (
              <li key={r} className="rounded-md bg-paper-deep px-2 py-0.5 text-[13px] font-semibold text-ink-soft">
                ✓ {r}
              </li>
            ))}
          </ul>
        )}

        <CommuteBars option={option} members={members} scaleMax={scaleMax} />

        {option.conflicts.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-lg border-2 border-cinnabar bg-cinnabar-soft px-3 py-2 text-[13px] font-semibold text-cinnabar-deep">
            {option.conflicts.map((c) => (
              <li key={c}>⚠️ {c}</li>
            ))}
          </ul>
        )}
      </button>

      <div className="flex items-center gap-2 border-t-2 border-dashed border-line px-4 py-2.5">
        {voters.length ? (
          <AvatarStack members={voters} max={6} size={28} />
        ) : (
          <span className="text-[13px] text-ink-faint">还没人投</span>
        )}
        <span className="font-num text-[15px] font-bold">{voters.length} 票</span>
        <span className="ml-auto flex items-center gap-2">
          {isAdmin && onConfirm && (
            <Button size="sm" variant="ink" onClick={onConfirm} className="!shadow-none">
              拍板
            </Button>
          )}
          {canVote && (
            <Button size="sm" variant={mine ? "gold" : "secondary"} onClick={onVote} className="!shadow-sticker-sm">
              {mine ? "✓ 我投了" : "投这家"}
            </Button>
          )}
        </span>
      </div>
    </article>
  );
}

export function VotingPanel({
  state,
  me,
  isAdmin,
  actions,
}: {
  state: JuState;
  me: Member | null;
  isAdmin: boolean;
  actions: JuActions;
}) {
  const { ju } = state;
  const plan = ju.plan;
  const [confirmPoi, setConfirmPoi] = useState<PlanOption | null>(null);
  const [busy, setBusy] = useState(false);
  if (!plan) return null;

  const members = new Map(state.members.map((m) => [m.id, m]));
  const tally = voteTally(ju);
  const attendees = plan.attendeeIds.map((id) => members.get(id)).filter(Boolean) as Member[];
  const absent = plan.absentIds.map((id) => members.get(id)).filter(Boolean) as Member[];
  const voted = Object.keys(ju.votes ?? {}).length;
  const canVote = !!me && me.status === "in";
  const myVote = me ? ju.votes?.[me.id] : undefined;
  const scaleMax = Math.max(1, ...plan.options.flatMap((o) => o.commutes.map((c) => c.minutes)));

  const vote = async (poiId: string) => {
    if (!canVote) {
      toast("先在下面入局，才能投票哦");
      return;
    }
    try {
      await actions.vote(poiId);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const doConfirm = async () => {
    if (!confirmPoi) return;
    setBusy(true);
    try {
      await actions.confirm(confirmPoi.poi.id);
      setConfirmPoi(null);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <section className="sticker bg-ink p-4 text-paper">
        <div className="text-[13px] font-semibold text-cream-faint">局长算好了时间</div>
        <div className="font-num mt-0.5 text-[26px] font-bold text-mustard">{slotLabel(ju, plan.slotId)}</div>
        <div className="mt-2 flex items-center gap-2">
          <AvatarStack members={attendees} max={7} size={28} />
          <span className="text-[14px]">{attendees.length} 人能来</span>
        </div>
        {absent.length > 0 && (
          <div className="mt-2 text-[13px] text-cream-faint">
            😢 {absent.map((m) => m.name).join("、")} 这个时间来不了
          </div>
        )}
      </section>

      <div className="flex items-end justify-between px-1">
        <h2 className="text-[22px] font-black">点一家投票</h2>
        <span className="font-num text-[14px] font-semibold text-ink-soft">
          已投 {voted}/{attendees.length} · 过半自动成局
        </span>
      </div>

      {plan.options.map((o, i) => (
        <div key={o.poi.id} className="animate-rise" style={{ animationDelay: `${i * 90}ms` }}>
          <PlanCard
            option={o}
            rank={i + 1}
            members={members}
            voterIds={tally[o.poi.id] ?? []}
            mine={myVote === o.poi.id}
            canVote={canVote}
            isAdmin={isAdmin}
            scaleMax={scaleMax}
            onVote={() => vote(o.poi.id)}
            onConfirm={() => setConfirmPoi(o)}
          />
        </div>
      ))}

      <Sheet open={!!confirmPoi} onClose={() => setConfirmPoi(null)} title="局长拍板？">
        <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">
          定在 <b className="text-ink">{confirmPoi?.poi.name}</b>，盖了章就通知所有人。
        </p>
        <div className="mb-2 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={() => setConfirmPoi(null)}>
            再等等
          </Button>
          <Button onClick={doConfirm} loading={busy}>
            盖章！
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { Experience, JuState, Member, Proposal } from "@/lib/types";
import { slotText, voteTally } from "@/lib/client/format";
import { errMsg, type VerifyResult } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Avatar, AvatarStack, Button, LockNote, Meter, Sheet, Spinner } from "../ui";
import { toast } from "../toast";

const STATUS_TEXT: Record<Experience["status"], string> = {
  full: "全程",
  late: "晚到",
  early: "早走",
  lateEarly: "晚到早走",
  absent: "来不了",
};

function utilTone(u: number): "jade" | "gold" | "red" {
  return u >= 80 ? "jade" : u >= 60 ? "gold" : "red";
}

/* ───────── #9 可复核 ───────── */
function HashLine({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="py-2">
      <div className="mb-0.5 flex items-center gap-2 text-[12px] font-bold text-ink-soft">
        {label}
        {ok && <span className="animate-check-pop rounded-full bg-jade px-1.5 text-[11px] text-white">一致 ✓</span>}
      </div>
      <code className="block break-all rounded-lg bg-paper-deep px-2.5 py-1.5 font-mono text-[11.5px] leading-snug">{value}</code>
    </div>
  );
}

export function AuditSheet({ state, actions, open, onClose }: { state: JuState; actions: JuActions; open: boolean; onClose: () => void }) {
  const audit = state.ju.plan?.audit;
  const [res, setRes] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  if (!audit) return null;
  const run = async () => {
    setBusy(true);
    setRes(null);
    try {
      const [r] = await Promise.all([actions.verify(), new Promise((ok) => setTimeout(ok, 900))]);
      setRes(r);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="局长拍板，可复核" subtitle="同样的输入，一定算出同样的方案">
      <div className="pb-4">
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          {[
            [audit.candidates, "个候选"],
            [audit.evaluations, "次体验计算"],
            [audit.paretoSize, "个前沿方案"],
          ].map(([n, l]) => (
            <div key={String(l)} className="rounded-xl border-2 border-ink bg-card px-1 py-2">
              <div className="font-num text-[24px] font-bold leading-tight">{n}</div>
              <div className="text-[11.5px] font-semibold text-ink-soft">{l}</div>
            </div>
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-ink-soft">
          输入里有大家的私密信息，所以只公开它的<b className="text-ink">加密指纹</b>：指纹能证明输入没被改过，但反推不出任何人说了什么。
        </p>
        <div className="divide-y-2 divide-dashed divide-line">
          <HashLine label="输入指纹（HMAC-SHA256）" value={audit.inputHash} />
          <HashLine label="方案指纹（SHA-256）" value={audit.outputHash} ok={res?.ok} />
          {res && <HashLine label="刚刚复算出的方案指纹" value={res.recomputedOutputHash} ok={res.ok} />}
        </div>
        {res && (
          <div
            className={`animate-pop-in my-2 rounded-xl border-2 border-ink px-3 py-2.5 text-center text-[15px] font-black ${
              res.ok ? "bg-jade text-white" : "bg-cinnabar text-white"
            }`}
          >
            {res.ok ? "✓ 复算一致：局长没有偷偷改结论" : "复算不一致，局长去查一下"}
          </div>
        )}
        <Button className="mt-2 w-full" variant="ink" loading={busy} onClick={run}>
          {busy ? "正在用同样的输入重算…" : res ? "再算一次" : "🔁 一键复算"}
        </Button>
        <p className="mt-2 text-center text-[11.5px] text-ink-faint">算法 {audit.algorithmVersion}</p>
      </div>
    </Sheet>
  );
}

/* ───────── 你的体验 ───────── */
function MyExperienceBox({ p, state, me }: { p: Proposal; state: JuState; me: Member }) {
  const mine = state.mine?.experiences.find((x) => x.proposalId === p.id);
  const pub = p.experiences.find((e) => e.memberId === me.id);
  const u = Math.round(mine?.utility ?? pub?.utility ?? 0);
  const facts: string[] = [];
  if (pub) {
    if (pub.status === "absent") facts.push("这个时间你来不了");
    else {
      if (pub.arriveAt) facts.push(`${pub.arriveAt} 到${pub.lateMin > 0 ? `（晚 ${pub.lateMin} 分钟）` : ""}`);
      facts.push(`路上 ${pub.commuteMin} 分钟`);
      if (pub.leaveAt) facts.push(`${pub.leaveAt} 得走`);
    }
  }
  return (
    <div className="rounded-xl border-2 border-ink bg-mustard-soft p-3">
      <div className="mb-2 flex items-center gap-2">
        <Avatar emoji={me.avatar} size={28} />
        <span className="flex-1 text-[15px] font-black">你的体验</span>
        <LockNote>只有你看得到</LockNote>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative size-16 shrink-0">
          <svg viewBox="0 0 36 36" className="size-16 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-card)" strokeWidth="5" />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke={u >= 80 ? "var(--color-jade)" : u >= 60 ? "var(--color-mustard)" : "var(--color-cinnabar)"}
              strokeWidth="5"
              strokeDasharray={`${(u / 100) * 97.4} 97.4`}
              strokeLinecap="round"
              style={{ transition: "stroke-dasharray .6s" }}
            />
          </svg>
          <span className="font-num absolute inset-0 flex items-center justify-center text-[19px] font-bold">{u}</span>
        </div>
        <div className="min-w-0 flex-1 space-y-0.5 text-[13.5px] leading-snug">
          {facts.map((f) => (
            <div key={f} className="font-semibold">
              {f}
            </div>
          ))}
          {mine?.notes.map((n) => (
            <div key={n} className="text-ink-soft">
              · {n}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────── 全员矩阵（公开 utility） ───────── */
function Matrix({ p, members, meId }: { p: Proposal; members: Map<string, Member>; meId?: string }) {
  const rows = [...p.experiences].sort((a, b) => (a.memberId === meId ? -1 : b.memberId === meId ? 1 : b.utility - a.utility));
  return (
    <ul className="space-y-1.5" aria-label="每个人在这个方案下的体验">
      {rows.map((e) => {
        const m = members.get(e.memberId);
        const absent = e.status === "absent";
        return (
          <li key={e.memberId} className={`flex items-center gap-2 ${absent ? "opacity-55" : ""}`}>
            <span className="w-6 shrink-0 text-center text-[16px]" aria-hidden>
              {m?.avatar ?? "🙂"}
            </span>
            <span className={`w-11 shrink-0 truncate text-[12.5px] ${e.memberId === meId ? "font-black" : "text-ink-soft"}`}>
              {e.memberId === meId ? "我" : (m?.name ?? "朋友")}
            </span>
            <Meter value={absent ? 0 : e.utility} tone={utilTone(e.utility)} className="flex-1" />
            <span className="w-[74px] shrink-0 truncate text-right text-[12px] font-semibold text-ink-soft">
              {absent ? "来不了" : e.notes[0] ?? STATUS_TEXT[e.status]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ProposalDetail({ p, state, me, members }: { p: Proposal; state: JuState; me: Member | null; members: Map<string, Member> }) {
  const { poi } = p;
  return (
    <article className="sticker animate-rise overflow-hidden" key={p.id}>
      <div className="border-b-2 border-ink bg-ink p-4 text-paper">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="rounded-md bg-mustard px-2 py-0.5 text-[13px] font-black text-ink">{p.labelText}</span>
          {p.recommended && <span className="rounded-md border-2 border-cinnabar px-1.5 text-[12px] font-black text-cinnabar">★ 局长推荐</span>}
        </div>
        <div className="font-num text-[24px] font-bold text-mustard">{slotText(p.slot)}</div>
        <h3 className="mt-1 text-[21px] font-black leading-snug break-words">{poi.name}</h3>
        <div className="font-num mt-1 flex flex-wrap gap-x-3 text-[13.5px] font-semibold text-cream-faint">
          {poi.rating != null && <span>★ {poi.rating.toFixed(1)}</span>}
          {poi.costPerPerson != null && <span>¥{poi.costPerPerson}/人</span>}
          <span>
            {p.attendCount} 人能到
          </span>
        </div>
        <p className="mt-1 truncate text-[12.5px] text-cream-faint">📍 {poi.address}</p>
      </div>

      <div className="space-y-4 p-4">
        {me && <MyExperienceBox p={p} state={state} me={me} />}

        <p className="text-[16px] font-black leading-snug">{p.headline}</p>

        {p.highlights.length > 0 && (
          <ul className="space-y-1">
            {p.highlights.slice(0, 3).map((h) => (
              <li key={h} className="flex gap-2 text-[14px]">
                <span className="font-black text-jade">✓</span>
                <span>{h}</span>
              </li>
            ))}
          </ul>
        )}
        {p.tradeoffs.length > 0 && (
          <ul className="space-y-1 rounded-lg border-2 border-cinnabar bg-cinnabar-soft px-3 py-2">
            {p.tradeoffs.map((t) => (
              <li key={t} className="flex gap-2 text-[13.5px] font-semibold text-cinnabar-deep">
                <span>⚖️</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        )}

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[14px] font-black">每个人怎么样</span>
            <span className="font-num text-[12px] text-ink-faint">
              最低 {Math.round(p.minUtility)} · 平均 {Math.round(p.avgUtility)}
            </span>
          </div>
          <Matrix p={p} members={members} meId={me?.id} />
          <p className="mt-2 text-[11.5px] text-ink-faint">🔒 只按通勤和时间算，预算、口味不会出现在这里</p>
        </div>
      </div>
    </article>
  );
}

export function PlansView({ state, me, actions }: { state: JuState; me: Member | null; actions: JuActions }) {
  const { ju } = state;
  const plan = ju.plan;
  const proposals = plan?.proposals ?? [];
  const recommended = proposals.find((p) => p.recommended) ?? proposals[0];
  const myVote = me ? ju.votes?.[me.id] : undefined;
  const [tab, setTab] = useState<string | undefined>(myVote ?? recommended?.id);
  const [auditOpen, setAuditOpen] = useState(false);
  const [voting, setVoting] = useState(false);
  if (!plan || !recommended) return null;

  const cur = proposals.find((p) => p.id === tab) ?? recommended;
  const members = new Map(state.members.map((m) => [m.id, m]));
  if (me) members.set(me.id, me);
  const tally = voteTally(ju);
  const voted = Object.keys(ju.votes ?? {}).length;
  const canVote = !!me && me.status === "in";
  const voters = (tally[cur.id] ?? []).map((id) => members.get(id)).filter((m): m is Member => !!m);
  const need = Math.floor(state.counts.in / 2) + 1;

  const vote = async () => {
    setVoting(true);
    try {
      await actions.vote(cur.id);
      toast(`投给了「${cur.labelText}」🗳️`, "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setVoting(false);
    }
  };

  return (
    <div className="space-y-4 pb-4">
      <section className="sticker p-4">
        <div className="mb-2 flex items-center gap-2">
          <h2 className="flex-1 text-[20px] font-black">局长出方案了</h2>
          <button
            type="button"
            onClick={() => setAuditOpen(true)}
            className="pressable inline-flex min-h-9 items-center gap-1 rounded-full border-2 border-ink bg-jade px-3 text-[13px] font-black text-white shadow-sticker-sm"
          >
            ✓ 可复核
          </button>
        </div>
        <p className="text-[14.5px] leading-relaxed">{plan.recommendation}</p>
        {plan.caredFor && (
          <p className="mt-2 rounded-lg bg-mustard-soft px-3 py-2 text-[13.5px] font-semibold">🤝 {plan.caredFor}</p>
        )}
        {plan.constraintSummaries.length > 0 && (
          <ul className="mt-2.5 space-y-1">
            {plan.constraintSummaries.map((c) => (
              <li key={c} className="flex gap-1.5 text-[13px] text-ink-soft">
                <span aria-hidden>🔒</span>
                {c}
              </li>
            ))}
          </ul>
        )}
        <p className="font-num mt-3 border-t-2 border-dashed border-line pt-2 text-[12px] text-ink-faint">
          算了 {plan.audit.candidates} 个候选 × {state.counts.in} 个人 = {plan.audit.evaluations} 次体验，挑出 {proposals.length} 个真不一样的方案
        </p>
      </section>

      <div role="tablist" className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {proposals.map((p) => {
          const on = p.id === cur.id;
          const n = tally[p.id]?.length ?? 0;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(p.id)}
              className={`pressable relative min-h-12 shrink-0 rounded-xl border-2 border-ink px-3.5 text-left ${
                on ? "bg-mustard shadow-sticker-sm" : "bg-card"
              }`}
            >
              <span className="block text-[14px] font-black">
                {p.recommended && "★ "}
                {p.labelText}
              </span>
              <span className="font-num block text-[11.5px] font-semibold text-ink-soft">
                {n} 票{myVote === p.id ? " · 我投的" : ""}
              </span>
            </button>
          );
        })}
      </div>

      <ProposalDetail p={cur} state={state} me={me} members={members} />

      <AuditSheet state={state} actions={actions} open={auditOpen} onClose={() => setAuditOpen(false)} />

      {/* 投票栏 */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-paper/95 px-4 pt-2.5 backdrop-blur">
        <div className="mx-auto max-w-[480px]">
          <div className="mb-2 flex items-center gap-2 text-[13px] text-ink-soft">
            {voters.length > 0 ? <AvatarStack members={voters} max={5} size={24} /> : null}
            <span className="font-num flex-1">
              已投 {voted}/{state.counts.in} · {need} 票同一个就自动成局
            </span>
          </div>
          {canVote ? (
            <Button size="lg" className="w-full" variant={myVote === cur.id ? "gold" : "primary"} loading={voting} onClick={vote} disabled={myVote === cur.id}>
              {myVote === cur.id ? `✓ 你投了「${cur.labelText}」` : myVote ? `改投「${cur.labelText}」` : `投「${cur.labelText}」`}
            </Button>
          ) : (
            <p className="flex min-h-12 items-center justify-center gap-2 text-[14px] font-semibold text-ink-soft">
              {voting ? <Spinner /> : null}先和局长聊完，才能投票
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { JuState, Member } from "@/lib/types";
import { ago, dayLabel, hhmm, INTAKE_TEXT, beijingDate } from "@/lib/client/format";
import { errMsg, type ChatBody } from "@/lib/client/api";
import { store } from "@/lib/client/storage";
import type { JuActions } from "@/lib/client/useJu";
import { Avatar, Button, LockNote, SectionTitle, Sheet, copyText } from "../ui";
import { toast } from "../toast";
import { BudgetWidget, DietWidget, LocationWidget, TimeWidget, privateSummary } from "./widgets";

function whenText(iso?: string): string {
  if (!iso) return "";
  const d = beijingDate(new Date(iso));
  return `${dayLabel(d)} ${hhmm(iso)}`;
}

/* ───────── #1 门限 ───────── */
export function QuorumCard({ state }: { state: JuState }) {
  const q = state.ju.quorum;
  if (!q || q.state !== "pending") return null;
  const need = state.counts.quorumNeed ?? q.min;
  const have = Math.min(need, state.counts.quorumHave ?? 0);
  const left = Math.max(0, need - have);
  return (
    <section className="sticker relative overflow-hidden bg-ink p-5 text-paper">
      <div className="text-[13px] font-semibold text-cream-faint">悄悄成局 · 门槛 {need} 人</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[30px] font-black">还差</span>
        <span className="font-num text-[64px] font-bold leading-none text-mustard">{left}</span>
        <span className="text-[30px] font-black">人</span>
      </div>
      <div className="mt-3 flex gap-2" aria-label={`已有 ${have} 人，门槛 ${need} 人`}>
        {Array.from({ length: need }, (_, i) => (
          <span
            key={i}
            className={`flex size-9 items-center justify-center rounded-full border-2 ${
              i < have ? "animate-pop-in border-mustard bg-mustard text-ink" : "border-dashed border-cream-faint text-cream-faint"
            }`}
            style={{ animationDelay: `${i * 80}ms` }}
          >
            {i < have ? "✓" : "?"}
          </span>
        ))}
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-cream">
        凑够 {need} 个人私下说“来”，局长才公开成局。在那之前，谁说了来、谁没说，<b className="text-mustard">连发起人都看不到</b>。
      </p>
      {q.deadline && <p className="mt-1.5 text-[12.5px] text-cream-faint">{whenText(q.deadline)} 前凑不齐，局长就悄悄把局收了，谁也不尴尬。</p>}
    </section>
  );
}

/* ───────── #2 候补 ───────── */
export function WaitlistCard() {
  return (
    <section className="sticker hatch flex items-start gap-3 bg-mustard-soft p-4">
      <span className="animate-float text-3xl" aria-hidden>
        ⏳
      </span>
      <div>
        <p className="text-[17px] font-black">局长正在确认名额</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">你的情况局长都记下了。有位置会第一时间私信你，不用一直盯着。</p>
      </div>
    </section>
  );
}

/* ───────── 进度 ───────── */
function IntakeChip({ intake }: { intake: Member["intake"] }) {
  const cls = intake === "done" ? "bg-jade text-white border-jade" : "bg-card text-ink-soft border-line";
  return <span className={`shrink-0 rounded-full border-2 px-2 text-[12px] font-bold leading-5 ${cls}`}>{intake === "done" ? "✓ " : ""}{INTAKE_TEXT[intake]}</span>;
}

export function ProgressCard({ state, meId }: { state: JuState; meId?: string }) {
  const { counts, ju } = state;
  const pending = ju.quorum?.state === "pending";
  const total = Math.max(counts.in, 1);
  const members = [...state.members].sort((a, b) => {
    if (a.isOrganizer !== b.isOrganizer) return a.isOrganizer ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });
  return (
    <section className="sticker p-4" data-tour="waiting-progress">
      <SectionTitle hint={ju.quorum?.state === "met" ? <span className="font-bold text-jade">✓ 已成局</span> : undefined}>谁说好了</SectionTitle>
      <div className="mb-1 flex items-baseline gap-1.5">
        <span className="font-num text-[34px] font-bold leading-none">{counts.done}</span>
        <span className="font-num text-[16px] font-bold text-ink-soft">/ {counts.in} 人和局长聊完了</span>
      </div>
      <div className="mb-3 h-2.5 overflow-hidden rounded-full border-2 border-ink bg-paper">
        <div className="h-full bg-mustard transition-all duration-700" style={{ width: `${(counts.done / total) * 100}%` }} />
      </div>
      {ju.deadline && <p className="mb-2 text-[13px] text-ink-soft">⏰ {whenText(ju.deadline)} 截止，没回的人局长会按习惯帮忙预填。</p>}
      {pending ? (
        <div className="hatch rounded-xl border-2 border-dashed border-line px-4 py-5 text-center text-[13.5px] text-ink-soft">
          🙈 名单在成局后揭晓
          <br />
          <span className="text-[12px] text-ink-faint">现在谁也看不到谁表了态</span>
        </div>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <Avatar emoji={m.avatar} size={36} ring={m.isOrganizer ? "red" : m.id === meId ? "gold" : "none"} />
              <span className="min-w-0 flex-1 truncate font-bold">
                {m.name}
                {m.isOrganizer && <span className="ml-1.5 rounded bg-cinnabar px-1.5 text-[11px] font-bold leading-[18px] text-white">发起</span>}
                {m.id === meId && <span className="ml-1.5 rounded bg-mustard px-1.5 text-[11px] font-bold leading-[18px]">我</span>}
                {m.role === "must" && <span className="ml-1.5 text-[12px]">⭐</span>}
              </span>
              <IntakeChip intake={m.intake} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────── 我告诉局长的（#6 可改） ───────── */
type EditKey = "availability" | "budget" | "diet" | "location";

export function EditSheet({
  state,
  me,
  actions,
  edit,
  onClose,
}: {
  state: JuState;
  me: Member;
  actions: JuActions;
  edit: EditKey | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const submit = async (body: ChatBody) => {
    setBusy(true);
    try {
      await actions.chat(body);
      toast("局长记下了 ✓", "ok");
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };
  const p = me.private;
  const ju = state.ju;
  return (
    <Sheet open={!!edit} onClose={onClose} title="改一下" subtitle="方案出来之后再改，局长会攒几条一起重算，别人看不出是谁改的">
      <div className="pb-4">
        {edit === "availability" && <TimeWidget ju={ju} initial={p?.availability} onSubmit={(b) => submit(b)} busy={busy} />}
        {edit === "budget" && <BudgetWidget initial={p?.budgetMax} publicBudget={ju.spec.budgetPerPerson} onSubmit={(b) => submit(b)} busy={busy} />}
        {edit === "diet" && <DietWidget initial={p?.dietTags} onSubmit={(b) => submit(b)} busy={busy} />}
        {edit === "location" && <LocationWidget ju={ju} initial={me.location} onSubmit={(b) => submit(b)} busy={busy} />}
      </div>
    </Sheet>
  );
}

export function MyInfoCard({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const [edit, setEdit] = useState<EditKey | null>(null);
  const rows = privateSummary(me);
  if (!rows.length) return null;
  const notes = me.private?.notes ?? [];
  const anyAuto = rows.some((r) => r.auto);
  return (
    <section className="sticker p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex-1 text-lg font-black">你告诉局长的</h3>
        <LockNote>只有你看得到</LockNote>
      </div>
      {anyAuto && <p className="mb-1 text-[12.5px] text-ink-soft">带“局长猜的”是按你的习惯预填的，不对就改。</p>}
      <ul className="divide-y-2 divide-dashed divide-line">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 py-1.5">
            <span className="w-11 shrink-0 text-[13px] font-bold text-ink-soft">{r.label}</span>
            <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug">
              {r.value}
              {r.auto && (
                <span className="ml-1.5 inline-block rounded border border-dashed border-ink px-1 text-[11px] font-bold text-ink-soft">局长猜的</span>
              )}
            </span>
            <button type="button" onClick={() => setEdit(r.key)} className="min-h-11 shrink-0 px-2 text-[14px] font-bold text-cinnabar">
              改
            </button>
          </li>
        ))}
        {notes.length > 0 && (
          <li className="flex gap-2 py-2">
            <span className="w-11 shrink-0 text-[13px] font-bold text-ink-soft">悄悄话</span>
            <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink-soft">{notes.map((n) => `"${n}"`).join(" ")}</span>
          </li>
        )}
      </ul>
      <EditSheet state={state} me={me} actions={actions} edit={edit} onClose={() => setEdit(null)} />
    </section>
  );
}

/* ───────── #2 想认识谁 ───────── */
export function WantsCard({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const others = state.members.filter((m) => m.id !== me.id);
  const saved = me.private?.wants ?? [];
  const [sel, setSel] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  const savedKey = [...saved].sort().join(",");
  useEffect(() => setSel(savedKey ? savedKey.split(",") : []), [savedKey]);
  if (!others.length || state.ju.quorum?.state === "pending") return null;
  const dirty = [...sel].sort().join(",") !== savedKey;
  const matches = state.mine?.matchNames ?? [];

  const save = async () => {
    setBusy(true);
    try {
      const names = await actions.wants(sel);
      toast(names.length ? `🎉 和 ${names.join("、")} 互选成功！` : "记下了，只有对方也选了你才会揭晓", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sticker p-4" data-tour="wants">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex-1 text-lg font-black">想认识谁？👀</h3>
        <LockNote>私密</LockNote>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">
        只有对方也选了你才会揭晓，局长会安排你们坐一起。<b className="text-ink">单方面的选择，永远没人知道。</b>
      </p>
      {matches.length > 0 && (
        <div className="animate-pop-in mb-3 rounded-xl border-2 border-ink bg-cinnabar-soft px-3 py-2.5 text-[14px] font-bold">
          🎉 你和 <span className="text-cinnabar-deep">{matches.join("、")}</span> 互相想认识！到时候坐一起。
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {others.map((m) => {
          const on = sel.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSel((xs) => (on ? xs.filter((x) => x !== m.id) : [...xs, m.id]))}
              className={`pressable flex min-h-11 items-center gap-1.5 rounded-full border-2 border-ink py-1 pl-1 pr-3 text-[14px] font-bold ${
                on ? "bg-cinnabar text-white shadow-sticker-sm" : "bg-card"
              }`}
            >
              <Avatar emoji={m.avatar} size={30} />
              {m.name}
              {on && <span aria-hidden>♥</span>}
            </button>
          );
        })}
      </div>
      {dirty && (
        <Button className="mt-3 w-full" size="sm" loading={busy} onClick={save}>
          悄悄告诉局长
        </Button>
      )}
    </section>
  );
}

/* ───────── 拉人 ───────── */
export function SharePanel({ state }: { state: JuState }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    // 带上自己进来时的圈层 token，拉来的朋友和自己同一圈
    const t = store.getJson<string>(`jz:tier:${state.ju.id}`);
    setUrl(`${window.location.origin}/j/${state.ju.id}${t ? `?t=${encodeURIComponent(t)}` : ""}`);
  }, [state.ju.id]);
  const msg = `【${state.ju.title}】点开私聊局长，10 秒说清你的情况。预算、来不来，只有局长知道 🤫 ${url}`;
  return (
    <section className="sticker p-4">
      <SectionTitle hint="帮局长拉人">📣 甩进群</SectionTitle>
      <Button
        variant="secondary"
        className="w-full"
        onClick={async () => {
          const ok = await copyText(msg);
          toast(ok ? "复制好了，去群里粘贴吧 📋" : "复制失败，长按地址栏手动复制", ok ? "ok" : "error");
        }}
      >
        复制邀请消息
      </Button>
    </section>
  );
}

/* ───────── 悄悄退出 ───────── */
export function LeaveLink({ actions, planned }: { actions: JuActions; planned: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="flex justify-center pb-6 pt-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          我去不了了…
        </Button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="悄悄退出？">
        <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">
          不会通知任何人。群里看不到你退出，也看不出原因。
          {planned ? "方案会在攒够几条变化后一起重算，没人能对上是谁。" : ""}
        </p>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Button variant="gold" onClick={() => setOpen(false)}>
            算了，我去
          </Button>
          <Button
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await actions.setStatus("out");
                setOpen(false);
              } catch (e) {
                toast(errMsg(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            确定不去
          </Button>
        </div>
      </Sheet>
    </>
  );
}

export function WaitingView({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const waitlist = me.status === "waitlist";
  const lastAnn = state.ju.announcements.at(-1);
  return (
    <div className="space-y-5 pb-4">
      {waitlist ? <WaitlistCard /> : <QuorumCard state={state} />}
      {!waitlist && <ProgressCard state={state} meId={me.id} />}
      <MyInfoCard state={state} me={me} actions={actions} />
      {!waitlist && <WantsCard state={state} me={me} actions={actions} />}
      {lastAnn && (
        <section className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-faint p-4">
          <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-ink-faint">
            <span>📌 最新群公告</span>
            <span>{ago(lastAnn.at)}</span>
          </div>
          <p className="text-[14px] leading-relaxed text-ink-soft">{lastAnn.text}</p>
        </section>
      )}
      {!waitlist && <SharePanel state={state} />}
    </div>
  );
}

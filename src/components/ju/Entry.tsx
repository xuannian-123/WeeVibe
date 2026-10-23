"use client";

import { useEffect, useRef, useState } from "react";
import type { JuState, SeedMember } from "@/lib/types";
import { errMsg } from "@/lib/client/api";
import { store } from "@/lib/client/storage";
import type { JuActions } from "@/lib/client/useJu";
import { AVATARS, Avatar, Button, SealLogo } from "../ui";
import { toast } from "../toast";

const PLEDGES: [string, string][] = [
  ["🔒", "预算、门禁、来不来，只有局长知道"],
  ["📣", "群里只看到结论，比如“有人预算偏紧”"],
  ["🧾", "局长拍板可复核，谁也不能偷偷改"],
];

function SeedCard({ s, selected, onPick }: { s: SeedMember; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={selected}
      className={`pressable flex w-full items-start gap-3 rounded-[var(--radius-card)] border-2 border-ink p-3 text-left ${
        selected ? "bg-mustard shadow-sticker" : "bg-card shadow-sticker-sm"
      }`}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper-deep text-[18px] font-black">
        {s.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-[17px] font-black">{s.name}</span>
          {s.hint && <span className="truncate rounded bg-paper-deep px-1.5 text-[12px] font-semibold text-ink-soft">{s.hint}</span>}
        </span>
        {s.quote && <span className="mt-0.5 block text-[14px] leading-snug text-ink-soft">“{s.quote}”</span>}
      </span>
      {selected && <span className="animate-check-pop text-xl">✓</span>}
    </button>
  );
}

export function EntryView({
  state,
  actions,
  isAdmin,
  tierToken,
}: {
  state: JuState;
  actions: JuActions;
  isAdmin: boolean;
  tierToken: string | null;
}) {
  const { ju } = state;
  // #5 群里说了"不去"的人不展示；已被认领的也不展示
  const seeds = (ju.seeds ?? []).filter((s) => s.said !== "no" && !s.claimedBy);
  const [step, setStep] = useState<"claim" | "name">(seeds.length && !isAdmin ? "claim" : "name");
  const [seedId, setSeedId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName((n) => n || store.getName() || (isAdmin ? (ju.organizerName ?? "") : ""));
    setAvatar(store.getAvatar() ?? AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  }, [isAdmin, ju.organizerName]);

  const pick = (s: SeedMember) => {
    setSeedId(s.id);
    setName(s.name);
    setTimeout(() => setStep("name"), 220);
  };

  const join = async () => {
    const n = name.trim();
    if (!n) {
      toast("告诉局长怎么称呼你");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await actions.join({
        name: n.slice(0, 12),
        avatar,
        seedId,
        tierToken: tierToken ?? undefined,
        isOrganizer: isAdmin || undefined,
      });
    } catch (e) {
      toast(errMsg(e), "error");
      setBusy(false);
    }
  };

  const q = ju.quorum;
  const quorumLine =
    q?.state === "pending"
      ? `已有 ${state.counts.quorumHave ?? 0} 人悄悄说了来 · 凑够 ${state.counts.quorumNeed ?? q.min} 人才公开成局`
      : null;

  if (step === "claim") {
    return (
      <div className="space-y-4 pb-10">
        <div className="animate-rise px-1">
          <h2 className="text-[26px] font-black leading-tight">你是群里的哪位？</h2>
          <p className="mt-1 text-[14px] text-ink-soft">局长从群聊截图里认出了这些人，点你自己，之前说过的就不用再说一遍。</p>
        </div>
        <div className="space-y-2.5">
          {seeds.map((s, i) => (
            <div key={s.id} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
              <SeedCard s={s} selected={seedId === s.id} onPick={() => pick(s)} />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setSeedId(undefined);
            setStep("name");
          }}
          className="flex min-h-12 w-full items-center justify-center text-[15px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4"
        >
          都不是，我是新来的 →
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-32">
      <div className="flex items-end gap-2">
        <SealLogo size={34} />
        <p className="bubble-jz animate-bubble-in max-w-[82%] px-3.5 py-2.5 text-[15.5px] leading-relaxed">
          {isAdmin ? "发起人好！你也先和我私聊一遍，我才知道你的情况 😉" : seedId ? `${name}，群里看到你啦 👋 选个头像就开聊。` : "嗨，我是这个局的局长 👋 先告诉我怎么称呼你？"}
        </p>
      </div>

      <section className="sticker p-4">
        <div className="mb-3 flex items-center gap-3">
          <Avatar emoji={avatar} size={52} />
          <input
            ref={inputRef}
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="群里大家怎么叫你"
            maxLength={12}
            aria-label="你的称呼"
            enterKeyHint="go"
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
        </div>
        <div className="grid grid-cols-8 gap-1">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`选择头像 ${a}`}
              aria-pressed={a === avatar}
              onClick={() => setAvatar(a)}
              className={`flex aspect-square min-h-10 items-center justify-center rounded-full text-[21px] ${a === avatar ? "bg-mustard ring-2 ring-ink" : ""}`}
            >
              {a}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-[var(--radius-card)] border-2 border-ink bg-ink p-4 text-paper">
        <p className="mb-2 text-[13px] font-bold text-mustard">局长的三条规矩</p>
        <ul className="space-y-1.5">
          {PLEDGES.map(([i, t]) => (
            <li key={t} className="flex gap-2.5 text-[14.5px] leading-snug">
              <span aria-hidden>{i}</span>
              {t}
            </li>
          ))}
        </ul>
      </section>

      {quorumLine && <p className="text-center text-[13px] font-semibold text-ink-soft">🤫 {quorumLine}</p>}
      {seeds.length > 0 && !isAdmin && (
        <button type="button" onClick={() => setStep("claim")} className="mx-auto block min-h-11 text-[14px] font-semibold text-ink-soft underline underline-offset-4">
          ← 重新选群里的我
        </button>
      )}

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-paper/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto max-w-[480px]">
          <Button size="lg" className="w-full" loading={busy} onClick={join}>
            去和局长私聊 →
          </Button>
        </div>
      </div>
    </div>
  );
}

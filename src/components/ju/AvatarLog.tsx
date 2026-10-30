"use client";

// v6 本人视图「我的分身」（docs/AVATAR.md 第 4.4 节）：分身替你做的每件事，只有本人看得到。
// 自动让步在 30 分钟内可以撤回：撤回 = 这一维的 give 视为 0，局长重算。
import { useCallback, useEffect, useState } from "react";
import type { AvatarLogEntry, JuState, Member } from "@/lib/types";
import { api, errMsg, revokeAvatarConcession, type AvatarActions } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { LockNote, Spinner } from "../ui";
import { toast } from "../toast";
import { AVATAR_KIND, DIM_LABEL, avatarCall, avatarSentence, canRevoke, revokeMinutesLeft } from "../screen/negotiation";

/** 分身名来自本人档案（Profile.avatarName）；拿不到就叫"你的分身" */
export function useAvatarName(me: Member | null | undefined, given?: string | null): string | undefined {
  const pid = me?.profileId;
  const [name, setName] = useState<string | undefined>(given ?? undefined);
  useEffect(() => {
    if (given !== undefined) {
      setName(given ?? undefined);
      return;
    }
    if (!pid) return;
    let alive = true;
    api
      .profile(pid)
      .then((p) => alive && setName(p?.avatarName || undefined))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [pid, given]);
  return name;
}

/** 每 20 秒走一次的时钟（撤回倒计时用） */
export function useNow(ms = 20_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** 撤回：JuActions 有 revokeAvatar 就用（mock / 以后线 B 接上），否则直接调接口再刷新 */
export function useRevoke(juId: string, actions: JuActions) {
  return useCallback(
    async (entryId: string) => {
      const a = actions as JuActions & AvatarActions;
      if (a.revokeAvatar) await a.revokeAvatar(entryId);
      else {
        await revokeAvatarConcession(juId, entryId);
        await actions.refresh();
      }
    },
    [juId, actions],
  );
}

/** 一条分身记录；自动让步带「撤回」 */
export function AvatarLogRow({
  entry,
  name,
  now,
  onRevoke,
}: {
  entry: AvatarLogEntry;
  name?: string;
  now: number;
  onRevoke?: (id: string) => Promise<void>;
}) {
  const k = AVATAR_KIND[entry.kind];
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const revocable = !!onRevoke && canRevoke(entry, now);
  const left = revokeMinutesLeft(entry, now);
  const expired = entry.kind === "concede" && !!entry.dim && !entry.revoked && !revocable;

  const revoke = async () => {
    if (!onRevoke) return;
    setBusy(true);
    try {
      await onRevoke(entry.id);
      toast("撤回了，局长正在重新算 🔁", "ok");
      setConfirm(false);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="animate-rise flex items-start gap-2.5">
      <span aria-label={k.label} className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[14px] ${k.cls}`}>
        {k.icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[14.5px] leading-snug break-words ${entry.revoked ? "text-ink-faint line-through" : "font-semibold"}`}>{avatarSentence(entry, name)}</p>
        {entry.kind === "concede" && entry.dim && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="rounded-full bg-paper-deep px-2 py-0.5 font-bold text-ink-soft">在你授权的「{DIM_LABEL[entry.dim]}」范围内</span>
            {entry.revoked && <span className="font-bold text-cinnabar">已撤回 · 局长重算中</span>}
            {expired && <span className="text-ink-faint">已过 30 分钟撤回时间</span>}
            {revocable && !confirm && (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className="pressable min-h-8 rounded-full border-2 border-ink bg-card px-3 font-black shadow-sticker-sm"
              >
                撤回 <span className="font-num font-semibold text-ink-soft">· 还剩 {left} 分钟</span>
              </button>
            )}
          </div>
        )}
        {confirm && (
          <div className="animate-pop-in mt-2 rounded-xl border-2 border-ink bg-cinnabar-soft p-2.5 text-[13px] leading-relaxed">
            <p>撤回后这一项就不让了，局长会重新算一遍 —— 方案可能会变，也可能有人因此来不了。</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={revoke}
                className="pressable inline-flex min-h-10 items-center gap-1.5 rounded-full border-2 border-ink bg-cinnabar px-3.5 font-black text-white shadow-sticker-sm disabled:opacity-50"
              >
                {busy && <Spinner />}确定撤回
              </button>
              <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="min-h-10 px-2 font-bold text-ink-soft underline underline-offset-4">
                算了，就这样
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** 「我的分身」卡片：分身替你做的每件事（只给本人） */
export function AvatarLog({
  state,
  me,
  actions,
  avatarName,
}: {
  state: JuState;
  me: Member;
  actions: JuActions;
  /** 不传就从本人档案里取 */
  avatarName?: string | null;
}) {
  const name = useAvatarName(me, avatarName);
  const now = useNow();
  const revoke = useRevoke(state.ju.id, actions);
  const log = me.private?.avatarLog ?? [];
  if (!log.length) return null;
  const order: AvatarLogEntry["kind"][] = ["concede", "held", "gained", "compensated", "ask"];
  const rows = [...log].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const conceded = log.filter((e) => e.kind === "concede" && !e.revoked).length;
  return (
    <section className="sticker overflow-hidden" data-tour="avatar-log">
      <div className="flex items-center gap-3 border-b-2 border-ink bg-ink px-4 py-3 text-paper">
        <span className="relative shrink-0" aria-hidden>
          <span className="flex size-11 items-center justify-center rounded-full border-2 border-mustard bg-night-3 text-[24px]">{me.avatar || "🙂"}</span>
          <span className="absolute -bottom-1 -right-2 rounded-md border-[1.5px] border-ink bg-mustard px-1 text-[10px] font-black text-ink">分身</span>
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[17px] font-black">{name ? `我的分身 · ${name}` : "我的分身"}</h3>
          <p className="text-[12.5px] text-cream-faint">
            {avatarCall(name)}替你谈完了{conceded ? `，自动让了 ${conceded} 步` : "，一步没让"}
          </p>
        </div>
        <LockNote dark>只有你看得到</LockNote>
      </div>
      <ul className="space-y-3 p-4">
        {rows.map((e) => (
          <AvatarLogRow key={e.id} entry={e} name={name} now={now} onRevoke={revoke} />
        ))}
      </ul>
      <p className="border-t-2 border-dashed border-line px-4 py-2.5 text-[12px] leading-relaxed text-ink-faint">
        🛡️ 大屏上只有「分身 A / B / C」这样的代号，和你的名字、加入顺序都无关；{name ? `「${name}」这个名字` : "分身的名字"}只出现在你自己的手机上。
      </p>
    </section>
  );
}

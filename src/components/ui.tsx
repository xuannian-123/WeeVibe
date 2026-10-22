"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Member } from "@/lib/types";

/* ───────── 按钮 ───────── */
type Variant = "primary" | "secondary" | "gold" | "ink" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-cinnabar text-white border-2 border-ink shadow-sticker",
  secondary: "bg-card text-ink border-2 border-ink shadow-sticker",
  gold: "bg-mustard text-ink border-2 border-ink shadow-sticker",
  ink: "bg-ink text-paper border-2 border-ink shadow-[4px_4px_0_0_var(--color-mustard)]",
  ghost: "bg-transparent text-ink-soft underline underline-offset-4 decoration-ink-faint",
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}) {
  const sz =
    size === "lg"
      ? "min-h-14 px-6 text-lg"
      : size === "sm"
        ? "min-h-11 px-3.5 text-[15px]"
        : "min-h-12 px-5 text-base";
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`pressable inline-flex select-none items-center justify-center gap-2 rounded-[var(--radius-btn)] font-bold tracking-wide disabled:cursor-not-allowed disabled:opacity-45 ${sz} ${VARIANT[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

/* ───────── Chip（多选） ───────── */
export function Chip({
  selected,
  onClick,
  children,
  className = "",
  ariaLabel,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={!!selected}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`pressable min-h-11 rounded-full border-2 border-ink px-3.5 text-[15px] font-semibold ${
        selected ? "bg-mustard shadow-sticker-sm" : "bg-card text-ink-soft"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ───────── 头像 ───────── */
export const AVATARS = ["🐼", "🦊", "🐯", "🐸", "🐙", "🐧", "🐨", "🐻", "🐰", "🐶", "🐱", "🦁", "🐵", "🐲", "🦄", "🍑"];

export function Avatar({
  emoji,
  size = 40,
  ring,
  className = "",
  title,
}: {
  emoji: string;
  size?: number;
  ring?: "red" | "gold" | "none";
  className?: string;
  title?: string;
}) {
  const ringCls =
    ring === "red"
      ? "border-cinnabar"
      : ring === "gold"
        ? "border-mustard"
        : "border-ink";
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center justify-center rounded-full border-2 bg-paper-deep leading-none ${ringCls} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.56 }}
    >
      {emoji || "🙂"}
    </span>
  );
}

export function AvatarStack({
  members,
  max = 8,
  size = 34,
}: {
  members: Pick<Member, "id" | "avatar" | "name">[];
  max?: number;
  size?: number;
}) {
  const shown = members.slice(0, max);
  const more = members.length - shown.length;
  return (
    <div className="flex items-center">
      {shown.map((m, i) => (
        <span key={m.id} className="animate-pop-in" style={{ marginLeft: i ? -size * 0.28 : 0, zIndex: max - i }}>
          <Avatar emoji={m.avatar} size={size} title={m.name} />
        </span>
      ))}
      {more > 0 && (
        <span
          className="font-num inline-flex items-center justify-center rounded-full border-2 border-ink bg-mustard text-xs font-bold"
          style={{ width: size, height: size, marginLeft: -size * 0.28 }}
        >
          +{more}
        </span>
      )}
    </div>
  );
}

/* ───────── 局长方印（Logo） ───────── */
export function SealLogo({ size = 40, dark }: { size?: number; dark?: boolean }) {
  return (
    <span
      aria-label="AI 局长"
      className="relative inline-flex shrink-0 flex-col items-center justify-center rounded-[7px] bg-cinnabar font-black leading-[1.02] text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.34,
        boxShadow: dark ? "0 0 18px rgb(226 65 46 / .55)" : "2px 2px 0 0 var(--color-ink)",
        border: `${Math.max(2, Math.round(size * 0.05))}px solid ${dark ? "#f3e7d3" : "var(--color-ink)"}`,
        transform: "rotate(-5deg)",
      }}
    >
      <span>局</span>
      <span>长</span>
      <span
        className="font-num absolute -right-1.5 -top-1.5 rounded-[4px] border-[1.5px] border-ink bg-mustard px-[3px] font-bold leading-none text-ink"
        style={{ fontSize: Math.max(9, size * 0.22), paddingTop: 1, paddingBottom: 1 }}
      >
        AI
      </span>
    </span>
  );
}

/* ───────── 底部弹层（二次确认） ───────── */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal aria-label={title}>
      <button aria-label="关闭" className="animate-fade-in absolute inset-0 bg-ink/45" onClick={onClose} />
      <div className="sticker animate-rise safe-bottom relative w-full max-w-[480px] rounded-b-none px-5 pt-5">
        <h3 className="mb-3 text-xl font-black">{title}</h3>
        {children}
      </div>
    </div>
  );
}

/* ───────── 轮换文案（加载时的小幽默） ───────── */
export function RotatingText({ lines, interval = 1400 }: { lines: string[]; interval?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % lines.length), interval);
    return () => clearInterval(t);
  }, [lines.length, interval]);
  return (
    <span key={i} className="animate-rise inline-block">
      {lines[i]}
    </span>
  );
}

export function SectionTitle({ n, children, hint }: { n?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline gap-2">
      {n && (
        <span className="font-num inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-paper">
          {n}
        </span>
      )}
      <h3 className="text-lg font-black">{children}</h3>
      {hint && <span className="ml-auto text-[13px] text-ink-faint">{hint}</span>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    collecting: ["收人中", "bg-mustard text-ink"],
    voting: ["投票中", "bg-ink text-paper"],
    confirmed: ["已成局", "bg-cinnabar text-white"],
    cancelled: ["已散局", "bg-line text-ink-soft"],
  };
  const [text, cls] = map[status] ?? [status, "bg-line"];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-[13px] font-bold ${cls}`}>
      {status === "collecting" && <span className="size-2 animate-pulse rounded-full bg-cinnabar" />}
      {text}
    </span>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 落到下面的兼容写法 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

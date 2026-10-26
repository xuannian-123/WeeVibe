"use client";

// 控制台的小积木：卡片外框、可复制的文字块、各面板共用的上下文。OrganizerPanel 和 Seating 共用。
import type { JuState } from "@/lib/types";
import { Button, copyText } from "@/components/ui";
import { toast } from "@/components/toast";
import { useState } from "react";
import type { OrganizerApi } from "./api";

export type Ctx = {
  state: JuState;
  admin: string;
  api: OrganizerApi;
  busy: string | null;
  run: (key: string, fn: () => Promise<void>) => () => Promise<void>;
  apply: (s: JuState) => void;
  refresh: () => Promise<void>;
};

/* ───────── 小积木 ───────── */
export function Card({ title, hint, children, tone = "card", tour }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; tone?: "card" | "gold"; tour?: string }) {
  return (
    <section data-tour={tour} className={`rounded-[var(--radius-card)] border-2 border-ink p-3.5 ${tone === "gold" ? "bg-mustard-soft" : "bg-card"}`}>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h4 className="text-[16px] font-black">{title}</h4>
        {hint && <span className="ml-auto text-right text-[12px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function CopyBlock({ text, label = "复制", clamp }: { text: string; label?: string; clamp?: boolean }) {
  const [full, setFull] = useState(false);
  const long = !!clamp && text.split("\n").length + text.length / 40 > 4;
  return (
    <div>
      <p className={`whitespace-pre-wrap rounded-lg border-2 border-dashed border-line bg-paper px-3 py-2 text-[14px] leading-relaxed ${long && !full ? "line-clamp-3" : ""}`}>
        {text}
      </p>
      {long && (
        <button type="button" onClick={() => setFull((x) => !x)} className="mt-1 min-h-9 text-[13px] font-bold text-ink-soft underline underline-offset-4">
          {full ? "收起" : "展开全文"}
        </button>
      )}
      <Button
        variant="gold"
        size="sm"
        className="mt-2 w-full"
        onClick={async () => toast((await copyText(text)) ? "已复制，去群里粘贴" : "复制失败，长按文字手动复制", "ok")}
      >
        {label}
      </Button>
    </div>
  );
}

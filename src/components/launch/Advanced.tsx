"use client";

import { useState } from "react";
import { beijingDate } from "@/components/screen/fmt";
import { Stepper } from "./SpecPreview";

export type AdvancedOpts = {
  quorumOn: boolean;
  quorumMin: number;
  capacityOn: boolean;
  capacity: number;
  tiers: 1 | 2 | 3;
  deadline: DeadlineKey;
};

export type DeadlineKey = "none" | "2h" | "tonight" | "tomorrowNoon";

export const DEFAULT_ADV: AdvancedOpts = { quorumOn: false, quorumMin: 4, capacityOn: false, capacity: 8, tiers: 1, deadline: "none" };

/** 截止时间选项 → 带 +08:00 的 ISO */
export function deadlineIso(k: DeadlineKey, now = new Date()): string | undefined {
  if (k === "none") return undefined;
  if (k === "2h") {
    const t = new Date(now.getTime() + 2 * 3600000);
    return new Date(t.getTime() + 8 * 3600000).toISOString().slice(0, 16) + ":00+08:00";
  }
  const today = beijingDate(now);
  const tomorrow = beijingDate(new Date(now.getTime() + 86400000));
  if (k === "tonight") {
    const t = `${today}T22:00:00+08:00`;
    return new Date(t).getTime() > now.getTime() + 30 * 60000 ? t : `${tomorrow}T22:00:00+08:00`;
  }
  return `${tomorrow}T12:00:00+08:00`;
}

const DEADLINES: [DeadlineKey, string][] = [
  ["none", "不设"],
  ["2h", "2 小时后"],
  ["tonight", "今晚 22:00"],
  ["tomorrowNoon", "明天中午"],
];

const TIER_TEXT: Record<1 | 2 | 3, string> = { 1: "一圈", 2: "两圈", 3: "三圈" };

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-8 w-14 shrink-0 rounded-full border-2 border-ink transition-colors ${on ? "bg-cinnabar" : "bg-paper-deep"}`}
    >
      <span className={`absolute top-0.5 size-6 rounded-full border-2 border-ink bg-card transition-[left] ${on ? "left-[24px]" : "left-0.5"}`} />
    </button>
  );
}

function Row({ title, desc, right, children }: { title: string; desc: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="border-t-2 border-dashed border-line py-3.5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-black">{title}</div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{desc}</p>
        </div>
        {right}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** 高级选项：门限成局 #1、名额 + 分圈邀请 #2、截止时间 */
export function Advanced({ value, onChange, headcount }: { value: AdvancedOpts; onChange: (v: AdvancedOpts) => void; headcount?: number }) {
  const [open, setOpen] = useState(false);
  const set = (p: Partial<AdvancedOpts>) => onChange({ ...value, ...p });
  const summary = [
    value.quorumOn && `凑够 ${value.quorumMin} 人成局`,
    value.capacityOn && `限 ${value.capacity} 人`,
    value.tiers > 1 && `分${TIER_TEXT[value.tiers]}邀请`,
    value.deadline !== "none" && `${DEADLINES.find((d) => d[0] === value.deadline)?.[1]}截止`,
  ].filter(Boolean);

  return (
    <div className="mt-4 rounded-xl border-2 border-ink bg-paper">
      <button type="button" className="flex min-h-12 w-full items-center gap-2 px-3.5 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="text-[15px] font-black">高级选项</span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-faint">{summary.length ? summary.join(" · ") : "怕没人回？叫谁不叫谁？"}</span>
        <span className={`transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="animate-rise px-3.5 pb-3.5">
          <Row
            title="凑够几人才成局"
            desc="凑不够就悄悄作废，没人知道谁拒绝了 —— 连你也不知道。"
            right={<Toggle label="门限成局" on={value.quorumOn} onChange={(v) => set({ quorumOn: v, quorumMin: Math.min(value.quorumMin, headcount ?? 50) })} />}
          >
            {value.quorumOn && <Stepper ariaLabel="成局门槛" value={value.quorumMin} min={2} max={Math.max(2, headcount ?? 20)} unit="人说来就公开成局" onChange={(v) => set({ quorumMin: v })} />}
          </Row>
          <Row
            title="名额有限"
            desc="满了之后新来的进候补，有人退出再自动补上。"
            right={<Toggle label="名额上限" on={value.capacityOn} onChange={(v) => set({ capacityOn: v })} />}
          >
            {value.capacityOn && <Stepper ariaLabel="名额" value={value.capacity} min={2} max={50} unit="个位置" onChange={(v) => set({ capacity: v })} />}
          </Row>
          <Row title="分几圈邀请" desc="核心圈先发；有空位了再放给下一圈。转正的人不会知道自己是第几圈。">
            <div className="grid grid-cols-3 gap-2">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={value.tiers === n}
                  onClick={() => set({ tiers: n })}
                  className={`pressable min-h-11 rounded-xl border-2 border-ink text-[14px] font-bold ${value.tiers === n ? "bg-mustard shadow-sticker-sm" : "bg-card text-ink-soft"}`}
                >
                  {n === 1 ? "不分圈" : TIER_TEXT[n]}
                </button>
              ))}
            </div>
          </Row>
          <Row title="截止时间" desc="到点还没填的人，局长按他的习惯替他预填，然后直接出方案。">
            <div className="grid grid-cols-4 gap-1.5">
              {DEADLINES.map(([k, t]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={value.deadline === k}
                  onClick={() => set({ deadline: k })}
                  className={`pressable min-h-11 rounded-xl border-2 border-ink px-1 text-[13px] font-bold ${value.deadline === k ? "bg-mustard shadow-sticker-sm" : "bg-card text-ink-soft"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </div>
      )}
    </div>
  );
}

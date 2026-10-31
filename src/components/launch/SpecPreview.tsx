"use client";

import type { JuSpec, SeedMember, SpecPart } from "@/lib/types";
import { categoryEmoji, dayLabel } from "@/components/screen/fmt";
import { activityByKey } from "@/lib/planner/activityLib";

const WHEN: Record<NonNullable<SpecPart["when"]>, string> = { morning: "上午", noon: "中午", afternoon: "下午", evening: "晚上", night: "夜里" };
const KIND: Record<SpecPart["kind"], string> = { eat: "吃饭", play: "玩", drink: "喝点什么", any: "干点什么" };

/** "下午 · 羽毛球" / "晚上 · 吃饭（局长定）" */
function partText(p: SpecPart): string {
  const what = p.activities?.length ? p.activities.map((k) => activityByKey(k)?.name ?? k).join("或") : `${KIND[p.kind]}（局长定）`;
  return `${p.when ? `${WHEN[p.when]} · ` : ""}${what}`;
}

export type Draft = { title: string; spec: JuSpec; seeds: Omit<SeedMember, "id" | "claimedBy">[]; fallback?: boolean };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-bold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

export function Stepper({ value, onChange, min, max, unit, ariaLabel }: { value: number; onChange: (v: number) => void; min: number; max: number; unit?: string; ariaLabel: string }) {
  const b = "pressable flex size-11 items-center justify-center rounded-xl border-2 border-ink bg-card text-xl font-bold shadow-sticker-sm disabled:opacity-40";
  return (
    <div className="flex items-center gap-2" role="group" aria-label={ariaLabel}>
      <button type="button" aria-label="减少" className={b} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span className="font-num w-12 text-center text-[24px] font-bold">{value}</span>
      <button type="button" aria-label="增加" className={b} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
      {unit && <span className="text-[14px] font-bold text-ink-soft">{unit}</span>}
    </div>
  );
}

/** spec 卡片：局长理解的需求，可直接改 */
export function SpecPreview({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const s = draft.spec;
  const set = (patch: Partial<JuSpec>) => onChange({ ...draft, spec: { ...s, ...patch } });
  return (
    <div className="space-y-4">
      <Field label="局名">
        <input className="field text-lg font-black" value={draft.title} maxLength={20} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`玩什么 ${categoryEmoji(s.category)}`}>
          <input className="field" value={s.category} maxLength={10} onChange={(e) => set({ category: e.target.value, poiKeywords: [e.target.value] })} />
        </Field>
        <Field label="人均预算（元）">
          <input
            className="field font-num"
            inputMode="numeric"
            value={s.budgetPerPerson ?? ""}
            placeholder="不限"
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "");
              set({ budgetPerPerson: v ? Number(v) : undefined });
            }}
          />
        </Field>
      </div>
      {s.shape && s.shape.length >= 2 && (
        <div>
          <span className="mb-1 block text-[13px] font-bold text-ink-soft">安排（分两段，第二家店在第一家步行 15 分钟内）</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {s.shape.map((p, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="font-black text-ink-faint">→</span>}
                <span className="rounded-full border-2 border-ink bg-card px-3 py-1.5 text-[14px] font-bold">{partText(p)}</span>
              </span>
            ))}
            <button type="button" className="min-h-10 px-2 text-[13px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4" onClick={() => set({ shape: undefined, durationMinutes: 120 })}>
              不分两段
            </button>
          </div>
        </div>
      )}
      {!!s.constraints?.length && (
        <div>
          <span className="mb-1 block text-[13px] font-bold text-ink-soft">整体要求（所有方案都按它来）</span>
          <div className="flex flex-wrap gap-2">
            {s.constraints.map((c) => (
              <span key={c} className="inline-flex min-h-10 items-center gap-1 rounded-full border-2 border-ink bg-cinnabar/10 pl-3 text-[14px] font-bold">
                {c}
                <button type="button" aria-label={`去掉：${c}`} className="flex size-10 items-center justify-center text-ink-soft" onClick={() => set({ constraints: s.constraints!.filter((x) => x !== c) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <Field label="哪天">
        <div className="flex flex-wrap gap-2">
          {s.dates.map((d) => (
            <span key={d} className="font-num inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-ink bg-mustard pl-3.5 font-semibold">
              {dayLabel(d)}
              {s.dates.length > 1 ? (
                <button type="button" aria-label={`去掉 ${d}`} className="flex size-11 items-center justify-center text-ink-soft" onClick={() => set({ dates: s.dates.filter((x) => x !== d) })}>
                  ✕
                </button>
              ) : (
                <span className="pr-3.5" />
              )}
            </span>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <Field label={s.shape?.length ? "第一段最早几点开始" : "最早几点开始"}>
          <input className="field font-num" type="time" value={s.earliest} onChange={(e) => set({ earliest: e.target.value })} />
        </Field>
        <span className="pb-3 font-bold text-ink-faint">—</span>
        <Field label={s.shape?.length ? "第一段最晚几点开始" : "最晚几点开始"}>
          <input className="field font-num" type="time" value={s.latest} onChange={(e) => set({ latest: e.target.value })} />
        </Field>
      </div>
      <Field label="大概几个人">
        <div className="flex items-center gap-2">
          {s.headcount ? (
            <>
              <Stepper ariaLabel="人数" value={s.headcount} min={2} max={50} onChange={(v) => set({ headcount: v })} />
              <button type="button" className="min-h-10 px-1 text-[12.5px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4" onClick={() => set({ headcount: undefined })}>
                不确定
              </button>
            </>
          ) : (
            <button type="button" className="min-h-11 rounded-xl border-2 border-dashed border-ink px-3 text-[14px] font-bold" onClick={() => set({ headcount: 4 })}>
              ＋ 填人数
            </button>
          )}
          <span className="ml-auto text-[13px] text-ink-faint">📍 {s.city}</span>
        </div>
        <span className="mt-1 block text-[12px] text-ink-faint">
          {s.headcount ? `到 ${s.headcount} 个人、都交了授权书，分身们就自动开谈` : "没填人数：大家都交了授权书时局长会提醒你，由你点开谈"}
        </span>
      </Field>
    </div>
  );
}

const SAID: Record<SeedMember["said"], [string, string]> = {
  yes: ["说了去", "bg-[#2e8b6a] text-white"],
  maybe: ["还在犹豫", "bg-mustard text-ink"],
  no: ["说了不去", "bg-line text-ink-soft"],
};

/** #3 截图里识别出的人：发起人可以删掉认错的 */
export function SeedList({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  if (!draft.seeds.length) return null;
  const yes = draft.seeds.filter((x) => x.said !== "no").length;
  return (
    <div className="mt-5 border-t-2 border-dashed border-line pt-4">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className="text-[16px] font-black">群里的人</h4>
        <span className="text-[12px] text-ink-faint">局长认出 {draft.seeds.length} 位，{yes} 位可能来</span>
      </div>
      <ul className="space-y-2">
        {draft.seeds.map((p, i) => {
          const [t, cls] = SAID[p.said];
          return (
            <li key={`${p.name}-${i}`} className="animate-rise flex items-start gap-2.5 rounded-xl border-2 border-ink bg-paper px-3 py-2" style={{ animationDelay: `${i * 70}ms` }}>
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-paper-deep text-[15px] font-black">{p.name.slice(0, 1)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="truncate text-[15px]">{p.name}</b>
                  <span className={`shrink-0 rounded-full px-2 py-px text-[11px] font-bold ${cls}`}>{t}</span>
                </div>
                {p.quote && <p className="mt-0.5 truncate text-[13px] text-ink-soft">“{p.quote}”</p>}
                {p.hint && <p className="text-[12px] text-cinnabar-deep">局长记下了：{p.hint}</p>}
              </div>
              <button
                type="button"
                aria-label={`去掉 ${p.name}`}
                className="-mr-1 flex size-9 shrink-0 items-center justify-center text-ink-faint"
                onClick={() => onChange({ ...draft, seeds: draft.seeds.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
        他们点开链接时可以直接认领自己，不用再填一遍。说了不去的人，局里不会公开列出来。
      </p>
    </div>
  );
}

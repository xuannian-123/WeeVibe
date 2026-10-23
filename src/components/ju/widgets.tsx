"use client";

// 私聊里局长弹出的内联组件。统一签名：onSubmit(body, say) —— body 发给 /chat，say 是聊天里显示成"我说的话"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DayAvailability, DietTag, Ju, Member, Place } from "@/lib/types";
import { api, errMsg, type ChatBody } from "@/lib/client/api";
import { compressImage } from "@/lib/client/image";
import { dayLabel } from "@/lib/client/format";
import { Button, Chip, LockNote, Spinner } from "../ui";
import { toast } from "../toast";

export type WidgetSubmit = (body: ChatBody, say: string) => Promise<void> | void;

export const DIETS: DietTag[] = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"];

/* ───────── 外框 ───────── */
export function WidgetCard({
  title,
  lock = true,
  children,
  className = "",
}: {
  title?: ReactNode;
  lock?: boolean | string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`sticker animate-bubble-in p-3.5 ${className}`}>
      {(title || lock) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <span className="min-w-0 flex-1 text-[15px] font-black">{title}</span>}
          {lock && <LockNote className={title ? "" : "ml-auto"}>{typeof lock === "string" ? lock : "只有局长知道"}</LockNote>}
        </div>
      )}
      {children}
    </div>
  );
}

/* ───────── #1 #5 来不来 ───────── */
export function RsvpWidget({ onSubmit, busy }: { onSubmit: WidgetSubmit; busy?: boolean }) {
  return (
    <WidgetCard title="这次能来吗？">
      <div className="grid grid-cols-2 gap-2.5">
        <Button variant="primary" disabled={busy} onClick={() => onSubmit({ rsvp: "yes" }, "能来！")}>
          🙋 能来
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onSubmit({ rsvp: "no" }, "这次来不了")}>
          这次来不了
        </Button>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-soft">
        说不来也没关系：群里不会出现你的名字，别人看不出你是没空、不想去，还是没回。
      </p>
    </WidgetCard>
  );
}

/* ───────── 出发地 ───────── */
export function PlacePicker({
  city,
  value,
  onChange,
}: {
  city: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setResults([]);
      setSearchErr(null);
      return;
    }
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.geoSearch(text, city);
        if (my === reqId.current) {
          setResults(r.slice(0, 6));
          setSearchErr(r.length ? null : "没搜到，换个说法试试，比如地铁站名");
        }
      } catch (e) {
        if (my === reqId.current) setSearchErr(errMsg(e));
      } finally {
        if (my === reqId.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, city]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      toast("这个浏览器拿不到定位，搜一下地点吧", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const p = await api.geoReverse(pos.coords.latitude, pos.coords.longitude);
          onChange(p);
          setQ("");
        } catch (e) {
          toast(errMsg(e), "error");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        toast(err.code === 1 ? "没有定位权限，搜一下地点也行" : "定位失败了，搜一下地点吧", "error");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  };

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-ink bg-mustard-soft px-3 py-2">
        <span className="text-xl" aria-hidden>
          📍
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{value.label}</span>
        <button type="button" onClick={() => onChange(null)} className="min-h-11 shrink-0 px-2 text-[15px] font-bold text-cinnabar">
          换一个
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <Button type="button" variant="gold" className="w-full" onClick={locate} loading={locating}>
        {locating ? "正在找你在哪…" : "📍 用我现在的位置"}
      </Button>
      <div className="relative">
        <input
          className="field pr-10"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="或者搜：小区 / 地铁站 / 公司"
          enterKeyHint="search"
          aria-label="搜索出发地"
        />
        {searching && <Spinner className="absolute right-4 top-1/2 -mt-2 text-ink-faint" />}
      </div>
      {searchErr && <p className="px-1 text-[13px] text-ink-faint">{searchErr}</p>}
      {results.length > 0 && (
        <ul className="overflow-hidden rounded-xl border-2 border-ink bg-card">
          {results.map((p, i) => (
            <li key={`${p.label}-${i}`} className="border-b border-line last:border-0">
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-2 px-3 text-left active:bg-mustard-soft"
                onClick={() => {
                  onChange(p);
                  setQ("");
                  setResults([]);
                }}
              >
                <span className="text-ink-faint">⌖</span>
                <span className="truncate">{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LocationWidget({ ju, initial, onSubmit, busy }: { ju: Ju; initial?: Place; onSubmit: WidgetSubmit; busy?: boolean }) {
  const [place, setPlace] = useState<Place | null>(initial ?? null);
  return (
    <WidgetCard title="从哪出发？" lock="只用来算通勤">
      <PlacePicker city={ju.spec.city} value={place} onChange={setPlace} />
      {place && (
        <Button className="mt-2.5 w-full" loading={busy} onClick={() => onSubmit({ location: place }, `从${place.label}出发`)}>
          就从这儿出发
        </Button>
      )}
    </WidgetCard>
  );
}

/* ───────── 时间 ───────── */
function times(from: string, to: string, step = 30): string[] {
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  };
  const out: string[] = [];
  for (let t = toMin(from); t <= toMin(to); t += step) {
    out.push(`${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}
const FROM_OPTS = times("10:00", "22:00");
const HOME_OPTS = times("20:00", "24:00");
const PREFS: [DayAvailability["pref"], string][] = [
  ["best", "最好这天"],
  ["ok", "可以"],
  ["meh", "勉强"],
];

type DayRow = { on: boolean; from: string; homeBy: string; pref: DayAvailability["pref"] };

export function juDates(ju: Ju): string[] {
  if (ju.spec.dates?.length) return ju.spec.dates;
  return [...new Set(ju.slots.map((s) => s.start.slice(0, 10)))];
}

export function TimeWidget({
  ju,
  initial,
  onSubmit,
  onSchedule,
  busy,
}: {
  ju: Ju;
  initial?: Record<string, DayAvailability>;
  onSubmit: WidgetSubmit;
  onSchedule?: () => void;
  busy?: boolean;
}) {
  const dates = useMemo(() => juDates(ju), [ju]);
  const hasInit = initial && Object.keys(initial).length > 0;
  const [rows, setRows] = useState<Record<string, DayRow>>(() =>
    Object.fromEntries(
      dates.map((d) => {
        const a = initial?.[d];
        return [
          d,
          {
            on: hasInit ? !!a : true,
            from: a?.from ?? (FROM_OPTS.includes(ju.spec.earliest) ? ju.spec.earliest : "18:00"),
            homeBy: a?.homeBy ?? "",
            pref: a?.pref ?? "ok",
          },
        ];
      }),
    ),
  );
  const set = (d: string, patch: Partial<DayRow>) => setRows((r) => ({ ...r, [d]: { ...r[d], ...patch } }));
  const onDays = dates.filter((d) => rows[d]?.on);

  const submit = () => {
    const availability: Record<string, DayAvailability> = {};
    for (const d of onDays) {
      const r = rows[d];
      availability[d] = { from: r.from, pref: r.pref, ...(r.homeBy ? { homeBy: r.homeBy } : {}) };
    }
    const say = onDays.length
      ? onDays
          .map((d) => `${dayLabel(d)} ${rows[d].from} 后能出发${rows[d].homeBy ? `，${rows[d].homeBy} 前要回` : ""}`)
          .join("；")
      : "这几天都不太行";
    return onSubmit({ availability }, say);
  };

  return (
    <WidgetCard title="哪天、几点能出发？">
      <div className="space-y-2.5">
        {dates.map((d) => {
          const r = rows[d];
          return (
            <div key={d} className={`rounded-xl border-2 border-ink p-2.5 ${r.on ? "bg-card" : "hatch bg-paper"}`}>
              <div className="flex items-center gap-2">
                <span className="font-num min-w-0 flex-1 text-[15px] font-bold">{dayLabel(d)}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={r.on}
                  onClick={() => set(d, { on: !r.on })}
                  className={`pressable min-h-9 rounded-full border-2 border-ink px-3 text-[13px] font-bold ${
                    r.on ? "bg-mustard" : "bg-card text-ink-faint"
                  }`}
                >
                  {r.on ? "✓ 这天行" : "这天不行"}
                </button>
              </div>
              {r.on && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[12px] font-semibold text-ink-soft">
                    几点后能出发
                    <select className="field mt-1 min-h-11 py-1.5" value={r.from} onChange={(e) => set(d, { from: e.target.value })}>
                      {FROM_OPTS.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[12px] font-semibold text-ink-soft">
                    几点前要回
                    <select className="field mt-1 min-h-11 py-1.5" value={r.homeBy} onChange={(e) => set(d, { homeBy: e.target.value })}>
                      <option value="">不着急</option>
                      {HOME_OPTS.map((t) => (
                        <option key={t} value={t}>
                          {t === "24:00" ? "00:00" : t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="col-span-2 flex gap-1.5" role="radiogroup" aria-label="这天的意愿">
                    {PREFS.map(([p, label]) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={r.pref === p}
                        onClick={() => set(d, { pref: p })}
                        className={`min-h-9 flex-1 rounded-lg border-2 text-[13px] font-bold ${
                          r.pref === p ? "border-ink bg-ink text-paper" : "border-line text-ink-soft"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[12px] text-ink-faint">门禁、末班车这种事，群里不用说，局长会悄悄留出时间。</p>
      <div className="mt-3 flex gap-2.5">
        {onSchedule && (
          <Button variant="secondary" size="sm" className="shrink-0" onClick={onSchedule} disabled={busy}>
            📷 传课表
          </Button>
        )}
        <Button className="flex-1" size="sm" loading={busy} onClick={submit}>
          就这样
        </Button>
      </div>
    </WidgetCard>
  );
}

/* ───────── #7 课表截图 ───────── */
export function ScheduleWidget({ onSubmit, onManual, busy }: { onSubmit: WidgetSubmit; onManual?: () => void; busy?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setReading(true);
    try {
      const url = await compressImage(f);
      setPreview(url);
      await onSubmit({ schedule: url }, "📷 发了一张课表截图");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const working = reading || busy;
  return (
    <WidgetCard title="传一张课表 / 排班截图" lock="截图只给局长看">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {preview ? (
        <div className="relative mb-3 overflow-hidden rounded-xl border-2 border-ink">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="课表预览" className="max-h-44 w-full object-cover object-top" />
          {working && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink/60 text-[14px] font-bold text-paper">
              <Spinner />
              局长在看你哪些时间有课…
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={working}
          onClick={() => fileRef.current?.click()}
          className="hatch mb-3 flex min-h-28 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink text-ink-soft"
        >
          {working ? <Spinner /> : <span className="text-3xl">🗓️</span>}
          <span className="text-[14px] font-bold text-ink">{working ? "局长在看…" : "点这里选截图"}</span>
          <span className="text-[12px]">课表、排班表、日历截图都行</span>
        </button>
      )}
      <p className="mb-3 text-[12px] leading-relaxed text-ink-faint">局长只读出哪些时段忙，课程名和截图不会给任何人看。</p>
      <div className="flex gap-2.5">
        <Button variant="secondary" size="sm" className="flex-1" disabled={working} onClick={() => onSubmit({ schedule: "demo" }, "📷 用示例课表试试")}>
          用示例课表
        </Button>
        {onManual && (
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onManual} disabled={working}>
            手动填
          </Button>
        )}
      </div>
    </WidgetCard>
  );
}

/* ───────── 忌口 ───────── */
export function DietWidget({ initial, onSubmit, busy }: { initial?: DietTag[]; onSubmit: WidgetSubmit; busy?: boolean }) {
  const [sel, setSel] = useState<DietTag[]>(initial ?? []);
  const toggle = (d: DietTag) => setSel((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));
  return (
    <WidgetCard title="有什么不吃的吗？">
      <div className="flex flex-wrap gap-2">
        {DIETS.map((d) => (
          <Chip key={d} selected={sel.includes(d)} onClick={() => toggle(d)}>
            {d}
          </Chip>
        ))}
      </div>
      <p className="mt-2.5 text-[12px] text-ink-faint">群里只会看到“有人不吃辣，已选有鸳鸯锅的店”，不会说是谁。</p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onSubmit({ dietTags: [] }, "没有忌口，啥都吃")}>
          啥都吃
        </Button>
        <Button size="sm" loading={busy} disabled={!sel.length} onClick={() => onSubmit({ dietTags: sel }, sel.join("、"))}>
          就这些
        </Button>
      </div>
    </WidgetCard>
  );
}

/* ───────── 预算 ───────── */
const B_MIN = 30;
const B_MAX = 300;
export function BudgetWidget({
  initial,
  publicBudget,
  onSubmit,
  busy,
}: {
  initial?: number;
  publicBudget?: number;
  onSubmit: WidgetSubmit;
  busy?: boolean;
}) {
  const [v, setV] = useState(() => Math.min(B_MAX, Math.max(B_MIN, initial ?? publicBudget ?? 100)));
  const pct = ((v - B_MIN) / (B_MAX - B_MIN)) * 100;
  const unlimited = v >= B_MAX;
  return (
    <WidgetCard title="人均多少以内比较舒服？">
      <div className="mb-1 flex items-baseline justify-center gap-1">
        <span className="text-[14px] font-bold text-ink-soft">人均</span>
        <span className="font-num text-[44px] font-bold leading-none">{unlimited ? "不限" : `¥${v}`}</span>
        {!unlimited && <span className="text-[14px] font-bold text-ink-soft">以内</span>}
      </div>
      <input
        type="range"
        className="range"
        min={B_MIN}
        max={B_MAX}
        step={10}
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
        style={{ ["--pct" as string]: `${pct}%` }}
        aria-label="人均预算"
      />
      <div className="font-num flex justify-between text-[12px] text-ink-faint">
        <span>¥{B_MIN}</span>
        {publicBudget ? <span>发起人说的是 ¥{publicBudget}</span> : null}
        <span>不限</span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">
        不方便在群里说的，悄悄告诉我就好。群里只会看到“有人预算偏紧，已按大家都舒服的价位筛选”。
      </p>
      <Button
        className="mt-3 w-full"
        size="sm"
        loading={busy}
        onClick={() => (unlimited ? onSubmit({ text: "预算多少都行" }, "多少都行") : onSubmit({ budgetMax: v }, `人均 ${v} 以内`))}
      >
        {unlimited ? "多少都行" : `¥${v} 以内`}
      </Button>
    </WidgetCard>
  );
}

/* ───────── 摘要：我告诉局长的 ───────── */
export function availabilitySummary(a: Record<string, DayAvailability> | undefined): string {
  const days = Object.entries(a ?? {}).sort(([x], [y]) => x.localeCompare(y));
  if (!days.length) return "还没说";
  return days.map(([d, v]) => `${dayLabel(d)} ${v.from} 后${v.homeBy ? ` · ${v.homeBy} 前回` : ""}`).join("；");
}

export function privateSummary(me: Member): { key: "availability" | "budget" | "diet" | "location"; label: string; value: string; auto: boolean }[] {
  const p = me.private;
  if (!p) return [];
  const auto = new Set(p.autoFilled);
  return [
    { key: "location", label: "出发地", value: me.location?.label ?? "还没说", auto: false },
    { key: "availability", label: "时间", value: availabilitySummary(p.availability), auto: auto.has("availability") },
    { key: "budget", label: "预算", value: p.budgetMax ? `人均 ¥${p.budgetMax} 以内` : "没说 / 都行", auto: auto.has("budget") },
    { key: "diet", label: "忌口", value: p.dietTags.length ? p.dietTags.join("、") : "啥都吃", auto: auto.has("diet") },
  ];
}

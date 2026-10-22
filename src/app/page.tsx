"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JuSpec } from "@/lib/types";
import { api, errMsg, type ParseResult } from "@/lib/client/api";
import { dayLabel } from "@/lib/client/format";
import { store } from "@/lib/client/storage";
import { Button, RotatingText } from "@/components/ui";
import { Stamp } from "@/components/Stamp";
import { TopBar } from "@/components/ju/JuView";
import { categoryEmoji } from "@/components/ju/JuHeader";
import { toast } from "@/components/toast";

const EXAMPLES = ["周五晚上 8 个人吃火锅，人均 100", "周六下午打羽毛球", "今晚宵夜烧烤"];

const PARSE_LINES = [
  "局长正在翻黄历…",
  "掐指一算，宜聚餐…",
  "正在数人头…",
  "正在盘算人均…",
  "顺便看看天气…",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-bold text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function Preview({
  parsed,
  onChange,
}: {
  parsed: ParseResult;
  onChange: (p: ParseResult) => void;
}) {
  const s = parsed.spec;
  const set = (patch: Partial<JuSpec>) => onChange({ ...parsed, spec: { ...s, ...patch } });
  return (
    <div className="space-y-4">
      <Field label="局名">
        <input
          className="field text-lg font-black"
          value={parsed.title}
          maxLength={20}
          onChange={(e) => onChange({ ...parsed, title: e.target.value })}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`玩什么 ${categoryEmoji(s.category)}`}>
          <input
            className="field"
            value={s.category}
            maxLength={10}
            onChange={(e) => set({ category: e.target.value, poiKeywords: [e.target.value] })}
          />
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
      <Field label="哪天">
        <div className="flex flex-wrap gap-2">
          {s.dates.map((d) => (
            <span key={d} className="font-num inline-flex min-h-11 items-center gap-1 rounded-full border-2 border-ink bg-mustard pl-3.5 font-semibold">
              {dayLabel(d)}
              {s.dates.length > 1 && (
                <button
                  type="button"
                  aria-label={`去掉 ${d}`}
                  className="flex size-11 items-center justify-center text-ink-soft"
                  onClick={() => set({ dates: s.dates.filter((x) => x !== d) })}
                >
                  ✕
                </button>
              )}
              {s.dates.length <= 1 && <span className="pr-3.5" />}
            </span>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <Field label="最早几点开始">
          <input className="field font-num" type="time" value={s.earliest} onChange={(e) => set({ earliest: e.target.value })} />
        </Field>
        <span className="pb-3 font-bold text-ink-faint">—</span>
        <Field label="最晚几点开始">
          <input className="field font-num" type="time" value={s.latest} onChange={(e) => set({ latest: e.target.value })} />
        </Field>
      </div>
      <Field label="大概几个人">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="减少人数"
            className="pressable flex size-12 items-center justify-center rounded-xl border-2 border-ink bg-card text-xl font-bold shadow-sticker-sm"
            onClick={() => set({ headcount: Math.max(2, (s.headcount ?? 4) - 1) })}
          >
            −
          </button>
          <span className="font-num w-14 text-center text-[28px] font-bold">{s.headcount ?? "?"}</span>
          <button
            type="button"
            aria-label="增加人数"
            className="pressable flex size-12 items-center justify-center rounded-xl border-2 border-ink bg-card text-xl font-bold shadow-sticker-sm"
            onClick={() => set({ headcount: Math.min(50, (s.headcount ?? 4) + 1) })}
          >
            +
          </button>
          <span className="ml-auto text-[13px] text-ink-faint">📍 {s.city}</span>
        </div>
      </Field>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [skip, setSkip] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setName(store.getName() ?? "");
  }, []);

  const parse = async (text = prompt) => {
    const t = text.trim();
    if (!t) {
      toast("先说一句你想组什么局");
      return;
    }
    setPrompt(t);
    setParsing(true);
    setParseErr(null);
    setParsed(null);
    setSkip(false);
    try {
      const r = await api.parse(t);
      setParsed(r);
      setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) {
      setParseErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  };

  const create = async () => {
    if (!name.trim()) {
      toast("留个称呼，大家才知道是谁组的局");
      return;
    }
    setCreating(true);
    try {
      const r = await api.createJu({
        prompt: prompt.trim(),
        organizerName: name.trim().slice(0, 12),
        ...(parsed ? { title: parsed.title.trim() || undefined, spec: parsed.spec } : {}),
      });
      store.setAdmin(r.id, r.adminToken);
      if (r.organizerMemberId) store.setMember(r.id, r.organizerMemberId);
      store.setName(name.trim());
      router.push(`/j/${r.id}`);
    } catch (e) {
      toast(errMsg(e), "error");
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[480px] overflow-x-clip px-4 pb-16">
      <TopBar />

      <section className="relative pb-6 pt-8">
        <div className="pointer-events-none absolute right-0 top-4 rotate-12 opacity-90" aria-hidden>
          <Stamp size={112} text="成局" />
        </div>
        <h1 className="text-[44px] font-black leading-[1.08] tracking-tight">
          一句话，
          <br />
          <span className="mr-1 inline-block -rotate-6 rounded-lg border-[3px] border-ink bg-cinnabar px-1.5 leading-[1.1] text-white shadow-sticker-sm">
            局
          </span>
          就组好了
        </h1>
        <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-ink-soft">
          说出你想组的局，AI 局长帮你约时间、挑一家对谁都公平的店，最后盖章定局。
        </p>
      </section>

      <section className="sticker p-4">
        <textarea
          className="field min-h-[96px] resize-none text-[17px] leading-relaxed"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="比如：周五晚上 8 个人吃火锅，人均 100"
          maxLength={120}
          aria-label="一句话描述你的局"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => parse(ex)}
              disabled={parsing}
              className="pressable min-h-11 rounded-full border-2 border-dashed border-ink bg-paper px-3 text-left text-[14px] font-semibold text-ink-soft"
            >
              “{ex}”
            </button>
          ))}
        </div>
        <Button size="lg" className="mt-4 w-full" onClick={() => parse()} loading={parsing}>
          {parsing ? <RotatingText lines={PARSE_LINES} /> : "让局长看看 →"}
        </Button>
      </section>

      {parsing && (
        <div className="mt-6 flex items-center justify-center gap-3 text-ink-soft" aria-live="polite">
          <span className="animate-wiggle inline-block text-3xl">📜</span>
          <span className="font-semibold">
            <RotatingText lines={PARSE_LINES} interval={1100} />
          </span>
        </div>
      )}

      {parseErr && (
        <section className="animate-rise mt-6 rounded-[var(--radius-card)] border-2 border-cinnabar bg-cinnabar-soft p-4">
          <p className="mb-3 font-semibold text-cinnabar-deep">😵 {parseErr}</p>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={() => parse()}>
              再试一次
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setParseErr(null);
                setSkip(true);
              }}
            >
              跳过预览直接发起
            </Button>
          </div>
        </section>
      )}

      <div ref={previewRef} className="scroll-mt-4">
        {parsed && (
          <section className="sticker animate-rise relative mt-7 p-4">
            <span className="absolute -top-4 left-4 rotate-[-3deg] rounded-md border-2 border-ink bg-mustard px-3 py-0.5 text-[14px] font-black">
              局长是这么理解的 👇
            </span>
            <div className="pt-3">
              <Preview parsed={parsed} onChange={setParsed} />
            </div>
          </section>
        )}
      </div>

      {skip && !parsed && (
        <p className="mt-6 rounded-xl border-2 border-dashed border-ink-faint px-4 py-3 text-[14px] text-ink-soft">
          好，局长直接按「{prompt}」来组，进了局页再看细节。
        </p>
      )}

      {(parsed || parseErr || skip) && (
        <section className="sticker animate-rise mt-6 p-4">
          <label className="block">
            <span className="mb-2 block text-lg font-black">你的称呼</span>
            <input
              className="field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="群里大家怎么叫你"
              maxLength={12}
              enterKeyHint="go"
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </label>
          <Button size="lg" className="mt-4 w-full" onClick={create} loading={creating}>
            {creating ? "正在刻章…" : "盖章发起 →"}
          </Button>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-[13px] font-bold tracking-[0.3em] text-ink-faint">怎么玩</h2>
        <ol className="grid grid-cols-3 gap-3">
          {[
            ["💬", "说一句话", "AI 听懂时间人数预算"],
            ["📲", "甩进群", "朋友 10 秒填完"],
            ["🔴", "盖章成局", "公平选店 投票定局"],
          ].map(([icon, t, d], i) => (
            <li key={t} className="sticker p-3 text-center" style={{ transform: `rotate(${[-2, 1.5, -1][i]}deg)` }}>
              <div className="text-2xl">{icon}</div>
              <div className="mt-1 text-[15px] font-black">{t}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-ink-soft">{d}</div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

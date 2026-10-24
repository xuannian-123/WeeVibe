"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { compressImage } from "@/lib/client/image";
import { store } from "@/lib/client/storage";
import { Button, RotatingText, SealLogo } from "@/components/ui";
import { Stamp, StampSlam } from "@/components/Stamp";
import { toast } from "@/components/toast";
import { api, errMsg, type CreateResult } from "@/components/organizer/api";
import { SeedList, SpecPreview, type Draft } from "@/components/launch/SpecPreview";
import { Advanced, DEFAULT_ADV, deadlineIso, type AdvancedOpts } from "@/components/launch/Advanced";
import { InviteLinks } from "@/components/launch/InviteLinks";
import { QrSvg } from "@/components/screen/bits";
import { Guide, GuideButton, HOME_GUIDE, useGuide } from "@/components/Guide";

const EXAMPLES = ["周五晚上 8 个人吃火锅，人均 100", "周六下午打羽毛球", "今晚宵夜烧烤"];
const PARSE_LINES = ["局长正在翻黄历…", "掐指一算，宜聚餐…", "正在数人头…", "正在盘算人均…"];
const SHOT_LINES = ["局长正在看截图…", "谁说了去，谁说了不去…", "有人说要加班，记下了…", "数一数到底几个人…", "快好了，再等一下…"];

type Mode = "text" | "shot";

function TopBar() {
  // 本地存的局数在客户端才知道，挂载后再读，避免水合不一致
  const [mine, setMine] = useState(0);
  useEffect(() => setMine(store.myJu().length), []);
  const guide = useGuide("home");
  return (
    <div className="flex h-14 items-center gap-2.5">
      <SealLogo size={34} />
      <span className="text-[17px] font-black tracking-tight">AI 局长</span>
      <Link href="/firewall" className="ml-auto text-[13px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4">
        怎么保密
      </Link>
      <Link
        href="/me"
        className="pressable min-h-9 rounded-full border-2 border-ink bg-card px-3 py-1.5 text-[13px] font-black shadow-sticker-sm"
      >
        我的局{mine > 0 ? ` · ${mine}` : ""}
      </Link>
      <GuideButton onClick={guide.show} />
      <Guide steps={HOME_GUIDE} open={guide.open} onClose={guide.close} />
    </div>
  );
}

/** 在电脑上发起、用手机管：扫这个码，手机就拿到发起人身份（A1 的局页读 #admin=） */
function AdminHandoff({ id, token }: { id: string; token: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/j/${id}#admin=${encodeURIComponent(token)}`), [id, token]);
  return (
    <details className="mt-4 rounded-xl border-2 border-dashed border-ink-faint px-3.5 py-2">
      <summary className="min-h-10 cursor-pointer pt-1.5 text-[14px] font-bold text-ink-soft">📱 换到手机上管理这个局</summary>
      <div className="pb-2 pt-1 text-center">
        <p className="text-[12px] text-cinnabar-deep">这个码等于发起人钥匙，只给你自己扫，别发到群里。</p>
        {url && (
          <div className="mx-auto mt-2 w-40 rounded-xl border-2 border-ink bg-white p-2.5">
            <QrSvg text={url} className="aspect-square w-full" />
          </div>
        )}
      </div>
    </details>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("text");
  const [prompt, setPrompt] = useState("");
  const [shot, setShot] = useState<{ src: string; demo: boolean } | null>(null);
  const [parsing, setParsing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [adv, setAdv] = useState<AdvancedOpts>(DEFAULT_ADV);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<(CreateResult & { title: string; quorumMin?: number }) | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(store.getName() ?? "");
  }, []);

  const showPreview = () => setTimeout(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);

  const parseText = async (text = prompt) => {
    const t = text.trim();
    if (!t) return toast("先说一句你想组什么局");
    setPrompt(t);
    setParsing(true);
    setParseErr(null);
    setDraft(null);
    try {
      const r = await api.parse(t);
      setDraft({ title: r.title, spec: r.spec, seeds: [] });
      setAdv((a) => ({ ...a, quorumMin: Math.min(a.quorumMin, r.spec.headcount ?? 4) }));
      showPreview();
    } catch (e) {
      setParseErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  };

  const parseShot = async (image: string, preview: string, demo: boolean) => {
    setShot({ src: preview, demo });
    setParsing(true);
    setParseErr(null);
    setDraft(null);
    try {
      const r = await api.parseScreenshot(image);
      setDraft({ title: r.title, spec: r.spec, seeds: r.seeds, fallback: r.fallback });
      const yes = r.seeds.filter((s) => s.said !== "no").length;
      setAdv((a) => ({ ...a, quorumMin: Math.max(2, Math.min(yes || 4, r.spec.headcount ?? 4)) }));
      showPreview();
    } catch (e) {
      setParseErr(errMsg(e));
    } finally {
      setParsing(false);
    }
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return toast("要一张图片哦", "error");
    try {
      const data = await compressImage(f, 1600);
      await parseShot(data, data, false);
    } catch (e) {
      toast(errMsg(e), "error");
    }
  };

  const create = async () => {
    if (!name.trim()) return toast("留个称呼，大家才知道是谁组的局");
    const raw = mode === "text" ? prompt.trim() : draft?.title || "群聊截图开局";
    if (!raw) return toast("先说一句你想组什么局");
    setCreating(true);
    try {
      const deadline = deadlineIso(adv.deadline);
      const quorumMin = adv.quorumOn ? adv.quorumMin : undefined;
      const r = await api.createJu({
        prompt: raw,
        organizerName: name.trim().slice(0, 12),
        ...(draft ? { title: draft.title.trim() || undefined, spec: draft.spec } : {}),
        ...(draft?.seeds.length ? { seeds: draft.seeds } : {}),
        ...(deadline ? { deadline } : {}),
        ...(quorumMin ? { quorum: { min: quorumMin, ...(deadline ? { deadline } : {}) } } : {}),
        ...(adv.capacityOn ? { capacity: adv.capacity } : {}),
        tiers: adv.tiers,
      });
      store.setAdmin(r.id, r.adminToken);
      store.setName(name.trim());
      setCreated({ ...r, title: draft?.title || raw, quorumMin });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setCreating(false);
    }
  };

  /* ───────── 发起成功：每一圈一个链接 ───────── */
  if (created) {
    return (
      <main className="mx-auto w-full max-w-[480px] overflow-x-clip px-4 pb-16">
        <TopBar />
        <section className="relative pb-5 pt-6 text-center">
          <div className="mx-auto w-fit">
            <StampSlam size={150} text="开局" sub={new Date().toISOString().slice(0, 10).replace(/-/g, ".")} />
          </div>
          <h1 className="mt-4 text-[30px] font-black leading-tight">{created.title}</h1>
          <p className="mt-1.5 text-[14px] text-ink-soft">
            {created.tierLinks.length > 1 ? "先把核心圈的链接发到群里，其余几圈等有空位再发。" : "把下面这段话发到群里，剩下的交给局长。"}
          </p>
        </section>
        <section className="sticker p-4">
          <InviteLinks
            id={created.id}
            title={created.title}
            organizerName={name.trim()}
            quorumMin={created.quorumMin}
            links={created.tierLinks.map((l, i) => ({ ...l, locked: i > 0 }))}
          />
        </section>
        <Link
          href={`/j/${created.id}`}
          className="pressable mt-6 flex min-h-14 items-center justify-center rounded-[var(--radius-btn)] border-2 border-ink bg-cinnabar text-lg font-bold text-white shadow-sticker"
        >
          进局里，先跟局长聊聊你自己 →
        </Link>
        <p className="mt-2 text-center text-[13px] text-ink-faint">你也是局里的一员，你的预算、几点得回，局长同样保密。</p>
        <AdminHandoff id={created.id} token={created.adminToken} />
        <a
          href={`/j/${created.id}/screen`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex min-h-12 items-center justify-center gap-1.5 rounded-[var(--radius-btn)] border-2 border-dashed border-ink-faint text-[15px] font-bold text-ink-soft"
        >
          🖥️ 打开大屏（投屏 / 聚会现场用）
        </a>
      </main>
    );
  }

  const busyLines = mode === "text" ? PARSE_LINES : SHOT_LINES;

  return (
    <main className="mx-auto w-full max-w-[480px] overflow-x-clip px-4 pb-16">
      <TopBar />

      <section className="relative pb-6 pt-6">
        <div className="pointer-events-none absolute -right-2 top-2 rotate-12 opacity-90" aria-hidden>
          <Stamp size={108} text="成局" />
        </div>
        <h1 className="text-[40px] font-black leading-[1.1] tracking-tight">
          组局里的尴尬事，
          <br />
          都交给
          <span className="mx-1 inline-block -rotate-6 rounded-lg border-[3px] border-ink bg-cinnabar px-1.5 leading-[1.1] text-white shadow-sticker-sm">局长</span>
        </h1>
        <p className="mt-3 max-w-[320px] text-[15px] leading-relaxed text-ink-soft">
          预算紧、门禁早、不想去 —— 私下告诉局长就行。局长只对外说结论，帮大家挑一个对谁都公平的时间和店。
        </p>
      </section>

      <section className="sticker p-4">
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border-2 border-ink bg-paper-deep p-1" role="tablist">
          {(
            [
              ["text", "💬 说一句话"],
              ["shot", "🖼️ 甩张群聊截图"],
            ] as [Mode, string][]
          ).map(([m, t]) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              type="button"
              onClick={() => setMode(m)}
              className={`min-h-10 rounded-lg text-[15px] font-bold transition ${mode === m ? "bg-card shadow-sticker-sm ring-2 ring-ink" : "text-ink-soft"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <>
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
                  onClick={() => parseText(ex)}
                  disabled={parsing}
                  className="pressable min-h-11 rounded-full border-2 border-dashed border-ink bg-paper px-3 text-left text-[14px] font-semibold text-ink-soft"
                >
                  “{ex}”
                </button>
              ))}
            </div>
            <Button size="lg" className="mt-4 w-full" onClick={() => parseText()} loading={parsing}>
              {parsing ? <RotatingText lines={busyLines} /> : "让局长看看 →"}
            </Button>
          </>
        ) : (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFile(e.dataTransfer.files?.[0]);
              }}
              className="relative flex min-h-[150px] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border-2 border-dashed border-ink bg-paper px-4 py-5 text-center"
            >
              {shot && !shot.demo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={shot.src} alt="群聊截图" className={`max-h-[220px] rounded-lg border-2 border-ink object-contain ${parsing ? "opacity-60" : ""}`} />
              ) : shot?.demo ? (
                <span className="text-[44px]">💬</span>
              ) : (
                <>
                  <span className="text-[40px]">🖼️</span>
                  <span className="text-[16px] font-black">上传群里聊组局的截图</span>
                  <span className="text-[13px] text-ink-soft">局长会认出时间、地点，还有谁说了去、谁在加班</span>
                </>
              )}
              {parsing && (
                <span className="absolute inset-x-0 bottom-0 bg-ink/80 py-2 text-[14px] font-bold text-paper">
                  <RotatingText lines={busyLines} interval={1700} />
                  <span className="block text-[11px] font-normal opacity-70">看图一般要 5–10 秒</span>
                </span>
              )}
              {parsing && <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 animate-[scan_1.6s_ease-in-out_infinite] bg-cinnabar shadow-glow-red" />}
            </button>
            <style>{`@keyframes scan{0%{transform:translateY(0)}50%{transform:translateY(146px)}100%{transform:translateY(0)}}`}</style>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" disabled={parsing} onClick={() => fileRef.current?.click()}>
                📷 选截图
              </Button>
              <Button variant="gold" size="sm" disabled={parsing} onClick={() => parseShot("demo", "", true)}>
                用示例截图
              </Button>
            </div>
          </>
        )}
      </section>

      {parseErr && (
        <section className="animate-rise mt-6 rounded-[var(--radius-card)] border-2 border-cinnabar bg-cinnabar-soft p-4">
          <p className="mb-3 font-semibold text-cinnabar-deep">😵 {parseErr}</p>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={() => (mode === "text" ? parseText() : shot?.demo ? parseShot("demo", "", true) : fileRef.current?.click())}>
              再试一次
            </Button>
            {mode === "shot" && (
              <Button variant="ghost" size="sm" onClick={() => parseShot("demo", "", true)}>
                先用示例截图
              </Button>
            )}
          </div>
        </section>
      )}

      <div ref={previewRef} className="scroll-mt-4">
        {draft && (
          <section className="sticker animate-rise relative mt-7 p-4">
            <span className="absolute -top-4 left-4 rotate-[-3deg] rounded-md border-2 border-ink bg-mustard px-3 py-0.5 text-[14px] font-black">局长是这么理解的 👇</span>
            {draft.fallback && mode === "shot" && (
              <span className="absolute -top-3 right-4 rounded-full border-2 border-ink bg-card px-2 text-[11px] font-bold text-ink-soft">示例截图</span>
            )}
            <div className="pt-3">
              <SpecPreview draft={draft} onChange={setDraft} />
              <SeedList draft={draft} onChange={setDraft} />
            </div>
          </section>
        )}
      </div>

      {(draft || (parseErr && mode === "text")) && (
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
          <Advanced value={adv} onChange={setAdv} headcount={draft?.spec.headcount} />
          <Button size="lg" className="mt-4 w-full" onClick={create} loading={creating}>
            {creating ? "正在刻章…" : "盖章发起 →"}
          </Button>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-4 text-[13px] font-bold tracking-[0.3em] text-ink-faint">局长替你干的脏活</h2>
        <ol className="grid grid-cols-2 gap-3">
          {[
            ["🤫", "说不出口的话", "预算、门禁、不想去，私下说"],
            ["🎯", "凑够才成局", "凑不够悄悄作废，没人尴尬"],
            ["⚖️", "局长拍板", "算法定方案，谁都能复核"],
            ["🧾", "催人催钱", "私下提醒，群里不点名"],
          ].map(([icon, t, d], i) => (
            <li key={t} className="sticker p-3" style={{ transform: `rotate(${[-1.5, 1.2, 1, -1.2][i]}deg)` }}>
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

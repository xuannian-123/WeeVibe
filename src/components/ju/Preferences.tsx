"use client";

// v6 入局：授权书卡片（docs/AVATAR.md 5.2）——上一版"偏好卡片"的改造。
// 一进来就是卡片：格子按档案预填（标"上次的"），空格就是方向；下面说一句话，对应格子实时亮起；
// 唯一的追问是推断出的硬约束确认；底部是授权书三栏（底线 / 可以让 / 想要），「就这样」完成入局。
// 老用户直接看到预填好的授权书，"还和上次一样吗？"一键完成。没建过档的先走「认识你的分身」（可跳过）。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AvatarStyle, DayAvailability, DietTag, Give, JuState, Member, Mood, Profile } from "@/lib/types";
import type { JuActions } from "@/lib/client/useJu";
import { api, errMsg, type ChatBody } from "@/lib/client/api";
import { store } from "@/lib/client/storage";
import { dayLabel } from "@/lib/client/format";
import { LOCAL_ACTIVITIES } from "@/lib/client/activities";
import { CARE_TAGS, GIVE_BY_STYLE, GIVE_MAX, HARD_DIET, MAX_FLOORS, MOOD_LABEL, STYLE_LABEL } from "@/lib/client/mandate";
import { needsOnboarding } from "@/lib/client/profileFacts";
import { bodyOf, cellValues, draftFor, draftProblem, examplePrompt, litCells, missingRequired, type CellKey, type Day, type Draft } from "@/lib/client/intakeDraft";
import { Button, Chip, LockNote, SealLogo, Sheet, Spinner } from "../ui";
import { DIETS, PlacePicker, ScheduleWidget } from "./widgets";
import { OnboardingView } from "./Onboarding";

/** 入口：先看档案，没建过档的先走建档（可跳过），再进授权书卡片 */
export function PreferencesView({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const pid = me.profileId;
  const skipKey = `onboard-skip:${state.ju.id}`;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [phase, setPhase] = useState<"loading" | "onboard" | "card">(pid ? "loading" : "card");
  // 已经开始聊了 / 授权书写过了的人（刷新回来）不再拦建档
  const started = !!me.private?.mandate || (me.private?.chat ?? []).some((t) => t.role === "me");

  useEffect(() => {
    if (!pid) return;
    let stop = false;
    api
      .profile(pid)
      .then((p) => {
        if (stop) return;
        setProfile(p);
        setPhase(needsOnboarding(p) && !started && !store.getFlag(skipKey) ? "onboard" : "card");
      })
      .catch(() => !stop && setPhase("card"));
    return () => {
      stop = true;
    };
    // 只在进来时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  if (phase === "loading")
    return (
      <div className="flex justify-center py-16 text-ink-soft">
        <Spinner />
      </div>
    );
  if (phase === "onboard")
    return (
      <OnboardingView
        state={state}
        me={me}
        actions={actions}
        profile={profile}
        onSkip={() => {
          store.setFlag(skipKey);
          setPhase("card");
        }}
        onDone={async () => {
          if (pid) setProfile(await api.profile(pid).catch(() => profile));
          setPhase("card");
        }}
      />
    );
  return <MandateCard state={state} me={me} actions={actions} profile={profile} />;
}

// ---------------------------------------------------------------- 卡片

const CELL_META: Record<CellKey, { icon: string; label: string; empty: string }> = {
  when: { icon: "🗓", label: "哪天有空", empty: "点一下选" },
  from: { icon: "📍", label: "从哪出发", empty: "点一下选" },
  budget: { icon: "💰", label: "预算", empty: "点一下填" },
  mood: { icon: "🌡", label: "这次的状态", empty: "说说这次想怎样" },
  activity: { icon: "🎯", label: "想干什么", empty: "有想法就说，没有点「局长定」" },
  care: { icon: "🧷", label: "讲究", empty: "没有就空着" },
};
const BUDGET_CHIPS = [50, 80, 100, 150, 200, 300];
const EXTRA_DIETS = DIETS.filter((d) => !CARE_TAGS.some((t) => t.diet === d));
const GIVE_ROWS: { key: keyof Give; label: string; unit: (v: number) => string; step: number }[] = [
  { key: "lateMin", label: "晚到", unit: (v) => (v ? `最多晚 ${v} 分钟` : "不晚到"), step: 5 },
  { key: "stayCutMin", label: "少待", unit: (v) => (v ? `最多早走 ${v} 分钟` : "待满全程"), step: 5 },
  { key: "budgetUp", label: "多花", unit: (v) => (v ? `人均最多多花 ¥${v}` : "一分不多花"), step: 5 },
  { key: "commuteUp", label: "多走", unit: (v) => (v ? `路上最多多 ${v} 分钟` : "路程不让"), step: 5 },
];
const LIT_MS = 1800;

type FloorOption = { key: string; text: string; hard: boolean };

/** 授权书里能当底线的：硬的（门禁、清真 / 素食、硬需求）+ 本人可以亲手升级的软需求（保存时升成硬需求） */
function floorOptions(d: Draft, me: Member): FloorOption[] {
  const out: FloorOption[] = [];
  const homeBy = Object.values(d.days).find((x) => x.selected && x.homeBy)?.homeBy;
  if (homeBy) out.push({ key: "homeBy", text: `${homeBy} 前必须回去`, hard: true });
  // 忌口里只有清真 / 素食能当底线（规划器只把这两样当硬约束；不吃辣这类是"想要"）
  for (const t of d.diet) if (HARD_DIET.includes(t)) out.push({ key: `diet:${t}`, text: `只能吃${t}`, hard: true });
  const order = new Map((me.private?.confirmed ?? []).map((k, i) => [k, i]));
  for (const n of me.private?.needs ?? []) {
    const tag = CARE_TAGS.find((t) => t.match?.(n));
    if (tag && !d.tags.includes(tag.key)) continue; // 卡片上刚取消的讲究
    if (n.rule.t === "preferCategory") continue; // 想干什么不当底线
    out.push({ key: n.id, text: n.text, hard: n.kind === "hard" });
  }
  return out.sort((a, b) => Number(b.hard) - Number(a.hard) || (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

function MandateCard({ state, me, actions, profile }: { state: JuState; me: Member; actions: JuActions; profile: Profile | null }) {
  const [draft, setDraft] = useState(() => draftFor(state, me, profile));
  const [floorsTouched, setFloorsTouched] = useState(!!me.private?.mandate?.floors.length);
  const [dirty, setDirty] = useState(false);
  const [lit, setLit] = useState<CellKey[]>([]);
  const [open, setOpen] = useState<CellKey | null>(null);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [floorWarn, setFloorWarn] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [same, setSame] = useState(() => isReturning(me, profile));
  const litTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = me.private?.pendingConfirm;
  const avatarName = profile?.avatarName || "你的分身";

  useEffect(() => () => clearTimeout(litTimer.current), []);

  const values = cellValues(draft);
  const options = useMemo(() => floorOptions(draft, me), [draft, me]);
  const hardKeys = options.filter((o) => o.hard).map((o) => o.key);
  const floors = (floorsTouched ? draft.floors.filter((k) => options.some((o) => o.key === k)) : hardKeys).slice(0, MAX_FLOORS);
  const demoted = options.filter((o) => o.hard && !floors.includes(o.key));
  const final: Draft = { ...draft, floors };

  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch, ...(patch.mood !== undefined ? { moodGuessed: false } : {}) }));
    setDirty(true);
    setSame(false);
  };
  const setDay = (date: string, patch: Partial<Day>) => edit({ days: { ...draft.days, [date]: { ...draft.days[date], ...patch } } });
  const flash = (cells: CellKey[]) => {
    setLit(cells);
    clearTimeout(litTimer.current);
    litTimer.current = setTimeout(() => setLit([]), LIT_MS);
  };

  const badgeOf = (k: CellKey): string | undefined => {
    if (lit.includes(k)) return "刚听到";
    const auto = me.private?.autoFilled ?? [];
    if (k === "mood" && draft.moodGuessed) return "猜的";
    if (dirty) return undefined;
    if (k === "when" && auto.includes("availability")) return profile?.usualFrom ? "上次的" : "按活动预填";
    if (k === "budget" && auto.includes("budget")) return "上次的";
    if (k === "care" && auto.includes("diet")) return "上次的";
    if (k === "from" && profile?.lastLocation && draft.location?.label === profile.lastLocation.label) return "上次的";
    return undefined;
  };

  /** 说一句话：先存卡片上手动改过的，再交给局长抽取；变了的格子亮起来 */
  const send = async (message: string) => {
    if (busy || !message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (dirty && !pending) await actions.chat(bodyOf(final, "review"));
      const r = await actions.chat({ text: message.trim(), preferencesChat: true });
      const next = draftFor(state, r.me, profile);
      flash(litCells(draft, next));
      setDraft(next);
      setDirty(false);
      setSame(false);
      setText("");
      setReply(r.reply);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async (action: "finish" | "swipe", d: Draft = final) => {
    if (busy) return;
    setError(null);
    const problem = pending ? "先回答上面的确认问题。" : text.trim() ? "输入框里的话还没发给分身，先发送或清空。" : draftProblem(d);
    if (problem) {
      setError(problem);
      const miss = missingRequired(d)[0];
      if (miss && !pending && !text.trim()) {
        flash([miss]);
        setOpen(miss);
      }
      return;
    }
    setBusy(true);
    try {
      await actions.chat(bodyOf(d, action));
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const uploadSchedule = async (body: ChatBody) => {
    setBusy(true);
    setError(null);
    try {
      if (dirty) await actions.chat(bodyOf(final, "review"));
      const r = await actions.chat({ ...body, preferencesChat: true } as ChatBody);
      const next = draftFor(state, r.me, profile, { explicitTimes: true });
      flash(litCells(draft, next));
      setDraft(next);
      setDirty(false);
      setScheduleOpen(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleFloor = (key: string) => {
    setFloorsTouched(true);
    setSame(false);
    if (floors.includes(key)) {
      setDraft((d) => ({ ...d, floors: floors.filter((k) => k !== key) }));
      setFloorWarn(false);
    } else if (floors.length >= MAX_FLOORS) setFloorWarn(true);
    else setDraft((d) => ({ ...d, floors: [...floors, key] }));
  };

  const decline = async () => {
    if (busy || !window.confirm("这次来不了？群里不会显示你拒绝了，也不会说原因。")) return;
    setBusy(true);
    try {
      await actions.chat({ rsvp: "no", preferenceAction: "finish" });
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const wants = wantsOf(final, demoted);
  return (
    <div className="space-y-4 pb-10">
      {/* 分身开场 */}
      <div className="flex items-end gap-2" data-tour="preferences-intro">
        <SealLogo size={32} />
        <div className="bubble-jz animate-bubble-in max-w-[84%] px-3.5 py-2.5 text-[15px] leading-relaxed">
          <span className="font-black">{avatarName}</span>：{same ? "还和上次一样吗？一样的话点一下就好。" : values.when && values.from ? "我猜你这次……对的就不用动，不对的点一下改，或者直接跟我说。" : "跟我说一句这次的情况，我来填；空着的格子就是我还不知道的。"}
        </div>
      </div>

      {same && (
        <section className="animate-rise rounded-[var(--radius-card)] border-2 border-ink bg-mustard p-4 shadow-sticker">
          <p className="text-[17px] font-black">还和上次一样吗？</p>
          <p className="mt-1 text-[13px] leading-relaxed">时间、出发地、预算和讲究都按上次填好了，授权书也照旧。</p>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" loading={busy} onClick={() => void save("finish")}>一样，就这样 ✓</Button>
            <Button variant="secondary" disabled={busy} onClick={() => setSame(false)}>改一改</Button>
          </div>
        </section>
      )}

      <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-80">
        {/* 格子 */}
        <section className="sticker p-3.5" data-tour="preferences-card" aria-label="这次的需求">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="text-[17px] font-black">这次的你</h2>
            <LockNote>只有你和局长看得到</LockNote>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {(Object.keys(CELL_META) as CellKey[]).map((k) => {
              const meta = CELL_META[k];
              const v = values[k];
              const badge = badgeOf(k);
              const isLit = lit.includes(k);
              return (
                <button
                  key={`${k}-${isLit ? "lit" : "idle"}`}
                  type="button"
                  onClick={() => setOpen(k)}
                  aria-label={`${meta.label}：${v ?? "还空着"}`}
                  className={`pressable relative min-h-[86px] min-w-0 rounded-xl border-2 p-2.5 text-left transition-colors ${
                    isLit ? "animate-check-pop border-ink bg-mustard-soft ring-4 ring-mustard" : v ? "border-ink bg-card" : "border-dashed border-ink-faint bg-paper-deep/50"
                  }`}
                >
                  <span className="flex items-center gap-1 pr-12 text-[12px] font-bold text-ink-soft">
                    <span aria-hidden>{meta.icon}</span>
                    {meta.label}
                  </span>
                  {badge && (
                    <span className={`absolute right-1.5 top-1.5 rounded-full border px-1.5 py-px text-[10.5px] font-black ${badge === "刚听到" ? "border-ink bg-mustard" : badge === "猜的" ? "border-ink-faint bg-card text-ink-soft" : "border-ink/30 bg-paper-deep text-ink-soft"}`}>
                      {badge}
                    </span>
                  )}
                  <span className={`mt-1.5 line-clamp-2 block break-words text-[14px] leading-snug ${v ? "font-black" : "font-semibold text-ink-faint"}`}>{v ?? meta.empty}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 说一句话 */}
        <section className="rounded-[var(--radius-card)] border-2 border-ink bg-card p-3.5" data-tour="preferences-chat">
          {pending ? (
            <div className="space-y-3" role="group" aria-label="确认硬约束">
              <p className="bubble-jz px-3 py-2.5 text-[14.5px] leading-relaxed">确认一下：<b>{pending.text}</b>，是绝对不能变的吗？</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void send("对，必须")}>对，必须</Button>
                <Button size="sm" variant="secondary" onClick={() => void send("不是，尽量就行")}>不是，尽量就行</Button>
              </div>
              <p className="text-[12px] text-ink-faint">确认了就当底线，分身会死守；“尽量”的话分身可以商量。</p>
            </div>
          ) : (
            <>
              <label htmlFor="mandate-say" className="mb-1.5 block text-[15px] font-black">💬 随口说一句就行</label>
              <textarea
                id="mandate-say"
                className="field min-h-[76px] resize-y text-[15px]"
                maxLength={500}
                placeholder={examplePrompt(state.ju, profile?.places?.[0]?.place.label ?? me.location?.label)}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(text);
                }}
              />
              <div className="mt-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[12px] leading-snug text-ink-faint">🎤 懒得打字？用输入法的语音输入说完点发送</span>
                <Button size="sm" className="shrink-0" disabled={!text.trim()} loading={busy && !!text.trim()} onClick={() => void send(text)}>说给分身</Button>
              </div>
            </>
          )}
          {reply && !pending && <p role="status" className="bubble-jz animate-bubble-in mt-3 whitespace-pre-wrap px-3 py-2.5 text-[14px] leading-relaxed">{reply}</p>}
        </section>

        {draft.rsvp === "yes" && scheduleOpen && <ScheduleWidget busy={busy} onSubmit={uploadSchedule} onManual={() => setScheduleOpen(false)} />}

        {/* 授权书 */}
        <section className="sticker overflow-hidden" aria-label="授权书" data-tour="preferences-mandate">
          <div className="flex items-center justify-between gap-2 border-b-2 border-ink bg-ink px-4 py-2.5 text-paper">
            <h2 className="text-[16px] font-black">📜 授权书 · 交给{avatarName}</h2>
            <span className="text-[11px] font-bold text-mustard">{STYLE_LABEL[draft.style]}</span>
          </div>
          <div className="divide-y-2 divide-dashed divide-line">
            <MandateBlock title="🛡 底线" hint={`绝不谈 · 最多 ${MAX_FLOORS} 条`}>
              {options.length === 0 ? (
                <p className="text-[13px] text-ink-faint">没有底线。门禁、清真这类说了会自动出现在这里。</p>
              ) : (
                <ul className="space-y-1.5">
                  {options.map((o) => {
                    const on = floors.includes(o.key);
                    return (
                      <li key={o.key}>
                        <label className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border-2 px-3 py-2 text-[14px] ${on ? "border-ink bg-cinnabar-soft font-black" : "border-line bg-card"}`}>
                          <input type="checkbox" className="size-4 shrink-0 accent-[var(--color-cinnabar)]" checked={on} onChange={() => toggleFloor(o.key)} />
                          <span className="min-w-0 flex-1 break-words">{o.text}</span>
                          {!on && o.hard && <span className="shrink-0 text-[11px] text-ink-faint">降为想要</span>}
                          {!on && !o.hard && <span className="shrink-0 text-[11px] text-ink-faint">设为底线</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {(floorWarn || demoted.length > 0) && (
                <p className={`mt-2 text-[12.5px] leading-relaxed ${floorWarn ? "font-bold text-cinnabar" : "text-ink-soft"}`}>底线越少，分身越好谈；真正必须的事 {MAX_FLOORS} 条够用。{demoted.length > 0 && !floorWarn ? "没勾的会当成最用力的「想要」。" : ""}</p>
              )}
            </MandateBlock>

            <MandateBlock title="🤝 可以让" hint="分身自己做主，超出才来问你">
              <div className="mb-3 grid grid-cols-3 gap-1 rounded-xl border-2 border-ink bg-paper-deep p-1" role="radiogroup" aria-label="谈判风格">
                {(["easy", "balanced", "firm"] as AvatarStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={draft.style === s}
                    onClick={() => edit({ style: s, give: { ...GIVE_BY_STYLE[s] } })}
                    className={`min-h-10 rounded-lg text-[14px] font-black ${draft.style === s ? "border-2 border-ink bg-card shadow-sticker-sm" : "text-ink-soft"}`}
                  >
                    {STYLE_LABEL[s]}
                  </button>
                ))}
              </div>
              <div className="space-y-2.5">
                {GIVE_ROWS.map((r) => (
                  <label key={r.key} className="block">
                    <span className="flex items-center justify-between text-[13px]">
                      <span className="font-bold">{r.label}</span>
                      <span className="font-num text-ink-soft">{r.unit(draft.give[r.key])}</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={GIVE_MAX[r.key]}
                      step={r.step}
                      value={draft.give[r.key]}
                      aria-label={`可以${r.label}多少`}
                      onChange={(e) => edit({ give: { ...draft.give, [r.key]: Number(e.target.value) } })}
                      className="mt-1 w-full accent-[var(--color-cinnabar)]"
                    />
                  </label>
                ))}
              </div>
            </MandateBlock>

            <MandateBlock title="✨ 想要" hint="尽量争取">
              {wants.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {wants.map((w) => (
                    <span key={w.text} className={`rounded-full border-2 px-2.5 py-1 text-[13px] font-bold ${w.strong ? "border-ink bg-mustard" : "border-ink/30 bg-card"}`}>{w.text}</span>
                  ))}
                </div>
              ) : (
                <p className="text-[13px] text-ink-faint">没什么特别想要的——分身会照大家的意思来。</p>
              )}
            </MandateBlock>
          </div>
        </section>
      </fieldset>

      {error && <p role="alert" className="rounded-xl border-2 border-cinnabar bg-card p-3 text-[14px] text-cinnabar-deep">{error}</p>}
      <div data-tour="preferences-confirm" className="space-y-2">
        <Button className="w-full" size="lg" loading={busy && !text.trim()} onClick={() => void save("finish")}>就这样 ✓</Button>
        <div className="flex items-center justify-between gap-2">
          <button type="button" disabled={busy} onClick={() => void decline()} className="min-h-11 text-[13px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4">这次来不了</button>
          <Button variant="ghost" disabled={busy} onClick={() => void save("swipe")}>我还想挑几家店 →</Button>
        </div>
        <p className="text-center text-[12px] text-ink-faint">交出去之后仍然可以改；超出授权的让步，分身都会先私下问你。</p>
      </div>

      {/* 每个格子的编辑器 */}
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? `${CELL_META[open].icon} ${CELL_META[open].label}` : ""}>
        <div className="space-y-3 pb-4">
          {open === "when" && (
            <>
              <div className="space-y-2.5">
                {Object.entries(draft.days).map(([date, day]) => (
                  <div key={date} className={`rounded-xl border-2 p-3 ${day.selected ? "border-ink bg-mustard-soft/40" : "border-line"}`}>
                    <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[14px] font-bold">
                      <input type="checkbox" className="size-4 accent-[var(--color-cinnabar)]" checked={day.selected} onChange={(e) => setDay(date, { selected: e.target.checked })} />
                      {dayLabel(date)}
                      <span className="ml-auto text-[12px] font-normal text-ink-soft">{day.selected ? "可以" : "没空"}</span>
                    </label>
                    {day.selected && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <label className="text-[12px] text-ink-soft">最早能出发
                          <input type="time" aria-label={`${dayLabel(date)}最早能出发`} className="field mt-1 min-w-0 px-2 py-2 text-[14px]" value={day.from} onChange={(e) => setDay(date, { from: e.target.value })} />
                        </label>
                        <label className="text-[12px] text-ink-soft">必须到家（可不填）
                          <input type="time" aria-label={`${dayLabel(date)}必须到家`} className="field mt-1 min-w-0 px-2 py-2 text-[14px]" value={day.homeBy ?? ""} onChange={(e) => setDay(date, { homeBy: e.target.value || undefined })} />
                        </label>
                        <label className="col-span-2 flex items-center justify-between gap-2 text-[12px] text-ink-soft">这天的意愿
                          <select className="field w-auto py-1 text-[13px]" value={day.pref} onChange={(e) => setDay(date, { pref: e.target.value as DayAvailability["pref"] })}>
                            <option value="ok">可以</option><option value="best">最好这天</option><option value="meh">勉强能来</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" className="min-h-10 text-[13px] font-bold text-cinnabar" onClick={() => { setOpen(null); setScheduleOpen(true); }}>📷 从课表 / 排班截图导入</button>
            </>
          )}
          {open === "from" && (
            <>
              {!!profile?.places?.length && (
                <div className="flex flex-wrap gap-2">
                  {profile.places.map((p, i) => (
                    <Chip key={`${p.kind}-${i}`} selected={draft.location?.label === p.place.label} onClick={() => { edit({ location: { ...p.place } }); setOpen(null); }}>
                      {p.kind === "home" ? "🏠" : p.kind === "work" ? "🏢" : p.kind === "school" ? "🎓" : "📍"} {p.place.label || "常用地点"}
                    </Chip>
                  ))}
                </div>
              )}
              <PlacePicker city={state.ju.spec.city} value={draft.location} onChange={(location) => edit({ location })} />
            </>
          )}
          {open === "budget" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {BUDGET_CHIPS.map((b) => (
                  <Chip key={b} selected={Number(draft.budget) === b} onClick={() => edit({ budget: String(b) })}>¥{b}</Chip>
                ))}
              </div>
              <label htmlFor="mandate-budget" className="flex items-center justify-between gap-3 text-[14px] font-bold">或者直接填（人均上限）
                <span className="flex items-center gap-1">¥ <input id="mandate-budget" type="number" inputMode="numeric" min="1" max="100000" className="field w-24 px-2 py-2" value={draft.budget} onChange={(e) => edit({ budget: e.target.value })} /></span>
              </label>
              <LockNote>这个数只有局长知道，群里只会说“有人预算偏紧”</LockNote>
            </>
          )}
          {open === "mood" && (
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MOOD_LABEL) as Mood[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={draft.mood === m}
                  onClick={() => { edit({ mood: draft.mood === m ? undefined : m }); setOpen(null); }}
                  className={`pressable min-h-16 rounded-xl border-2 border-ink text-[15px] font-black ${draft.mood === m ? "bg-mustard shadow-sticker-sm" : "bg-card"}`}
                >
                  <span className="mr-1 text-[20px]" aria-hidden>{MOOD_LABEL[m].emoji}</span>{MOOD_LABEL[m].text}
                </button>
              ))}
            </div>
          )}
          {open === "activity" && (
            <>
              <Chip selected={draft.activityOpen} onClick={() => edit({ activityOpen: !draft.activityOpen, activities: [] })} className="w-full">🎲 局长定（按大家的状态挑）</Chip>
              <div className="flex flex-wrap gap-2">
                {LOCAL_ACTIVITIES.map((a) => (
                  <Chip
                    key={a.key}
                    selected={!draft.activityOpen && draft.activities.includes(a.key)}
                    onClick={() => edit({ activityOpen: false, activities: draft.activities.includes(a.key) ? draft.activities.filter((k) => k !== a.key) : [...draft.activities, a.key].slice(0, 6) })}
                    className="px-3 text-[14px]"
                  >
                    {a.emoji} {a.name}
                  </Chip>
                ))}
              </div>
            </>
          )}
          {open === "care" && (
            <>
              <div className="flex flex-wrap gap-2">
                {CARE_TAGS.map((t) => {
                  const on = t.diet ? draft.diet.includes(t.diet) : draft.tags.includes(t.key);
                  return (
                    <Chip
                      key={t.key}
                      selected={on}
                      onClick={() => (t.diet ? edit({ diet: on ? draft.diet.filter((x) => x !== t.diet) : [...draft.diet, t.diet] }) : edit({ tags: on ? draft.tags.filter((x) => x !== t.key) : [...draft.tags, t.key] }))}
                      className="px-3 text-[14px]"
                    >
                      {t.label}
                    </Chip>
                  );
                })}
                {EXTRA_DIETS.map((d: DietTag) => (
                  <Chip key={d} selected={draft.diet.includes(d)} onClick={() => edit({ diet: draft.diet.includes(d) ? draft.diet.filter((x) => x !== d) : [...draft.diet, d] })} className="px-3 text-[14px]">{d}</Chip>
                ))}
              </div>
              <p className="text-[12px] text-ink-faint">都是“尽量”；绝对不能碰的，在授权书的「底线」里勾上。</p>
            </>
          )}
          <Button className="w-full" onClick={() => setOpen(null)}>好了</Button>
        </div>
      </Sheet>
    </div>
  );
}

function MandateBlock({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-black">{title}</h3>
        <span className="text-[11.5px] text-ink-faint">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/** 想要一栏（展示用；和 mandateOf 的 wants 对应：被降级的底线最用力） */
function wantsOf(d: Draft, demoted: FloorOption[]): { text: string; strong: boolean }[] {
  const v = cellValues(d);
  const out: { text: string; strong: boolean }[] = demoted.map((o) => ({ text: o.text, strong: true }));
  if (v.mood) out.push({ text: v.mood, strong: d.style === "firm" });
  if (v.activity) out.push({ text: v.activity, strong: d.style === "firm" });
  if (v.budget) out.push({ text: v.budget, strong: d.style === "firm" });
  for (const k of d.tags) {
    const t = CARE_TAGS.find((x) => x.key === k);
    if (t && !d.floors.some((f) => !!t.need && f.endsWith(`-${t.need.rule.t}`))) out.push({ text: t.label, strong: d.style === "firm" });
  }
  for (const t of d.diet) if (!HARD_DIET.includes(t) && !d.floors.includes(`diet:${t}`)) out.push({ text: t, strong: false });
  return out.filter((x, i, a) => a.findIndex((y) => y.text === x.text) === i);
}

/** 老朋友：档案里有上次的记录、这次的格子按档案预填过、还没开口说话 */
function isReturning(me: Member, profile: Profile | null): boolean {
  if (!profile || me.private?.pendingConfirm) return false;
  // 建档只写偏好；入局完成过才会有 name / usualFrom / 账本
  const known = profile.ledger.length > 0 || !!profile.usualFrom || !!profile.name;
  const said = (me.private?.chat ?? []).some((t) => t.role === "me");
  return known && !said && !!me.location && Object.keys(me.private?.availability ?? {}).length > 0;
}

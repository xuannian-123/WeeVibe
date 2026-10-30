"use client";

import { useState } from "react";
import type { DayAvailability, DietTag, JuState, Member, Place } from "@/lib/types";
import type { JuActions } from "@/lib/client/useJu";
import { errMsg, type ChatBody } from "@/lib/client/api";
import { dayLabel } from "@/lib/client/format";
import { Button, Chip, LockNote } from "../ui";
import { DIETS, PlacePicker, ScheduleWidget, juDates } from "./widgets";

type Day = DayAvailability & { selected: boolean };
type Draft = { rsvp: "yes" | "no"; location: Place | null; days: Record<string, Day>; budget: string; diet: DietTag[] };

function draftFor(state: JuState, me: Member, explicitTimes = false): Draft {
  const p = me.private;
  const [h, m] = state.ju.spec.earliest.split(":").map(Number);
  const minutes = Math.max(0, h * 60 + m - 30);
  const from = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const hasTimes = Object.keys(p?.availability ?? {}).length > 0;
  return {
    rsvp: p?.rsvp ?? "yes",
    location: me.location ?? null,
    days: Object.fromEntries(juDates(state.ju).map((date) => [date, { from, pref: "ok", ...p?.availability[date], selected: (!hasTimes && !explicitTimes) || !!p?.availability[date] }])),
    budget: String(p?.budgetMax ?? state.ju.spec.budgetPerPerson ?? 100),
    diet: [...(p?.dietTags ?? [])],
  };
}

export function PreferencesView({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const [draft, setDraft] = useState(() => draftFor(state, me));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [chatOpen, setChatOpen] = useState(!!me.private?.pendingConfirm);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [hasReply, setHasReply] = useState(!!me.private?.pendingConfirm);
  const pending = me.private?.pendingConfirm;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const setDay = (date: string, patch: Partial<Day>) => setDraft((d) => ({ ...d, days: { ...d.days, [date]: { ...d.days[date], ...patch } } }));
  const availability = Object.fromEntries(Object.entries(draft.days).filter(([, day]) => day.selected).map(([date, day]) => [date, { from: day.from, pref: day.pref, ...(day.homeBy ? { homeBy: day.homeBy } : {}) }]));
  const form = { rsvp: draft.rsvp, ...(draft.location ? { location: draft.location } : {}), availability, budgetMax: Number(draft.budget), dietTags: draft.diet };

  const save = async (preferenceAction: "finish" | "swipe") => {
    if (busy) return;
    setError(null);
    if (draft.rsvp === "yes") {
      const problem = !draft.location ? "先选一个出发地，局长才能安排通勤。"
        : !Object.keys(availability).length ? "至少选一个可用日期；这次都没空也可以选“来不了”。"
          : !Number.isFinite(form.budgetMax) || form.budgetMax <= 0 || form.budgetMax > 100000 ? "填一个有效的人均预算。"
            : Object.values(availability).some((a) => !a.from || (a.homeBy && a.homeBy <= a.from)) ? "请确认出发时间，到家时间需晚于出发时间。"
              : pending ? "先回答局长的确认问题，再提交偏好。" : text.trim() ? "这段话还没发给局长，先发送或清空后再确认。" : null;
      if (problem) {
        setError(problem);
        if (pending || text.trim()) setChatOpen(true);
        return;
      }
    }
    setBusy(true);
    try {
      await actions.chat(draft.rsvp === "no" ? { rsvp: "no", preferenceAction: "finish" } : { ...form, preferenceAction });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async (message: string) => {
    if (busy || !message.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // 先存当前卡片，让局长知道已选内容；确认问题的回答不覆盖刚抽取出的约束。
      if (!pending) await actions.chat({ ...form, preferenceAction: "review" });
      const result = await actions.chat({ text: message.trim(), preferencesChat: true });
      setDraft(draftFor(state, result.me, true));
      setText("");
      setHasReply(true);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const uploadSchedule = async (body: ChatBody) => {
    setBusy(true);
    setError(null);
    try {
      await actions.chat({ ...form, preferenceAction: "review" });
      const result = await actions.chat({ ...body, preferencesChat: true });
      setDraft(draftFor(state, result.me, true));
      setScheduleOpen(false);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const lastReply = [...(me.private?.chat ?? [])].reverse().find((t) => t.role === "juzhang")?.text;
  return (
    <div className="space-y-4 pb-8">
      <div data-tour="preferences-intro" className="pt-1">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="rounded-full border-2 border-ink bg-mustard px-2.5 py-1 text-[12px] font-black">一张卡，确认就好</span>
          <LockNote>预算和忌口只给局长看</LockNote>
        </div>
        <h2 className="text-[26px] font-black tracking-tight">看看这些安排合不合适</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          {me.private?.autoFilled.length ? "按你上次的习惯先填好了，哪里变了直接改。" : "时间和预算先按活动预填，确认或改一下就能报名。"}
        </p>
      </div>

      <fieldset disabled={busy} className="min-w-0 space-y-4 disabled:opacity-70">
        <section className="sticker space-y-4 p-4" data-tour="preferences-card" aria-label="我的偏好卡片">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[15px] font-black">这次能来吗？</h3>
            <div className="flex gap-2">
              <Chip selected={draft.rsvp === "yes"} onClick={() => set({ rsvp: "yes" })}>能来</Chip>
              <Chip selected={draft.rsvp === "no"} onClick={() => set({ rsvp: "no" })}>来不了</Chip>
            </div>
          </div>
          {draft.rsvp === "no" ? (
            <p className="rounded-xl bg-mustard-soft p-3 text-[14px] leading-relaxed">没关系，确认后悄悄退出。群里不会显示你拒绝了，也不会说明原因。</p>
          ) : (
            <>
              <div className="border-t-2 border-dashed border-line pt-3">
                <h3 className="mb-2 text-[15px] font-black">📍 从哪出发</h3>
                <PlacePicker city={state.ju.spec.city} value={draft.location} onChange={(location) => set({ location })} />
              </div>
              <div className="border-t-2 border-dashed border-line pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-[15px] font-black">🗓 哪天有空</h3>
                  <button type="button" className="min-h-10 text-[13px] font-bold text-cinnabar" onClick={() => setScheduleOpen(!scheduleOpen)}>从课表导入</button>
                </div>
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
                <p className="mt-2 text-[12px] text-ink-faint">到家时间会预留返程通勤；只是想早点走，可以私聊说明。</p>
              </div>
              <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-line pt-3">
                <label htmlFor="preference-budget" className="text-[15px] font-black">💰 人均预算上限</label>
                <div className="flex items-center gap-1 text-[14px] font-bold">
                  ¥ <input id="preference-budget" type="number" inputMode="numeric" min="1" max="100000" step="1" className="field w-24 px-2 py-2" value={draft.budget} onChange={(e) => set({ budget: e.target.value })} />
                </div>
              </div>
              <div className="border-t-2 border-dashed border-line pt-3">
                <h3 className="mb-2 text-[15px] font-black">🥢 忌口</h3>
                <div className="flex flex-wrap gap-2">
                  <Chip selected={!draft.diet.length} onClick={() => set({ diet: [] })}>无忌口</Chip>
                  {DIETS.map((tag) => <Chip key={tag} selected={draft.diet.includes(tag)} onClick={() => set({ diet: draft.diet.includes(tag) ? draft.diet.filter((d) => d !== tag) : [...draft.diet, tag] })}>{tag}</Chip>)}
                </div>
              </div>
            </>
          )}
        </section>

        {draft.rsvp === "yes" && scheduleOpen && <ScheduleWidget busy={busy} onSubmit={uploadSchedule} onManual={() => setScheduleOpen(false)} />}

        {draft.rsvp === "yes" && (
          <section className="rounded-xl border-2 border-dashed border-ink-faint bg-card p-3.5" data-tour="preferences-chat">
            <button type="button" aria-expanded={chatOpen || !!pending} aria-controls="preferences-private-chat" className="flex min-h-11 w-full items-center justify-between gap-2 text-left" onClick={() => setChatOpen(!chatOpen)}>
              <span><span className="block text-[15px] font-black">还有什么想悄悄告诉局长？</span><span className="text-[12px] text-ink-soft">可选 · 不喝酒、怕冷场、想早点走……</span></span>
              <span aria-hidden>{chatOpen || pending ? "−" : "+"}</span>
            </button>
            {(chatOpen || pending) && (
              <div id="preferences-private-chat" className="mt-2 space-y-3">
                {hasReply && lastReply && <p role="status" className="bubble-jz whitespace-pre-wrap px-3 py-2.5 text-[14px] leading-relaxed">{lastReply}</p>}
                {pending ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void send("对，必须")}>对，必须</Button>
                    <Button size="sm" variant="secondary" onClick={() => void send("不是，尽量就行")}>不是，尽量就行</Button>
                  </div>
                ) : (
                  <>
                    <textarea className="field min-h-20 resize-y text-[14px]" maxLength={500} aria-label="悄悄告诉局长" placeholder="复杂的情况在这里说，局长只在需要时追问。" value={text} onChange={(e) => setText(e.target.value)} />
                    <Button size="sm" variant="secondary" className="w-full" disabled={!text.trim()} onClick={() => void send(text)}>告诉局长</Button>
                  </>
                )}
                {!!me.private?.notes.length && <p className="text-[12px] leading-relaxed text-ink-soft">已记下：{me.private.notes.filter((n) => !n.startsWith("__")).join("；")}</p>}
              </div>
            )}
          </section>
        )}
      </fieldset>

      {error && <p role="alert" className="rounded-xl border-2 border-cinnabar bg-card p-3 text-[14px] text-cinnabar-deep">{error}</p>}
      <div data-tour="preferences-confirm" className="space-y-2">
        <Button className="w-full" loading={busy} onClick={() => void save("finish")}>{draft.rsvp === "no" ? "确认，这次先不参加" : "确认偏好，报名完成 ✓"}</Button>
        {draft.rsvp === "yes" && <Button variant="ghost" className="w-full" disabled={busy} onClick={() => void save("swipe")}>我还想挑几家店 →</Button>}
        <p className="text-center text-[12px] text-ink-faint">确认后仍可修改，局长会替大家协调。</p>
      </div>
    </div>
  );
}

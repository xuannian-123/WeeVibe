"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatReply, ChatTurn, ChatWidget, JuState, Member } from "@/lib/types";
import { errMsg, type ChatBody } from "@/lib/client/api";
import { store } from "@/lib/client/storage";
import type { JuActions } from "@/lib/client/useJu";
import { Avatar, Button, LockNote, SealLogo, TypingDots } from "../ui";
import { toast } from "../toast";
import {
  BudgetWidget,
  DietWidget,
  LocationWidget,
  RsvpWidget,
  ScheduleWidget,
  TimeWidget,
  WidgetCard,
  privateSummary,
  type WidgetSubmit,
} from "./widgets";

type EditKey = "availability" | "budget" | "diet" | "location";
const EDIT_WIDGET: Record<EditKey, ChatWidget> = { availability: "time", budget: "budget", diet: "diet", location: "location" };

/** 刷新页面后不知道局长上一轮弹的是什么组件：优先用本机存的，过期了就按缺什么推断 */
export function currentReply(state: JuState, me: Member): ChatReply {
  const p = me.private;
  const lastJz = [...(p?.chat ?? [])].reverse().find((t) => t.role === "juzhang");
  const saved = store.getJson<ChatReply>(`jz:reply:${state.ju.id}`);
  const stale =
    !saved ||
    (saved.widget === "rsvp" && !!p?.rsvp) ||
    (saved.widget === "location" && !!me.location) ||
    (saved.widget === "time" && Object.keys(p?.availability ?? {}).length > 0) ||
    (saved.widget === "budget" && p?.budgetMax != null) ||
    (lastJz && saved.reply && saved.reply !== lastJz.text);
  if (saved && !stale) return saved;

  let widget: ChatWidget = null;
  if (!p?.rsvp && state.ju.quorum?.state === "pending") widget = "rsvp";
  else if (!me.location) widget = "location";
  else if (!Object.keys(p?.availability ?? {}).length) widget = "time";
  else if (p?.budgetMax == null && !p?.autoFilled.includes("budget")) widget = "budget";
  return {
    reply: lastJz?.text ?? "",
    widget,
    quickReplies: widget === "time" || widget === "budget" ? ["都行"] : widget ? [] : ["没有了", "就这些"],
    done: false,
  };
}

function Bubble({ turn, me, first }: { turn: ChatTurn; me: Member; first: boolean }) {
  const mine = turn.role === "me";
  return (
    <li className={`animate-bubble-in flex items-end gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <span className={`w-8 shrink-0 ${first ? "" : "invisible"}`} aria-hidden={!first}>
        {mine ? <Avatar emoji={me.avatar} size={32} /> : <SealLogo size={30} />}
      </span>
      <p
        className={`max-w-[78%] whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15.5px] leading-relaxed ${
          mine ? "bubble-me" : "bubble-jz"
        }`}
      >
        {turn.text}
      </p>
    </li>
  );
}

/** #6 局长替你预填了：展示内容，每项可改 */
function AutofillCard({ me, onEdit, onOk }: { me: Member; onEdit: (k: EditKey) => void; onOk: () => void }) {
  const rows = privateSummary(me).filter((r) => r.auto || r.key === "availability" || r.key === "budget");
  return (
    <WidgetCard title="局长先帮你填好了 ✍️" lock="只有你和局长看得到" className="border-dashed">
      <ul className="divide-y-2 divide-dashed divide-line">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2 py-2">
            <span className="w-10 shrink-0 text-[13px] font-bold text-ink-soft">{r.label}</span>
            <span className="min-w-0 flex-1 text-[14px] font-semibold leading-snug">
              {r.value}
              {r.auto && (
                <span className="ml-1.5 inline-block rounded border border-dashed border-ink px-1 text-[11px] font-bold text-ink-soft">
                  局长猜的
                </span>
              )}
            </span>
            <button type="button" onClick={() => onEdit(r.key)} className="min-h-11 shrink-0 px-2 text-[14px] font-bold text-cinnabar">
              改
            </button>
          </li>
        ))}
      </ul>
      <Button className="mt-2 w-full" size="sm" variant="gold" onClick={onOk}>
        没问题 ✓
      </Button>
    </WidgetCard>
  );
}

export function ChatView({
  state,
  me,
  actions,
  onSwipe,
}: {
  state: JuState;
  me: Member;
  actions: JuActions;
  onSwipe: () => void;
}) {
  const { ju } = state;
  const juId = ju.id;
  const serverChat = me.private?.chat ?? [];
  const [reply, setReply] = useState<ChatReply>(() => currentReply(state, me));
  const [pending, setPending] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typingLabel, setTypingLabel] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditKey | null>(null);
  const [scheduleMode, setScheduleMode] = useState(false);
  const [text, setText] = useState("");
  const [afAck, setAfAck] = useState(() => store.getFlag(`af:${juId}`));
  const endRef = useRef<HTMLDivElement>(null);

  // 局长的回复如果后端没写进 chat，也补在末尾显示
  const turns: ChatTurn[] = [...serverChat];
  const lastJz = [...serverChat].reverse().find((t) => t.role === "juzhang");
  if (reply.reply && (!lastJz || lastJz.text !== reply.reply) && !typing) {
    turns.push({ role: "juzhang", text: reply.reply, at: "" });
  }
  if (pending) turns.push({ role: "me", text: pending, at: "" });

  const autoFilled = me.private?.autoFilled ?? [];
  const showAutofill = autoFilled.length > 0 && !afAck && !typing && !edit;

  let widget: ChatWidget = typing ? null : edit ? EDIT_WIDGET[edit] : reply.widget;
  if (widget === "time" && scheduleMode) widget = "schedule";
  const finished = !typing && !edit && (reply.done || reply.widget === "swipe");

  useLayoutEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, typing, widget, showAutofill]);

  useEffect(() => {
    if (widget !== "time" && widget !== "schedule") setScheduleMode(false);
  }, [widget]);

  const send = async (body: ChatBody, say: string) => {
    if (typing) return;
    setPending(say);
    setTyping(true);
    setTypingLabel("schedule" in body && body.schedule ? "局长正在看你的课表…" : null);
    const minWait = new Promise((r) => setTimeout(r, 650));
    try {
      const [r] = await Promise.all([actions.chat(body), minWait]);
      setReply({ reply: r.reply, widget: r.widget, quickReplies: r.quickReplies, done: r.done });
      setEdit(null);
      if (body && "autofill" in body) {
        setAfAck(false);
        store.setFlag(`af:${juId}`, false);
      }
    } catch (e) {
      toast(errMsg(e), "error");
      if ("text" in body) setText(body.text);
    } finally {
      setPending(null);
      setTyping(false);
    }
  };

  const submit: WidgetSubmit = (body, say) => send(body, say);

  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    void send({ text: t }, t);
  };

  const p = me.private;
  const widgetEl = (() => {
    switch (widget) {
      case "rsvp":
        return <RsvpWidget onSubmit={submit} busy={typing} />;
      case "location":
        return <LocationWidget ju={ju} initial={me.location} onSubmit={submit} busy={typing} />;
      case "time":
        return <TimeWidget ju={ju} initial={p?.availability} onSubmit={submit} onSchedule={() => setScheduleMode(true)} busy={typing} />;
      case "schedule":
        return <ScheduleWidget onSubmit={submit} onManual={reply.widget === "schedule" && !scheduleMode ? undefined : () => setScheduleMode(false)} busy={typing} />;
      case "diet":
        return <DietWidget initial={p?.dietTags} onSubmit={submit} busy={typing} />;
      case "budget":
        return <BudgetWidget initial={p?.budgetMax} publicBudget={ju.spec.budgetPerPerson} onSubmit={submit} busy={typing} />;
      default:
        return null;
    }
  })();

  const quick = typing || edit || finished ? [] : reply.quickReplies.filter(Boolean).slice(0, 4);
  const firstOfRun = (i: number) => i === 0 || turns[i - 1].role !== turns[i].role;

  return (
    <div className="pb-40">
      <div className="mx-auto mb-4 mt-1 flex max-w-[320px] flex-col items-center gap-1.5 text-center">
        <LockNote>私聊 · 只有你和局长</LockNote>
        <p className="text-[12.5px] leading-relaxed text-ink-faint">
          预算、门禁、来不来，群里都看不到。局长对外只说结论，而且能证明没说漏。
        </p>
      </div>

      <ul className="space-y-2.5">
        {turns.map((t, i) => (
          <Bubble key={`${i}-${t.text.slice(0, 8)}`} turn={t} me={me} first={firstOfRun(i)} />
        ))}
        {typing && (
          <li className="animate-bubble-in flex items-end gap-2">
            <SealLogo size={30} />
            <span className="bubble-jz flex items-center gap-2.5 px-4 py-3.5">
              <TypingDots />
              {typingLabel && <span className="text-[14px] font-semibold text-ink-soft">{typingLabel}</span>}
            </span>
          </li>
        )}
      </ul>

      {edit && (
        <div className="mt-3 flex items-center justify-between px-1 text-[13px] text-ink-soft">
          <span>改一下，局长会重新记下</span>
          <button type="button" className="min-h-11 px-2 font-bold" onClick={() => setEdit(null)}>
            算了
          </button>
        </div>
      )}
      {widgetEl && <div className="mt-3 pl-10">{widgetEl}</div>}

      {showAutofill && (
        <div className="mt-3 pl-10">
          <AutofillCard
            me={me}
            onEdit={(k) => setEdit(k)}
            onOk={() => {
              setAfAck(true);
              store.setFlag(`af:${juId}`);
            }}
          />
        </div>
      )}

      {finished && (
        <div className="mt-4 pl-10">
          <div className="sticker animate-bubble-in bg-mustard-soft p-4">
            <p className="text-[16px] font-black">最后一步：刷几家店 🃏</p>
            <p className="mt-1 text-[13px] text-ink-soft">右滑想去，上滑超想去，左滑不想。大概 10 秒。</p>
            <Button className="mt-3 w-full" onClick={onSwipe}>
              开始刷卡 →
            </Button>
          </div>
        </div>
      )}
      <div ref={endRef} className="h-2" />

      {/* 输入区 */}
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-paper/95 pt-2 backdrop-blur">
        <div className="mx-auto max-w-[480px] px-3">
          {quick.length > 0 && (
            <div className="no-scrollbar -mx-3 mb-2 flex gap-2 overflow-x-auto px-3">
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    if (/课表|排班/.test(q) && (widget === "time" || widget === "schedule")) return setScheduleMode(true);
                    void send(/^(都行|随便|你定)|都行，?你定/.test(q) && widget ? { autofill: true } : { text: q }, q);
                  }}
                  className="pressable min-h-10 shrink-0 rounded-full border-2 border-ink bg-card px-3.5 text-[14px] font-bold shadow-sticker-sm"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              sendText();
            }}
          >
            <input
              className="field min-h-11 flex-1 rounded-full py-2"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={finished ? "还有想说的也可以告诉局长" : "悄悄告诉局长…"}
              enterKeyHint="send"
              maxLength={200}
              aria-label="和局长说"
            />
            <button
              type="submit"
              disabled={!text.trim() || typing}
              aria-label="发送"
              className="pressable flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-cinnabar text-white shadow-sticker-sm disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 12l16-8-6 16-2.5-6.5L4 12z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

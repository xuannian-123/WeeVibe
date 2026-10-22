"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { JuState, Member } from "@/lib/types";
import { activeMembers, dayLabel, organizer, shortPlace, slotCounts, slotDate, slotTime } from "@/lib/client/format";
import { errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Avatar, Button, RotatingText, SectionTitle, copyText } from "../ui";
import { toast } from "../toast";

const PLAN_LINES = [
  "局长正在掐指一算…",
  "正在找让最远的人也不吃亏的点…",
  "翻遍附近的店，挑评分高的…",
  "核对谁不吃辣…",
  "给每个人算通勤时间…",
];

export function shareMessage(state: JuState, url: string) {
  const org = organizer(state);
  return `【${state.ju.title}】${org ? org.name + " " : ""}组了个局！10 秒填一下你啥时候有空、从哪出发，AI 局长帮大家挑个离谁都不远的店 👉 ${url}`;
}

/** 微信右上角分享引导 */
export function WechatGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <button
      className="animate-fade-in fixed inset-0 z-[60] bg-ink/85 text-left text-paper"
      onClick={onClose}
      aria-label="关闭分享引导"
    >
      <svg className="absolute right-5 top-3 h-28 w-24" viewBox="0 0 96 112" fill="none" aria-hidden>
        <path d="M14 104 C 20 60, 50 36, 80 14" stroke="#f2b530" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 9" />
        <path d="M62 12 L82 12 L80 32" stroke="#f2b530" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="absolute inset-x-6 top-36">
        <p className="mb-3 text-2xl font-black leading-snug">
          点右上角 <span className="rounded-md bg-mustard px-2 text-ink">···</span>
        </p>
        <p className="text-lg leading-relaxed">
          选「发送给朋友」，挑你们的群
          <br />
          或者先复制群消息，直接粘到群里 ✌️
        </p>
        <p className="mt-10 text-sm text-cream-faint">点任意处关闭</p>
      </div>
    </button>
  );
}

export function SharePanel({ state, isAdmin }: { state: JuState; isAdmin: boolean }) {
  const [url, setUrl] = useState("");
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    setUrl(`${window.location.origin}/j/${state.ju.id}`);
  }, [state.ju.id]);
  const msg = shareMessage(state, url);

  return (
    <section className="sticker relative p-4">
      <SectionTitle hint={isAdmin ? "发群里，等大家来填" : "帮局长拉人"}>📣 把局甩进群</SectionTitle>
      <blockquote className="mb-3 rounded-xl border-2 border-dashed border-ink-faint bg-paper px-3 py-2.5 text-[14px] leading-relaxed text-ink-soft select-all break-all">
        {msg}
      </blockquote>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          onClick={async () => {
            const ok = await copyText(msg);
            toast(ok ? "复制好了，去群里粘贴吧 📋" : "复制失败，长按上面的文字手动复制", ok ? "ok" : "error");
          }}
        >
          复制群消息
        </Button>
        <Button variant="secondary" onClick={() => setGuide(true)}>
          怎么发到群？
        </Button>
      </div>
      {isAdmin && (
        <Link
          href={`/j/${state.ju.id}/screen`}
          className="mt-3 flex min-h-11 items-center justify-center text-[14px] font-semibold text-ink-soft underline decoration-ink-faint underline-offset-4"
        >
          🖥️ 打开大屏模式（投屏 / 路演用）
        </Link>
      )}
      <WechatGuide open={guide} onClose={() => setGuide(false)} />
    </section>
  );
}

export function MemberRow({ m, me }: { m: Member; me?: boolean }) {
  const out = m.status === "out";
  return (
    <li className={`animate-rise flex items-center gap-3 py-2.5 ${out ? "opacity-45" : ""}`}>
      <Avatar emoji={m.avatar} size={42} ring={m.isOrganizer ? "red" : me ? "gold" : "none"} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-bold">{m.name}</span>
          {m.isOrganizer && (
            <span className="shrink-0 rounded bg-cinnabar px-1.5 text-[11px] font-bold leading-[18px] text-white">局长</span>
          )}
          {me && <span className="shrink-0 rounded bg-mustard px-1.5 text-[11px] font-bold leading-[18px]">我</span>}
          {out && <span className="shrink-0 text-[12px] text-ink-faint">不去了</span>}
        </div>
        <div className="truncate text-[13px] text-ink-soft">📍 {shortPlace(m.location.label, 18)}</div>
      </div>
      {m.dietTags.length > 0 && (
        <div className="flex max-w-[38%] shrink-0 flex-wrap justify-end gap-1">
          {m.dietTags.slice(0, 2).map((d) => (
            <span key={d} className="rounded-full border border-cinnabar px-2 text-[11px] font-semibold leading-5 text-cinnabar">
              {d}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}

export function MemberWall({ state, meId }: { state: JuState; meId: string | null }) {
  const sorted = [...state.members].sort((a, b) => {
    if (a.status !== b.status) return a.status === "in" ? -1 : 1;
    if (a.isOrganizer !== b.isOrganizer) return a.isOrganizer ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });
  return (
    <section className="sticker p-4">
      <SectionTitle hint="谁从哪来">🧑‍🤝‍🧑 已入局</SectionTitle>
      {sorted.length === 0 ? (
        <p className="py-4 text-center text-ink-faint">空空如也，等第一个勇士</p>
      ) : (
        <ul className="divide-y-2 divide-dashed divide-line">
          {sorted.map((m) => (
            <MemberRow key={m.id} m={m} me={m.id === meId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function TopSlots({ state }: { state: JuState }) {
  const counts = slotCounts(state);
  const n = activeMembers(state).length;
  const top = [...state.ju.slots]
    .map((s) => ({ s, c: counts[s.id] ?? 0 }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c || a.s.start.localeCompare(b.s.start))
    .slice(0, 3);
  if (!top.length) return null;
  return (
    <section className="sticker p-4">
      <SectionTitle hint="目前最多人有空">⏰ 时间风向标</SectionTitle>
      <ul className="space-y-2">
        {top.map(({ s, c }, i) => (
          <li key={s.id} className="flex items-center gap-3">
            <span className="font-num shrink-0 whitespace-nowrap text-[14px] font-bold">
              {dayLabel(slotDate(s))} {slotTime(s)}
            </span>
            <span className="relative h-6 flex-1 overflow-hidden rounded-md border-2 border-ink bg-paper">
              <span
                className={`absolute inset-y-0 left-0 ${i === 0 ? "bg-mustard" : "bg-mustard-soft"}`}
                style={{ width: `${(c / Math.max(1, n)) * 100}%`, transition: "width .5s" }}
              />
            </span>
            <span className="font-num w-12 shrink-0 text-right text-[14px] font-bold">
              {c}/{n}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WaitingPanel({
  state,
  me,
  isAdmin,
  actions,
}: {
  state: JuState;
  me: Member | null;
  isAdmin: boolean;
  actions: JuActions;
}) {
  const [planning, setPlanning] = useState(false);
  const n = activeMembers(state).length;
  const target = state.ju.spec.headcount;

  const doPlan = async () => {
    setPlanning(true);
    try {
      await actions.plan();
      toast("方案出炉！大家投票吧 🗳️", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setPlanning(false);
    }
  };

  return (
    <div className="space-y-5 pb-4">
      <section className="sticker flex items-center gap-4 bg-ink p-4 text-paper">
        <div className="font-num text-[56px] font-bold leading-none text-mustard">{n}</div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-black">
            已有 {n} 人入局{target ? <span className="font-num text-cream-faint"> / {target}</span> : null}
          </div>
          <div className="text-[14px] text-cream-faint">
            {isAdmin ? "人差不多了就出方案" : "等局长出方案，你可以先去催催别人"}
          </div>
          {target ? (
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-night-3">
              <div className="h-full rounded-full bg-mustard transition-all duration-500" style={{ width: `${Math.min(100, (n / target) * 100)}%` }} />
            </div>
          ) : null}
        </div>
      </section>

      {me?.status === "in" || isAdmin ? <SharePanel state={state} isAdmin={isAdmin} /> : null}
      <TopSlots state={state} />
      <MemberWall state={state} meId={me?.id ?? null} />

      {isAdmin && (
        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-paper/95 px-4 pt-3 backdrop-blur">
          <div className="mx-auto max-w-[480px]">
            <Button size="lg" className="w-full" onClick={doPlan} loading={planning} disabled={n === 0}>
              {planning ? <RotatingText lines={PLAN_LINES} /> : n < 2 ? "就这些人，出方案 →" : `人齐了，出方案 →`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

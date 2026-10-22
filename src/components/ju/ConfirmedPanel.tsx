"use client";

import { useState } from "react";
import type { JuState, Member } from "@/lib/types";
import { amapUrl, leadingOption, slotLabel, voteTally } from "@/lib/client/format";
import { api, errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { AvatarStack, Button, SectionTitle } from "../ui";
import { StampSlam } from "../Stamp";
import { toast } from "../toast";

export function ConfirmedPanel({ state, actions }: { state: JuState; actions: JuActions }) {
  const { ju } = state;
  const opt = leadingOption(ju);
  const [total, setTotal] = useState(ju.settlement ? String(ju.settlement.total) : "");
  const [busy, setBusy] = useState(false);
  if (!opt || !ju.plan) return null;
  const { poi } = opt;
  const members = new Map(state.members.map((m) => [m.id, m]));
  const attendees = ju.plan.attendeeIds
    .map((id) => members.get(id))
    .filter((m): m is Member => !!m && m.status === "in");
  const votes = voteTally(ju)[poi.id]?.length ?? 0;
  const slot = ju.slots.find((s) => s.id === ju.plan?.slotId);
  const stampDate = slot ? slot.start.slice(0, 10).replace(/-/g, ".") : undefined;

  const settle = async () => {
    const n = Number(total);
    if (!Number.isFinite(n) || n <= 0) {
      toast("输入这顿一共花了多少钱");
      return;
    }
    setBusy(true);
    try {
      await actions.settle(Math.round(n * 100) / 100);
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      <section className="sticker relative overflow-visible p-5 pt-6">
        <div className="pointer-events-none absolute -right-3 -top-6 z-10">
          <StampSlam size={132} sub={stampDate} />
        </div>
        <div className="mb-1 text-[14px] font-bold tracking-widest text-cinnabar">局 · 定 · 了</div>
        <div className="font-num pr-28 text-[30px] font-bold leading-tight">{slotLabel(ju, ju.plan.slotId)}</div>
        <h2 className="mt-3 text-[24px] font-black leading-snug break-words">{poi.name}</h2>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{poi.address}</p>
        <div className="font-num mt-2 flex flex-wrap gap-x-3 text-[14px] font-semibold text-ink-soft">
          {poi.costPerPerson != null && <span>¥{poi.costPerPerson}/人</span>}
          <span>最远 {opt.maxCommute}′</span>
          {votes > 0 && <span>{votes} 票当选</span>}
          {poi.tel && (
            <a href={`tel:${poi.tel}`} className="text-ink underline underline-offset-2">
              ☎ 订位
            </a>
          )}
        </div>
        <div className="mt-4 flex items-center gap-2 border-t-2 border-dashed border-line pt-3">
          <AvatarStack members={attendees} max={8} size={30} />
          <span className="text-[14px] font-semibold">{attendees.length} 人赴约</span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <a
          href={api.icsUrl(ju.id)}
          download={`${ju.title}.ics`}
          className="pressable sticker flex min-h-14 items-center justify-center gap-2 font-bold"
        >
          📅 加入日历
        </a>
        <a
          href={amapUrl(poi.lng, poi.lat, poi.name)}
          target="_blank"
          rel="noopener noreferrer"
          className="pressable flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-ink bg-cinnabar font-bold text-white shadow-sticker"
        >
          🧭 一键导航
        </a>
      </div>
      <p className="-mt-2 px-1 text-[12px] text-ink-faint">微信里下载不了日历？点右上角 ··· 用浏览器打开</p>

      <section className="sticker p-4">
        <SectionTitle hint={`${attendees.length} 人平摊`}>🧾 吃完 AA</SectionTitle>
        <div className="flex gap-3">
          <label className="relative min-w-0 flex-1">
            <span className="font-num absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold">¥</span>
            <input
              className="field font-num pl-9 text-lg font-bold"
              inputMode="decimal"
              value={total}
              onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder="总共多少"
              aria-label="总金额"
            />
          </label>
          <Button onClick={settle} loading={busy} variant="gold" className="shrink-0">
            算一下
          </Button>
        </div>
        {ju.settlement && (
          <div className="animate-rise mt-4 flex items-baseline justify-between rounded-xl bg-ink px-4 py-3 text-paper">
            <span className="text-[14px] text-cream-faint">
              共 <span className="font-num">¥{ju.settlement.total}</span>，每人
            </span>
            <span className="font-num text-[34px] font-bold text-mustard">¥{ju.settlement.perPerson}</span>
          </div>
        )}
      </section>
    </div>
  );
}

"use client";

import type { JuState } from "@/lib/types";
import { activeMembers, organizer, specChips } from "@/lib/client/format";
import { AvatarStack } from "../ui";

const CAT_EMOJI: [RegExp, string][] = [
  [/火锅/, "🍲"],
  [/烧烤|串/, "🍢"],
  [/宵夜|夜宵/, "🌙"],
  [/羽毛球/, "🏸"],
  [/篮球/, "🏀"],
  [/足球/, "⚽"],
  [/桌游|狼人杀/, "🎲"],
  [/剧本杀/, "🕵️"],
  [/KTV|唱歌|k歌/i, "🎤"],
  [/咖啡/, "☕"],
  [/电影/, "🎬"],
  [/酒|bar/i, "🍻"],
  [/日料|寿司/, "🍣"],
  [/奶茶|甜品/, "🧋"],
];

export function categoryEmoji(cat: string): string {
  for (const [re, e] of CAT_EMOJI) if (re.test(cat)) return e;
  return "🍽️";
}

export function JuHeader({ state }: { state: JuState }) {
  const { ju } = state;
  const org = organizer(state);
  const active = activeMembers(state);
  return (
    <header className="sticker relative mt-2 overflow-hidden p-4 pr-5">
      <span
        className="absolute -right-1 top-3 rotate-6 rounded-l-lg border-2 border-r-0 border-ink bg-mustard px-3 py-1 text-[15px] font-black"
        aria-label={`品类：${ju.spec.category}`}
      >
        {categoryEmoji(ju.spec.category)} {ju.spec.category}
      </span>
      <h1 className="mb-3 pr-24 text-[28px] font-black leading-[1.15] tracking-tight break-words">{ju.title}</h1>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {specChips(ju).map((c) => (
          <span
            key={c.icon}
            className="font-num inline-flex items-center gap-1 rounded-md bg-paper-deep px-2 py-1 text-[13px] font-semibold text-ink-soft"
          >
            <span aria-hidden>{c.icon}</span>
            {c.text}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 border-t-2 border-dashed border-line pt-3">
        <span className="min-w-0 truncate text-[14px] text-ink-soft">
          局长 <b className="text-ink">{org?.name ?? ju.organizerName ?? "神秘人"}</b> 发起
        </span>
        {active.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2">
            <AvatarStack members={active} max={5} size={30} />
            <span className="font-num text-[14px] font-bold">{active.length}人</span>
          </div>
        ) : (
          <span className="shrink-0 text-[13px] text-ink-faint">还没人入局</span>
        )}
      </div>
    </header>
  );
}

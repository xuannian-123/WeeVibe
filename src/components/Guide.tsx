"use client";

// 新手指引：第一次进入某个界面时弹出几张卡片，讲清楚这里怎么玩。看过一次就记在本地，之后可以手动再打开。
import { useCallback, useEffect, useState } from "react";
import { store } from "@/lib/client/storage";
import { Button } from "./ui";

export type GuideStep = { emoji: string; title: string; body: string };

/** 发起页 */
export const HOME_GUIDE: GuideStep[] = [
  { emoji: "🗣️", title: "说一句话就开局", body: "比如“周五晚上 8 个人吃火锅”。也可以直接丢一张群聊截图，局长会认出谁说了去。" },
  { emoji: "🤫", title: "大家私下跟局长说真话", body: "把链接发到群里。预算、门禁、不想去，每个人只跟局长说，群里只看到“有人预算偏紧”这样的结论。" },
  { emoji: "🗳️", title: "局长出方案，大家投票", body: "局长把时间和店都算好，给出 2–3 个方案。过半投同一个就自动成局，你也可以直接拍板。" },
  { emoji: "📋", title: "随时回来看", body: "右上角“我的局”里，能找到你发起和参加过的所有局。" },
];

/** 成员第一次打开局页 */
export const MEMBER_GUIDE: GuideStep[] = [
  { emoji: "🤫", title: "先和局长私聊几句", body: "几点能出发、几点得回、预算、忌口……你说的话只有局长知道，群里看不出是谁说的。" },
  { emoji: "👉", title: "刷几家店", body: "右滑想去，左滑不想，告诉局长你的口味。这一步不是投票。" },
  { emoji: "🗳️", title: "方案出来再投票", body: "人齐了局长会出方案，并私信提醒你。过半投同一个就自动成局。" },
  { emoji: "🎫", title: "定了就拿行程卡", body: "几点出发、怎么走、AA 该转多少，都只发给你自己。" },
];

/** 发起人第一次打开局页 */
export const ORGANIZER_GUIDE: GuideStep[] = [
  { emoji: "👑", title: "你是这个局的发起人", body: "顶部有两个标签：“我的”是你自己作为成员要做的事，“管理”里是催人、出方案、拍板这些发起人的事。" },
  { emoji: "🤫", title: "你自己也先私聊局长", body: "发起人也是成员，你的时间、预算一样只有局长知道。" },
  { emoji: "🗳️", title: "投票和拍板是两回事", body: "在“我的”里投票，和大家一样算一票；在“管理”里拍板，是不等投票直接定局。" },
];

/** 第一次来自动打开；open / show / close 给“？”按钮手动重开用 */
export function useGuide(id: string, auto = true) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (auto && !store.getFlag(`guide-${id}`)) setOpen(true);
  }, [id, auto]);
  const close = useCallback(() => {
    store.setFlag(`guide-${id}`);
    setOpen(false);
  }, [id]);
  const show = useCallback(() => setOpen(true), []);
  return { open, show, close };
}

export function Guide({ steps, open, onClose }: { steps: GuideStep[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (open) setI(0);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || steps.length === 0) return null;
  const s = steps[Math.min(i, steps.length - 1)];
  const last = i >= steps.length - 1;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-5" role="dialog" aria-modal aria-label="新手指引">
      <div className="animate-fade-in absolute inset-0 bg-ink/55" aria-hidden />
      <div className="sticker animate-pop-in relative w-full max-w-[360px] p-6 text-center">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 min-h-9 px-2 text-[13px] font-bold text-ink-faint"
        >
          跳过
        </button>
        <div key={i} className="animate-rise">
          <div className="mx-auto mb-3 flex size-20 items-center justify-center rounded-full border-2 border-ink bg-mustard-soft text-[44px]" aria-hidden>
            {s.emoji}
          </div>
          <h3 className="text-[21px] font-black leading-snug">{s.title}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">{s.body}</p>
        </div>
        <div className="mt-5 flex justify-center gap-1.5" aria-label={`第 ${i + 1} 步，共 ${steps.length} 步`}>
          {steps.map((_, k) => (
            <span key={k} className={`h-2 rounded-full transition-all ${k === i ? "w-5 bg-cinnabar" : "w-2 bg-line"}`} />
          ))}
        </div>
        <div className="mt-5 flex gap-2">
          {i > 0 && (
            <Button variant="secondary" className="flex-1" onClick={() => setI(i - 1)}>
              上一步
            </Button>
          )}
          <Button className="flex-1" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? "知道了，开始吧" : "下一步"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 顶栏上的“？”：重新打开指引 */
export function GuideButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="怎么玩"
      className="pressable flex size-10 items-center justify-center rounded-full border-2 border-ink bg-card text-[16px] font-black shadow-sticker-sm"
    >
      ?
    </button>
  );
}

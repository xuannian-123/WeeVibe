"use client";

// 新手指引（聚光灯式）：把页面压暗，只照亮某个具体元素，旁边的气泡用箭头指着它讲这是干什么的。
// 目标用 data-tour="xxx" 标在元素上；某一步的目标不在页面上（没渲染 / 折叠着）就自动跳过。
// 每个阶段第一次出现时自动弹一次，看完记在本地；顶栏的“?”随时重看当前页面的指引。
import { useCallback, useEffect, useRef, useState } from "react";
import { store } from "@/lib/client/storage";
import { Button } from "./ui";

export type TourStep = { target: string; title: string; body: string };

/* ───────── 各页面的指引 ───────── */

export const HOME_TOUR: TourStep[] = [
  { target: "launch-mode", title: "两种开局方式", body: "直接说一句话；或者切到“甩张群聊截图”，局长会认出谁说了去、谁在加班。" },
  { target: "launch-input", title: "在这说你想组什么局", body: "时间、人数、预算随口说，局长自己会拆出来。也可以点下面的例子试试。" },
  { target: "launch-go", title: "让局长看看", body: "局长解析完先给你预览，你确认了才会建局。" },
  { target: "my-ju", title: "我的局", body: "你发起过、参加过的局都在这里，随时回来看。" },
  { target: "help", title: "随时再看一遍", body: "每个页面右上角的“?”，都能重看这一页的指引。" },
];

const ROLE_TABS: TourStep = {
  target: "role-tabs",
  title: "你是这个局的发起人",
  body: "“我的”里做成员要做的事（私聊、投票）；“管理”里催人、出方案、拍板。两边分开，投票和拍板不会混。",
};

export const JU_TOURS: Record<string, TourStep[]> = {
  entry: [
    { target: "entry-form", title: "先报个名", body: "填个称呼就能进局。接下来认识一下替你去谈的分身，再交给它一张授权书。" },
    { target: "help", title: "随时再看一遍", body: "不知道下一步干嘛，就点右上角的“?”。" },
  ],
  preferences: [
    { target: "preferences-card", title: "分身猜的你", body: "按你的档案先填好了，空着的格子就是还缺的。点一下就能改或补。" },
    { target: "preferences-chat", title: "随口说一句", body: "比如“这周好累，想安静点”，分身听懂的格子会亮起来。说的话只有你和局长知道。" },
    { target: "preferences-confirm", title: "交出授权书", body: "底线分身死守，“可以让”的范围内它替你做主，超出了才私下问你。点“就这样”就完成了。" },
  ],
  chat: [
    { target: "chat-privacy", title: "这是你和局长的私聊", body: "这里说的预算、门禁、不想去，只有局长知道，群里只看到“有人预算偏紧”这样的结论。" },
    { target: "chat-quick", title: "点一下就能回答", body: "不想打字就点这些。说“都行”，局长会按你的习惯先帮你填好。" },
    { target: "chat-input", title: "也可以直接打字", body: "比如“6 点半下班，11 点前回宿舍”，局长听得懂。" },
    { target: "inbox", title: "局长的私信", body: "催你、提醒你出发、告诉你该转多少，都只发到这里。" },
  ],
  swipe: [
    { target: "swipe-card", title: "刷卡告诉局长口味", body: "右滑想去，上滑超想去，左滑不想。这一步不是投票。" },
    { target: "swipe-btns", title: "不想滑就点按钮", body: "✕ 不想去，★ 超想去，♥ 想去。" },
    { target: "swipe-guess", title: "懒得刷？", body: "局长按你以前的口味猜好了，一键接受就行。" },
  ],
  waiting: [
    { target: "waiting-progress", title: "等大家的分身到齐", body: "这里能看到谁交了授权书。人差不多齐了，局长就主持分身们谈一轮，出方案后私信通知你。" },
    { target: "wants", title: "想认识谁？", body: "悄悄选几个人。只有对方也选了你才会揭晓，单方面的选择永远没人知道。" },
  ],
  plans: [
    { target: "plan-summary", title: "局长为什么这么推荐", body: "推荐理由和大家的约束都在这。“有人预算偏紧”这种说法不会点名。" },
    { target: "audit-btn", title: "可复核", body: "点开能看到审计哈希、一键复算，证明局长没偷偷改结果。" },
    { target: "plan-tabs", title: "切换方案", body: "2–3 个真不一样的方案，点一下看详情和票数。" },
    { target: "my-exp", title: "你的体验", body: "只有你看得到：几点到、预算够不够、是不是你想去的店。" },
    { target: "vote-btn", title: "投一票", body: "过半投同一个方案就自动成局。投了还能改。" },
  ],
  confirmed: [
    { target: "itinerary", title: "你的专属行程卡", body: "几点出发、怎么走、几点得走，只发给你一个人。" },
    { target: "travel", title: "日历和导航", body: "加进日历会带出发前提醒。" },
    { target: "more", title: "其他功能收在这", body: "当天可以共享到达时间（不共享位置），吃完可以传照片。" },
  ],
  "manage-collecting": [
    { target: "org-progress", title: "入局进度", body: "看有多少人说完了。“局长去催”会私下提醒没填完的人，不点名。" },
    { target: "org-invite", title: "邀请链接", body: "复制发到群里。分了圈的话，先发核心圈。" },
    { target: "org-plan", title: "让局长出方案", body: "人差不多齐了就点。没填完的人，局长会按他的习惯替他预填。" },
  ],
  "manage-voting": [
    { target: "org-votes", title: "看大家投票", body: "票数实时更新，过半自动定局。" },
    { target: "org-stamp", title: "直接拍板", body: "不想等了可以直接定。注意：这不算投票，你自己的一票在“我的”里投。" },
    { target: "org-nudge", title: "催投票", body: "局长私下提醒还没投的人，谁也不知道是你让催的。" },
  ],
  "manage-confirmed": [
    { target: "org-reserve", title: "订位", body: "听局长模拟订位，或者一键拨给店家。订好了点“已订好位”。" },
    { target: "org-broadcast", title: "群公告", body: "局长按进度写好了，复制发群里就行。" },
    { target: "org-after", title: "吃完以后", body: "拍小票分账、生成回顾、一键再约，都在这里。" },
  ],
};

/** 发起人第一次看到局页时，在当前阶段的指引前面加一步讲两个标签 */
export function withRoleTabs(steps: TourStep[]): TourStep[] {
  return store.getFlag("tour-role-tabs") ? steps : [ROLE_TABS, ...steps];
}

/* ───────── 机制 ───────── */

function findTarget(name: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

/** 第一次走到这个页面（id）时自动打开；目标是异步渲染的，等它们出现再开 */
export function useTour(id: string, steps: TourStep[], auto = true) {
  const [open, setOpen] = useState(false);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  useEffect(() => {
    setOpen(false);
    if (!auto || store.getFlag(`tour-${id}`)) return;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const check = () => {
      if (stepsRef.current.some((s) => findTarget(s.target))) setOpen(true);
      else if (++tries < 20) t = setTimeout(check, 400);
    };
    t = setTimeout(check, 800);
    return () => clearTimeout(t);
  }, [id, auto]);
  const close = useCallback(() => {
    store.setFlag(`tour-${id}`);
    if (stepsRef.current.some((s) => s.target === "role-tabs")) store.setFlag("tour-role-tabs");
    setOpen(false);
  }, [id]);
  const show = useCallback(() => setOpen(true), []);
  return { open, show, close };
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 6;

export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  // 打开时定下这一轮要走的步骤（只留页面上找得到的）
  const [list, setList] = useState<TourStep[]>([]);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [vp, setVp] = useState({ w: 390, h: 844 });

  useEffect(() => {
    if (!open) return;
    const avail = steps.filter((s) => findTarget(s.target));
    if (avail.length === 0) {
      onClose();
      return;
    }
    setList(avail);
    setI(0);
    // 只在打开时取一次；steps 每次渲染都是新数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cur = open ? list[i] : undefined;

  // 滚到目标，并持续跟着它的位置（页面滚动、动画、布局变化都跟得上）
  useEffect(() => {
    if (!cur) return;
    const el = findTarget(cur.target);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    let raf = 0;
    let last = "";
    const tick = () => {
      const r = el.getBoundingClientRect();
      const key = `${r.top}|${r.left}|${r.width}|${r.height}|${window.innerWidth}|${window.innerHeight}`;
      if (key !== last) {
        last = key;
        setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
        setVp({ w: window.innerWidth, h: window.innerHeight });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cur]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !cur || !box) return null;
  const last = i >= list.length - 1;

  // 气泡放在目标下面，放不下就放上面；目标太高（比如刷卡的卡片）就贴在屏幕底部
  const w = Math.min(330, vp.w - 32);
  const left = Math.max(16, Math.min(box.left + box.width / 2 - w / 2, vp.w - w - 16));
  const EST = 190;
  const below = box.top + box.height + PAD + 14;
  const above = box.top - PAD - 14;
  let pos: { top?: number; bottom?: number };
  let arrow: "up" | "down" | null;
  if (below + EST < vp.h) {
    pos = { top: below };
    arrow = "up";
  } else if (above - EST > 0) {
    pos = { bottom: vp.h - above };
    arrow = "down";
  } else {
    pos = { bottom: 16 };
    arrow = null;
  }
  const arrowX = Math.max(18, Math.min(box.left + box.width / 2 - left, w - 18));

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal aria-label="新手指引">
      {/* 挡住页面点击 */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      {/* 聚光灯：目标周围挖空，其他地方压暗 */}
      <div
        className="pointer-events-none absolute rounded-2xl transition-all duration-300 ease-out"
        style={{
          top: box.top - PAD,
          left: box.left - PAD,
          width: box.width + PAD * 2,
          height: box.height + PAD * 2,
          boxShadow: "0 0 0 3px var(--color-mustard), 0 0 0 9999px rgb(20 17 15 / 0.62)",
        }}
      />
      <div
        key={i}
        className="sticker animate-rise absolute p-4"
        style={{ left, width: w, ...pos }}
      >
        {arrow && (
          <span
            className="absolute size-3.5 rotate-45 border-ink bg-card"
            style={{
              left: arrowX - 7,
              ...(arrow === "up" ? { top: -9, borderLeftWidth: 2, borderTopWidth: 2 } : { bottom: -9, borderRightWidth: 2, borderBottomWidth: 2 }),
            }}
            aria-hidden
          />
        )}
        <div className="flex items-start gap-2">
          <h3 className="flex-1 text-[17px] font-black leading-snug">{cur.title}</h3>
          <span className="font-num shrink-0 pt-0.5 text-[12px] font-bold text-ink-faint">
            {i + 1}/{list.length}
          </span>
        </div>
        <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{cur.body}</p>
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={onClose} className="min-h-10 px-1 text-[13px] font-bold text-ink-faint">
            跳过
          </button>
          <span className="flex-1" />
          {i > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setI(i - 1)}>
              上一步
            </Button>
          )}
          <Button size="sm" onClick={() => (last ? onClose() : setI(i + 1))}>
            {last ? "知道了" : "下一步"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 顶栏上的“?”：重看当前页面的指引 */
export function GuideButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="怎么玩"
      data-tour="help"
      className="pressable flex size-10 items-center justify-center rounded-full border-2 border-ink bg-card text-[16px] font-black shadow-sticker-sm"
    >
      ?
    </button>
  );
}

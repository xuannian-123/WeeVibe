"use client";

// v4 局内编排（成员这一侧）：
// - SocialCard：你和大家熟吗（#17）+ 想认识谁（#2）+ 今天的电量 + 公开兴趣 + 悄悄回避（#18）
// - SeatCard：你每一轮坐哪、玩什么、为什么这么排；正在进行的那一轮可以私下反馈感受（#19）
// - ClickCard：局后和谁聊得来，双方都选了才揭晓（#20）
// - CircleCard：同一个圈子一局一局熟起来（#21）
import { useEffect, useMemo, useState } from "react";
import type { CircleStep, Familiarity, JuState, Member, RoundFeel, SeatingRound, SocialEnergy } from "@/lib/types";
import { api, errMsg } from "@/lib/client/api";
import type { JuActions } from "@/lib/client/useJu";
import { Avatar, Button, LockNote } from "../ui";
import { toast } from "../toast";

const FAM_TEXT: Record<Familiarity, string> = { 0: "不认识", 1: "见过", 2: "挺熟" };
const ENERGY: { key: SocialEnergy; icon: string; text: string }[] = [
  { key: "low", icon: "🔋", text: "想安静点" },
  { key: "mid", icon: "🙂", text: "都行" },
  { key: "high", icon: "⚡", text: "想多认识人" },
];
const INTEREST_PRESETS = ["爬山", "桌游", "摄影", "剧本杀", "猫", "咖啡", "羽毛球", "动漫", "音乐", "电影", "健身", "美食"];

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ───────── #17 #18 你和大家熟吗 ───────── */
export function SocialCard({ state, me, actions, compact }: { state: JuState; me: Member; actions: JuActions; compact?: boolean }) {
  const others = state.members.filter((m) => m.id !== me.id);
  const p = me.private;
  const saved = useMemo(
    () => ({
      know: p?.know ?? {},
      wants: [...(p?.wants ?? [])].sort(),
      energy: p?.energy,
      interests: me.interests ?? [],
      avoid: p?.avoid?.[0],
    }),
    [p?.know, p?.wants, p?.energy, me.interests, p?.avoid],
  );
  const savedKey = JSON.stringify(saved);
  const [know, setKnow] = useState<Record<string, Familiarity>>(saved.know);
  const [wants, setWants] = useState<string[]>(saved.wants);
  const [energy, setEnergy] = useState<SocialEnergy | undefined>(saved.energy);
  const [interests, setInterests] = useState<string[]>(saved.interests);
  const [avoid, setAvoid] = useState<string | undefined>(saved.avoid);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const s = JSON.parse(savedKey) as typeof saved;
    setKnow(s.know);
    setWants(s.wants);
    setEnergy(s.energy);
    setInterests(s.interests);
    setAvoid(s.avoid);
  }, [savedKey]);

  if (!others.length || state.ju.quorum?.state === "pending") return null;
  const auto = new Set(p?.knowAuto ?? []);
  const matches = state.mine?.matchNames ?? [];
  const current = { know, wants: [...wants].sort(), energy, interests, avoid };
  const dirty = !sameJson(current, saved);
  const marked = others.filter((m) => know[m.id] !== undefined).length;

  const addInterest = (x: string) => {
    const t = x.trim().replace(/^#/, "").slice(0, 12);
    if (!t || interests.includes(t) || interests.length >= 6) return;
    setInterests([...interests, t]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await actions.social({ know, ...(energy ? { energy } : {}), avoid: avoid ? [avoid] : [], interests });
      let names: string[] = [];
      if (!sameJson([...wants].sort(), saved.wants)) names = await actions.wants(wants);
      toast(names.length ? `🎉 和 ${names.join("、")} 互选成功！` : "局长记下了，排座时会用上 ✓", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sticker p-4" data-tour="social">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex-1 text-lg font-black">你和大家熟吗？</h3>
        <LockNote>只有局长知道</LockNote>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">
        局长排座用：每桌给你留个认识的人，再介绍几位新朋友。<b className="text-ink">对方看不到你怎么标的</b>，只要有一方说熟就按熟算。
      </p>
      {matches.length > 0 && (
        <div className="animate-pop-in mb-3 rounded-xl border-2 border-ink bg-cinnabar-soft px-3 py-2.5 text-[14px] font-bold">
          🎉 你和 <span className="text-cinnabar-deep">{matches.join("、")}</span> 互相想认识！局长会安排你们同桌。
        </div>
      )}

      <ul className="divide-y-2 divide-dashed divide-line">
        {others.map((m) => {
          const v = know[m.id];
          const wanted = wants.includes(m.id);
          return (
            <li key={m.id} className="flex items-center gap-2 py-2">
              <Avatar emoji={m.avatar} size={30} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold">{m.name}</span>
                {auto.has(m.id) && v !== undefined && <span className="block text-[11px] font-bold text-jade">局长记得你们上次一起</span>}
              </span>
              <span role="radiogroup" aria-label={`你和${m.name}熟不熟`} className="flex shrink-0 overflow-hidden rounded-full border-2 border-ink">
                {([0, 1, 2] as Familiarity[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="radio"
                    aria-checked={v === f}
                    onClick={() => setKnow({ ...know, [m.id]: f })}
                    className={`min-h-9 px-2 text-[12.5px] font-bold ${f > 0 ? "border-l-2 border-ink" : ""} ${v === f ? "bg-ink text-paper" : "bg-card text-ink-soft"}`}
                  >
                    {FAM_TEXT[f]}
                  </button>
                ))}
              </span>
              <button
                type="button"
                aria-pressed={wanted}
                aria-label={`想认识${m.name}`}
                onClick={() => setWants(wanted ? wants.filter((x) => x !== m.id) : [...wants, m.id])}
                className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink text-[15px] ${wanted ? "bg-cinnabar text-white" : "bg-card text-ink-faint"}`}
              >
                {wanted ? "♥" : "♡"}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[12px] text-ink-faint">♡ = 想认识：只有对方也点了你才会揭晓，单方面的永远没人知道。</p>

      {!compact && (
        <>
          <div className="mt-4">
            <div className="mb-1.5 text-[14px] font-black">今天的社交电量</div>
            <div className="grid grid-cols-3 gap-2">
              {ENERGY.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  aria-pressed={energy === e.key}
                  onClick={() => setEnergy(e.key)}
                  className={`pressable min-h-12 rounded-xl border-2 border-ink px-1 text-[13px] font-bold ${energy === e.key ? "bg-mustard shadow-sticker-sm" : "bg-card text-ink-soft"}`}
                >
                  <span className="block text-[18px] leading-none">{e.icon}</span>
                  {e.text}
                </button>
              ))}
            </div>
            {energy === "low" && <p className="mt-1.5 text-[12.5px] text-ink-soft">收到。每一轮都给你留个认识的人，玩法也先从轻松的开始。</p>}
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-[14px] font-black">我的兴趣</span>
              <span className="rounded-full border-2 border-dashed border-ink px-2 text-[11px] font-bold text-ink-soft">会给同桌看</span>
            </div>
            <p className="mb-2 text-[12.5px] text-ink-soft">局长用它给每桌出话题卡（“这桌有 3 个人都喜欢爬山”）。不想填可以不填。</p>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set([...INTEREST_PRESETS, ...interests])].map((x) => {
                const on = interests.includes(x);
                return (
                  <button
                    key={x}
                    type="button"
                    aria-pressed={on}
                    onClick={() => (on ? setInterests(interests.filter((y) => y !== x)) : addInterest(x))}
                    className={`min-h-9 rounded-full border-2 border-ink px-2.5 text-[13px] font-semibold ${on ? "bg-mustard" : "bg-card text-ink-soft"}`}
                  >
                    {on ? "✓ " : ""}
                    {x}
                  </button>
                );
              })}
            </div>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addInterest(custom);
                setCustom("");
              }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                maxLength={12}
                placeholder="自己写一个，比如：胶片"
                className="min-h-10 min-w-0 flex-1 rounded-xl border-2 border-ink bg-card px-3 text-[14px]"
              />
              <Button type="submit" variant="secondary" size="sm" disabled={!custom.trim() || interests.length >= 6}>
                加上
              </Button>
            </form>
          </div>

          <details className="mt-4 rounded-xl border-2 border-dashed border-line px-3 py-1" open={!!avoid}>
            <summary className="min-h-10 cursor-pointer py-2 text-[14px] font-bold text-ink-soft">🤫 悄悄话：有不想坐一桌的人吗？</summary>
            <p className="mb-2 text-[12.5px] leading-relaxed text-ink-soft">
              最多选 1 位。局长会让你们不同桌，同时顺手把另外几对朋友也分开，<b className="text-ink">谁也看不出是谁提的</b>。藏不住的时候（比如只有一桌）局长就不照办——宁可不照顾，也不让你暴露。
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={!avoid}
                onClick={() => setAvoid(undefined)}
                className={`min-h-9 rounded-full border-2 border-ink px-3 text-[13px] font-semibold ${!avoid ? "bg-ink text-paper" : "bg-card text-ink-soft"}`}
              >
                没有
              </button>
              {others.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={avoid === m.id}
                  onClick={() => setAvoid(m.id)}
                  className={`min-h-9 rounded-full border-2 border-ink px-3 text-[13px] font-semibold ${avoid === m.id ? "bg-ink text-paper" : "bg-card text-ink-soft"}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </details>
        </>
      )}

      {dirty ? (
        <Button className="mt-3 w-full" size="sm" loading={busy} onClick={save}>
          悄悄告诉局长
        </Button>
      ) : (
        <p className="mt-3 text-center text-[12.5px] text-ink-faint">
          {marked ? `标了 ${marked}/${others.length} 位，随时可以改` : "标几位就行。你没标的人，对方标了就按对方的算"}
        </p>
      )}
    </section>
  );
}

/* ───────── #18 #19 你的座位 ───────── */
const FEELS: { key: RoundFeel; icon: string; text: string }[] = [
  { key: "stiff", icon: "😶", text: "有点拘谨" },
  { key: "ok", icon: "🙂", text: "刚刚好" },
  { key: "loud", icon: "🔊", text: "有点吵" },
];

function roundState(r: SeatingRound): string {
  return r.status === "live" ? "进行中" : r.status === "done" ? "已结束" : "还没开始";
}

export function SeatCard({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const s = state.ju.seating;
  const seats = state.mine?.seats ?? [];
  const live = s && s.current >= 0 && s.current < s.rounds.length ? s.current : -1;
  const initial = live >= 0 ? live : s && s.current >= s.rounds.length ? s.rounds.length - 1 : 0;
  const [tab, setTab] = useState(initial);
  const [busy, setBusy] = useState<RoundFeel | null>(null);
  useEffect(() => setTab(initial), [initial]);
  if (!s || !seats.length) return null;
  const round = s.rounds[tab] ?? s.rounds[0];
  const seat = seats.find((x) => x.round === round.index);
  const table = round.tables.find((t) => t.id === seat?.tableId);
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const mates = (table?.memberIds ?? []).map((id) => byId.get(id)).filter((m): m is Member => !!m);
  const myFeel = me.private?.feel?.[String(round.index)];

  const sendFeel = async (f: RoundFeel) => {
    setBusy(f);
    try {
      await actions.feel(round.index, f);
      toast("收到，局长下一轮会照顾到 ✓", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="sticker overflow-hidden" data-tour="seat">
      <div className="flex items-center gap-2 border-b-2 border-ink bg-ink px-4 py-3 text-paper">
        <h3 className="flex-1 text-lg font-black">💺 你的座位</h3>
        <span className="font-num text-[12.5px] text-cream-faint">
          {s.rounds.length} 轮 · 第 {round.index + 1} 轮{roundState(round)}
        </span>
      </div>
      {s.rounds.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b-2 border-dashed border-line px-3 pt-2.5">
          {s.rounds.map((r) => (
            <button
              key={r.index}
              type="button"
              role="tab"
              aria-selected={tab === r.index}
              onClick={() => setTab(r.index)}
              className={`relative min-h-10 flex-1 rounded-t-lg text-[14px] font-black ${tab === r.index ? "bg-paper-deep" : "text-ink-soft"}`}
            >
              第 {r.index + 1} 轮
              {r.status === "live" && <span className="absolute right-2 top-2 size-2 animate-pulse rounded-full bg-cinnabar" aria-label="进行中" />}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3 p-4">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-[17px] font-black">「{round.format.name}」</span>
            <span className="font-num text-[12.5px] text-ink-faint">约 {round.format.minutes} 分钟</span>
          </div>
          <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">{round.format.how}</p>
          {round.adjust && <p className="mt-1.5 rounded-lg bg-mustard-soft px-3 py-2 text-[13px] font-semibold">🧭 {round.adjust}</p>}
        </div>
        {table && seat && (
          <div className="rounded-xl border-2 border-ink bg-paper p-3">
            <div className="mb-2 text-[13px] font-black text-cinnabar">{Number(table.id.split("t").at(-1)) + 1} 号桌</div>
            <div className="flex flex-wrap gap-2">
              {[me, ...mates.filter((m) => m.id !== me.id)].map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink bg-card py-0.5 pl-0.5 pr-2.5 text-[13.5px] font-bold">
                  <Avatar emoji={m.avatar} size={26} ring={m.id === me.id ? "gold" : "none"} />
                  {m.id === me.id ? "我" : m.name}
                </span>
              ))}
            </div>
            {table.topics.length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {table.topics.map((t) => (
                  <li key={t} className="text-[13px] leading-snug">
                    💬 {t}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {seat && seat.notes.length > 0 && (
          <div className="flex items-start gap-2">
            <LockNote className="mt-0.5">只有你看得到</LockNote>
            <p className="text-[13px] leading-relaxed text-ink-soft">{seat.notes.join("；")}</p>
          </div>
        )}
        {round.status === "live" && (
          <div className="border-t-2 border-dashed border-line pt-3">
            <p className="mb-2 text-[13.5px] font-black">
              这一轮感觉怎样？<span className="ml-1 text-[12px] font-semibold text-ink-faint">私下说，大家只看到聚合数字</span>
            </p>
            <div className="grid grid-cols-3 gap-2">
              {FEELS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={myFeel === f.key}
                  disabled={!!busy}
                  onClick={() => sendFeel(f.key)}
                  className={`pressable min-h-12 rounded-xl border-2 border-ink text-[13px] font-bold disabled:opacity-60 ${myFeel === f.key ? "bg-mustard shadow-sticker-sm" : "bg-card text-ink-soft"}`}
                >
                  <span className="block text-[18px] leading-none">{f.icon}</span>
                  {f.text}
                </button>
              ))}
            </div>
          </div>
        )}
        {round.status === "done" && round.feedback && (
          <p className="font-num text-[12.5px] text-ink-faint">
            这一轮的反馈：😶 {round.feedback.stiff} · 🙂 {round.feedback.ok} · 🔊 {round.feedback.loud}
          </p>
        )}
      </div>
    </section>
  );
}

/* ───────── #20 和谁聊得来 ───────── */
export function ClickCard({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const saved = [...(me.private?.clicked ?? [])].sort();
  const savedKey = saved.join(",");
  const [sel, setSel] = useState<string[]>(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(savedKey ? savedKey.split(",") : []), [savedKey]);
  // 同桌过的人排前面
  const sat = new Set((state.ju.seating?.rounds ?? []).flatMap((r) => r.tables.filter((t) => t.memberIds.includes(me.id)).flatMap((t) => t.memberIds)));
  const others = state.members.filter((m) => m.id !== me.id).sort((a, b) => Number(sat.has(b.id)) - Number(sat.has(a.id)));
  if (!others.length) return null;
  const clicks = state.mine?.clickNames ?? [];
  const dirty = [...sel].sort().join(",") !== savedKey;

  const save = async () => {
    setBusy(true);
    try {
      const names = await actions.clicked(sel);
      toast(names.length ? `🤝 你和 ${names.join("、")} 都觉得聊得来！` : "记下了，只有对方也选了你才会揭晓", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sticker p-4" data-tour="clicked">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="flex-1 text-lg font-black">🤝 这次和谁聊得来？</h3>
        <LockNote>私密</LockNote>
      </div>
      <p className="mb-3 text-[13px] leading-relaxed text-ink-soft">
        双方都选了才揭晓，<b className="text-ink">单方面的永远没人知道</b>。下次再约，局长会记得把你们排一起。
      </p>
      {clicks.length > 0 && (
        <div className="animate-pop-in mb-3 rounded-xl border-2 border-ink bg-jade px-3 py-2.5 text-[14px] font-bold text-white">
          🤝 你和 {clicks.join("、")} 都觉得这次聊得来！
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {others.map((m) => {
          const on = sel.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => setSel((xs) => (on ? xs.filter((x) => x !== m.id) : [...xs, m.id]))}
              className={`pressable flex min-h-11 items-center gap-1.5 rounded-full border-2 border-ink py-1 pl-1 pr-3 text-[14px] font-bold ${
                on ? "bg-jade text-white shadow-sticker-sm" : "bg-card"
              }`}
            >
              <Avatar emoji={m.avatar} size={30} />
              {m.name}
              {sat.has(m.id) && !on && <span className="text-[11px] font-semibold text-ink-faint">同桌过</span>}
            </button>
          );
        })}
      </div>
      {dirty && (
        <Button className="mt-3 w-full" size="sm" loading={busy} onClick={save}>
          悄悄告诉局长
        </Button>
      )}
    </section>
  );
}

/* ───────── #21 圈子：一局一局熟起来 ───────── */
export function useCircle(state: JuState): CircleStep[] {
  const [steps, setSteps] = useState<CircleStep[]>([]);
  const { id, prevJuId } = state.ju;
  const seatVersion = state.ju.seating?.version ?? 0;
  useEffect(() => {
    if (!prevJuId) return;
    let alive = true;
    api
      .circle(id)
      .then((r) => alive && setSteps(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, prevJuId, seatVersion]);
  return steps;
}

/** 横条：底色 = 总对数，深色 = 这局之前就认识，金色 = 这局新认识 */
export function CircleBars({ steps, dark }: { steps: CircleStep[]; dark?: boolean }) {
  const maxPairs = Math.max(1, ...steps.map((s) => s.pairs));
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        // 条的长度按这局的总对数（人越多条越长），里面按这局自己的对数算比例
        const pairs = Math.max(1, s.pairs);
        const before = (s.knownBefore / pairs) * 100;
        const gain = (Math.max(0, s.knownAfter - s.knownBefore) / pairs) * 100;
        return (
          <li key={s.juId}>
            <div className={`mb-1 flex items-baseline gap-2 text-[13px] ${dark ? "text-cream" : ""}`}>
              <span className="font-black">第 {i + 1} 局</span>
              <span className={`min-w-0 flex-1 truncate ${dark ? "text-cream-faint" : "text-ink-faint"}`}>{s.title.replace(/^（演示）/, "")}</span>
              <span className="font-num shrink-0 font-bold">
                {s.knownAfter}/{s.pairs} 对{s.knownAfter > s.knownBefore ? ` · +${s.knownAfter - s.knownBefore}` : ""}
              </span>
            </div>
            <div
              className={`relative h-3.5 overflow-hidden rounded-full border-2 ${dark ? "border-cream-faint bg-night-3" : "border-ink bg-paper"}`}
              style={{ width: `${Math.max(18, (s.pairs / maxPairs) * 100)}%` }}
            >
              <span className={`absolute inset-y-0 left-0 ${dark ? "bg-cream" : "bg-ink"}`} style={{ width: `${before}%` }} />
              <span className="absolute inset-y-0 bg-mustard" style={{ left: `${before}%`, width: `${gain}%` }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function CircleCard({ state }: { state: JuState }) {
  const steps = useCircle(state);
  if (steps.length < 2) return null;
  const first = steps[0];
  const last = steps.at(-1)!;
  return (
    <section className="sticker p-4">
      <h3 className="text-lg font-black">🌱 你们这个圈子，一局比一局熟</h3>
      <p className="mb-3 mt-0.5 text-[13px] text-ink-soft">
        从第 1 局认识 {first.knownBefore} 对，到现在 {last.knownAfter} 对。只统计对数，不看谁和谁。
      </p>
      <CircleBars steps={steps} />
      <p className="mt-2.5 flex items-center gap-3 text-[12px] text-ink-faint">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-ink" />之前就认识
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm bg-mustard" />这局新认识
        </span>
      </p>
    </section>
  );
}

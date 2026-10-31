"use client";

// v6 首次建档「认识你的分身」（docs/AVATAR.md 5.1）：≤ 5 屏、每屏可跳过、约 1 分钟。
// 起名 → 常从哪出发 + 交通 → 底线（最多 3 条）→ 平时花多少 → 滑 10 张活动卡。
// 走到最后 = 完成（写 Profile.onboardedAt）；顶部「先跳过」= 这次不建档，下次入局还会再问。
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { JuState, Member, Place, Profile, SwipeVerdict, Transport } from "@/lib/types";
import type { JuActions } from "@/lib/client/useJu";
import { errMsg, type OnboardingBody } from "@/lib/client/api";
import { activityOf, ONBOARD_DECK } from "@/lib/client/activities";
import { MAX_FLOORS, ONBOARD_FLOORS, type OnboardFloor } from "@/lib/client/mandate";
import { Button, Chip, LockNote, SealLogo } from "../ui";
import { PlacePicker } from "./widgets";

type PlaceKind = NonNullable<Profile["places"]>[number]["kind"];

const KIND_LABEL: Record<PlaceKind, string> = { home: "🏠 家", work: "🏢 公司", school: "🎓 学校", other: "📍 其他" };
const TRANSPORTS: [Transport, string][] = [["metro", "🚇 地铁公交"], ["taxi", "🚕 打车"], ["drive", "🚗 开车"], ["bike", "🚲 骑车"], ["walk", "🚶 走路"]];
const FLOOR_LABEL: Record<OnboardFloor, string> = { homeBy: "⏰ 有门禁", 清真: "☪️ 清真", 素食: "🥬 素食", 过敏: "🤧 有过敏", 膝盖不好: "🦵 膝盖不好", 不喝酒: "🚫🍺 不喝酒" };
const BUDGETS: [number, string][] = [[50, "¥50 左右"], [100, "¥100 左右"], [200, "¥200 左右"], [0, "不太在意"]];
const STEPS = ["起个名", "常从哪出发", "底线", "平时花多少", "喜欢玩什么"] as const;
const SWIPE_PX = 70;

export function OnboardingView({
  state,
  me,
  actions,
  profile,
  onDone,
  onSkip,
}: {
  state: JuState;
  me: Member;
  actions: JuActions;
  profile: Profile | null;
  onDone: () => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(profile?.avatarName ?? `${me.name}的分身`);
  const [places, setPlaces] = useState<NonNullable<Profile["places"]>>(profile?.places ?? (me.location ? [{ kind: "home", place: me.location }] : []));
  const [kind, setKind] = useState<PlaceKind>(places.length ? "work" : "home");
  const [transport, setTransport] = useState<Transport | undefined>(profile?.transport);
  const [floors, setFloors] = useState<OnboardFloor[]>([]);
  const [floorHint, setFloorHint] = useState(false);
  const [homeBy, setHomeBy] = useState(profile?.usualHomeBy ?? "22:30");
  const [allergy, setAllergy] = useState("");
  const [budget, setBudget] = useState<number | undefined>(undefined);
  const [swipes, setSwipes] = useState<Record<string, SwipeVerdict>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 每屏填了才带上，跳过的屏不提交（不会清掉档案里原来的）
  const [touched, setTouched] = useState<Set<number>>(new Set());
  const touch = (i: number) => setTouched((s) => new Set(s).add(i));

  const realName = me.name.trim().length >= 2 && name.includes(me.name.trim());

  const toggleFloor = (f: OnboardFloor) => {
    touch(2);
    if (floors.includes(f)) {
      setFloors(floors.filter((x) => x !== f));
      setFloorHint(false);
    } else if (floors.length >= MAX_FLOORS) setFloorHint(true);
    else setFloors([...floors, f]);
  };

  const finish = async (finalSwipes = swipes) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const body: OnboardingBody = {};
    if (touched.has(0) || !profile?.avatarName) body.avatarName = name.trim();
    if (touched.has(1)) {
      if (places.length) body.places = places;
      if (transport) body.transport = transport;
    }
    if (touched.has(2) && floors.length) {
      body.floors = floors;
      if (floors.includes("homeBy")) body.homeBy = homeBy;
      if (floors.includes("过敏") && allergy.trim()) body.allergy = allergy.trim();
    }
    if (budget !== undefined) body.budget = budget;
    if (Object.keys(finalSwipes).length) body.swipes = finalSwipes;
    try {
      await actions.chat({ onboarding: body });
      onDone();
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  const next = () => (step < STEPS.length - 1 ? setStep(step + 1) : void finish());

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5" aria-label={`第 ${step + 1} / ${STEPS.length} 步`}>
          {STEPS.map((s, i) => (
            <span key={s} className={`h-2 rounded-full border border-ink transition-all ${i === step ? "w-6 bg-cinnabar" : i < step ? "w-2 bg-ink" : "w-2 bg-card"}`} />
          ))}
        </div>
        <button type="button" onClick={onSkip} className="min-h-10 text-[13px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4">
          先跳过，直接入局
        </button>
      </div>

      <div className="flex items-end gap-2">
        <SealLogo size={30} />
        <p className="bubble-jz animate-bubble-in max-w-[84%] px-3.5 py-2.5 text-[15px] leading-relaxed" key={step}>
          {step === 0 && "第一次见面！以后每个局，都有一个替你去谈的分身。先给它起个名字？"}
          {step === 1 && "你一般从哪出发？可以加好几个，下次一点就选上。"}
          {step === 2 && "有没有绝对不能碰的事？分身会死守这几条。"}
          {step === 3 && "平时聚一次，人均花多少比较舒服？只有分身知道。"}
          {step === 4 && "最后，滑一滑：右滑喜欢、左滑没兴趣、上滑超爱。"}
        </p>
      </div>

      <section className="sticker animate-rise space-y-3 p-4" key={`s${step}`} aria-label={STEPS[step]}>
        <h2 className="text-[20px] font-black">{STEPS[step]}</h2>

        {step === 0 && (
          <>
            <input
              className="field text-[16px]"
              value={name}
              maxLength={12}
              aria-label="分身的名字"
              onChange={(e) => {
                setName(e.target.value);
                touch(0);
              }}
            />
            <div className="flex flex-wrap gap-2">
              {["小橘", "阿柴", "团子", "小卷"].map((n) => (
                <Chip key={n} selected={name === n} onClick={() => { setName(n); touch(0); }}>{n}</Chip>
              ))}
            </div>
            {realName ? (
              <p className="rounded-xl bg-mustard-soft p-3 text-[13px] leading-relaxed">名字里有你的真名。大屏和群里都不会显示分身名，不过只给你自己看的地方会用它，别人凑过来看屏幕时可能认出你。</p>
            ) : (
              <p className="text-[12.5px] text-ink-faint">分身名只出现在你自己的页面里，大屏上它叫“分身 A / B…”，谁也看不出是你。</p>
            )}
          </>
        )}

        {step === 1 && (
          <>
            {places.length > 0 && (
              <ul className="space-y-1.5">
                {places.map((p, i) => (
                  <li key={`${p.kind}-${i}`} className="flex items-center gap-2 rounded-xl border-2 border-ink bg-mustard-soft/50 px-3 py-2 text-[14px]">
                    <span className="shrink-0 font-bold">{KIND_LABEL[p.kind]}</span>
                    <span className="min-w-0 flex-1 truncate">{p.place.label || "已定位"}</span>
                    <button type="button" aria-label="删掉这个出发地" className="min-h-9 min-w-9 text-ink-soft" onClick={() => { setPlaces(places.filter((_, j) => j !== i)); touch(1); }}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            {places.length < 4 && (
              <div className="space-y-2 rounded-xl border-2 border-dashed border-line p-3">
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(KIND_LABEL) as PlaceKind[]).map((k) => (
                    <Chip key={k} selected={kind === k} onClick={() => setKind(k)} className="min-h-9 px-3 text-[13px]">{KIND_LABEL[k]}</Chip>
                  ))}
                </div>
                <PlacePicker
                  city={state.ju.spec.city}
                  value={null}
                  onChange={(p: Place | null) => {
                    if (!p) return;
                    setPlaces([...places, { kind, place: p }]);
                    setKind(kind === "home" ? "work" : "other");
                    touch(1);
                  }}
                />
              </div>
            )}
            <div>
              <p className="mb-2 text-[14px] font-black">常用交通</p>
              <div className="flex flex-wrap gap-2">
                {TRANSPORTS.map(([t, label]) => (
                  <Chip key={t} selected={transport === t} onClick={() => { setTransport(t); touch(1); }} className="px-3 text-[14px]">{label}</Chip>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="flex flex-wrap gap-2">
              {ONBOARD_FLOORS.map((f) => (
                <Chip key={f} selected={floors.includes(f)} onClick={() => toggleFloor(f)} className="px-3 text-[14px]">{FLOOR_LABEL[f]}</Chip>
              ))}
            </div>
            {floors.includes("homeBy") && (
              <label className="flex items-center justify-between gap-3 text-[14px] font-bold">几点前必须到家
                <input type="time" className="field w-32 px-2 py-2" value={homeBy} onChange={(e) => setHomeBy(e.target.value)} />
              </label>
            )}
            {floors.includes("过敏") && (
              <input className="field text-[14px]" maxLength={20} placeholder="对什么过敏？比如：花生、海鲜" value={allergy} onChange={(e) => setAllergy(e.target.value)} aria-label="过敏的东西" />
            )}
            <p className={`text-[12.5px] leading-relaxed ${floorHint ? "font-bold text-cinnabar" : "text-ink-faint"}`}>
              {floorHint ? `最多 ${MAX_FLOORS} 条：底线越少，分身越好谈。先去掉一条再选。` : `最多 ${MAX_FLOORS} 条。没有就跳过——其余的事分身都可以商量。`}
            </p>
          </>
        )}

        {step === 3 && (
          <div className="grid grid-cols-2 gap-2">
            {BUDGETS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={budget === v}
                onClick={() => { setBudget(v); setTimeout(() => setStep(4), 180); }}
                className={`pressable min-h-14 rounded-xl border-2 border-ink text-[16px] font-black ${budget === v ? "bg-mustard shadow-sticker-sm" : "bg-card"}`}
              >
                {label}
              </button>
            ))}
            <div className="col-span-2"><LockNote>预算只有分身和局长知道</LockNote></div>
          </div>
        )}

        {step === 4 && <SwipeDeck swipes={swipes} onSwipe={(k, v) => setSwipes((s) => ({ ...s, [k]: v }))} onAllDone={(s) => void finish(s)} />}
      </section>

      {error && <p role="alert" className="rounded-xl border-2 border-cinnabar bg-card p-3 text-[14px] text-cinnabar-deep">{error}</p>}

      <div className="flex items-center gap-2">
        {step > 0 && <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>← 上一步</Button>}
        <Button variant="secondary" className="ml-auto" onClick={next} disabled={busy}>跳过这一屏</Button>
        <Button onClick={next} loading={busy && step === STEPS.length - 1}>{step === STEPS.length - 1 ? "好了" : "下一步"}</Button>
      </div>
    </div>
  );
}

/** 10 张活动卡：拖动滑卡（左 / 右 / 上），也可以点下面三个按钮 */
function SwipeDeck({
  swipes,
  onSwipe,
  onAllDone,
}: {
  swipes: Record<string, SwipeVerdict>;
  onSwipe: (key: string, v: SwipeVerdict) => void;
  onAllDone: (s: Record<string, SwipeVerdict>) => void;
}) {
  const left = ONBOARD_DECK.filter((k) => !swipes[k]);
  const key = left[0];
  const a = key ? activityOf(key) : undefined;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const decide = (v: SwipeVerdict) => {
    if (!key) return;
    onSwipe(key, v);
    setDrag(null);
    if (left.length === 1) onAllDone({ ...swipes, [key]: v });
  };
  const onDown = (e: ReactPointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent) => {
    if (start.current) setDrag({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
  };
  const onUp = () => {
    const d = drag;
    start.current = null;
    if (!d) return;
    if (d.y < -SWIPE_PX && Math.abs(d.y) > Math.abs(d.x)) decide("love");
    else if (d.x > SWIPE_PX) decide("like");
    else if (d.x < -SWIPE_PX) decide("pass");
    else setDrag(null);
  };

  if (!a) return <p className="py-8 text-center text-[15px] font-bold">都滑完了 ✓</p>;
  const hint = drag ? (drag.y < -SWIPE_PX / 2 && Math.abs(drag.y) > Math.abs(drag.x) ? "超爱 😍" : drag.x > SWIPE_PX / 2 ? "喜欢 👍" : drag.x < -SWIPE_PX / 2 ? "没兴趣" : "") : "";
  return (
    <div className="space-y-3">
      <p className="text-center text-[12px] font-bold text-ink-faint">{ONBOARD_DECK.length - left.length + 1} / {ONBOARD_DECK.length}</p>
      <div className="relative mx-auto h-52 w-full max-w-[300px] select-none">
        {left[1] && (
          <div className="absolute inset-0 translate-y-2 scale-95 rounded-[var(--radius-card)] border-2 border-ink bg-paper-deep" aria-hidden />
        )}
        <div
          role="group"
          aria-label={`${a.name}：${a.blurb}`}
          className="absolute inset-0 flex touch-none cursor-grab flex-col items-center justify-center rounded-[var(--radius-card)] border-2 border-ink bg-card p-4 text-center shadow-sticker"
          style={{ transform: drag ? `translate(${drag.x}px, ${Math.min(0, drag.y)}px) rotate(${drag.x / 18}deg)` : undefined, transition: drag ? "none" : "transform 200ms ease-out" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => { start.current = null; setDrag(null); }}
        >
          <span className="text-[56px] leading-none" aria-hidden>{a.emoji}</span>
          <span className="mt-2 text-[22px] font-black">{a.name}</span>
          <span className="mt-1 text-[13px] text-ink-soft">{a.blurb}</span>
          {hint && <span className="animate-check-pop absolute right-3 top-3 rounded-full border-2 border-ink bg-mustard px-2 py-0.5 text-[12px] font-black">{hint}</span>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Button size="sm" variant="secondary" onClick={() => decide("pass")}>👈 没兴趣</Button>
        <Button size="sm" variant="gold" onClick={() => decide("love")}>😍 超爱</Button>
        <Button size="sm" variant="secondary" onClick={() => decide("like")}>喜欢 👉</Button>
      </div>
    </div>
  );
}

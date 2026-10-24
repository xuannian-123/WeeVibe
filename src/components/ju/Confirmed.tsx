"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Itinerary, JuState, Member, Proposal } from "@/lib/types";
import { amapUrl, confirmedProposal, hhmm, slotText, yuan } from "@/lib/client/format";
import { api, errMsg } from "@/lib/client/api";
import { compressImage } from "@/lib/client/image";
import { store } from "@/lib/client/storage";
import type { JuActions } from "@/lib/client/useJu";
import { Avatar, AvatarStack, Button, LockNote, SectionTitle, Spinner } from "../ui";
import { StampSlam } from "../Stamp";
import { toast } from "../toast";
import { WaitlistCard } from "./Waiting";

export function photoSrc(juId: string, p: string): string {
  return /^(https?:|data:|\/)/.test(p) ? p : api.photoUrl(juId, p);
}

/* ───────── 盖章 ───────── */
function Hero({ state, p }: { state: JuState; p: Proposal }) {
  const key = `stamp:${state.ju.id}`;
  const [play] = useState(() => !store.getFlag(key));
  useEffect(() => store.setFlag(key), [key]);
  const attendees = state.members.filter((m) => p.experiences.some((e) => e.memberId === m.id && e.status !== "absent"));
  const stampDate = p.slot.start.slice(0, 10).replace(/-/g, ".");
  return (
    <section className="sticker relative overflow-visible p-5 pt-6">
      <div className="pointer-events-none absolute -right-3 -top-6 z-10">
        <StampSlam size={128} sub={stampDate} play={play} />
      </div>
      <div className="mb-1 text-[14px] font-bold tracking-widest text-cinnabar">局 · 定 · 了</div>
      <div className="font-num pr-28 text-[28px] font-bold leading-tight">{slotText(p.slot)}</div>
      <h2 className="mt-3 text-[23px] font-black leading-snug break-words">{p.poi.name}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{p.poi.address}</p>
      <div className="font-num mt-2 flex flex-wrap gap-x-3 text-[14px] font-semibold text-ink-soft">
        {p.poi.costPerPerson != null && <span>¥{p.poi.costPerPerson}/人</span>}
        <span>{p.labelText}</span>
        {state.ju.reservation?.status === "booked" && <span className="text-jade">✓ 已订位</span>}
      </div>
      <div className="mt-4 flex items-center gap-2 border-t-2 border-dashed border-line pt-3">
        <AvatarStack members={attendees} max={8} size={30} />
        <span className="text-[14px] font-semibold">{attendees.length} 人赴约</span>
      </div>
    </section>
  );
}

/* ───────── #12 定局后的变化 ───────── */
function Revisions({ state }: { state: JuState }) {
  const r = state.ju.revisions.at(-1);
  if (!r) return null;
  return (
    <section className="rounded-[var(--radius-card)] border-2 border-ink bg-mustard-soft p-3.5">
      <p className="text-[14px] font-black">🔄 局长微调了一下</p>
      <ul className="mt-1 space-y-0.5 text-[13.5px] text-ink-soft">
        {r.changes.map((c) => (
          <li key={c}>· {c}</li>
        ))}
      </ul>
    </section>
  );
}

/* ───────── #11 我的行程卡 ───────── */
function ItineraryCard({ state, actions, p }: { state: JuState; actions: JuActions; p: Proposal }) {
  const [it, setIt] = useState<Itinerary | null>(state.mine?.itinerary ?? null);
  const [loading, setLoading] = useState(!state.mine?.itinerary);
  const fromState = state.mine?.itinerary;
  useEffect(() => {
    if (fromState) {
      setIt(fromState);
      setLoading(false);
      return;
    }
    let alive = true;
    actions
      .itinerary()
      .then((r) => alive && setIt(r))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [fromState, actions]);

  if (loading)
    return (
      <section className="sticker flex items-center justify-center gap-2 p-6 text-ink-soft">
        <Spinner /> 局长在帮你查路线…
      </section>
    );
  if (!it) return null;
  return (
    <section className="sticker overflow-hidden">
      <div className="flex items-center gap-3 border-b-2 border-ink bg-ink px-4 py-3 text-paper">
        <div className="flex-1">
          <div className="text-[12.5px] font-semibold text-cream-faint">建议出发</div>
          <div className="font-num text-[36px] font-bold leading-none text-mustard">{hhmm(it.departAt)}</div>
        </div>
        <div className="text-right">
          <div className="text-[12.5px] font-semibold text-cream-faint">路上</div>
          <div className="font-num text-[20px] font-bold">{it.commuteMin} 分钟</div>
        </div>
      </div>
      <ol className="relative space-y-2.5 px-4 py-3.5">
        <span className="absolute bottom-6 left-[23px] top-6 w-0.5 bg-line" aria-hidden />
        {it.route.map((s, i) => (
          <li key={i} className="relative flex gap-3 text-[14px] leading-snug">
            <span className="font-num z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-card text-[10px] font-bold">
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
        <li className="relative flex gap-3 text-[14px] font-bold leading-snug">
          <span className="z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 border-ink bg-cinnabar text-[10px] text-white">
            ✓
          </span>
          <span>
            {hhmm(it.arriveAt)} 到 {p.poi.name}
          </span>
        </li>
      </ol>
      {(it.leaveAt || it.seatWith?.length) && (
        <div className="space-y-1.5 border-t-2 border-dashed border-line px-4 py-3 text-[14px]">
          {it.leaveAt && (
            <p className="flex items-center gap-2">
              <span>🌙</span>
              <span className="flex-1">
                <b className="font-num">{hhmm(it.leaveAt)}</b> 得走，局长会提前提醒你
              </span>
              <LockNote>别人只看到你要先走</LockNote>
            </p>
          )}
          {it.seatWith && it.seatWith.length > 0 && (
            <p className="flex items-center gap-2">
              <span>💺</span>
              <span>
                局长安排你和 <b>{it.seatWith.join("、")}</b> 坐一起
              </span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ───────── #11 我在路上 ───────── */
function OnTheWay({ state, me, actions, p }: { state: JuState; me: Member; actions: JuActions; p: Proposal }) {
  const [busy, setBusy] = useState(false);
  const [eta, setEta] = useState(me.eta ?? null);
  const others = state.members.filter((m) => m.id !== me.id && m.eta);
  const over = Date.now() > Date.parse(p.slot.end);
  if (over && !others.length) return null;

  const share = () => {
    if (!("geolocation" in navigator)) {
      toast("这个浏览器拿不到定位", "error");
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const r = await actions.eta(pos.coords.latitude, pos.coords.longitude);
          setEta(r);
          toast(r.lateMin > 0 ? `已告诉大家：大概晚 ${r.lateMin} 分钟` : "已告诉大家：准时到 👍", "ok");
        } catch (e) {
          toast(errMsg(e), "error");
        } finally {
          setBusy(false);
        }
      },
      (err) => {
        setBusy(false);
        toast(err.code === 1 ? "没有定位权限，没法估到达时间" : "定位失败了，再试一次", "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  };

  return (
    <section className="sticker p-4">
      <SectionTitle>🚇 路上</SectionTitle>
      {!over && (
        <>
          <Button variant={eta ? "secondary" : "gold"} className="w-full" loading={busy} onClick={share}>
            {eta ? `更新一下（预计 ${hhmm(eta.arriveAt)} 到）` : "我在路上"}
          </Button>
          <p className="mt-2 text-center text-[12.5px] text-ink-soft">🛡️ 只共享到达时间，不共享位置</p>
        </>
      )}
      {others.length > 0 && (
        <ul className="mt-3 divide-y-2 divide-dashed divide-line border-t-2 border-dashed border-line">
          {others.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 py-2 text-[14px]">
              <Avatar emoji={m.avatar} size={28} />
              <span className="flex-1 font-semibold">{m.name}</span>
              <span className="font-num font-bold">{hhmm(m.eta!.arriveAt)} 到</span>
              {m.eta!.lateMin > 0 ? (
                <span className="rounded-full bg-cinnabar-soft px-2 text-[12px] font-bold text-cinnabar-deep">晚 {m.eta!.lateMin}′</span>
              ) : (
                <span className="rounded-full bg-jade px-2 text-[12px] font-bold text-white">准时</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ───────── #14 #15 我该转多少 ───────── */
function PaymentCard({ state, me, actions }: { state: JuState; me: Member; actions: JuActions }) {
  const s = state.ju.settlement;
  const pay = me.private?.payment;
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (!s || !pay) return null;
  const payer = s.payerName ?? state.mine?.itinerary?.payerName;
  return (
    <section className="sticker overflow-hidden">
      <div className="flex items-center gap-2 px-4 pt-4">
        <h3 className="flex-1 text-lg font-black">🧾 你该转多少</h3>
        <LockNote>只有你看得到</LockNote>
      </div>
      <div className="px-4 pb-1 pt-2">
        <div className="flex items-baseline gap-2">
          <span className="font-num text-[48px] font-bold leading-none">¥{yuan(pay.amount)}</span>
          {payer && <span className="text-[14px] font-semibold text-ink-soft">转给 {payer}</span>}
        </div>
        {pay.lines.length > 0 && (
          <button type="button" className="mt-1 min-h-10 text-[13.5px] font-bold text-ink-soft underline underline-offset-4" onClick={() => setOpen((x) => !x)}>
            {open ? "收起明细" : "怎么算的？看明细"}
          </button>
        )}
        {open && (
          <ul className="animate-rise mb-2 divide-y divide-dashed divide-line rounded-xl border-2 border-ink bg-paper px-3">
            {pay.lines.map((l, i) => (
              <li key={i} className="py-2 text-[13.5px]">
                <div className="flex gap-2">
                  <span className="flex-1">{l.itemName}</span>
                  <span className="font-num font-bold">¥{yuan(l.amount)}</span>
                </div>
                {l.reason && <div className="mt-0.5 text-[12px] text-jade">↳ {l.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3 border-t-2 border-dashed border-line px-4 py-3">
        <span className="font-num flex-1 text-[13px] text-ink-soft">
          群里只显示：已转 {s.paidCount}/{s.payCount}
        </span>
        {pay.paid ? (
          <span className="animate-check-pop rounded-full border-2 border-ink bg-jade px-3 py-1.5 text-[14px] font-black text-white">✓ 已转</span>
        ) : (
          <Button
            size="sm"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await actions.paid();
                toast("收到！局长不会再提醒你了 ✓", "ok");
              } catch (e) {
                toast(errMsg(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            我已转
          </Button>
        )}
      </div>
    </section>
  );
}

/* ───────── #16 照片 ───────── */
function PhotosCard({ state, actions }: { state: JuState; actions: JuActions }) {
  const [mine, setMine] = useState<string[]>([]);
  const [busy, setBusy] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const recapPhotos = state.ju.recap?.photos ?? [];
  const all = [...new Set([...recapPhotos, ...mine])];

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 9);
    setBusy(list.length);
    for (const f of list) {
      try {
        const data = await compressImage(f);
        const url = await actions.uploadPhoto(data);
        setMine((xs) => [...xs, url]);
      } catch (e) {
        toast(errMsg(e), "error");
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
    toast("照片交给局长了 📸", "ok");
  };

  return (
    <section className="sticker p-4">
      <SectionTitle hint={all.length ? `${all.length} 张` : undefined}>📸 局上的照片</SectionTitle>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      {all.length > 0 && (
        <div className="mb-3 grid grid-cols-3 gap-2">
          {all.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={photoSrc(state.ju.id, p)} alt="" className="aspect-square w-full rounded-lg border-2 border-ink object-cover" />
          ))}
        </div>
      )}
      <Button variant="secondary" className="w-full" loading={busy > 0} onClick={() => fileRef.current?.click()}>
        {busy > 0 ? `正在上传 ${busy} 张…` : "上传照片"}
      </Button>
    </section>
  );
}

/* ───────── #16 回顾 ───────── */
function RecapCard({ state }: { state: JuState }) {
  const r = state.ju.recap;
  if (!r) return null;
  const rot = [-3, 2, -1.5, 3, -2, 1.5];
  return (
    <section className="sticker overflow-hidden bg-paper-deep p-4">
      <div className="mb-2 text-[13px] font-bold tracking-widest text-cinnabar">局 · 后 · 回 · 顾</div>
      <p className="whitespace-pre-wrap text-[15.5px] leading-[1.8]">{r.text}</p>
      {r.photos.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {r.photos.map((p, i) => (
            <figure
              key={p}
              className="animate-pop-in border-2 border-ink bg-card p-1.5 pb-5 shadow-sticker-sm"
              style={{ transform: `rotate(${rot[i % rot.length]}deg)`, animationDelay: `${i * 90}ms` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoSrc(state.ju.id, p)} alt="" className="aspect-[4/3] w-full object-cover" />
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

/** 按时间分阶段：局前只看行程，当天加上“我在路上”，局后才是转账、照片、回顾 */
type Phase = "before" | "day" | "after";
function phaseOf(state: JuState, p: Proposal, now = Date.now()): Phase {
  const { ju } = state;
  if (ju.settlement || ju.recap?.text || now >= Date.parse(p.slot.end)) return "after";
  if (now >= Date.parse(p.slot.start) - 3 * 3600_000) return "day";
  return "before";
}

export function ConfirmedView({ state, me, actions }: { state: JuState; me: Member | null; actions: JuActions }) {
  const { ju } = state;
  const p = confirmedProposal(ju) ?? ju.plan?.proposals[0];
  if (!p) return null;
  const inJu = me && me.status === "in";
  const phase = phaseOf(state, p);

  const travel = (
    <div className="grid grid-cols-2 gap-3">
      <a href={api.icsUrl(ju.id)} download={`${ju.title}.ics`} className="pressable sticker flex min-h-14 items-center justify-center gap-2 font-bold">
        📅 加入日历
      </a>
      <a
        href={amapUrl(p.poi.lng, p.poi.lat, p.poi.name)}
        target="_blank"
        rel="noopener noreferrer"
        className="pressable flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius-card)] border-2 border-ink bg-cinnabar font-bold text-white shadow-sticker"
      >
        🧭 导航过去
      </a>
    </div>
  );

  return (
    <div className="space-y-5 pb-10">
      <Hero state={state} p={p} />
      {ju.nextJuId && (
        <Link href={`/j/${ju.nextJuId}`} className="pressable sticker flex items-center gap-3 bg-mustard p-4">
          <span className="text-3xl" aria-hidden>
            🔁
          </span>
          <span className="flex-1">
            <span className="block text-[17px] font-black">下一局已经约上了</span>
            <span className="block text-[13px] text-ink-soft">同一拨人，局长记得大家的习惯</span>
          </span>
          <span className="text-xl font-black">→</span>
        </Link>
      )}
      <Revisions state={state} />

      {phase === "after" ? (
        <>
          {inJu && <PaymentCard state={state} me={me} actions={actions} />}
          <RecapCard state={state} />
          {inJu && <PhotosCard state={state} actions={actions} />}
        </>
      ) : (
        <>
          {inJu && <ItineraryCard state={state} actions={actions} p={p} />}
          {travel}
          {inJu && phase === "day" && <OnTheWay state={state} me={me} actions={actions} p={p} />}
        </>
      )}

      {me?.status === "waitlist" && <WaitlistCard />}
      {!inJu && me?.status !== "waitlist" && <p className="text-center text-[14px] text-ink-soft">这个局已经定了。下次有局，局长再叫你 👋</p>}

      {/* 不在当前阶段的功能收起来，需要时还能点开 */}
      {inJu && (
        <details className="rounded-[var(--radius-card)] border-2 border-dashed border-line px-4 py-2">
          <summary className="min-h-10 cursor-pointer py-2 text-[14px] font-bold text-ink-soft">
            {phase === "after" ? "行程和导航" : "更多：我在路上 · 局后传照片"}
          </summary>
          <div className="space-y-4 pb-3 pt-2">
            {phase === "after" ? (
              <>
                <ItineraryCard state={state} actions={actions} p={p} />
                {travel}
              </>
            ) : (
              <>
                {phase === "before" && <OnTheWay state={state} me={me} actions={actions} p={p} />}
                <PhotosCard state={state} actions={actions} />
              </>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

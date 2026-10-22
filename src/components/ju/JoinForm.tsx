"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DietTag, Ju, Place } from "@/lib/types";
import { api, errMsg, type JoinBody } from "@/lib/client/api";
import { dayLabel, groupSlots, slotTime } from "@/lib/client/format";
import { store } from "@/lib/client/storage";
import { AVATARS, Avatar, Button, Chip, SectionTitle, Spinner } from "../ui";
import { toast } from "../toast";

const DIETS: DietTag[] = ["不吃辣", "素食", "清真", "不吃牛肉", "不吃海鲜", "不吃内脏"];

/* ───────── 出发地 ───────── */
function PlacePicker({ city, value, onChange }: { city: string; value: Place | null; onChange: (p: Place | null) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setResults([]);
      setSearchErr(null);
      return;
    }
    const my = ++reqId.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.geoSearch(text, city);
        if (my === reqId.current) {
          setResults(r.slice(0, 6));
          setSearchErr(r.length ? null : "没搜到，换个说法试试，比如地铁站名");
        }
      } catch (e) {
        if (my === reqId.current) setSearchErr(errMsg(e));
      } finally {
        if (my === reqId.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q, city]);

  const locate = () => {
    if (!("geolocation" in navigator)) {
      toast("这个浏览器拿不到定位，搜一下地点吧", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const p = await api.geoReverse(pos.coords.latitude, pos.coords.longitude);
          onChange(p);
          setQ("");
        } catch (e) {
          toast(errMsg(e), "error");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        toast(err.code === 1 ? "没有定位权限，搜一下地点也行" : "定位失败了，搜一下地点吧", "error");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  };

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-xl border-2 border-ink bg-mustard-soft px-3 py-2.5">
        <span className="text-xl" aria-hidden>
          📍
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">{value.label}</span>
        <button type="button" onClick={() => onChange(null)} className="min-h-11 shrink-0 px-2 text-[15px] font-bold text-cinnabar">
          换一个
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <Button type="button" variant="gold" className="w-full" onClick={locate} loading={locating}>
        {locating ? "正在找你在哪…" : "📍 用我的位置"}
      </Button>
      <div className="relative">
        <input
          className="field pr-10"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="或者搜：小区 / 地铁站 / 公司"
          enterKeyHint="search"
          aria-label="搜索出发地"
        />
        {searching && <Spinner className="absolute right-4 top-1/2 -mt-2 text-ink-faint" />}
      </div>
      {searchErr && <p className="px-1 text-[13px] text-ink-faint">{searchErr}</p>}
      {results.length > 0 && (
        <ul className="overflow-hidden rounded-xl border-2 border-ink bg-card">
          {results.map((p, i) => (
            <li key={`${p.label}-${i}`} className="border-b border-line last:border-0">
              <button
                type="button"
                className="flex min-h-12 w-full items-center gap-2 px-3 text-left active:bg-mustard-soft"
                onClick={() => {
                  onChange(p);
                  setQ("");
                  setResults([]);
                }}
              >
                <span className="text-ink-faint">⌖</span>
                <span className="truncate">{p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────── 时间 ───────── */
function SlotPicker({ ju, value, onChange }: { ju: Ju; value: string[]; onChange: (v: string[]) => void }) {
  const groups = useMemo(() => groupSlots(ju.slots), [ju.slots]);
  const all = value.length === ju.slots.length && ju.slots.length > 0;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  if (!ju.slots.length) return <p className="text-ink-faint">局长还没定时间范围，先跳过～</p>;
  return (
    <div className="space-y-3">
      <Chip selected={all} onClick={() => onChange(all ? [] : ju.slots.map((s) => s.id))} className="w-full">
        {all ? "✓ 都行，我随时有空" : "🙌 都行"}
      </Chip>
      {groups.map((g) => {
        const ids = g.slots.map((s) => s.id);
        const dayAll = ids.every((id) => value.includes(id));
        return (
          <div key={g.date}>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-num text-[15px] font-bold">{dayLabel(g.date)}</span>
              <button
                type="button"
                className="min-h-11 px-2 text-[13px] font-semibold text-ink-soft"
                onClick={() =>
                  onChange(dayAll ? value.filter((v) => !ids.includes(v)) : [...new Set([...value, ...ids])])
                }
              >
                {dayAll ? "这天取消" : "这天都行"}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 min-[400px]:grid-cols-4">
              {g.slots.map((s) => (
                <Chip key={s.id} selected={value.includes(s.id)} onClick={() => toggle(s.id)} className="font-num px-0">
                  {slotTime(s)}
                </Chip>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── 表单 ───────── */
export function JoinForm({
  ju,
  isAdmin,
  onSubmit,
}: {
  ju: Ju;
  isAdmin: boolean;
  onSubmit: (body: JoinBody) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [place, setPlace] = useState<Place | null>(null);
  const [slots, setSlots] = useState<string[]>([]);
  const [diets, setDiets] = useState<DietTag[]>([]);
  const [dietFree, setDietFree] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(store.getName() ?? "");
    setAvatar(store.getAvatar() ?? AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  }, []);

  const missing = !name.trim() ? "填个称呼" : !place ? "选个出发地" : slots.length === 0 && ju.slots.length ? "勾一下有空的时间" : null;

  const submit = async () => {
    if (missing || !place) {
      toast(`还差一步：${missing}`);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim().slice(0, 12),
        avatar,
        location: place,
        availableSlotIds: slots,
        dietRaw: [...diets, dietFree.trim()].filter(Boolean).join("，"),
        isOrganizer: isAdmin || undefined,
      });
      toast("入局成功 🎉", "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-28">
      {isAdmin && (
        <div className="rounded-xl border-2 border-dashed border-ink bg-mustard-soft px-4 py-3 text-[15px] font-semibold">
          👑 你是局长，先把自己填上，再把链接甩进群。
        </div>
      )}

      <section className="sticker p-4">
        <SectionTitle n="1">你是谁</SectionTitle>
        <div className="mb-3 grid grid-cols-6 gap-1.5">
          {AVATARS.slice(0, 12).map((a) => (
            <button
              key={a}
              type="button"
              aria-label={`选择头像 ${a}`}
              aria-pressed={a === avatar}
              onClick={() => setAvatar(a)}
              className={`flex aspect-square min-h-11 items-center justify-center rounded-full text-[24px] ${
                a === avatar ? "bg-mustard ring-2 ring-ink" : ""
              }`}
            >
              {a}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Avatar emoji={avatar} size={48} />
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="群里大家怎么叫你"
            maxLength={12}
            aria-label="你的称呼"
            enterKeyHint="next"
          />
        </div>
      </section>

      <section className="sticker p-4">
        <SectionTitle n="2" hint="用来算谁通勤最公平">
          从哪出发
        </SectionTitle>
        <PlacePicker city={ju.spec.city} value={place} onChange={setPlace} />
      </section>

      <section className="sticker p-4">
        <SectionTitle n="3" hint={slots.length ? `已选 ${slots.length} 个` : "可多选"}>
          什么时候有空
        </SectionTitle>
        <SlotPicker ju={ju} value={slots} onChange={setSlots} />
      </section>

      <section className="sticker p-4">
        <SectionTitle n="4" hint="没有就跳过">
          忌口
        </SectionTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          {DIETS.map((d) => (
            <Chip
              key={d}
              selected={diets.includes(d)}
              onClick={() => setDiets((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]))}
            >
              {d}
            </Chip>
          ))}
        </div>
        <input
          className="field"
          value={dietFree}
          onChange={(e) => setDietFree(e.target.value)}
          placeholder="其他，比如：不要香菜、花生过敏"
          maxLength={60}
          aria-label="其他忌口"
        />
      </section>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-paper/95 px-4 pt-3 backdrop-blur">
        <div className="mx-auto flex max-w-[480px] items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] leading-tight text-ink-soft">
            {missing ? (
              <>
                还差：<b className="text-ink">{missing}</b>
              </>
            ) : (
              <>齐活了，盖个手印吧 ✋</>
            )}
          </p>
          <Button onClick={submit} loading={busy} size="lg" className={`shrink-0 ${missing ? "opacity-60" : ""}`}>
            {isAdmin ? "我先入局" : "入局 ✓"}
          </Button>
        </div>
      </div>
    </div>
  );
}

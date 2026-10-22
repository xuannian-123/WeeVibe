"use client";

import { useEffect, useMemo, useState } from "react";
import type { JuState, Member } from "@/lib/types";
import type { JuActions } from "@/lib/client/useJu";
import { FIXTURES, fixtureVoting, type FixtureKey } from "@/components/fixtures";
import { JuView } from "@/components/ju/JuView";
import { BigScreen } from "@/components/screen/BigScreen";
import { Stage } from "@/components/screen/bits";
import { Stamp, StampSlam } from "@/components/Stamp";
import { SealLogo, StatusBadge } from "@/components/ui";
import { toast } from "@/components/toast";

type Role = "admin" | "member" | "guest";
const STATES: FixtureKey[] = ["empty", "collecting", "voting", "confirmed"];

/** 用本地 state 模拟后端，交互可点 */
function useFakeJu(initial: JuState, role: Role) {
  const [state, setState] = useState<JuState>(initial);
  const [memberId, setMemberId] = useState<string | null>(role === "guest" ? null : role === "admin" ? "m1" : "m2");
  useEffect(() => {
    setState(structuredClone(initial));
    setMemberId(role === "guest" ? null : role === "admin" ? "m1" : "m2");
  }, [initial, role]);

  const delay = (ms = 500) => new Promise((r) => setTimeout(r, ms));
  const patchJu = (f: (s: JuState) => JuState) => setState((s) => f(structuredClone(s)));

  const actions: JuActions = {
    refresh: async () => {},
    join: async (body) => {
      await delay();
      const m: Member = {
        id: "m9",
        juId: state.ju.id,
        name: body.name,
        avatar: body.avatar ?? "🙂",
        location: body.location,
        availableSlotIds: body.availableSlotIds,
        dietRaw: body.dietRaw,
        dietTags: [],
        status: "in",
        joinedAt: new Date().toISOString(),
        isOrganizer: !!body.isOrganizer,
      };
      patchJu((s) => ({ ...s, members: [...s.members, m] }));
      setMemberId("m9");
    },
    leave: async () => {
      await delay(300);
      patchJu((s) => ({ ...s, members: s.members.map((m) => (m.id === memberId ? { ...m, status: "out" } : m)) }));
    },
    rejoin: async () => {
      patchJu((s) => ({ ...s, members: s.members.map((m) => (m.id === memberId ? { ...m, status: "in" } : m)) }));
    },
    plan: async () => {
      await delay(1800);
      patchJu((s) => ({ ...s, ju: { ...s.ju, status: "voting", plan: fixtureVoting.ju.plan, votes: {} } }));
    },
    vote: async (poiId) => {
      if (!memberId) throw new Error("先入局才能投票");
      patchJu((s) => ({ ...s, ju: { ...s.ju, votes: { ...s.ju.votes, [memberId]: poiId } } }));
    },
    confirm: async (poiId) => {
      await delay(400);
      patchJu((s) => ({ ...s, ju: { ...s.ju, status: "confirmed", confirmedPoiId: poiId } }));
    },
    settle: async (total) => {
      await delay(300);
      patchJu((s) => {
        const n = s.ju.plan?.attendeeIds.length || 1;
        return { ...s, ju: { ...s.ju, settlement: { total, perPerson: Math.ceil(total / n) } } };
      });
    },
    seed: async () => {
      await delay(600);
      patchJu((s) => ({ ...s, members: FIXTURES.collecting.members }));
    },
  };
  return { state, memberId, actions };
}

function useQuery() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams(window.location.search)), []);
  return q;
}

export default function Gallery() {
  const q = useQuery();
  const view = q?.get("view") ?? "all";
  const [key, setKey] = useState<FixtureKey>("collecting");
  const [role, setRole] = useState<Role>("admin");
  const [stampKey, setStampKey] = useState(0);

  useEffect(() => {
    if (!q) return;
    const s = q.get("state") as FixtureKey | null;
    if (s && STATES.includes(s)) setKey(s);
    const r = q.get("as") as Role | null;
    if (r && ["admin", "member", "guest"].includes(r)) setRole(r);
  }, [q]);

  const initial = useMemo(() => FIXTURES[key], [key]);
  const { state, memberId, actions } = useFakeJu(initial, role);

  if (!q) return null;

  if (view === "mobile") {
    return <JuView state={state} memberId={memberId} isAdmin={role === "admin"} actions={actions} />;
  }
  if (view === "screen") {
    return (
      <Stage>
        <BigScreen state={state} isAdmin={role === "admin"} actions={actions} joinUrl="http://192.168.1.8:3000/j/demo42" />
      </Stage>
    );
  }

  return (
    <div className="min-h-dvh bg-paper-deep px-6 py-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <SealLogo size={44} />
        <h1 className="text-2xl font-black">组件画廊</h1>
        <div className="flex flex-wrap gap-2">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() => setKey(s)}
              className={`min-h-11 rounded-full border-2 border-ink px-4 font-bold ${key === s ? "bg-mustard" : "bg-card"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["admin", "member", "guest"] as Role[]).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`min-h-11 rounded-full border-2 border-ink px-4 font-bold ${role === r ? "bg-ink text-paper" : "bg-card"}`}
            >
              {r === "admin" ? "局长" : r === "member" ? "已入局" : "路人"}
            </button>
          ))}
        </div>
        <span className="text-sm text-ink-soft">
          截图用：?view=mobile 或 ?view=screen，加 &state=voting&as=member
        </span>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        <div>
          <div className="mb-2 text-sm font-bold text-ink-soft">手机 375 × 812（可交互，假后端）</div>
          <div
            className="overflow-y-auto overflow-x-hidden rounded-[32px] border-[6px] border-ink bg-paper shadow-sticker-lg"
            style={{ width: 375 + 12, height: 812, transform: "translateZ(0)" }}
          >
            <JuView state={state} memberId={memberId} isAdmin={role === "admin"} actions={actions} />
          </div>
        </div>

        <div className="min-w-[640px] flex-1">
          <div className="mb-2 text-sm font-bold text-ink-soft">大屏 1920 × 1080（等比缩放）</div>
          <div className="overflow-hidden rounded-2xl border-[6px] border-ink">
            <Stage fit="container">
              <BigScreen
                key={`${key}-${stampKey}`}
                state={state}
                isAdmin={role === "admin"}
                actions={actions}
                joinUrl="http://192.168.1.8:3000/j/demo42"
              />
            </Stage>
          </div>

          <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-6">
            <div className="sticker flex flex-col items-center gap-3 p-5">
              <div className="text-sm font-bold text-ink-soft">印章 · 砸下来</div>
              <StampSlam key={stampKey} size={160} sub="2026.10.23" />
              <button className="min-h-11 font-bold underline" onClick={() => setStampKey((k) => k + 1)}>
                再盖一次
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-[16px] bg-night p-5">
              <div className="text-sm font-bold text-cream-faint">夜间印章</div>
              <StampSlam key={`d${stampKey}`} size={160} onDark sub="2026.10.23" />
            </div>
            <div className="sticker flex flex-col items-center gap-3 p-5">
              <div className="text-sm font-bold text-ink-soft">静态 / Logo / 状态</div>
              <Stamp size={110} text="稍等" />
              <div className="flex items-center gap-3">
                <SealLogo size={40} />
                <SealLogo size={28} />
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {["collecting", "voting", "confirmed", "cancelled"].map((s) => (
                  <StatusBadge key={s} status={s} />
                ))}
              </div>
              <button className="min-h-11 font-bold underline" onClick={() => toast("这是一条提示 🎉", "ok")}>
                弹个 toast
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

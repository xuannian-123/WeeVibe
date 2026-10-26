"use client";

import { useEffect, useMemo, useState } from "react";
import type { JuState } from "@/lib/types";
import {
  FIXTURE_KEYS,
  fixtureMessages,
  fixtureReceipt,
  fixtureSelfTest,
  fixtureSplit,
  fixtureState,
  fixtureStats,
  fixtureStatsEmpty,
  type FixtureKey,
} from "@/components/screen/fixtures";
import { StatsScreen } from "@/components/stats/StatsScreen";
import { BigScreen } from "@/components/screen/BigScreen";
import { Stage } from "@/components/screen/bits";
import { OrganizerApiContext, OrganizerPanel } from "@/components/organizer/OrganizerPanel";
import { SimCall } from "@/components/organizer/SimCall";
import type { OrganizerApi, VerifyResult } from "@/components/organizer/api";
import { FirewallDiagram } from "@/components/launch/Firewall";
import { Stamp, StampSlam } from "@/components/Stamp";
import { SealLogo } from "@/components/ui";

const JOIN = "http://192.168.1.8:3003/j/demo42";

const LABEL: Record<FixtureKey, string> = {
  quorum: "门限未达成",
  collecting: "收人中",
  voting: "投票中",
  confirmed: "已定局",
  settled: "已结算",
  recap: "局后回顾",
  failed: "没凑成",
};

const pub = (s: JuState): JuState => ({ ...s, ju: { ...s.ju, admin: undefined }, isAdmin: undefined, me: undefined, mine: undefined });

const fakeVerify = async (): Promise<VerifyResult> => {
  await new Promise((r) => setTimeout(r, 700));
  const a = fixtureState("voting").ju.plan!.audit;
  return { ok: true, inputHash: a.inputHash, outputHash: a.outputHash, recomputedOutputHash: a.outputHash };
};

/** 本地假后端：每个动作把局推到下一个 fixture 阶段 */
function makeFakeApi(set: (k: FixtureKey) => void, get: () => JuState): OrganizerApi {
  const wait = (ms = 500) => new Promise((r) => setTimeout(r, ms));
  const to = async (k: FixtureKey, ms?: number) => {
    await wait(ms);
    set(k);
    return fixtureState(k, true);
  };
  return {
    getJu: async () => get(),
    setRole: async (_id, _a, mid, role) => {
      const s = structuredClone(get());
      s.members = s.members.map((m) => (m.id === mid ? { ...m, role } : m));
      return s;
    },
    openTier: async () => {
      const s = structuredClone(get());
      s.ju.admin?.tiers.forEach((t) => (t.openedAt ??= new Date().toISOString()));
      return s;
    },
    plan: () => to("voting", 1600),
    confirm: () => to("confirmed", 400),
    messages: async () => fixtureMessages,
    nudge: async () => ({ nudged: 2 }),
    reservation: async () => fixtureMessages,
    receipt: async () => (await wait(1200), { receipt: fixtureReceipt, split: fixtureSplit }),
    settle: () => to("settled"),
    remindPay: async () => ({ reminded: 2 }),
    payments: async () => {
      const s = get();
      const names = new Map(s.members.map((m) => [m.id, m.name]));
      return Object.fromEntries(Object.entries(s.ju.admin?.payments ?? {}).map(([id, p]) => [id, { ...p, name: names.get(id) ?? "朋友" }]));
    },
    recap: () => to("recap", 1000),
    again: async () => ({
      id: "demo43",
      adminToken: "fake",
      tierLinks: [
        { tier: 1, label: "核心圈", token: "n1" },
        { tier: 2, label: "第二圈", token: "n2" },
      ],
    }),
    devClock: async (_id, _a, offsetMin) => {
      const s = structuredClone(get());
      if (s.ju.admin) s.ju.admin.clockOffsetMin = offsetMin;
      return s;
    },
    devSeed: () => to("collecting"),
    // v4 排座：gallery 的 fixture 没有排座数据，原样返回
    seating: async () => get(),
    nextRound: async () => get(),
    seatAbsent: async () => get(),
    verifySeating: fakeVerify,
    switchFallback: async () => get(),
    devAnswer: async () => get(),
  };
}

function useQuery() {
  const [q, setQ] = useState<URLSearchParams | null>(null);
  useEffect(() => setQ(new URLSearchParams(window.location.search)), []);
  return q;
}

export default function Gallery() {
  const q = useQuery();
  const view = q?.get("view") ?? "all";
  const [key, setKey] = useState<FixtureKey>("voting");
  const [state, setState] = useState<JuState>(() => fixtureState("voting", true));
  const [stampKey, setStampKey] = useState(0);

  useEffect(() => {
    const s = q?.get("state") as FixtureKey | null;
    if (s && FIXTURE_KEYS.includes(s)) setKey(s);
  }, [q]);
  useEffect(() => setState(fixtureState(key, true)), [key]);

  const fakeApi = useMemo(() => makeFakeApi(setKey, () => state), [state]);
  const publicState = useMemo(() => pub(state), [state]);

  if (!q) return null;

  const panel = (
    <OrganizerApiContext.Provider value={fakeApi}>
      <OrganizerPanel state={state} adminToken="fake" onState={setState} />
    </OrganizerApiContext.Provider>
  );

  if (view === "organizer") return <main className="mx-auto max-w-[480px] px-4 py-6">{panel}</main>;
  if (view === "stats") {
    const which = q.get("stats");
    return (
      <Stage>
        <StatsScreen stats={which === "empty" ? fixtureStatsEmpty : which === "loading" ? null : fixtureStats} />
      </Stage>
    );
  }
  if (view === "screen") {
    return (
      <Stage>
        <BigScreen state={publicState} joinUrl={JOIN} selfTest={fixtureSelfTest} verify={fakeVerify} />
      </Stage>
    );
  }

  return (
    <div className="min-h-dvh bg-paper-deep px-6 py-6">
      <header className="mb-6 flex flex-wrap items-center gap-4">
        <SealLogo size={44} />
        <h1 className="text-2xl font-black">组件画廊 · v3</h1>
        <div className="flex flex-wrap gap-2">
          {FIXTURE_KEYS.map((s) => (
            <button key={s} onClick={() => setKey(s)} className={`min-h-11 rounded-full border-2 border-ink px-4 font-bold ${key === s ? "bg-mustard" : "bg-card"}`}>
              {LABEL[s]}
            </button>
          ))}
        </div>
        <span className="text-sm text-ink-soft">截图用：?view=screen&amp;state=voting / ?view=organizer&amp;state=confirmed / ?view=stats（&amp;stats=empty）</span>
      </header>

      <div className="flex flex-wrap items-start gap-8">
        <div>
          <div className="mb-2 text-sm font-bold text-ink-soft">发起人控制台 · 手机 375（假后端，可点）</div>
          <div className="overflow-y-auto overflow-x-hidden rounded-[32px] border-[6px] border-ink bg-paper p-3 shadow-sticker-lg" style={{ width: 375 + 12, height: 812 }}>
            {panel}
          </div>
        </div>

        <div className="min-w-[640px] flex-1">
          <div className="mb-2 text-sm font-bold text-ink-soft">大屏 1920 × 1080（公开视图，等比缩放）</div>
          <div className="overflow-hidden rounded-2xl border-[6px] border-ink">
            <Stage fit="container">
              <BigScreen key={`${key}-${stampKey}`} state={publicState} joinUrl={JOIN} selfTest={fixtureSelfTest} verify={fakeVerify} />
            </Stage>
          </div>

          <div className="mb-2 mt-8 text-sm font-bold text-ink-soft">/firewall 架构图（跟随系统明暗）</div>
          <div className="sticker p-4 dark:bg-night">
            <FirewallDiagram />
          </div>

          <div className="mb-2 mt-8 text-sm font-bold text-ink-soft">/stats 真实数据页（有数据 / 空状态）</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="overflow-hidden rounded-2xl border-[6px] border-ink">
              <Stage fit="container">
                <StatsScreen stats={fixtureStats} />
              </Stage>
            </div>
            <div className="overflow-hidden rounded-2xl border-[6px] border-ink">
              <Stage fit="container">
                <StatsScreen stats={fixtureStatsEmpty} />
              </Stage>
            </div>
          </div>

          <div className="mt-8 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-6">
            <div className="w-[340px]">
              <div className="mb-2 text-sm font-bold text-ink-soft">#13 模拟订位通话</div>
              <SimCall dialog={fixtureMessages.reservationDialog!} shopName="左庭右院鲜牛肉火锅（徐家汇店）" tel="021-64071234" />
            </div>
            <div className="sticker flex flex-col items-center gap-3 p-5">
              <div className="text-sm font-bold text-ink-soft">印章 · 砸下来</div>
              <StampSlam key={stampKey} size={160} sub="2026.10.24" />
              <button className="min-h-11 font-bold underline" onClick={() => setStampKey((k) => k + 1)}>
                再盖一次
              </button>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-[16px] bg-night p-5">
              <div className="text-sm font-bold text-cream-faint">夜间印章</div>
              <StampSlam key={`d${stampKey}`} size={160} onDark text="定局" sub="2026.10.24" />
              <Stamp size={90} text="成局" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

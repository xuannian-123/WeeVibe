"use client";

import { useEffect, useState } from "react";
import type { JuState, PrivacySelfTest } from "@/lib/types";
import { api, type VerifyResult } from "@/components/organizer/api";
import { Odometer } from "./bits";
import { heatColor, shortHash, slotLabel, trunc, voteTally } from "./fmt";

export function Panel({
  title,
  right,
  children,
  className = "",
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col rounded-[28px] border-2 border-night-line bg-night-2 p-6 ${className}`}>
      <div className="mb-4 flex shrink-0 items-baseline justify-between gap-3">
        <h3 className="text-[24px] font-black text-cream">{title}</h3>
        {right && <span className="text-[17px] text-cream-faint">{right}</span>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/* ───────── 人 × 方案 体验矩阵（只用公开 utility） ───────── */
export function ExperienceMatrix({ state }: { state: JuState }) {
  const { ju } = state;
  const plan = ju.plan;
  if (!plan) return null;
  const ps = plan.proposals;
  const tally = voteTally(ju);
  const members = state.members;
  const marked = (id: string) => (ju.confirmedProposalId ? ju.confirmedProposalId === id : ps.find((p) => p.id === id)?.recommended);
  const cols = `150px repeat(${ps.length}, minmax(0, 1fr))`;

  return (
    <div className="flex h-full flex-col">
      {/* 表头：方案 */}
      <div className="grid shrink-0 gap-2" style={{ gridTemplateColumns: cols }}>
        <div />
        {ps.map((p, i) => {
          const on = marked(p.id);
          return (
            <div
              key={p.id}
              className={`animate-rise relative rounded-t-2xl px-3 pb-2 pt-3 ${on ? "bg-cinnabar/20 ring-2 ring-cinnabar" : "bg-night-3"}`}
              style={{ animationDelay: `${i * 120}ms` }}
            >
              {on && (
                <span className="absolute -top-3 right-2 rounded-full bg-cinnabar px-2.5 py-0.5 text-[13px] font-black text-white">
                  {ju.confirmedProposalId ? "已定" : "推荐"}
                </span>
              )}
              <span className="inline-block rounded-md bg-mustard px-2 py-0.5 text-[14px] font-black text-night">{p.labelText}</span>
              <div className="mt-1.5 line-clamp-1 text-[17px] font-black leading-tight text-cream">{trunc(p.poi.name, 11)}</div>
              <div className="font-num mt-1 flex items-center gap-2 text-[14px] text-cream-faint">
                <span>{slotLabel(p.slot).split(" ").slice(-1)[0]}</span>
                {p.poi.costPerPerson != null && <span>¥{p.poi.costPerPerson}</span>}
                {ju.status === "voting" || (ju.status === "confirmed" && Object.keys(ju.votes ?? {}).length > 0) ? (
                  <span className="ml-auto text-[18px] font-bold text-mustard">
                    {tally[p.id] ?? 0}
                    <span className="text-[12px] text-cream-faint">票</span>
                  </span>
                ) : (
                  ju.status === "confirmed" &&
                  p.id === ju.confirmedProposalId && <span className="ml-auto text-[13px] font-bold text-mustard">发起人拍板</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 每个人在每个方案下的公开体验 */}
      <div className="mt-1 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
        {members.map((m, r) => (
          <div key={m.id} className="grid min-h-[26px] items-center gap-2" style={{ gridTemplateColumns: cols, flex: "1 1 0", maxHeight: 46 }}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="text-[24px]">{m.avatar}</span>
              <span className="truncate text-[17px] font-bold text-cream">{m.name}</span>
              {m.role === "must" && <span className="text-[13px] text-mustard">★</span>}
            </div>
            {ps.map((p) => {
              const e = p.experiences.find((x) => x.memberId === m.id);
              if (!e) return <div key={p.id} className="h-full rounded-lg bg-night-3" />;
              const absent = e.status === "absent";
              const note = absent ? "来不了" : e.lateMin > 0 ? `晚${e.lateMin}′` : e.leaveAt && e.status !== "full" ? `${e.leaveAt}走` : `${e.commuteMin}′`;
              return (
                <div
                  key={p.id}
                  className="animate-fade-in font-num flex h-full items-center justify-between rounded-lg px-3"
                  style={{
                    background: absent ? "#2a231f" : heatColor(e.utility),
                    color: absent ? "#a89a88" : "#14110f",
                    animationDelay: `${200 + r * 60}ms`,
                    outline: marked(p.id) ? "2px solid rgb(226 65 46 / .6)" : undefined,
                  }}
                  title={e.notes.join("，")}
                >
                  <span className="text-[22px] font-bold">{absent ? "—" : e.utility}</span>
                  <span className="text-[13px] font-semibold opacity-75">{note}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 汇总 */}
      <div className="mt-2 grid shrink-0 gap-2 border-t-2 border-dashed border-night-line pt-2" style={{ gridTemplateColumns: cols }}>
        <div className="text-[14px] leading-tight text-cream-faint">
          到场 · 最低 · 平均
          <br />
          <span className="text-[12px]">满意度 0-100</span>
        </div>
        {ps.map((p) => (
          <div key={p.id} className="font-num flex items-baseline justify-between px-1 text-[18px] font-bold text-cream">
            <span>{p.attendCount}人</span>
            <span style={{ color: heatColor(p.minUtility) }}>{p.minUtility}</span>
            <span className="text-cream-faint">{p.avgUtility}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── #9 审计面板 ───────── */
export function AuditPanel({ state, className = "", verify = api.verify }: { state: JuState; className?: string; verify?: (id: string) => Promise<VerifyResult> }) {
  const plan = state.ju.plan;
  const [v, setV] = useState<VerifyResult | null>(null);
  const [err, setErr] = useState(false);
  const id = state.ju.id;
  const at = plan?.computedAt;

  useEffect(() => {
    if (!at) return;
    let alive = true;
    setV(null);
    setErr(false);
    const t = setTimeout(() => {
      verify(id)
        .then((r) => alive && setV(r))
        .catch(() => alive && setErr(true));
    }, 900); // 让"复算中"停留一下，台上看得见
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [id, at, verify]);

  if (!plan) return null;
  const a = plan.audit;
  return (
    <Panel title="🔏 拍板可复核" right={<span className="font-num">{a.algorithmVersion}</span>} className={className}>
      <div className="grid grid-cols-3 gap-3">
        {[
          ["候选组合", a.candidates],
          ["体验计算", a.evaluations],
          ["帕累托前沿", a.paretoSize],
        ].map(([l, n]) => (
          <div key={l} className="rounded-2xl bg-night-3 px-3 py-2">
            <Odometer value={Number(n)} className="text-[32px] font-bold text-mustard" />
            <div className="mt-0.5 text-[14px] text-cream-faint">{l}</div>
          </div>
        ))}
      </div>
      <dl className="font-num mt-3 space-y-1 text-[15px]">
        <div className="flex gap-3">
          <dt className="w-[88px] shrink-0 text-cream-faint">inputHash</dt>
          <dd className="truncate text-cream">{shortHash(a.inputHash, 20)}</dd>
        </div>
        <div className="flex gap-3">
          <dt className="w-[88px] shrink-0 text-cream-faint">outputHash</dt>
          <dd className="truncate text-cream">{shortHash(a.outputHash, 20)}</dd>
        </div>
      </dl>
      <div
        className={`mt-3 flex items-center gap-3 rounded-2xl border-2 px-4 py-2.5 text-[19px] font-black ${
          v?.ok ? "border-[#3ecf8e] text-[#3ecf8e]" : v && !v.ok ? "border-cinnabar text-cinnabar" : "border-night-line text-cream-faint"
        }`}
      >
        {v ? (
          v.ok ? (
            <>
              <span className="animate-pop-in text-[26px]">✓</span> 复算一致
              <span className="font-num ml-auto truncate text-[14px] font-normal opacity-80">{shortHash(v.recomputedOutputHash, 12)}</span>
            </>
          ) : (
            <>✗ 复算不一致</>
          )
        ) : err ? (
          <>复算接口暂时不可用</>
        ) : (
          <>
            <span className="inline-block size-5 animate-spin rounded-full border-[3px] border-current border-r-transparent" /> 同样的输入，再算一遍…
          </>
        )}
      </div>
    </Panel>
  );
}

/* ───────── #4 隐私面板 ───────── */
export function useSelfTest() {
  const [t, setT] = useState<PrivacySelfTest | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .selftest()
        .then((r) => {
          if (!alive) return;
          setT(r);
          setErr(false);
        })
        .catch(() => alive && setErr(true));
    load();
    const timer = setInterval(load, 5 * 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return { test: t, error: err };
}

export function PrivacyPanel({ state, test, className = "" }: { state: JuState; test: PrivacySelfTest | null; className?: string }) {
  const pending = state.ju.pendingChanges;
  return (
    <Panel title="🛡️ 隐私防火墙" right={test ? "实时自检" : "自检中…"} className={className}>
      <div className="flex items-end gap-3">
        <span className="text-[20px] font-bold text-cream-faint">反事实检验</span>
        {test ? <Odometer value={test.runs} className="text-[52px] font-bold text-cream" /> : <span className="text-[52px] font-bold leading-none text-cream-faint">…</span>}
        <span className="pb-1 text-[20px] font-bold text-cream-faint">次</span>
        <span
          className={`ml-auto rounded-xl px-3 py-1 text-[26px] font-black ${test && test.leaks === 0 ? "bg-[#3ecf8e] text-night" : test ? "bg-cinnabar text-white" : "bg-night-3 text-cream-faint"}`}
        >
          <span className="font-num">{test ? test.leaks : "?"}</span> 泄露
        </span>
      </div>
      {test && test.checks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {test.checks.map((c) => (
            <span key={c.name} className="font-num rounded-full border border-night-line px-3 py-1 text-[14px] text-cream-faint">
              {c.name.split(/[（(]/)[0].trim()} {c.runs} · <b className={c.leaks ? "text-cinnabar" : "text-[#3ecf8e]"}>{c.leaks}</b>
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-[16px] leading-relaxed text-cream-faint">
        把两个人的私密信息对调，再生成一遍所有公开内容 —— 逐字节相同，才算没漏。
        {pending > 0 && <span className="text-mustard"> 有 {pending} 位朋友刚更新了情况，局长攒一攒再重算。</span>}
      </p>
    </Panel>
  );
}

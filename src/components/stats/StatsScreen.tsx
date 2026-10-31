"use client";

import { useId } from "react";
import type { Stats } from "@/lib/types";
import { SealLogo } from "../ui";
import { Stamp } from "../Stamp";
import { Odometer } from "../screen/bits";

/* ───────── 工具：任何异常数据都不能变成 NaN ───────── */
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** 兼容几种小时格式：ISO / "YYYY-MM-DDTHH" / "YYYY-MM-DD HH:00" */
function parseHour(h: string): Date | null {
  let d = new Date(h);
  if (!Number.isNaN(d.getTime())) return d;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2})/.exec(h);
  if (m) {
    d = new Date(`${m[1]}T${m[2]}:00:00+08:00`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** 北京时间的 月/日 与 时 */
function bj(d: Date) {
  const t = new Date(d.getTime() + 8 * 3600000);
  return { md: `${t.getUTCMonth() + 1}/${t.getUTCDate()}`, h: t.getUTCHours() };
}

function relTime(iso: string, nowIso: string): string {
  const a = new Date(iso).getTime();
  const b = new Date(nowIso).getTime() || Date.now();
  if (!Number.isFinite(a)) return "";
  const min = Math.max(0, Math.round((b - a) / 60000));
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

/** Fritsch–Carlson 单调三次插值：曲线平滑但不会冲到 0 以下 */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    m.push((pts[i + 1].y - pts[i].y) / (dx[i] || 1));
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i].x + h).toFixed(1)},${(pts[i].y + t[i] * h).toFixed(1)} ${(pts[i + 1].x - h).toFixed(1)},${(
      pts[i + 1].y - t[i + 1] * h
    ).toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

function niceMax(v: number) {
  if (v <= 4) return 4;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

/* ───────── 72 小时入局曲线 ───────── */
const CW = 1124;
const CH = 420;
const ML = 56;
const MR = 40;
const MT = 40;
const MB = 44;

function HourlyChart({ hourly }: { hourly: Stats["hourly"] }) {
  const uid = useId().replace(/:/g, "");
  const rows = hourly
    .map((r) => ({ d: parseHour(r.hour), joins: Math.max(0, num(r.joins)) }))
    .filter((r): r is { d: Date; joins: number } => !!r.d)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .slice(-72);
  const total = rows.reduce((s, r) => s + r.joins, 0);
  const pw = CW - ML - MR;
  const ph = CH - MT - MB;

  if (rows.length < 2 || total === 0) {
    return (
      <svg viewBox={`0 0 ${CW} ${CH}`} className="block h-full w-full" role="img" aria-label="72 小时入局曲线：暂无数据">
        <line x1={ML} x2={CW - MR} y1={MT + ph} y2={MT + ph} stroke="var(--color-night-line)" strokeWidth="2" strokeDasharray="6 8" />
        <text x={CW / 2} y={MT + ph / 2} textAnchor="middle" fill="var(--color-cream-faint)" fontSize="26" fontWeight="700">
          曲线会在第一位朋友入局后长出来 🌱
        </text>
      </svg>
    );
  }

  const max = niceMax(Math.max(...rows.map((r) => r.joins)));
  const n = rows.length;
  const x = (i: number) => ML + (i / (n - 1)) * pw;
  const y = (v: number) => MT + ph - (v / max) * ph;
  const pts = rows.map((r, i) => ({ x: x(i), y: y(r.joins) }));
  const line = monotonePath(pts);
  const area = `${line}L${x(n - 1).toFixed(1)},${MT + ph}L${ML},${MT + ph}Z`;
  const peakIdx = rows.reduce((bi, r, i) => (r.joins > rows[bi].joins ? i : bi), 0);
  const last = rows[n - 1];
  const step = Math.max(1, Math.round(n / 6));

  return (
    <svg viewBox={`0 0 ${CW} ${CH}`} className="block h-full w-full" role="img" aria-label={`72 小时入局曲线，共 ${total} 人次`}>
      <defs>
        <linearGradient id={`area-${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--color-mustard)" stopOpacity="0.38" />
          <stop offset="1" stopColor="var(--color-mustard)" stopOpacity="0" />
        </linearGradient>
        <filter id={`glow-${uid}`} x="-10%" y="-30%" width="120%" height="160%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* 网格：低调 */}
      {[0, 0.5, 1].map((k) => (
        <g key={k}>
          <line x1={ML} x2={CW - MR} y1={y(max * k)} y2={y(max * k)} stroke="var(--color-cream)" strokeOpacity={k === 0 ? 0.25 : 0.08} strokeWidth="1.5" />
          <text x={ML - 14} y={y(max * k) + 6} textAnchor="end" fill="var(--color-cream-faint)" fontSize="17" style={{ fontFamily: "var(--font-num)" }}>
            {Math.round(max * k)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        if (i % step !== 0 && i !== n - 1) return null;
        if (i !== n - 1 && n - 1 - i < step * 0.6) return null; // 避免和最后一个标签挤在一起
        const { md, h } = bj(r.d);
        return (
          <text key={i} x={x(i)} y={CH - 12} textAnchor="middle" fill="var(--color-cream-faint)" fontSize="16" style={{ fontFamily: "var(--font-num)" }}>
            {md} {String(h).padStart(2, "0")}:00
          </text>
        );
      })}

      <path d={area} fill={`url(#area-${uid})`} />
      <path d={line} fill="none" stroke="var(--color-mustard)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" filter={`url(#glow-${uid})`} />

      {/* 峰值 */}
      {peakIdx !== n - 1 && (
        <g transform={`translate(${x(peakIdx)} ${y(rows[peakIdx].joins)})`}>
          <circle r="7" fill="var(--color-mustard)" stroke="var(--color-night-2)" strokeWidth="3" />
          <text y="-18" textAnchor="middle" fill="var(--color-cream)" fontSize="18" fontWeight="700" stroke="var(--color-night-2)" strokeWidth="6" paintOrder="stroke">
            峰值 <tspan style={{ fontFamily: "var(--font-num)" }}>{rows[peakIdx].joins}</tspan>
          </text>
        </g>
      )}
      {/* 最新一小时 */}
      <g transform={`translate(${x(n - 1)} ${y(last.joins)})`}>
        <circle r="10" fill="none" stroke="var(--color-cinnabar)" strokeWidth="3" className="svg-origin animate-pulse-ring" />
        <circle r="7" fill="var(--color-cinnabar)" stroke="var(--color-night-2)" strokeWidth="3" />
        <text x="-14" y="-22" textAnchor="end" fill="var(--color-cream)" fontSize="18" fontWeight="700" stroke="var(--color-night-2)" strokeWidth="6" paintOrder="stroke">
          这一小时 <tspan style={{ fontFamily: "var(--font-num)" }}>{last.joins}</tspan>
        </text>
      </g>

      {/* 悬停：每小时一个命中区 */}
      {rows.map((r, i) => {
        const { md, h } = bj(r.d);
        const w = pw / (n - 1);
        return (
          <rect key={`h${i}`} x={x(i) - w / 2} y={MT} width={w} height={ph} fill="transparent">
            <title>{`${md} ${String(h).padStart(2, "0")}:00 · ${r.joins} 人入局`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/* ───────── 大数字卡片 ───────── */
function BigStat({
  label,
  value,
  unit,
  sub,
  accent,
  children,
}: {
  label: React.ReactNode;
  value: number | null;
  unit: string;
  sub: React.ReactNode;
  accent?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-[28px] border-2 p-8 ${
        accent ? "border-mustard bg-mustard text-night shadow-[0_0_60px_rgb(201_185_241/.22)]" : "border-night-line bg-night-2 text-cream"
      }`}
    >
      {children}
      <div className={`relative text-[28px] font-black ${accent ? "text-night" : "text-cream"}`}>{label}</div>
      <div className="relative mt-3 flex items-end gap-3">
        {value === null ? (
          <span className={`font-num text-[124px] font-bold leading-none ${accent ? "text-night/35" : "text-cream-faint"}`}>?</span>
        ) : (
          <Odometer value={value} className={`text-[124px] font-bold ${accent ? "text-night" : "text-mustard"}`} />
        )}
        <span className={`pb-4 text-[30px] font-bold ${accent ? "text-night/70" : "text-cream-faint"}`}>{unit}</span>
      </div>
      <div className={`relative mt-3 text-[18px] leading-snug ${accent ? "text-night/75" : "text-cream-faint"}`}>{sub}</div>
    </section>
  );
}

const STATUS_CHIP: Record<string, [string, string]> = {
  confirmed: ["已成局", "bg-cinnabar text-white"],
  voting: ["投票中", "bg-mustard text-night"],
  collecting: ["收人中", "border-2 border-night-line text-cream"],
  cancelled: ["已散", "bg-night-3 text-cream-faint"],
};

function RecentRow({ r, now }: { r: Stats["recent"][number]; now: string }) {
  const [text, cls] = STATUS_CHIP[r.status] ?? [r.status, "bg-night-3"];
  return (
    <li className="flex h-[66px] items-center gap-4 border-b border-dashed border-night-line">
      <span className={`w-[92px] shrink-0 rounded-full py-1 text-center text-[16px] font-bold ${cls}`}>{text}</span>
      <span className="min-w-0 flex-1 truncate text-[23px] font-bold text-cream">{r.title}</span>
      <span className="font-num shrink-0 text-[20px] font-bold text-mustard">{num(r.members)} 人</span>
      <span className="w-[96px] shrink-0 text-right text-[16px] text-cream-faint">{relTime(r.createdAt, now)}</span>
    </li>
  );
}


function RecentList({ recent, now }: { recent: Stats["recent"]; now: string }) {
  if (!recent.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
        <span className="text-[56px]">🪑</span>
        <p className="text-[24px] font-bold text-cream">还没有真实的局</p>
        <p className="text-[18px] text-cream-faint">扫码发起，来做第一个吧</p>
      </div>
    );
  }
  const scroll = recent.length > 6;
  return (
    <div className="relative h-full overflow-hidden" style={{ maskImage: scroll ? "linear-gradient(transparent, #000 8%, #000 88%, transparent)" : undefined }}>
      <ul className={scroll ? "animate-ticker" : ""} style={scroll ? { animationDuration: `${recent.length * 3.2}s` } : undefined}>
        {recent.map((r) => (
          <RecentRow key={r.id} r={r} now={now} />
        ))}
        {scroll && recent.map((r) => <RecentRow key={`dup-${r.id}`} r={r} now={now} />)}
      </ul>
    </div>
  );
}

export function StatsScreen({ stats, error }: { stats: Stats | null; error?: boolean }) {
  const juCount = num(stats?.juCount);
  const confirmed = num(stats?.confirmedCount);
  const members = num(stats?.memberCount);
  const median = stats && typeof stats.medianFillSeconds === "number" && Number.isFinite(stats.medianFillSeconds) ? Math.round(stats.medianFillSeconds) : null;
  const hourly = stats?.hourly ?? [];
  const total72 = hourly.reduce((s, r) => s + Math.max(0, num(r.joins)), 0);
  const perJu = juCount > 0 ? Math.round((members / juCount) * 10) / 10 : null;
  const rate = juCount > 0 ? Math.round((confirmed / juCount) * 100) : null;
  const share =
    stats && typeof stats.privateShareRate === "number" && Number.isFinite(stats.privateShareRate)
      ? Math.round(Math.max(0, Math.min(1, stats.privateShareRate)) * 100)
      : null;
  const updated = stats?.generatedAt ? new Date(stats.generatedAt) : null;
  const updatedText = updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleTimeString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "";

  return (
    <div className="relative h-full w-full overflow-hidden bg-night text-cream">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-60 size-[800px] rounded-full"
        style={{ background: "radial-gradient(circle, rgb(99 80 162 / .14), transparent 65%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-72 -left-40 size-[900px] rounded-full"
        style={{ background: "radial-gradient(circle, rgb(201 185 241 / .08), transparent 65%)" }}
      />

      <header className="relative flex h-[150px] items-center gap-7 px-12">
        <SealLogo size={78} dark />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[22px] font-bold text-cream-faint">AI 局长 / 真实数据</div>
          <h1 className="truncate text-[56px] font-black leading-tight tracking-tight">不是 PPT，是真的有人在组局</h1>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`flex items-center gap-3 rounded-full border-2 px-6 py-2.5 text-[22px] font-black ${error ? "border-cinnabar text-cinnabar" : "border-night-line"}`}>
            <span className={`size-3 rounded-full ${error ? "bg-cinnabar" : "animate-pulse bg-[#3ecf8e]"}`} />
            {error ? "连接中断，重试中…" : stats ? "LIVE · 每 5 秒刷新" : "加载中…"}
          </span>
          {updatedText && <span className="font-num text-[16px] text-cream-faint">更新于 {updatedText}</span>}
        </div>
      </header>

      <div className="relative grid h-[300px] grid-cols-4 gap-7 px-12">
        <BigStat
          label="真实成局"
          value={stats ? confirmed : null}
          unit="个"
          sub={juCount > 0 ? <>共 <b className="font-num text-cream">{juCount}</b> 个真实局，盖章率 <b className="font-num text-cream">{rate}%</b></> : "两人以上的真局才算数"}
        >
          <div className="pointer-events-none absolute -right-8 -top-6 rotate-[-12deg] opacity-80" style={{ filter: "drop-shadow(0 0 18px rgb(99 80 162 / .45))" }}>
            <Stamp size={140} />
          </div>
        </BigStat>
        <BigStat
          label="参与人次"
          value={stats ? members : null}
          unit="人次"
          sub={perJu !== null ? <>平均每个局 <b className="font-num text-cream">{perJu}</b> 人</> : "演示成员不计入"}
        />
        <BigStat
          label="私下说了真话"
          value={share}
          unit="%"
          sub={share !== null ? "的人私下告诉了局长说不出口的话（预算 / 门禁 / 不想去）" : "等第一位朋友私聊完就有了"}
        >
          <div className="pointer-events-none absolute -right-3 -top-3 text-[90px] opacity-20" aria-hidden>
            🤫
          </div>
        </BigStat>
        <BigStat
          accent
          label={median !== null ? <>朋友平均 <span className="font-num">{median}</span> 秒入局</> : "朋友平均几秒入局？"}
          value={median}
          unit="秒"
          sub={median !== null ? "中位数 · 从打开链接到私聊完成" : "等第一位朋友聊完就有了"}
        />
      </div>

      <div className="relative mt-8 grid h-[550px] grid-cols-[1180px_1fr] gap-8 px-12 pb-12">
        <section className="flex min-h-0 flex-col rounded-[28px] border-2 border-night-line bg-night-2 p-7 pb-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[26px] font-black">📈 72 小时入局曲线</h3>
            <span className="text-[18px] text-cream-faint">
              共 <b className="font-num text-[22px] text-mustard">{total72}</b> 人次 · 按小时
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <HourlyChart hourly={hourly} />
          </div>
        </section>
        <section className="flex min-h-0 flex-col rounded-[28px] border-2 border-night-line bg-night-2 p-7">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[26px] font-black">🔥 最近的局</h3>
            <span className="text-[18px] text-cream-faint">最近 10 个</span>
          </div>
          <div className="min-h-0 flex-1">
            <RecentList recent={stats?.recent ?? []} now={stats?.generatedAt ?? ""} />
          </div>
        </section>
      </div>
    </div>
  );
}

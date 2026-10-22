"use client";

import { useId, useMemo } from "react";
import type { JuState, LatLng, Member } from "@/lib/types";
import { leadingOption } from "@/lib/client/format";

const W = 760;
const H = 850;
const PAD = 96;

/** 等距圆柱投影 + 等比缩放进画布 */
function makeProjector(points: LatLng[]) {
  if (!points.length) return () => ({ x: W / 2, y: H / 2 });
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p.lng * k);
  const ys = points.map((p) => -p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max((maxX - minX) / (W - PAD * 2), (maxY - minY) / (H - PAD * 2 - 40), 0.012 / (W - PAD * 2));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return (p: LatLng) => ({
    x: W / 2 + (p.lng * k - cx) / span,
    y: H / 2 - 10 + (-p.lat - cy) / span,
  });
}

type XY = { x: number; y: number };

/** 候选店常挤在公平中心附近：把店的标记推开，避免互相压住（抽象地图，不追求真实比例） */
function relax(pois: XY[], fixed: XY[], center: XY | null): XY[] {
  const out = pois.map((p) => ({ ...p }));
  const anchors = center ? [...fixed, center] : fixed;
  for (let iter = 0; iter < 80; iter++) {
    out.forEach((p, i) => {
      const push = (o: XY, minD: number, share: number, seed: number) => {
        let dx = p.x - o.x;
        let dy = p.y - o.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          const a = (seed * 2.399) % (Math.PI * 2);
          dx = Math.cos(a);
          dy = Math.sin(a);
          d = 1;
        }
        if (d < minD) {
          const k = ((minD - d) / d) * share;
          p.x += dx * k;
          p.y += dy * k;
        }
      };
      anchors.forEach((a, j) => push(a, center && j === anchors.length - 1 ? 100 : 125, 0.5, i + j + 1));
      out.forEach((q, j) => j !== i && push(q, 120, 0.5, i * 3 + j + 1));
      p.x = Math.min(W - 60, Math.max(60, p.x));
      p.y = Math.min(H - 90, Math.max(90, p.y));
    });
  }
  return out;
}

/** 成员之间也稍微推开，避免头像叠在一起 */
function spread(points: XY[], minD = 96): XY[] {
  const out = points.map((p) => ({ ...p }));
  for (let iter = 0; iter < 60; iter++) {
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = Math.cos(i + j);
          dy = Math.sin(i + j);
          d = 1;
        }
        if (d < minD) {
          const k = (minD - d) / d / 2;
          a.x -= dx * k;
          a.y -= dy * k;
          b.x += dx * k;
          b.y += dy * k;
        }
      }
    for (const p of out) {
      p.x = Math.min(W - 50, Math.max(50, p.x));
      p.y = Math.min(H - 80, Math.max(80, p.y));
    }
  }
  return out;
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function AbstractMap({ state }: { state: JuState }) {
  const uid = useId().replace(/:/g, "");
  const { ju } = state;
  const plan = ju.plan;
  const members = state.members.filter((m) => m.status === "in");
  const target = plan ? leadingOption(ju) : undefined;
  const confirmed = ju.status === "confirmed";

  const project = useMemo(() => {
    const pts: LatLng[] = members.map((m) => m.location);
    if (plan) {
      pts.push(plan.center);
      for (const o of plan.options) pts.push(o.poi);
    }
    return makeProjector(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(members.map((m) => m.location)), plan?.computedAt]);

  const absent = new Set(plan?.absentIds ?? []);
  const center = plan ? project(plan.center) : null;
  const memberPos = useMemo(
    () => new Map(spread(members.map((m) => project(m.location))).map((p, i) => [members[i].id, p])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, members.length],
  );
  const posOf = (m: Member) => memberPos.get(m.id) ?? project(m.location);
  const poiPos = useMemo(
    () => (plan ? relax(plan.options.map((o) => project(o.poi)), [...memberPos.values()], center) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, memberPos, plan?.computedAt],
  );
  const targetIdx = plan && target ? plan.options.findIndex((o) => o.poi.id === target.poi.id) : -1;
  const tp = targetIdx >= 0 ? poiPos[targetIdx] : null;
  const commuteOf = (m: Member) => target?.commutes.find((c) => c.memberId === m.id);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-full w-full" role="img" aria-label="成员与候选店的抽象地图">
      <defs>
        <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={`line-${uid}`} x1="0" x2="1">
          <stop offset="0" stopColor="#f2b530" />
          <stop offset="1" stopColor="#e2412e" />
        </linearGradient>
        <radialGradient id={`vig-${uid}`} cx="50%" cy="50%" r="65%">
          <stop offset="0.55" stopColor="#14110f" stopOpacity="0" />
          <stop offset="1" stopColor="#14110f" stopOpacity="0.85" />
        </radialGradient>
        <pattern id={`dots-${uid}`} width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="13" cy="13" r="1.5" fill="#f3e7d3" opacity="0.13" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill={`url(#dots-${uid})`} />

      {/* 雷达环 */}
      {(() => {
        const c = center ?? { x: W / 2, y: H / 2 - 10 };
        return [110, 220, 330, 440].map((r) => (
          <circle key={r} cx={c.x} cy={c.y} r={r} fill="none" stroke="#f3e7d3" strokeOpacity="0.06" strokeWidth="1.5" strokeDasharray="4 8" />
        ));
      })()}

      {members.length === 0 && (
        <g>
          <circle cx={W / 2} cy={H / 2 - 10} r="14" fill="#f2b530" className="svg-origin animate-pulse-ring" />
          <circle cx={W / 2} cy={H / 2 - 10} r="7" fill="#f2b530" />
          <text x={W / 2} y={H / 2 + 50} textAnchor="middle" fill="#a89a88" fontSize="24" fontWeight="700">
            等第一个人扫码入局…
          </text>
        </g>
      )}

      {/* 成员 → 第 1 名店 的连线 */}
      {tp &&
        members.map((m) => {
          if (absent.has(m.id)) return null;
          const p = posOf(m);
          return (
            <line
              key={`l-${m.id}`}
              x1={p.x}
              y1={p.y}
              x2={tp.x}
              y2={tp.y}
              stroke={`url(#line-${uid})`}
              strokeWidth="3"
              strokeOpacity="0.75"
              strokeDasharray="8 4"
              strokeLinecap="round"
              className="animate-flow"
            />
          );
        })}

      {/* 公平中心 */}
      {center && (
        <g>
          <circle cx={center.x} cy={center.y} r="26" fill="none" stroke="#f2b530" strokeWidth="3" className="svg-origin animate-pulse-ring" />
          <circle
            cx={center.x}
            cy={center.y}
            r="26"
            fill="none"
            stroke="#f2b530"
            strokeWidth="3"
            className="svg-origin animate-pulse-ring"
            style={{ animationDelay: "1.2s" }}
          />
          <circle cx={center.x} cy={center.y} r="9" fill="#f2b530" filter={`url(#glow-${uid})`} />
          <text x={center.x} y={center.y + 32} textAnchor="middle" fill="#f2b530" fontSize="16" fontWeight="800" stroke="#14110f" strokeWidth="5" paintOrder="stroke">
            公平中心
          </text>
        </g>
      )}

      {/* 候选店 */}
      {plan?.options.map((o, i) => {
        const p = poiPos[i];
        const isTarget = target?.poi.id === o.poi.id;
        const dim = confirmed && !isTarget;
        const s = isTarget ? 46 : 36;
        return (
          <g key={o.poi.id} opacity={dim ? 0.35 : 1} className="animate-fade-in" style={{ animationDelay: `${300 + i * 150}ms` }}>
            <g transform={`translate(${p.x} ${p.y})`}>
              <g transform="rotate(45)">
                <rect
                  x={-s / 2}
                  y={-s / 2}
                  width={s}
                  height={s}
                  rx="8"
                  fill={isTarget ? "#e2412e" : "#2a231f"}
                  stroke={isTarget ? "#f3e7d3" : "#e2412e"}
                  strokeWidth="3"
                  filter={isTarget ? `url(#glow-${uid})` : undefined}
                />
              </g>
              <text y="8" textAnchor="middle" fill="#f3e7d3" fontSize={isTarget ? 24 : 19} fontWeight="800" style={{ fontFamily: "var(--font-num)" }}>
                {i + 1}
              </text>
              {isTarget && (
                <text
                  y={center && p.y > center.y ? s / 2 + 34 : -s / 2 - 22}
                  textAnchor="middle"
                  fill="#f3e7d3"
                  fontSize="20"
                  fontWeight="800"
                  stroke="#14110f"
                  strokeWidth="6"
                  paintOrder="stroke"
                >
                  {trunc(o.poi.name, 11)}
                </text>
              )}
            </g>
          </g>
        );
      })}

      {/* 成员 */}
      {members.map((m) => {
        const p = posOf(m);
        const off = absent.has(m.id);
        const c = commuteOf(m);
        return (
          <g key={m.id} transform={`translate(${p.x} ${p.y})`} opacity={off ? 0.35 : 1}>
            <g className="svg-origin animate-pop-in">
              <circle r="31" fill="#2a231f" stroke={m.isOrganizer ? "#e2412e" : "#f2b530"} strokeWidth="3" filter={`url(#glow-${uid})`} />
              <text y="11" textAnchor="middle" fontSize="32">
                {m.avatar}
              </text>
              <text
                y="54"
                textAnchor="middle"
                fill="#f3e7d3"
                fontSize="17"
                fontWeight="700"
                stroke="#14110f"
                strokeWidth="5"
                paintOrder="stroke"
              >
                {trunc(m.name, 6)}
              </text>
              {c && !off && (
                <g transform="translate(26 -30)">
                  <rect x="0" y="-15" width={c.minutes >= 100 ? 62 : 52} height="26" rx="13" fill="#e2412e" />
                  <text x={c.minutes >= 100 ? 31 : 26} y="5" textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700" style={{ fontFamily: "var(--font-num)" }}>
                    {c.minutes}′
                  </text>
                </g>
              )}
            </g>
          </g>
        );
      })}

      <rect width={W} height={H} fill={`url(#vig-${uid})`} pointerEvents="none" />

      {/* 指北针 */}
      <g transform={`translate(${W - 50} 52)`} opacity="0.5">
        <circle r="20" fill="none" stroke="#f3e7d3" strokeWidth="1.5" />
        <path d="M0 -14 L6 4 L0 0 L-6 4 Z" fill="#f3e7d3" />
        <text y="-26" textAnchor="middle" fill="#f3e7d3" fontSize="13" fontWeight="700" style={{ fontFamily: "var(--font-num)" }}>
          N
        </text>
      </g>
    </svg>
  );
}

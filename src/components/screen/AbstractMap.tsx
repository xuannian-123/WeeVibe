"use client";

import { useId, useMemo } from "react";
import type { JuState, LatLng, Member } from "@/lib/types";
import { focusProposal } from "./fmt";

const W = 760;
const H = 850;
/** 投影内边距：上方留给标题和指北针，下方留给名字和图例 */
const PAD_X = 100;
const PAD_T = 150;
const PAD_B = 135;
/** 点被推开后允许的范围 */
const SAFE = { x0: 70, x1: W - 70, y0: 128, y1: H - 112 };

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
  const pw = W - PAD_X * 2;
  const ph = H - PAD_T - PAD_B;
  const span = Math.max((maxX - minX) / pw, (maxY - minY) / ph, 0.012 / pw);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return (p: LatLng) => ({
    x: PAD_X + pw / 2 + (p.lng * k - cx) / span,
    y: PAD_T + ph / 2 + (-p.lat - cy) / span,
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
      p.x = Math.min(SAFE.x1, Math.max(SAFE.x0, p.x));
      p.y = Math.min(SAFE.y1, Math.max(SAFE.y0, p.y));
    });
  }
  return out;
}

/** 成员之间也稍微推开，避免头像叠在一起 */
function spread(points: XY[], minD = 112): XY[] {
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
      p.x = Math.min(SAFE.x1, Math.max(SAFE.x0, p.x));
      p.y = Math.min(SAFE.y1, Math.max(SAFE.y0, p.y));
    }
  }
  return out;
}

/* ───────── 标签避让 ───────── */
type Box = { x0: number; y0: number; x1: number; y1: number };

const box = (x: number, y: number, w: number, h: number): Box => ({ x0: x, y0: y, x1: x + w, y1: y + h });
const around = (p: XY, r: number): Box => ({ x0: p.x - r, y0: p.y - r, x1: p.x + r, y1: p.y + r });

function overlap(a: Box, b: Box) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/** 线段是否穿过矩形（Liang–Barsky） */
function segHitsBox(a: XY, b: XY, r: Box) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const checks: [number, number][] = [
    [-dx, a.x - r.x0],
    [dx, r.x1 - a.x],
    [-dy, a.y - r.y0],
    [dy, r.y1 - a.y],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** 粗略估算文字宽度：中文按 1em，其他按 0.6em */
function textW(s: string, size: number) {
  let w = 0;
  for (const ch of s) w += /[\u2e80-\uffff]/.test(ch) ? size : size * 0.6;
  return w;
}

/** 在候选方位里挑一个碰撞最少的 */
function pickSpot(cands: Box[], obstacles: Box[], segs: [XY, XY][]): Box {
  let best = cands[0];
  let bestScore = Infinity;
  cands.forEach((c, i) => {
    let score = i * 2; // 同分时按候选顺序
    for (const o of obstacles) score += overlap(c, o) * 3;
    for (const [a, b] of segs) if (segHitsBox(a, b, c)) score += 160;
    // 出界
    score += (Math.max(0, 10 - c.x0) + Math.max(0, c.x1 - (W - 10)) + Math.max(0, 20 - c.y0) + Math.max(0, c.y1 - (H - 10))) * 60;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  });
  return best;
}

/** 地图上的固定元素：左上标题、右上指北针、左下图例 */
const STATIC_BOXES: Box[] = [box(0, 0, 330, 84), box(W - 84, 10, 74, 80), box(0, H - 64, 520, 64)];

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function AbstractMap({ state }: { state: JuState }) {
  const uid = useId().replace(/:/g, "");
  const { ju } = state;
  const plan = ju.plan;
  const members = state.members.filter((m): m is Member & { location: NonNullable<Member["location"]> } => m.status === "in" && !!m.location);
  const target = plan ? focusProposal(ju) : undefined;
  const confirmed = ju.status === "confirmed";

  const project = useMemo(() => {
    const pts: LatLng[] = members.map((m) => m.location);
    if (plan) {
      pts.push(plan.center);
      for (const o of plan.proposals) pts.push(o.poi);
    }
    return makeProjector(pts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(members.map((m) => m.location)), plan?.computedAt]);

  const absent = new Set((target?.experiences ?? []).filter((e) => e.status === "absent").map((e) => e.memberId));
  const center = plan ? project(plan.center) : null;
  const memberPos = useMemo(
    () => new Map(spread(members.map((m) => project(m.location))).map((p, i) => [members[i].id, p])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, members.length],
  );
  const posOf = (m: (typeof members)[number]) => memberPos.get(m.id) ?? project(m.location);
  const poiPos = useMemo(
    () => (plan ? relax(plan.proposals.map((o) => project(o.poi)), [...memberPos.values()], center) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, memberPos, plan?.computedAt],
  );
  const targetIdx = plan && target ? plan.proposals.findIndex((o) => o.id === target.id) : -1;
  const tp = targetIdx >= 0 ? poiPos[targetIdx] : null;
  const commuteOf = (m: Member) => {
    const e = target?.experiences.find((x) => x.memberId === m.id);
    return e ? { minutes: e.commuteMin } : undefined;
  };

  // —— 标签布局：先放第 1 名店名，再逐个放通勤分钟，后放的避开先放的 ——
  const ownBoxes = new Map<string, Box[]>();
  for (const m of members) {
    const p = posOf(m);
    const nw = textW(trunc(m.name, 6), 17) + 8;
    ownBoxes.set(m.id, [around(p, 34), box(p.x - nw / 2, p.y + 38, nw, 24)]);
  }
  const memberBoxes = [...ownBoxes.values()].flat();
  const poiBoxes: Box[] = poiPos.map((p, i) => around(p, (plan?.proposals[i].id === target?.id ? 46 : 36) * 0.75));
  const centerBox: Box[] = center ? [box(center.x - 34, center.y - 30, 68, 72)] : [];
  const lineSegs: [XY, XY][] = tp ? members.filter((m) => !absent.has(m.id)).map((m) => [posOf(m), tp] as [XY, XY]) : [];

  let targetLabel: (Box & { text: string }) | null = null;
  if (tp && target) {
    const text = trunc(target.poi.name, 12);
    const w = textW(text, 20) + 22;
    const h = 32;
    const g = 30; // 离菱形的距离
    const cands = [
      box(tp.x - w / 2, tp.y - g - h, w, h), // 上
      box(tp.x - w / 2, tp.y + g, w, h), // 下
      box(tp.x + g, tp.y - h / 2, w, h), // 右
      box(tp.x - g - w, tp.y - h / 2, w, h), // 左
    ];
    const others = poiBoxes.filter((_, i) => i !== targetIdx);
    targetLabel = { ...pickSpot(cands, [...STATIC_BOXES, ...memberBoxes, ...others, ...centerBox], lineSegs), text };
  }

  const placed: Box[] = targetLabel ? [targetLabel] : [];
  const pillOf = new Map<string, Box & { text: string }>();
  for (const m of members) {
    const c = commuteOf(m);
    if (!c || absent.has(m.id)) continue;
    const p = posOf(m);
    const text = `${c.minutes}′`;
    const w = textW(text, 16) + 22;
    const h = 26;
    const cands = [
      box(p.x + 22, p.y - 46, w, h), // 右上
      box(p.x + 36, p.y - h / 2, w, h), // 右
      box(p.x + 22, p.y + 20, w, h), // 右下
      box(p.x - 22 - w, p.y - 46, w, h), // 左上
      box(p.x - 36 - w, p.y - h / 2, w, h), // 左
      box(p.x - 22 - w, p.y + 20, w, h), // 左下
      box(p.x - w / 2, p.y - 66, w, h), // 正上
    ];
    const others = members.filter((o) => o.id !== m.id).flatMap((o) => ownBoxes.get(o.id) ?? []);
    const obstacles = [...STATIC_BOXES, ...others, ...poiBoxes, ...centerBox, ...placed];
    const spot = pickSpot(cands, obstacles, lineSegs);
    placed.push(spot);
    pillOf.set(m.id, { ...spot, text });
  }

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
          <stop offset="0" stopColor="var(--color-mustard)" />
          <stop offset="1" stopColor="var(--color-cinnabar)" />
        </linearGradient>
        <radialGradient id={`vig-${uid}`} cx="50%" cy="50%" r="65%">
          <stop offset="0.55" stopColor="var(--color-night)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--color-night)" stopOpacity="0.85" />
        </radialGradient>
        <pattern id={`dots-${uid}`} width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="13" cy="13" r="1.5" fill="var(--color-cream)" opacity="0.13" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill={`url(#dots-${uid})`} />

      {/* 雷达环 */}
      {(() => {
        const c = center ?? { x: W / 2, y: H / 2 - 10 };
        return [110, 220, 330, 440].map((r) => (
          <circle key={r} cx={c.x} cy={c.y} r={r} fill="none" stroke="var(--color-cream)" strokeOpacity="0.06" strokeWidth="1.5" strokeDasharray="4 8" />
        ));
      })()}

      {members.length === 0 && (
        <g>
          <circle cx={W / 2} cy={H / 2 - 10} r="14" fill="var(--color-mustard)" className="svg-origin animate-pulse-ring" />
          <circle cx={W / 2} cy={H / 2 - 10} r="7" fill="var(--color-mustard)" />
          <text x={W / 2} y={H / 2 + 50} textAnchor="middle" fill="var(--color-cream-faint)" fontSize="24" fontWeight="700">
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
          <circle cx={center.x} cy={center.y} r="26" fill="none" stroke="var(--color-mustard)" strokeWidth="3" className="svg-origin animate-pulse-ring" />
          <circle
            cx={center.x}
            cy={center.y}
            r="26"
            fill="none"
            stroke="var(--color-mustard)"
            strokeWidth="3"
            className="svg-origin animate-pulse-ring"
            style={{ animationDelay: "1.2s" }}
          />
          <circle cx={center.x} cy={center.y} r="9" fill="var(--color-mustard)" filter={`url(#glow-${uid})`} />
          <text x={center.x} y={center.y + 32} textAnchor="middle" fill="var(--color-mustard)" fontSize="16" fontWeight="800" stroke="var(--color-night)" strokeWidth="5" paintOrder="stroke">
            公平中心
          </text>
        </g>
      )}

      {/* 候选店 */}
      {plan?.proposals.map((o, i) => {
        const p = poiPos[i];
        const isTarget = target?.id === o.id;
        const dim = confirmed && !isTarget;
        const s = isTarget ? 46 : 36;
        return (
          <g key={o.id} opacity={dim ? 0.35 : 1} className="animate-fade-in" style={{ animationDelay: `${300 + i * 150}ms` }}>
            <g transform={`translate(${p.x} ${p.y})`}>
              <g transform="rotate(45)">
                <rect
                  x={-s / 2}
                  y={-s / 2}
                  width={s}
                  height={s}
                  rx="8"
                  fill={isTarget ? "var(--color-cinnabar)" : "var(--color-night-3)"}
                  stroke={isTarget ? "var(--color-cream)" : "var(--color-cinnabar)"}
                  strokeWidth="3"
                  filter={isTarget ? `url(#glow-${uid})` : undefined}
                />
              </g>
              <text y="8" textAnchor="middle" fill="var(--color-cream)" fontSize={isTarget ? 24 : 19} fontWeight="800" style={{ fontFamily: "var(--font-num)" }}>
                {i + 1}
              </text>
            </g>
          </g>
        );
      })}

      {/* 第 1 名店名：半透明深色底，压在连线上也能读 */}
      {targetLabel && (
        <g className="animate-fade-in" style={{ animationDelay: "450ms" }}>
          <rect
            x={targetLabel.x0}
            y={targetLabel.y0}
            width={targetLabel.x1 - targetLabel.x0}
            height={targetLabel.y1 - targetLabel.y0}
            rx="9"
            fill="var(--color-night)"
            fillOpacity="0.86"
            stroke="var(--color-cinnabar)"
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
          <text
            x={(targetLabel.x0 + targetLabel.x1) / 2}
            y={targetLabel.y0 + 23}
            textAnchor="middle"
            fill="var(--color-cream)"
            fontSize="20"
            fontWeight="800"
          >
            {targetLabel.text}
          </text>
        </g>
      )}

      {/* 成员 */}
      {members.map((m) => {
        const p = posOf(m);
        const off = absent.has(m.id);
        return (
          <g key={m.id} transform={`translate(${p.x} ${p.y})`} opacity={off ? 0.35 : 1}>
            <g className="svg-origin animate-pop-in">
              <circle r="31" fill="var(--color-night-3)" stroke={m.isOrganizer ? "var(--color-cinnabar)" : "var(--color-mustard)"} strokeWidth="3" filter={`url(#glow-${uid})`} />
              <text y="11" textAnchor="middle" fontSize="32">
                {m.avatar}
              </text>
              <text
                y="54"
                textAnchor="middle"
                fill="var(--color-cream)"
                fontSize="17"
                fontWeight="700"
                stroke="var(--color-night)"
                strokeWidth="5"
                paintOrder="stroke"
              >
                {trunc(m.name, 6)}
              </text>
            </g>
          </g>
        );
      })}

      {/* 通勤分钟：放在碰撞最少的方位 */}
      {members.map((m) => {
        const b = pillOf.get(m.id);
        if (!b) return null;
        return (
          <g key={`pill-${m.id}`} className="animate-fade-in" style={{ animationDelay: "500ms" }}>
            <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx="13" fill="var(--color-cinnabar)" stroke="var(--color-night)" strokeWidth="2" />
            <text
              x={(b.x0 + b.x1) / 2}
              y={b.y0 + 19}
              textAnchor="middle"
              fill="#fff"
              fontSize="16"
              fontWeight="700"
              style={{ fontFamily: "var(--font-num)" }}
            >
              {b.text}
            </text>
          </g>
        );
      })}

      <rect width={W} height={H} fill={`url(#vig-${uid})`} pointerEvents="none" />

      {/* 指北针 */}
      <g transform={`translate(${W - 50} 52)`} opacity="0.5">
        <circle r="20" fill="none" stroke="var(--color-cream)" strokeWidth="1.5" />
        <path d="M0 -14 L6 4 L0 0 L-6 4 Z" fill="var(--color-cream)" />
        <text y="-26" textAnchor="middle" fill="var(--color-cream)" fontSize="13" fontWeight="700" style={{ fontFamily: "var(--font-num)" }}>
          N
        </text>
      </g>
    </svg>
  );
}

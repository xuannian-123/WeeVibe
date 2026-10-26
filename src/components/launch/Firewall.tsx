"use client";

import { useId } from "react";

/* 隐私防火墙三层架构图：手写 SVG，横版（≥768px）/ 竖版（手机）两套坐标，内容同一份。
   颜色全部走 Tailwind 的 fill-/stroke- 工具类，dark: 跟随系统明暗。 */

type Rect = { x: number; y: number; w: number; h: number };

type Layer = {
  n: string;
  title: string;
  sub: string;
  see: string[];
  blind: string[];
  out: string[];
  accent?: boolean;
};

const LAYERS: Layer[] = [
  {
    n: "1",
    title: "私聊局长",
    sub: "大模型 · 一人一个对话",
    see: ["你自己说的话", "你的预算、门禁、忌口"],
    blind: ["别人的任何信息"],
    out: ["回复只给你本人"],
  },
  {
    n: "2",
    title: "确定性规划器",
    sub: "纯算法 · 不是大模型",
    see: ["所有人的私密约束", "通勤、时段、刷卡"],
    blind: ["不写任何文字"],
    out: ["方案 + 审计哈希", "公开满意度只看通勤和时段"],
    accent: true,
  },
  {
    n: "3",
    title: "公开局长",
    sub: "大模型 · 写群公告",
    see: ["PublicFacts", "聚合后的结论"],
    blind: ["任何人的私密信息"],
    out: ["群公告 · 订位 · 回顾"],
  },
];

const INPUTS: [string, string][] = [
  ["🐰", "预算 80 就够了"],
  ["🐻", "11 点前得回宿舍"],
  ["🦊", "这次不太想去…"],
];

const OUTPUTS: string[][] = [
  ["有人预算偏紧，", "已按舒服的价位筛选"],
  ["6 人全到，", "有人 21:20 需先走"],
  ["说了不来的人，", "群里直接不存在"],
];

type Layout = {
  W: number;
  H: number;
  inTitle: { x: number; y: number };
  inputs: Rect[];
  layers: Rect[];
  wall: Rect & { vertical: boolean };
  outTitle: { x: number; y: number };
  outputs: Rect[];
};

const H_LAYOUT: Layout = {
  W: 1400,
  H: 640,
  inTitle: { x: 20, y: 128 },
  inputs: [150, 250, 350].map((y) => ({ x: 20, y, w: 240, h: 70 })),
  layers: [
    { x: 300, y: 60, w: 236, h: 500 },
    { x: 580, y: 60, w: 260, h: 500 },
    { x: 960, y: 60, w: 236, h: 500 },
  ],
  wall: { x: 880, y: 24, w: 40, h: 612, vertical: true },
  outTitle: { x: 1228, y: 128 },
  outputs: [150, 260, 370].map((y) => ({ x: 1228, y, w: 166, h: 84 })),
};

const V_LAYOUT: Layout = {
  W: 450,
  H: 1630,
  inTitle: { x: 20, y: 30 },
  inputs: [46, 106, 166].map((y) => ({ x: 20, y, w: 380, h: 50 })),
  layers: [
    { x: 20, y: 262, w: 380, h: 290 },
    { x: 20, y: 610, w: 380, h: 300 },
    { x: 20, y: 1040, w: 380, h: 290 },
  ],
  wall: { x: 6, y: 952, w: 438, h: 44, vertical: false },
  outTitle: { x: 20, y: 1392 },
  outputs: [1408, 1478, 1548].map((y) => ({ x: 20, y, w: 380, h: 62 })),
};

const T = {
  ink: "fill-ink dark:fill-cream",
  soft: "fill-ink-soft dark:fill-cream-faint",
  card: "fill-card dark:fill-night-2",
  stroke: "stroke-ink dark:stroke-cream",
  line: "stroke-ink-soft dark:stroke-cream-faint",
};

function LayerBox({ r, l, compact }: { r: Rect; l: Layer; compact: boolean }) {
  const gap = compact ? 26 : 30;
  let y = r.y + 64;
  const lines: React.ReactNode[] = [];
  const push = (node: (yy: number) => React.ReactNode, step = gap) => {
    lines.push(node(y));
    y += step;
  };
  push(
    (yy) => (
      <text key="sub" x={r.x + 20} y={yy + 4} fontSize="16" className={T.soft}>
        {l.sub}
      </text>
    ),
    compact ? 34 : 50,
  );
  push(
    (yy) => (
      <text key="see-h" x={r.x + 20} y={yy} fontSize="15" fontWeight="800" className={T.soft} letterSpacing="2">
        能看到
      </text>
    ),
    26,
  );
  l.see.forEach((s, i) =>
    push((yy) => (
      <g key={`s${i}`}>
        <text x={r.x + 20} y={yy} fontSize="18" fontWeight="900" className="fill-jade dark:fill-[#3ecf8e]">
          ✓
        </text>
        <text x={r.x + 44} y={yy} fontSize="17" fontWeight="700" className={T.ink}>
          {s}
        </text>
      </g>
    )),
  );
  l.blind.forEach((s, i) =>
    push((yy) => (
      <g key={`b${i}`}>
        <text x={r.x + 20} y={yy} fontSize="18" fontWeight="900" className="fill-cinnabar">
          ✗
        </text>
        <text x={r.x + 44} y={yy} fontSize="17" fontWeight="700" className={T.soft}>
          {s}
        </text>
      </g>
    )),
  );
  const outY = r.y + r.h - 22 - (l.out.length - 1) * 24;
  return (
    <g>
      <rect x={r.x + 5} y={r.y + 5} width={r.w} height={r.h} rx="18" className="fill-ink dark:fill-black/60" />
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="18" strokeWidth="2.5" className={`${l.accent ? "fill-mustard-soft dark:fill-night-3" : T.card} ${T.stroke}`} />
      <circle cx={r.x + 30} cy={r.y + 30} r="15" className="fill-cinnabar" />
      <text x={r.x + 30} y={r.y + 36} textAnchor="middle" fontSize="17" fontWeight="900" fill="#fff" style={{ fontFamily: "var(--font-num)" }}>
        {l.n}
      </text>
      <text x={r.x + 54} y={r.y + 37} fontSize="22" fontWeight="900" className={T.ink}>
        {l.title}
      </text>
      {lines}
      <line x1={r.x + 16} x2={r.x + r.w - 16} y1={outY - 30} y2={outY - 30} strokeDasharray="5 6" strokeWidth="1.5" className={T.line} />
      {l.out.map((o, i) => (
        <text key={o} x={r.x + 20} y={outY + i * 24} fontSize="16" fontWeight={i === 0 ? 800 : 600} className={i === 0 ? T.ink : T.soft}>
          {i === 0 ? "→ " : "  "}
          {o}
        </text>
      ))}
    </g>
  );
}

function Arrow({ a, b, id, label, dashed, labelSide = -1 }: { a: [number, number]; b: [number, number]; id: string; label?: string; dashed?: boolean; labelSide?: number }) {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const horizontal = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
  return (
    <g>
      <line
        x1={a[0]}
        y1={a[1]}
        x2={b[0]}
        y2={b[1]}
        strokeWidth="3"
        strokeDasharray={dashed ? "7 6" : undefined}
        markerEnd={`url(#${id})`}
        className={`${T.stroke} ${dashed ? "" : "animate-flow"}`}
        style={dashed ? undefined : { strokeDasharray: "10 6" }}
      />
      {label && (
        <text
          x={horizontal ? mx : mx + 12}
          y={horizontal ? my + labelSide * 12 : my + 5}
          textAnchor={horizontal ? "middle" : "start"}
          fontSize="14"
          fontWeight="700"
          className={T.soft}
        >
          {label}
        </text>
      )}
    </g>
  );
}

function PathArrow({ d, id, label, lx, ly, rotate }: { d: string; id: string; label: string; lx: number; ly: number; rotate?: boolean }) {
  return (
    <g>
      <path d={d} fill="none" strokeWidth="3" markerEnd={`url(#${id})`} className={`${T.stroke} animate-flow`} style={{ strokeDasharray: "10 6" }} strokeLinejoin="round" />
      <text x={lx} y={ly} textAnchor="middle" fontSize="14" fontWeight="700" className={T.soft} transform={rotate ? `rotate(90 ${lx} ${ly})` : undefined}>
        {label}
      </text>
    </g>
  );
}

function Diagram({ L, compact }: { L: Layout; compact: boolean }) {
  const uid = useId().replace(/:/g, "");
  const mk = `arrow-${uid}`;
  const [l1, l2, l3] = L.layers;
  const w = L.wall;
  const cy = (r: Rect) => r.y + r.h / 2;
  const cx = (r: Rect) => r.x + r.w / 2;

  return (
    <svg viewBox={`0 0 ${L.W} ${L.H}`} className="block h-auto w-full" role="img" aria-label="隐私防火墙三层架构：私聊局长、确定性规划器、公开局长">
      <defs>
        <marker id={mk} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 Z" className="fill-ink dark:fill-cream" />
        </marker>
        <pattern id={`hatch-${uid}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="14" height="14" className="fill-cinnabar" />
          <rect width="6" height="14" className="fill-cinnabar-deep" />
        </pattern>
      </defs>

      {/* 输入：成员私下说的话 */}
      <text x={L.inTitle.x} y={L.inTitle.y} fontSize="17" fontWeight="900" className={T.soft} letterSpacing="2">
        成员私下说的
      </text>
      {L.inputs.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={r.h / 2} strokeWidth="2" className={`fill-cinnabar-soft dark:fill-night-3 ${T.stroke}`} />
          <text x={r.x + 20} y={r.y + r.h / 2 + 8} fontSize="22">
            {INPUTS[i][0]}
          </text>
          <text x={r.x + 56} y={r.y + r.h / 2 + 6} fontSize="17" fontWeight="700" className={T.ink}>
            {INPUTS[i][1]}
          </text>
        </g>
      ))}

      {/* 箭头 */}
      {w.vertical ? (
        <>
          {L.inputs.map((r, i) => (
            <Arrow key={i} id={mk} a={[r.x + r.w + 4, r.y + r.h / 2]} b={[l1.x - 6, cy(l1) - 60 + i * 60]} />
          ))}
          <Arrow id={mk} a={[l1.x + l1.w + 4, cy(l1)]} b={[l2.x - 6, cy(l2)]} />
          <Arrow id={mk} a={[l2.x + l2.w + 4, cy(l2) - 40]} b={[l3.x - 6, cy(l3) - 40]} />
          <PathArrow
            id={mk}
            d={`M${cx(l2)} ${l2.y + l2.h + 4} V${L.H - 16} H${L.outputs[2].x + L.outputs[2].w / 2} V${L.outputs[2].y + L.outputs[2].h + 8}`}
            label="公开数字：只由通勤、时段算出，直接上大屏"
            lx={(w.x + w.w + L.outputs[2].x + L.outputs[2].w / 2) / 2}
            ly={L.H - 24}
          />
          {L.outputs.map((r, i) => (
            <Arrow key={i} id={mk} a={[l3.x + l3.w + 4, cy(l3) - 80 + i * 80]} b={[r.x - 6, r.y + r.h / 2]} />
          ))}
        </>
      ) : (
        <>
          <Arrow id={mk} a={[cx(l1), L.inputs[2].y + L.inputs[2].h + 4]} b={[cx(l1), l1.y - 6]} />
          <Arrow id={mk} a={[cx(l1), l1.y + l1.h + 4]} b={[cx(l2), l2.y - 6]} label="约束→数字" />
          <Arrow id={mk} a={[l2.x + 50, l2.y + l2.h + 4]} b={[l3.x + 50, l3.y - 6]} label="只有聚合结论" />
          <PathArrow
            id={mk}
            d={`M${l2.x + l2.w + 4} ${l2.y + l2.h - 60} H${L.W - 22} V${L.outputs[0].y - 18} H${cx(L.outputs[0]) + 120} V${L.outputs[0].y - 6}`}
            label="公开数字：只由通勤、时段算出"
            lx={L.W - 8}
            ly={(l2.y + l2.h + L.outputs[0].y) / 2 + 40}
            rotate
          />
          <Arrow id={mk} a={[cx(l3), l3.y + l3.h + 4]} b={[cx(l3), L.outputs[0].y - 6]} />
        </>
      )}

      {/* 防火墙 */}
      <g>
        <rect x={w.x} y={w.y} width={w.w} height={w.h} rx="6" fill={`url(#hatch-${uid})`} className="stroke-ink dark:stroke-cream" strokeWidth="2.5" />
        {w.vertical ? (
          <g transform={`translate(${w.x + w.w / 2} ${w.y + w.h / 2}) rotate(-90)`}>
            <rect x="-170" y="-14" width="340" height="28" rx="6" className="fill-ink dark:fill-night" />
            <text textAnchor="middle" y="6" fontSize="16" fontWeight="900" fill="#fff" letterSpacing="1">
              防火墙 · publicFacts() · 类型上拿不到私密字段
            </text>
          </g>
        ) : (
          <g transform={`translate(${w.x + w.w / 2} ${w.y + w.h / 2})`}>
            <rect x="-120" y="-14" width="240" height="28" rx="6" className="fill-ink dark:fill-night" />
            <text textAnchor="middle" y="6" fontSize="15" fontWeight="900" fill="#fff">
              防火墙 · publicFacts()
            </text>
          </g>
        )}
      </g>

      {L.layers.map((r, i) => (
        <LayerBox key={i} r={r} l={LAYERS[i]} compact={compact} />
      ))}

      {/* 输出：群里 / 大屏看到的 */}
      <text x={L.outTitle.x} y={L.outTitle.y} fontSize="17" fontWeight="900" className={T.soft} letterSpacing="2">
        群里看到的
      </text>
      {L.outputs.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="14" strokeWidth="2" className={`fill-mustard-soft dark:fill-night-3 ${T.stroke}`} />
          {OUTPUTS[i].map((t, j) => (
            <text key={j} x={r.x + 14} y={r.y + (compact ? 26 : 34) + j * 24} fontSize="16" fontWeight={j === 0 ? 800 : 600} className={j === 0 ? T.ink : T.soft}>
              {t}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

export function FirewallDiagram() {
  return (
    <>
      <div className="hidden md:block">
        <Diagram L={H_LAYOUT} compact={false} />
      </div>
      <div className="mx-auto max-w-[420px] md:hidden">
        <Diagram L={V_LAYOUT} compact />
      </div>
    </>
  );
}

/** 每层能看到什么 —— 一张表说清楚 */
export const VISIBILITY: { what: string; cells: [boolean, boolean, boolean, boolean] }[] = [
  { what: "私下说的预算数字", cells: [true, true, false, false] },
  { what: "几点前得回（门禁）", cells: [true, true, false, false] },
  { what: "忌口、私密备注", cells: [true, true, false, false] },
  { what: "谁说了不来", cells: [true, true, false, false] },
  { what: "单方面的\"想认识\"", cells: [true, true, false, false] },
  { what: "我觉得和谁熟不熟、今天的电量", cells: [true, true, false, false] },
  { what: "悄悄不想和谁一桌", cells: [true, true, false, false] },
  { what: "座位表、\"新认识了几对\"", cells: [true, true, true, true] },
  { what: "出发地、通勤时间", cells: [true, true, true, true] },
  { what: "聚合结论（\"有人预算偏紧\"）", cells: [false, true, true, true] },
];
export const VIS_COLS = ["私聊局长", "规划器", "公开局长", "群 / 大屏"];

"use client";

import { useId } from "react";

/** 五角星路径 */
function starPath(cx: number, cy: number, r: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

/**
 * 朱砂圆形公章 ——「成局」
 * 用 SVG 滤镜做出印泥不均匀、边缘毛糙的墨迹感。
 */
export function Stamp({
  size = 160,
  text = "成局",
  ring = "AI 局长 · 组局专用章",
  sub,
  color = "var(--color-cinnabar)",
  className = "",
}: {
  size?: number;
  text?: string;
  ring?: string;
  sub?: string;
  color?: string;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const fid = `ink-${uid}`;
  const pid = `arc-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="-100 -100 200 200"
      className={className}
      role="img"
      aria-label={`印章：${text}`}
    >
      <defs>
        <filter id={fid} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="7" result="warp" />
          <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="3" result="grain" />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 2.25"
            result="mask"
          />
          <feComposite in="rough" in2="mask" operator="in" />
        </filter>
        <path id={pid} d="M -64,6 A 64,64 0 1 1 64,6" />
      </defs>
      <g filter={`url(#${fid})`} fill={color} stroke={color}>
        <circle r="91" fill="none" strokeWidth="8" />
        <circle r="81" fill="none" strokeWidth="1.6" />
        <text
          fontSize="17"
          fontWeight="800"
          stroke="none"
          letterSpacing="3"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          <textPath href={`#${pid}`} startOffset="50%" textAnchor="middle">
            {ring}
          </textPath>
        </text>
        <path d={starPath(0, -26, 17)} stroke="none" />
        <text
          y="34"
          textAnchor="middle"
          fontSize={text.length > 2 ? 38 : 52}
          fontWeight="900"
          stroke="none"
          letterSpacing="2"
          style={{ fontFamily: "var(--font-sans)" }}
        >
          {text}
        </text>
        {sub && (
          <text
            y="66"
            textAnchor="middle"
            fontSize="12.5"
            fontWeight="700"
            stroke="none"
            letterSpacing="1.5"
            style={{ fontFamily: "var(--font-num)" }}
          >
            {sub}
          </text>
        )}
      </g>
    </svg>
  );
}

/** 墨点飞溅（印章砸下时出现） */
function InkSplats({ size, color }: { size: number; color: string }) {
  const dots = [
    [-0.58, -0.32, 0.05],
    [0.62, -0.18, 0.035],
    [0.55, 0.48, 0.055],
    [-0.5, 0.55, 0.03],
    [0.05, -0.66, 0.025],
    [-0.7, 0.12, 0.022],
    [0.72, 0.15, 0.02],
  ];
  return (
    <svg
      aria-hidden
      width={size * 1.6}
      height={size * 1.6}
      viewBox="-1 -1 2 2"
      className="animate-ink-splat pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ marginLeft: 0 }}
    >
      {dots.map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={color} opacity={0.85} />
      ))}
    </svg>
  );
}

/** 从大到小砸下来 + 落地抖动 + 墨点 */
export function StampSlam({
  size = 160,
  text,
  sub,
  play = true,
  color = "var(--color-cinnabar)",
  onDark,
  className = "",
}: {
  size?: number;
  text?: string;
  sub?: string;
  play?: boolean;
  color?: string;
  /** 深色背景：不用正片叠底，改成发光 */
  onDark?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${play ? "animate-impact-shake" : ""} ${className}`} style={{ width: size, height: size }}>
      {play && (
        <div className="absolute inset-0" aria-hidden>
          <InkSplats size={size} color={color} />
        </div>
      )}
      <div
        className={play ? "animate-stamp-slam" : ""}
        style={{
          transform: play ? undefined : "rotate(-12deg)",
          mixBlendMode: onDark ? undefined : "multiply",
          filter: onDark ? "drop-shadow(0 0 22px rgb(99 80 162 / .55))" : undefined,
        }}
      >
        <Stamp size={size} text={text} sub={sub} color={color} />
      </div>
    </div>
  );
}

import type { LatLng } from "../types";
import { getDemoCenter } from "../map/geo";

const M_PER_DEG = 111_320;

type XY = { x: number; y: number };
type Circle = { c: XY; r: number };

const EPS = 1e-6; // 米

function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function inside(c: Circle | undefined, p: XY): boolean {
  return !!c && dist(c.c, p) <= c.r + EPS;
}
function fromTwo(a: XY, b: XY): Circle {
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { c, r: dist(a, b) / 2 };
}
function fromThree(a: XY, b: XY, c: XY): Circle {
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const d = 2 * (bx * cy - by * cx);
  if (Math.abs(d) < 1e-9) {
    // 共线：取最远两点为直径
    const cands = [fromTwo(a, b), fromTwo(a, c), fromTwo(b, c)];
    return cands.reduce((m, x) => (x.r > m.r ? x : m));
  }
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const ux = (cy * b2 - by * c2) / d;
  const uy = (bx * c2 - cx * b2) / d;
  const center = { x: a.x + ux, y: a.y + uy };
  return { c: center, r: Math.hypot(ux, uy) };
}

/** 最小包围圆（Welzl 增量迭代版，固定顺序，确定性，精确解） */
export function minEnclosingCircle(pts: XY[]): Circle {
  let circle: Circle | undefined;
  for (let i = 0; i < pts.length; i++) {
    if (inside(circle, pts[i])) continue;
    circle = { c: { ...pts[i] }, r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(circle, pts[j])) continue;
      circle = fromTwo(pts[i], pts[j]);
      for (let k = 0; k < j; k++) {
        if (inside(circle, pts[k])) continue;
        circle = fromThree(pts[i], pts[j], pts[k]);
      }
    }
  }
  return circle ?? { c: { x: 0, y: 0 }, r: 0 };
}

/**
 * 公平中心（minimax）：让离中心最远的人尽量近 = 最小包围圆的圆心。
 * 先以平均纬度做等距投影换成米，再求精确最小包围圆，最后投影回经纬度。
 */
export function fairCenter(points: LatLng[]): LatLng {
  const pts = points.filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
  if (pts.length === 0) return getDemoCenter();
  if (pts.length === 1) return { lat: pts[0].lat, lng: pts[0].lng };

  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  const kx = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const xy = pts.map((p) => ({ x: (p.lng - lng0) * kx, y: (p.lat - lat0) * M_PER_DEG }));
  const { c } = minEnclosingCircle(xy);
  return {
    lat: Math.round((lat0 + c.y / M_PER_DEG) * 1e6) / 1e6,
    lng: Math.round((lng0 + c.x / kx) * 1e6) / 1e6,
  };
}

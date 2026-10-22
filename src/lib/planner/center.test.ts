import { afterEach, describe, expect, it } from "vitest";
import { fairCenter } from "./index";
import { haversineKm } from "../map";

const maxDist = (c: { lat: number; lng: number }, pts: { lat: number; lng: number }[]) =>
  Math.max(...pts.map((p) => haversineKm(c, p)));

describe("fairCenter", () => {
  afterEach(() => {
    delete process.env.DEMO_CENTER;
  });

  it("0 个点返回 DEMO_CENTER，1 个点返回自身", () => {
    expect(fairCenter([])).toEqual({ lat: 31.27, lng: 120.735 });
    process.env.DEMO_CENTER = "31.3,120.6";
    expect(fairCenter([])).toEqual({ lat: 31.3, lng: 120.6 });
    expect(fairCenter([{ lat: 31.2, lng: 120.7 }])).toEqual({ lat: 31.2, lng: 120.7 });
  });

  it("两点取中点", () => {
    const a = { lat: 31.25, lng: 120.7 };
    const b = { lat: 31.31, lng: 120.76 };
    const c = fairCenter([a, b]);
    expect(Math.abs(haversineKm(c, a) - haversineKm(c, b)) * 1000).toBeLessThan(50);
    expect(haversineKm(c, { lat: 31.28, lng: 120.73 }) * 1000).toBeLessThan(50);
  });

  it("锐角三角形取外心（到三点等距）", () => {
    const pts = [
      { lat: 31.25, lng: 120.7 },
      { lat: 31.25, lng: 120.76 },
      { lat: 31.3, lng: 120.73 },
    ];
    const c = fairCenter(pts);
    const ds = pts.map((p) => haversineKm(c, p) * 1000);
    expect(Math.max(...ds) - Math.min(...ds)).toBeLessThan(50);
  });

  it("钝角三角形取最长边中点，且比质心更公平", () => {
    const a = { lat: 31.25, lng: 120.7 };
    const b = { lat: 31.25, lng: 120.8 };
    const c = { lat: 31.255, lng: 120.75 };
    const center = fairCenter([a, b, c]);
    expect(haversineKm(center, { lat: 31.25, lng: 120.75 }) * 1000).toBeLessThan(50);
    const centroid = { lat: (a.lat + b.lat + c.lat) / 3, lng: (a.lng + b.lng + c.lng) / 3 };
    expect(maxDist(center, [a, b, c])).toBeLessThanOrEqual(maxDist(centroid, [a, b, c]));
  });

  it("一群人里有一个离得远：最远距离不超过任意网格点", () => {
    const pts = [
      { lat: 31.27, lng: 120.73 },
      { lat: 31.275, lng: 120.74 },
      { lat: 31.268, lng: 120.745 },
      { lat: 31.32, lng: 120.62 },
      { lat: 31.3, lng: 120.7 },
    ];
    const c = fairCenter(pts);
    const best = maxDist(c, pts);
    for (let i = -20; i <= 20; i++) {
      for (let j = -20; j <= 20; j++) {
        const g = { lat: c.lat + i * 0.0005, lng: c.lng + j * 0.0005 };
        expect(best).toBeLessThanOrEqual(maxDist(g, pts) + 0.05);
      }
    }
  });
});

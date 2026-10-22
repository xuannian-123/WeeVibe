// /api/dev/seed：Demo 兜底，一键加入 5–6 个演示成员
import { nanoid } from "nanoid";
import * as db from "../db";
import { ruleParseDiet } from "../llm";
import { getDemoCenter, getMapProvider, haversineKm } from "../map";
import type { JuState, LatLng, Member, Place } from "../types";
import { HttpError } from "./http";
import { _autoReplan, _inOnly, _pickAvatar, defaultCity, loadJu, withJuLock } from "./ju";

const DEMO_PEOPLE: { name: string; dietRaw: string; budgetMax?: number }[] = [
  { name: "小林", dietRaw: "" },
  { name: "阿杰", dietRaw: "" },
  { name: "Momo", dietRaw: "", budgetMax: 150 },
  { name: "大鹏", dietRaw: "" },
  { name: "橙子", dietRaw: "不能吃辣" },
  { name: "老王", dietRaw: "回民，不吃猪肉" },
  { name: "小鱼", dietRaw: "" },
  { name: "阿May", dietRaw: "海鲜过敏" },
];

function offsetKm(p: LatLng, km: number, bearingRad: number): LatLng {
  const north = km * Math.cos(bearingRad);
  const east = km * Math.sin(bearingRad);
  return {
    lat: +(p.lat + north / 111.32).toFixed(6),
    lng: +(p.lng + east / (111.32 * Math.cos((p.lat * Math.PI) / 180))).toFixed(6),
  };
}

const jitter = (p: LatLng): LatLng => offsetKm(p, 0.1 + Math.random() * 0.25, Math.random() * Math.PI * 2);

async function seedLocations(city: string, n: number): Promise<Place[]> {
  const map = getMapProvider();
  let landmarks: Place[] = [];
  try {
    landmarks = await map.searchPlaces("", city);
  } catch (e) {
    console.warn(`[seed] searchPlaces 失败：${(e as Error).message}`);
  }
  const center =
    city === defaultCity() || landmarks.length === 0
      ? getDemoCenter()
      : {
          lat: landmarks.reduce((s, p) => s + p.lat, 0) / landmarks.length,
          lng: landmarks.reduce((s, p) => s + p.lng, 0) / landmarks.length,
        };
  const usable = landmarks.filter((p) => {
    const d = haversineKm(center, p);
    return d >= 3 && d <= 9;
  });
  const used = new Set<string>();
  const base = Math.random() * Math.PI * 2;
  const out: Place[] = [];
  for (let i = 0; i < n; i++) {
    const bearing = base + (i * 2 * Math.PI) / n + (Math.random() - 0.5) * 0.5;
    const target = offsetKm(center, 4 + Math.random() * 4, bearing);
    const lm = usable
      .filter((p) => !used.has(p.label) && haversineKm(p, target) <= 2.5)
      .sort((a, b) => haversineKm(a, target) - haversineKm(b, target))[0];
    if (lm) {
      used.add(lm.label);
      out.push({ ...jitter(lm), label: lm.label });
      continue;
    }
    let label = "";
    try {
      label = await map.reverseGeocode(target);
    } catch {
      /* 用默认 label */
    }
    out.push({ ...target, label: label ? `${label}附近` : `${city}·${i + 1}号点` });
  }
  return out;
}

export function seedJu(id: string, count = 6): Promise<JuState> {
  return withJuLock(id, async () => {
    const ju = loadJu(id);
    if (ju.status === "confirmed" || ju.status === "cancelled") throw new HttpError(409, "局已经定了，不能再加人");
    const members = db.listMembers(id);
    const taken = new Set(members.map((m) => m.name));
    const people = DEMO_PEOPLE.filter((p) => !taken.has(p.name)).slice(0, count);
    while (people.length < count) {
      const p = DEMO_PEOPLE[people.length % DEMO_PEOPLE.length];
      people.push({ ...p, name: `${p.name}${people.length + 1}` });
    }

    // 热门时间：已有成员勾得最多的 slot；没人勾就取第一天的第二档
    const slots = ju.slots;
    const votes = new Map<string, number>();
    for (const m of _inOnly(members)) for (const s of m.availableSlotIds) votes.set(s, (votes.get(s) ?? 0) + 1);
    const hotId =
      [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? slots[Math.min(1, slots.length - 1)]?.id;
    const hotIdx = Math.max(0, slots.findIndex((s) => s.id === hotId));

    const places = await seedLocations(ju.spec.city, people.length);
    const all = [...members];
    const now = Date.now();
    people.forEach((p, i) => {
      let avail: string[];
      const isOddOneOut = people.length >= 4 && i === people.length - 1 && slots.length > 1;
      if (isOddOneOut) {
        // 1 个人只有别的时间有空，演示“这个时间来不了”的情况
        avail = [slots[(hotIdx + 2) % slots.length].id];
        if (avail[0] === hotId) avail = [slots[(hotIdx + 1) % slots.length].id];
      } else {
        avail = [hotId];
        const nb = slots[hotIdx + (i % 2 === 0 ? 1 : -1)];
        if (nb && i % 3 !== 2) avail.push(nb.id);
      }
      const m: Member = {
        id: nanoid(10),
        juId: id,
        name: p.name,
        avatar: _pickAvatar(all),
        location: places[i],
        availableSlotIds: avail.filter(Boolean),
        dietRaw: p.dietRaw,
        dietTags: ruleParseDiet(p.dietRaw),
        ...(p.budgetMax ? { budgetMax: p.budgetMax } : {}),
        status: "in",
        joinedAt: new Date(now + i).toISOString(),
        isOrganizer: false,
        isDemo: true,
      };
      all.push(m);
      db.upsertMember(m);
    });

    if (ju.status === "voting") {
      await _autoReplan(ju);
      db.saveJu(ju);
    }
    return { ju, members: db.listMembers(id) };
  });
}

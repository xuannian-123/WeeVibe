import type { JuSpec, Slot } from "../types";

export const MAX_SLOTS = 12;

const pad = (n: number) => String(n).padStart(2, "0");

function parseHm(s: string | undefined, fallback: number): number {
  const m = /^(\d{1,2})[:：](\d{2})$/.exec((s ?? "").trim());
  if (!m) return fallback;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return fallback;
  return h * 60 + mi;
}

function parseDate(s: string): { y: number; m: number; d: number } | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return undefined;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * 北京时间的"墙上时间"用 UTC 字段来表示做加减，完全不依赖机器时区。
 * 返回 "YYYY-MM-DDTHH:mm"。
 */
function wallClock(y: number, mo: number, d: number, minutes: number): string {
  const t = new Date(Date.UTC(y, mo - 1, d, 0, minutes));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

function makeSlot(y: number, mo: number, d: number, startMin: number, duration: number): Slot {
  const id = wallClock(y, mo, d, startMin);
  return {
    id,
    start: `${id}:00+08:00`,
    end: `${wallClock(y, mo, d, startMin + duration)}:00+08:00`,
  };
}

/**
 * 每个日期从 earliest 到 latest（含）每 30 分钟一个开始时间；
 * 总数 > 12 改为 60 分钟一档；仍 > 12 截断到 12 个。
 * latest 早于 earliest 视为跨午夜（如 22:00–01:00）。
 */
export function generateSlots(spec: JuSpec): Slot[] {
  const earliest = parseHm(spec.earliest, 18 * 60);
  let latest = parseHm(spec.latest, earliest);
  if (latest < earliest) latest += 24 * 60;
  const duration = Number.isFinite(spec.durationMinutes) && spec.durationMinutes > 0 ? spec.durationMinutes : 120;
  const dates = [...new Set(spec.dates ?? [])].map(parseDate).filter((x): x is NonNullable<typeof x> => !!x);

  const build = (step: number) => {
    const out: Slot[] = [];
    for (const { y, m, d } of dates) {
      for (let t = earliest; t <= latest; t += step) out.push(makeSlot(y, m, d, t, duration));
    }
    return out;
  };

  let slots = build(30);
  if (slots.length > MAX_SLOTS) slots = build(60);
  return slots.slice(0, MAX_SLOTS);
}

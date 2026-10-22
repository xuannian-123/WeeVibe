// Asia/Shanghai 日历工具（中国无夏令时，固定 +08:00）

const SH_OFFSET_MS = 8 * 3600 * 1000;

export type ShNow = {
  ymd: string; // YYYY-MM-DD
  /** ISO 周几：1=周一 … 7=周日 */
  isoDow: number;
  hour: number;
  minute: number;
};

export function shanghaiNow(now: Date): ShNow {
  const d = new Date(now.getTime() + SH_OFFSET_MS);
  const dow = d.getUTCDay();
  return {
    ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    isoDow: dow === 0 ? 7 : dow,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function isoDowOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

export function isValidYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(min: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

const CN_DOW = ["", "一", "二", "三", "四", "五", "六", "日"];
export function dowLabel(isoDow: number): string {
  return `周${CN_DOW[isoDow]}`;
}

/** 把 slot 的 ISO 时间（带 +08:00）转成“周五 19:00”这种 */
export function slotLabel(iso: string): string {
  const d = new Date(iso);
  const sh = shanghaiNow(d);
  return `${dowLabel(sh.isoDow)} ${pad(sh.hour)}:${pad(sh.minute)}`;
}

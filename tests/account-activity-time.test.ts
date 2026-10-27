import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatActivityTime } from '../apps/miniprogram/src/features/shell/activity-time';
const originalTZ = process.env.TZ;
afterEach(() => { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; vi.restoreAllMocks(); });
describe('activity card timezone fidelity, including native-format fallback', () => {
  it('formats Shanghai activity in Shanghai even on a New York device', () => {
    process.env.TZ = 'America/New_York';
    const value = formatActivityTime('2030-01-02T00:00:00Z', 'Asia/Shanghai');
    expect(value).toContain('2030/01/02'); expect(value).toContain('08:00'); expect(value).toContain('Asia/Shanghai'); expect(value).not.toContain('19:00');
  });
  it('keeps UTC and an overseas activity zone distinct, rather than hardcoding China', () => {
    process.env.TZ = 'Asia/Shanghai';
    expect(formatActivityTime('2030-01-02T00:00:00Z', 'UTC')).toMatch(/2030\/01\/02.*00:00.*UTC/);
    expect(formatActivityTime('2030-01-02T00:00:00Z', 'America/New_York')).toMatch(/2030\/01\/01.*19:00.*America\/New_York/);
  });
  it('uses explicit ISO UTC fallback when the runtime lacks IANA formatter support', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { throw new RangeError('unsupported timezone'); });
    expect(formatActivityTime('2030-01-02T00:00:00Z', 'Asia/Shanghai')).toBe('2030-01-02 00:00 · UTC（无法确认活动时区显示，已回退 UTC）');
  });
  it('falls back when a lightweight runtime silently ignores the requested timeZone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { return { resolvedOptions: () => ({ timeZone: 'America/New_York' }), format: () => '2030/01/01 19:00' } as Intl.DateTimeFormat; });
    const value = formatActivityTime('2030-01-02T00:00:00Z', 'Asia/Shanghai');
    expect(value).toContain('2030-01-02 00:00 · UTC'); expect(value).not.toContain('19:00'); expect(value).not.toContain('Asia/Shanghai');
  });
  it('falls back safely for an unsupported zone and never labels device-local time as that zone', () => {
    const value = formatActivityTime('2030-01-02T00:00:00Z', 'Unsupported/Zone');
    expect(value).toContain('2030-01-02 00:00 · UTC'); expect(value).not.toContain('Unsupported/Zone');
  });
  it('does not invent a date for missing or invalid values', () => {
    expect(formatActivityTime(null, 'Asia/Shanghai')).toBe('时间待定');
    expect(formatActivityTime('invalid', 'Asia/Shanghai')).toBe('时间格式暂不可用');
  });
});

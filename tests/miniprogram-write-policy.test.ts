import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../packages/api-client/src';
import { uncertain } from '../apps/miniprogram/src/platform/write-policy';
import { buildCreateInput, type ActivityForm } from '../apps/miniprogram/src/platform/activity-form';

describe('pending write preservation after a lost response', () => {
  it.each([401, 403, 429])('keeps the original key when HTTP %s can precede idempotency lookup', status => {
    expect(uncertain(new ApiClientError('UNAUTHENTICATED', 'local fixture', status))).toBe(true);
  });
  it('keeps uncertain transport/server results but releases definitive business rejections', () => {
    for (const error of [new Error('lost response'), new ApiClientError('NETWORK_ERROR', '', 0), new ApiClientError('DATABASE_UNAVAILABLE', '', 503)]) expect(uncertain(error)).toBe(true);
    for (const code of ['VERSION_CONFLICT', 'CAPACITY_FULL', 'ARRANGEMENT_STALE']) expect(uncertain(new ApiClientError(code, '', 409))).toBe(false);
  });
});

function form(count: number): ActivityForm {
  return { name: '离线请求大小验证', nickname: '', mainRef: 'segment_0', attending: [], segments: Array.from({ length: count }, (_, i) => ({
    ref: `segment_${i}`, type: 'custom', name: `环节${i}`, startDate: '2026-10-30', startTime: '14:00', endDate: '2026-10-30', endTime: '15:00', deadlineDate: '2026-10-30', deadlineTime: '12:00',
    place: '虚构测试地点', address: '测试地址'.repeat(100), amount: '', feeUnit: 'unknown', feeNote: '', requirements: '测试要求'.repeat(250), minimum: '2', capacity: '6',
  })) };
}
describe('shared business byte limit in mini-program forms', () => {
  it('validates the supported Shanghai form even when Intl is unavailable', () => {
    vi.stubGlobal('Intl', undefined);
    try { expect(buildCreateInput(form(1), 'offline-test-key').timezone).toBe('Asia/Shanghai'); }
    finally { vi.unstubAllGlobals(); }
  });
  it('allows a valid multi-segment payload larger than the old 4 KiB bound', () => {
    const input = buildCreateInput(form(3), 'offline-test-key');
    expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(4096);
    expect(input.segments).toHaveLength(3);
  });
  it('rejects oversized input without truncating fields or dropping segments', () => {
    expect(() => buildCreateInput(form(30), 'offline-test-key')).toThrow('64KiB');
  });
});

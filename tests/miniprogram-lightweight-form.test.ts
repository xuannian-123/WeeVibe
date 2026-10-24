import { describe, expect, it } from 'vitest';
import { buildCreateInput, emptyForm, emptySegment } from '../apps/miniprogram/src/platform/activity-form';

function minimalForm() {
  const value = emptyForm();
  value.name = '朋友见面';
  Object.assign(value.segments[0], {
    startDate: '2026-10-30', startTime: '16:00', endTime: '18:00',
    place: '朋友约定的集合点', minimum: '2', capacity: '6'
  });
  return value;
}

describe('lightweight creation keeps an explicit complete server arrangement', () => {
  it('uses the activity name for one unnamed segment and displays same-day/start-time defaults', () => {
    const value = minimalForm();
    const input = buildCreateInput(value, 'lightweight-fixture-1');
    expect(input.segments[0]).toMatchObject({ name: value.name, starts_at: '2026-10-30T16:00:00+08:00', ends_at: '2026-10-30T18:00:00+08:00', deadline_at: '2026-10-30T16:00:00+08:00',
      fee: { kind: 'unknown', amount_cents: null }, requirements: '' });
    expect(input.participating_segment_refs).toEqual([]);
    expect(value.segments[0].endDate).toBe('');
    expect(value.segments[0].deadlineTime).toBe('');
  });
  it('keeps explicit cross-day endings, early deadlines and known fees', () => {
    const value = minimalForm();
    Object.assign(value.segments[0], { endDate: '2026-10-31', endTime: '01:00', deadlineDate: '2026-10-29', deadlineTime: '20:00', feeUnit: 'per_person', amount: '50.5' });
    const segment = buildCreateInput(value, 'lightweight-fixture-2').segments[0];
    expect(segment.ends_at).toBe('2026-10-31T01:00:00+08:00');
    expect(segment.deadline_at).toBe('2026-10-29T20:00:00+08:00');
    expect(segment.fee.amount_cents).toBe(5050);
  });
  it('keeps missing or contradictory decisions invalid rather than inventing them', () => {
    const value = minimalForm();
    value.segments[0].minimum = '';
    expect(() => buildCreateInput(value, 'lightweight-fixture-3')).toThrow('正整数');
    value.segments[0].minimum = '2';
    value.segments[0].deadlineDate = '2026-10-29';
    expect(() => buildCreateInput(value, 'lightweight-fixture-3')).toThrow('完整填写');
    value.segments[0].deadlineDate = '';
    value.segments[0].endTime = '14:00';
    expect(() => buildCreateInput(value, 'lightweight-fixture-3')).toThrow('结束必须晚于开始');
  });
  it('requires separate names for multiple segments, retaining main and attendance choices', () => {
    const value = minimalForm();
    const second = { ...emptySegment(), startDate: '2026-10-30', startTime: '18:00', endTime: '19:00', place: '晚餐集合点', minimum: '2', capacity: '6' };
    value.segments.push(second);
    expect(() => buildCreateInput(value, 'lightweight-fixture-4')).toThrow();
    value.segments[0].name = '打球'; second.name = '吃饭';
    value.mainRef = second.ref; value.attending = [second.ref];
    const input = buildCreateInput(value, 'lightweight-fixture-4');
    expect(input.segments.map(s => s.name)).toEqual(['打球', '吃饭']);
    expect(input.main_segment_ref).toBe(second.ref);
    expect(input.participating_segment_refs).toEqual([second.ref]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildCreateInput, createTimingIssue, emptyForm } from '../apps/miniprogram/src/features/activity-create/form';

function input() {
  const form = emptyForm(); form.name = '打球';
  Object.assign(form.segments[0], { startDate: '2026-10-26', startTime: '19:00', endTime: '20:00', place: '测试集合点', minimum: '2', capacity: '3' });
  form.attending = [form.segments[0].ref];
  return buildCreateInput(form, 'time-fixture');
}
describe('new creation timing checks', () => {
  it('identifies the selected segment at its start boundary, including a preview that aged', () => {
    const value = input(), start = Date.parse(value.segments[0].starts_at);
    expect(createTimingIssue(value, start - 1)).toBeUndefined();
    expect(createTimingIssue(value, start)).toContain('“打球”的开始时间已过');
  });
  it('checks a custom deadline independently of the start time', () => {
    const value = input(); value.segments[0].deadline_at = '2026-10-26T18:00:00+08:00';
    expect(createTimingIssue(value, Date.parse(value.segments[0].deadline_at))).toContain('报名截止时间已过');
  });
  it('does not add an attendance restriction to organization-only creation', () => {
    const value = input(); value.participating_segment_refs = [];
    expect(createTimingIssue(value, Date.parse(value.segments[0].ends_at))).toBeUndefined();
  });
});

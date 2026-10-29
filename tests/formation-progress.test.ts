import { describe, expect, it } from 'vitest';
import { applicationDetail } from './application-fixtures';
import { formationProgress } from '../apps/miniprogram/src/features/formation/progress';

function detail() {
  const value = applicationDetail();
  Object.assign(value.segments[0], { minimum_participants: 4, capacity: 6, verification_status: 'manual_checked', has_started: false, is_join_open: true,
    counts: { occupied_count: 4, accepted_count: 4, pending_acceptance_count: 0, remaining_capacity: 2, meets_minimum: true, is_full: false } });
  return value;
}
describe('WG04 formation progress from current server snapshot', () => {
  it('shows the actual deficit after exit and explains that replacement can join only the main segment', () => {
    const value = detail(); value.segments[0].counts.occupied_count = 3;
    const progress = formationProgress(value);
    expect(progress.label).toBe('主环节待补位'); expect(progress.guidance).toContain('还差 1 人');
    expect(progress.guidance).toContain('只申请这一段'); expect(progress.guidance).toContain('原成员不用重报');
  });
  it('requires explicit manager confirmation once replacement fills the minimum, without requiring full capacity', () => {
    expect(formationProgress(detail()).label).toBe('主环节待确认成局');
    expect(formationProgress(detail()).guidance).toContain('不因补齐人数自动成局');
  });
  it('distinguishes retained seats awaiting acceptance from seats available for replacement', () => {
    const value = detail(); value.segments[0].counts.pending_acceptance_count = 1;
    const progress = formationProgress(value);
    expect(progress.label).toBe('主环节待重新接受'); expect(progress.guidance).toContain('不释放席位');
  });
  it('explains closed-deadline recovery without suggesting reopening a started main segment', () => {
    const value = detail(); value.segments[0].counts.occupied_count = 2; value.segments[0].is_join_open = false;
    expect(formationProgress(value).guidance).toContain('开始前明确延期');
    value.server_time = value.segments[0].starts_at;
    expect(formationProgress(value).guidance).toContain('停止线上补位');
    expect(formationProgress(value).guidance).not.toContain('延期');
  });
  it('does not turn an unverified or unconfirmed started main segment into a formed event', () => {
    const value = detail(); value.segments[0].verification_status = 'unknown';
    expect(formationProgress(value).label).toBe('主环节待核实');
    value.server_time = value.segments[0].starts_at;
    expect(formationProgress(value).guidance).toContain('后续未开始且仍开放的环节仍可单独申请');
  });
  it('keeps an actually confirmed main and cancelled history distinct', () => {
    const value = detail(); value.formation_status = 'confirmed';
    expect(formationProgress(value).label).toBe('主环节已成局');
    value.cancelled_at = value.server_time;
    expect(formationProgress(value).label).toBe('已取消');
    expect(formationProgress(value).guidance).toContain('不开放补位');
  });
});

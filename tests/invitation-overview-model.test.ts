import { describe, expect, it } from 'vitest';
import { applicationDetail, applicationId, applicationSegment, applicantA } from './application-fixtures';
import { overviewModel } from '../apps/miniprogram/src/features/activity-entry/overview-model';

describe('overview role and current arrangement state', () => {
  it('invites a guest to log in and select segments without granting seats', () => {
    const d = applicationDetail(); d.viewer.user_id = null; d.viewer.is_manager = false;
    expect(overviewModel(d).primary).toEqual({ section: 'apply', label: '登录并选择参加环节' });
    expect(d.viewer.participations).toEqual([]);
  });
  it('prioritizes explicit review of changed arrangements even for managers', () => {
    const d = applicationDetail(); d.viewer.participations = [{ segment_id: applicationSegment, status: 'awaiting_acceptance', accepted_plan_revision: 1 }];
    expect(overviewModel(d).primary.section).toBe('arrangement');
  });
  it('keeps pending applications separate from joined seats', () => {
    const d = applicationDetail(); d.viewer.applications = [{ application_id: applicationId, applicant_user_id: applicantA, display_name: '周周', status: 'pending', segments: [{ segment_id: applicationSegment, plan_revision: 1 }], created_at: d.server_time, decided_at: null }];
    expect(overviewModel(d).status).toBe('申请待审批');
    expect(overviewModel(d).primary.section).toBe('participation');
    expect(overviewModel(d).joined).toHaveLength(0);
  });
  it('does not advertise registration when cancelled, closed, empty or all segments cancelled', () => {
    for (const kind of ['cancelled', 'closed', 'empty', 'segments-cancelled']) {
      const d = applicationDetail();
      if (kind === 'cancelled') d.cancelled_at = d.server_time;
      if (kind === 'closed') d.segments[0].is_join_open = false;
      if (kind === 'empty') d.segments = [];
      if (kind === 'segments-cancelled') d.segments[0].cancelled_at = d.server_time;
      expect(overviewModel(d).primary.section).not.toBe('apply');
    }
  });
  it('does not sum multiple segment counts into an invented unique member total', () => {
    const d = applicationDetail(); d.segments[0].counts.occupied_count = 3;
    d.segments.push({ ...d.segments[0], segment_id: applicationId, position: 1, counts: { ...d.segments[0].counts, occupied_count: 5 } });
    expect(overviewModel(d).main?.counts.occupied_count).toBe(3);
    expect(overviewModel(d).segmentCount).toBe(2);
  });
});

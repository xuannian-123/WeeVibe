import type { ActivityDetail } from '../packages/contracts/src';
export const applicantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const applicantB = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const applicationActivity = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const applicationSegment = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const applicationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export function applicationDetail(actor = applicantA): ActivityDetail {
  return { activity_id: applicationActivity, name: '离线活动', timezone: 'Asia/Shanghai', revision: 1, server_time: '2030-01-01T00:00:00Z', main_segment_id: applicationSegment, cancelled_at: null, formation_status: 'not_confirmed',
    viewer: { user_id: actor, is_manager: true, participations: [], applications: [] }, applications: [],
    segments: [{ segment_id: applicationSegment, client_ref: 'first', position: 0, type: 'custom', name: '离线环节', starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-02T12:00:00Z', deadline_at: '2030-01-02T00:00:00Z', minimum_participants: 1, capacity: 10, plan_revision: 1,
      location: { name: '自定义地点', address: null, source_url: null }, fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, requirements: '', cancelled_at: null, has_started: false, is_join_open: true, verification_status: 'unknown', booking_status: 'unknown',
      counts: { occupied_count: 0, accepted_count: 0, pending_acceptance_count: 0, remaining_capacity: 10, meets_minimum: false, is_full: false } }] };
}

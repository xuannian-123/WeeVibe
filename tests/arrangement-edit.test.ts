import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editArrangementInputSchema, type EditArrangementInput } from '../packages/contracts/src';
import { planArrangementEdit } from '../apps/web/src/server/activities/arrangement-edit';
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
type State = Parameters<typeof planArrangementEdit>[0];
function source(): State {
  return { id: id(1), currentManagerId: id(9), revision: 1, mainRevision: 1, mainSegmentId: id(2), cancelledAt: null,
    segments: [0, 1].map((position) => ({ id: id(position + 2), activityId: id(1), clientRef: `part${position}`, position, type: 'custom', name: `Part ${position}`,
      startsAt: new Date(`2030-01-01T${position ? '14' : '11'}:00:00Z`), endsAt: new Date(`2030-01-01T${position ? '15' : '12'}:00:00Z`), deadlineAt: new Date('2030-01-01T10:30:00Z'),
      minimumParticipants: 1, capacity: 3, location: { name: 'Old place', address: null, source_url: null }, fee: { kind: 'unknown', amount_cents: null, currency: 'CNY', note: '' }, requirements: '',
      planRevision: 1, cancelledAt: null, verificationStatus: 'manual_checked', bookingStatus: 'manual_booked',
      participations: [{ userId: id(8), status: 'joined', acceptedPlanRevision: 1 }] })) } as unknown as State;
}
function input(s: State): EditArrangementInput {
  return editArrangementInputSchema.parse({ idempotency_key: 'edit-fixture-key', expected_revision: s.revision, main_segment_ref: 'part0', segments: s.segments.map(segment => ({
    segment_id: segment.id, client_ref: segment.clientRef, type: segment.type, name: segment.name, starts_at: segment.startsAt.toISOString(), ends_at: segment.endsAt.toISOString(), deadline_at: segment.deadlineAt.toISOString(),
    minimum_participants: segment.minimumParticipants, capacity: segment.capacity, location: segment.location, fee: segment.fee, requirements: segment.requirements, cancelled: false })) });
}
const plan = (s: State, command: EditArrangementInput) => planArrangementEdit(s, id(9), command, new Date());
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T10:00:00Z')); });
afterEach(() => vi.useRealTimers());
describe('WG05 edit planning without persistence', () => {
  it('a restaurant-only change preserves unaffected main and requires reacceptance plus new venue verification', () => {
    const s = source(), command = input(s); command.segments[1].location.name = 'New restaurant';
    const p = plan(s, command); expect(p.main.material || p.main.cross).toBe(false); expect(p.changed).toHaveLength(1);
    expect(p.preview.changes[0]).toMatchObject({ requires_reacceptance: true, resets_verification: true, affected_count: 1 });
  });
  it('detects changed inter-segment timing for shared participants even when main fields stay the same', () => {
    const s = source(), command = input(s); command.segments[1].starts_at = '2030-01-01T14:30:00Z';
    expect(plan(s, command).main.cross).toBe(true);
    s.segments[1].participations[0].userId = id(7);
    expect(plan(s, command).main.cross).toBe(false);
  });
  it('does not require new acceptance for a capacity-only change', () => {
    const s = source(), command = input(s); command.segments[0].capacity = 4;
    expect(plan(s, command).preview.changes[0].requires_reacceptance).toBe(false);
  });
  it('counts awaiting-acceptance seats and refuses a capacity below occupied', () => {
    const s = source(); s.segments[0].participations.push({ userId: id(7), status: 'joined', acceptedPlanRevision: null, lateArrivalAt: null, lateNoticeAt: null });
    const command = input(s); command.segments[0].capacity = 1;
    expect(() => plan(s, command)).toThrow('新上限不能少于当前占位');
  });
  it('minimum changes are material and keep seats pending rather than automatically forming', () => {
    const s = source(), command = input(s); command.segments[0].minimum_participants = 2;
    expect(plan(s, command).preview.changes[0]).toMatchObject({ requires_reacceptance: true, affected_count: 1 });
    expect(s.segments[0].participations[0].acceptedPlanRevision).toBe(1);
  });
  it('cannot delete a historical segment or silently resurrect a cancelled segment', () => {
    const s = source(), command = input(s); command.segments.pop(); expect(() => plan(s, command)).toThrow('不能删除历史');
    s.segments[1].cancelledAt = new Date(); expect(() => plan(s, input(s))).toThrow('不能复活');
  });
  it('cannot move the start of an already started segment back into the future', () => {
    const s = source(); s.segments[0].startsAt = new Date('2030-01-01T09:00:00Z'); s.segments[0].deadlineAt = new Date('2030-01-01T08:00:00Z');
    const command = input(s); command.segments[0].starts_at = '2030-01-01T11:00:00Z';
    expect(() => plan(s, command)).toThrow('已开始环节');
  });
  it('adding a segment never copies old participation into the preview', () => {
    const s = source(), command = input(s); command.segments.push({ ...command.segments[1], segment_id: undefined, client_ref: 'new', name: 'Karaoke', starts_at: '2030-01-01T17:00:00Z', ends_at: '2030-01-01T18:00:00Z' });
    expect(plan(s, command).preview.changes[0]).toMatchObject({ is_new: true, affected_count: 0 });
  });
  it('requires an active new main when cancelling the original one', () => {
    const s = source(), command = input(s); command.segments[0].cancelled = true;
    expect(editArrangementInputSchema.safeParse(command).success).toBe(false);
    command.main_segment_ref = 'part1'; expect(plan(s, command).mainChanged).toBe(true);
  });
  it('rejects foreign identity/version before exposing a preview', () => {
    const s = source(), command = input(s); command.segments[1].location.name = 'new';
    expect(() => planArrangementEdit(s, id(8), command, new Date())).toThrow('仅当前发起人');
    command.expected_revision = 2; expect(() => plan(s, command)).toThrow('活动已更新');
  });
});

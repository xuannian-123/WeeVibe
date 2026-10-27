import { describe, expect, it } from 'vitest';
import { participationActionSchema } from '../packages/contracts/src/participation-actions';
import { checkParticipationAction } from '../apps/web/src/server/activities/participation-rules';
const segmentId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const now = new Date('2030-01-01T10:00:00Z');
const segment = { id: segmentId, startsAt: new Date('2030-01-01T11:00:00Z'), endsAt: new Date('2030-01-01T13:00:00Z'), cancelledAt: null, participations: [{ userId: 'self', status: 'joined' as const }] };
const base = { expected_revision: 1, idempotency_key: 'participation-key', segment_ids: [segmentId] };
const exit = participationActionSchema.parse({ ...base, action: 'exit' });
const late = participationActionSchema.parse({ ...base, action: 'late', estimated_arrival_at: '2030-01-01T11:15:00Z' });
describe('strict participation action contracts', () => {
 it.each(['answers','preferences','budget','departure','user_id','actor_id','accepted_plan_revision','fee','status'])('rejects hidden %s field', key => expect(participationActionSchema.safeParse({ ...base, action:'exit', [key]: 'injected' }).success).toBe(false));
 it('rejects duplicate segments', () => expect(participationActionSchema.safeParse({ ...base, action:'exit', segment_ids:[segmentId,segmentId] }).success).toBe(false));
 it('rejects empty selection', () => expect(participationActionSchema.safeParse({ ...base, action:'exit', segment_ids:[] }).success).toBe(false));
 it('rejects ETA on exit', () => expect(participationActionSchema.safeParse({ ...base, action:'exit', estimated_arrival_at:'2030-01-01T11:15:00Z' }).success).toBe(false));
 it('requires offset aware late ETA', () => expect(participationActionSchema.safeParse({ ...base, action:'late', estimated_arrival_at:'2030-01-01 11:15' }).success).toBe(false));
});
describe('participant-only exit and lateness', () => {
 it('permits own joined segment without consulting requirement cutoff', () => expect(checkParticipationAction([segment], 'self', exit, now)).toEqual([segment]));
 it('does not allow another actor to edit a participant', () => expect(() => checkParticipationAction([segment], 'manager', exit, now)).toThrow('本人'));
 it('rejects exited participant', () => expect(() => checkParticipationAction([{ ...segment, participations:[{userId:'self',status:'exited'}] }], 'self', exit, now)).toThrow('本人'));
 it('rejects foreign segment atomically before writes', () => expect(() => checkParticipationAction([segment], 'self', { ...exit, segment_ids:[segmentId,otherId] }, now)).toThrow('不属于'));
 it('rejects cancelled segment', () => expect(() => checkParticipationAction([{ ...segment, cancelledAt:now }], 'self', exit, now)).toThrow('取消'));
 it('rejects completed segment', () => expect(() => checkParticipationAction([segment], 'self', exit, segment.endsAt)).toThrow('结束'));
 it('late leaves all source participation values unchanged', () => { const original = JSON.stringify(segment); expect(checkParticipationAction([segment], 'self', late, now)).toEqual([segment]); expect(JSON.stringify(segment)).toBe(original); });
 it.each(['2030-01-01T09:00:00Z','2030-01-01T11:00:00Z','2030-01-01T13:00:00Z','2030-01-02T11:15:00Z'])('rejects ETA %s outside relevant interval', estimated_arrival_at => expect(() => checkParticipationAction([segment], 'self', { ...late, action:'late', estimated_arrival_at }, now)).toThrow('预计到达'));
 it('permits active segment late ETA only in its remaining time', () => expect(checkParticipationAction([segment], 'self', late, new Date('2030-01-01T11:05:00Z'))).toHaveLength(1));
});

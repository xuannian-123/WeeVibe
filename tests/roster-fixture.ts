import { vi } from 'vitest';
export const rosterId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const rosterIds = { activity: rosterId(1), main: rosterId(2), second: rosterId(3), cancelled: rosterId(4), actor: rosterId(5) };
function select(row: any, shape: any): any {
  const out: any = {};
  for (const [key, value] of Object.entries(shape)) {
    if (value === true) out[key] = structuredClone(row[key]);
    else if (value && typeof value === 'object' && 'select' in value) {
      const q = value as any;
      out[key] = [...row[key]].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).slice(0, q.take).map(r => select(r, q.select));
    }
  }
  return out;
}
export function createRosterFixture() {
  const segment = (id: string, position: number) => ({ id, activityId: rosterIds.activity, name: `段${position + 1}`, position, planRevision: 3, cancelledAt: null as Date | null });
  const participation = (id: number, segmentId: string, name: string | null, acceptedPlanRevision: number | null = 3) => ({
    id: rosterId(id), activityId: rosterIds.activity, segmentId, userId: rosterId(10000 + id), displayName: name, acceptedPlanRevision,
    status: 'joined', joinedAt: new Date(`2030-01-01T00:00:${String(id % 60).padStart(2, '0')}Z`),
    sourceApplicationId: 'PRIVATE_APPLICATION_ID', lateArrivalAt: 'PRIVATE_LATE_TIME', privateOrigin: 'PRIVATE_ORIGIN'
  });
  const f: any = {
    activity: { id: rosterIds.activity, revision: 5, cancelledAt: null, segments: [segment(rosterIds.main, 0), segment(rosterIds.second, 1), { ...segment(rosterIds.cancelled, 2), cancelledAt: new Date('2030-01-01T00:00:00Z') }], privateProfile: 'PRIVATE_PROFILE' },
    rows: [participation(11, rosterIds.main, '同名'), participation(12, rosterIds.main, '同名', 2), participation(13, rosterIds.main, null, null), participation(14, rosterIds.second, ''), { ...participation(15, rosterIds.second, 'PRIVATE_EXITED'), status: 'exited' }, participation(16, rosterIds.cancelled, 'PRIVATE_CANCELLED')],
    participation,
    trace: []
  };
  f.tx = {
    activity: { findUnique: vi.fn(async ({ where, select: shape }: any) => { f.trace.push('activity'); return f.activity && where.id === f.activity.id ? select(f.activity, shape) : null; }), update: vi.fn(), create: vi.fn() },
    participation: { findMany: vi.fn(async ({ where, orderBy, take, select: shape }: any) => { f.trace.push('participation'); return f.rows.filter((r: any) => r.activityId === where.activityId && r.status === where.status && where.segmentId.in.includes(r.segmentId)).sort((a: any, b: any) => a.segmentId.localeCompare(b.segmentId) || a.joinedAt.valueOf() - b.joinedAt.valueOf() || a.id.localeCompare(b.id)).slice(0, take).map((r: any) => select(r, shape)); }), updateMany: vi.fn(), createMany: vi.fn() },
    user: { findMany: vi.fn() }, privateProfile: { findMany: vi.fn() }, activityApplication: { findMany: vi.fn() }, requirementSubmission: { findMany: vi.fn() }, activityEvent: { create: vi.fn() }, activityMutationKey: { create: vi.fn() }, $queryRaw: vi.fn()
  };
  f.db = { $transaction: vi.fn(async (fn: any, _options: any) => fn(f.tx)) };
  return f;
}

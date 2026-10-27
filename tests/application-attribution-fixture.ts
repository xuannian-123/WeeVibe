import { vi } from 'vitest';
import { createHandoverFixture, handoverIds as I, handoverId, selectFields } from './handover-fixture';
export { I, handoverId as id };
function match(row: any, where: any): boolean {
 return Object.entries(where ?? {}).every(([key, value]: any) => key === 'targets'
  ? row.targets?.some((t: any) => value.some.segmentId.in.includes(t.segmentId))
  : row[key] === value);
}
export function attributionFixture() {
 const f = createHandoverFixture();
 f.activity.segments.forEach((s: any) => { s.deadlineAt = new Date('2030-01-01T10:30:00Z'); });
 f.sources = [{ id: handoverId(31), activityId: I.activity, inviterDisplayName: 'PUBLIC_ENTRY_NAME', inviterUserId: I.b,
  inviterAvatarUrl: 'PRIVATE_AVATAR_SENTINEL', privateProfile: { introduction: 'PRIVATE_PROFILE_SENTINEL' }, privateOrigin: 'PRIVATE_ORIGIN_SENTINEL' },
 { id: handoverId(32), activityId: handoverId(999), inviterDisplayName: 'FOREIGN_ENTRY', inviterUserId: I.c }];
 f.tx.invitationSource = { findFirst: vi.fn(async ({ where, select }: any) => selectFields(f.sources.find((s: any) => match(s, where)) ?? null, select)) };
 f.tx.activityApplication.findFirst = vi.fn(async ({ where }: any) => structuredClone(f.apps.find((a: any) => match(a, where)) ?? null));
 f.tx.activityApplication.findMany = vi.fn(async ({ where, select, take }: any) => f.apps.filter((a: any) => match(a, where))
  .sort((a: any, b: any) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)).slice(0, take)
  .map((a: any) => selectFields({ ...a, invitationSourceId: a.invitationSourceId ?? null,
   invitationSource: f.sources.find((s: any) => s.id === a.invitationSourceId) ?? null }, select)));
 f.tx.activityApplication.updateMany = vi.fn(async ({ where, data }: any) => { let count=0; for(const a of f.apps) if(match(a,where)){Object.assign(a,structuredClone(data));count++;} return {count}; });
 f.tx.activityApplication.create = vi.fn(async ({ data }: any) => {
  const row = { id: handoverId(100 + f.apps.length), invitationSourceId: null, status: 'pending', createdAt: new Date(), decidedAt: null, targets: [], ...structuredClone(data) };
  f.apps.push(row); return structuredClone(row);
 });
 f.tx.applicationTarget = { createMany: vi.fn(async ({ data }: any) => {
  for (const target of data) f.apps.find((a: any) => a.id === target.applicationId).targets.push(structuredClone(target));
  return { count: data.length };
 }) };
 f.addApp = (actor = I.stranger, source: string | null = handoverId(31), status = 'pending') => {
  const row = { id: handoverId(100 + f.apps.length), activityId: I.activity, applicantUserId: actor, displayName: 'APPLICANT_PUBLIC',
   invitationSourceId: source, status, createdAt: new Date(), decidedAt: null, targets: [{ segmentId: I.main, acceptedPlanRevision: 3 }] };
  f.apps.push(row); return row;
 };
 return f;
}

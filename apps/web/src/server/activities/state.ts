import type { Prisma } from '@prisma/client';
import { ServiceError } from '../http';

export type Tx = Prisma.TransactionClient;
const stateInclude = {
  segments: { orderBy: { position: 'asc' as const }, include: { participations: { select: { userId: true, status: true, acceptedPlanRevision: true, lateArrivalAt: true, lateNoticeAt: true } } } }
} satisfies Prisma.ActivityInclude;

export async function loadActivity(tx: Tx, id: string) {
  const activity = await tx.activity.findUnique({ where: { id }, include: stateInclude });
  if (!activity) throw new ServiceError('NOT_FOUND', 404, '未找到此活动');
  return activity;
}
export async function lockActivity(tx: Tx, id: string) {
  // Every seat-affecting operation takes this parent lock before reading counts.
  // Identifier already passes UUID validation; values remain parameterized.
  await tx.$queryRaw`SELECT "id" FROM "Activity" WHERE "id" = ${id}::uuid FOR UPDATE`;
  return loadActivity(tx, id);
}

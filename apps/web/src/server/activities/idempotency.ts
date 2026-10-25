import type { Tx } from './state';
import { verifyReplay } from './rules';

export async function replay(tx: Tx, actorId: string, key: string, scope: string, fingerprint: string) {
  const row = await tx.activityMutationKey.findUnique({ where: { actorUserId_key: { actorUserId: actorId, key } } });
  if (!row) return null;
  verifyReplay(row, scope, fingerprint);
  return row;
}
export async function remember(tx: Tx, actorId: string, key: string, scope: string, fingerprint: string, activityId: string) {
  await tx.activityMutationKey.create({ data: { actorUserId: actorId, key, scope, requestHash: fingerprint, activityId } });
}

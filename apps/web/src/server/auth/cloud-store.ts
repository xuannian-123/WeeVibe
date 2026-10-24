import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { isRetryableActivityTransactionError } from '../activities/transaction-errors';

type VerifiedCloudIdentity = { appId: string; openId: string };
type VerifiedCloudProof = { digest: string; expiresAt: Date };
const unauthorized = () => new ServiceError('UNAUTHENTICATED', 401, '登录凭证无效或已使用，请重新发起登录');

/** Server-only store. The caller must verify the fixed signature, app, audience,
 * environment and source FIRST. Never call with identity/proof copied from a client.
 * Proof consumption, stable business identity and session issuance commit together. */
export async function issueCloudSession(identity: VerifiedCloudIdentity, proof: VerifiedCloudProof, now = new Date()) {
  const initialTime = now.getTime(), started = performance.now();
  const proofExpiry = proof.expiresAt instanceof Date ? proof.expiresAt.getTime() : NaN;
  if (!Number.isFinite(initialTime) || !Number.isFinite(proofExpiry) || !/^[a-f0-9]{64}$/.test(proof.digest)
    || typeof identity.appId !== 'string' || !identity.appId || identity.appId.length > 128 || identity.appId.trim() !== identity.appId
    || typeof identity.openId !== 'string' || !identity.openId || identity.openId.length > 256 || identity.openId.trim() !== identity.openId) throw unauthorized();
  // Preserve a trusted injected clock while accounting for connection/lock queues.
  const currentTime = () => initialTime + Math.max(0, performance.now() - started);
  const requireFresh = () => { if (proofExpiry <= currentTime()) throw unauthorized(); };
  requireFresh();
  const digest = proof.digest, appId = identity.appId, openId = identity.openId;
  return withDb(async db => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await db.$transaction(async tx => {
          requireFresh();
          await tx.cloudLoginUse.create({ data: { digest, expiresAt: new Date(proofExpiry) } });
          requireFresh();
          const where = { appId_openId: { appId, openId } };
          let binding = await tx.wechatIdentity.findUnique({ where });
          if (!binding) binding = await tx.wechatIdentity.create({ data: { appId, openId, user: { create: {} } } });
          requireFresh();
          const token = randomBytes(32).toString('base64url');
          const expiresAt = new Date(currentTime() + 24 * 60 * 60 * 1000);
          await tx.authSession.create({ data: { tokenHash: createHash('sha256').update(token).digest('hex'), userId: binding.userId, expiresAt } });
          requireFresh();
          return { token, expires_at: expiresAt.toISOString(), user: { user_id: binding.userId } };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 });
      } catch (error) {
        if (error instanceof ServiceError) throw error;
        const known = error instanceof Prisma.PrismaClientKnownRequestError;
        if (known && error.code === 'P2002') {
          // Query only after the failed transaction has rolled back. A consumed
          // proof is always a replay, even if an identity unique race also happened.
          if (await db.cloudLoginUse.findUnique({ where: { digest }, select: { digest: true } })) throw unauthorized();
        }
        // Reuse the already-tested adapter SQLSTATE mapping, but only AFTER the
        // consumed-digest check above; nonce duplicates must never become success.
        if (isRetryableActivityTransactionError(error) && attempt < 2) continue;
        throw error;
      }
    }
    throw new ServiceError('DATABASE_UNAVAILABLE', 503, '暂时无法建立会话，请稍后重试');
  });
}

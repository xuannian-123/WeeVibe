import { Prisma } from '@prisma/client';
import { withDb } from '../db';
import { ServiceError } from '../http';
import { isRetryableActivityTransactionError } from './transaction-errors';
import type { Tx } from './state';

export async function mutation<T>(action: (tx: Tx) => Promise<T>): Promise<T> {
  return withDb(async db => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await db.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 10000 }); }
      catch (error) {
        // A unique-key race must roll back the WHOLE operation, then re-read the
        // idempotency winner or current seats. Never continue a failed transaction.
        if (isRetryableActivityTransactionError(error)) {
          if (attempt < 2) continue;
          throw new ServiceError('CONCURRENT_MODIFICATION', 409, '其他成员正在更新活动，请刷新后重试');
        }
        throw error;
      }
    }
    throw new ServiceError('CONCURRENT_MODIFICATION', 409, '活动正在更新，请刷新后重试');
  });
}

import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { isRetryableActivityTransactionError } from '../apps/web/src/server/activities/transaction-errors';

const error = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Synthetic driver fixture', { code, meta, clientVersion: '6.19.3' });
describe('whole-transaction retry classification', () => {
  it('recognizes observed adapter-pg Error cause and supported legacy states', () => {
    for (const state of ['40001', '40P01']) {
      const adapter = new Error('Synthetic adapter error', { cause: { originalCode: state } });
      expect(isRetryableActivityTransactionError(error('P2010', { driverAdapterError: adapter }))).toBe(true);
      expect(isRetryableActivityTransactionError(error('P2010', { code: state }))).toBe(true);
    }
    expect(isRetryableActivityTransactionError(error('P2034'))).toBe(true);
    expect(isRetryableActivityTransactionError(error('P2002'))).toBe(true);
  });
  it('does not retry deterministic SQL, permission, domain or unknown errors', () => {
    for (const state of ['P0001', '23514', '42501', '08006']) {
      expect(isRetryableActivityTransactionError(error('P2010', { driverAdapterError: { cause: { originalCode: state } } }))).toBe(false);
    }
    for (const value of [error('P2010'), error('P2025'), new Error('domain error'), { code: 'P2034' }, null]) {
      expect(isRetryableActivityTransactionError(value)).toBe(false);
    }
  });
});

import { Prisma } from '@prisma/client';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;

export function isRetryableActivityTransactionError(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034' || error.code === 'P2002') return true;
  if (error.code !== 'P2010') return false;
  // Raw adapter-pg lock conflicts preserve SQLSTATE in the Error's cause.
  // Other connectors used meta.code. Do not expose either raw error body.
  const adapter = object(error.meta?.driverAdapterError);
  const cause = object(adapter?.cause);
  const state = error.meta?.code ?? cause?.originalCode;
  return state === '40001' || state === '40P01';
}

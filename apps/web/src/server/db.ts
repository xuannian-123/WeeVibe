import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ServiceError } from './http';
const state = globalThis as typeof globalThis & { weegoPrisma?: PrismaClient };
export function getDb() {
  if (!process.env.DATABASE_URL) throw new ServiceError('NOT_CONFIGURED', 503, '尚未配置 WeeVibe 数据库');
  return state.weegoPrisma ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 }), log: [] });
}
export async function withDb<T>(action: (db: PrismaClient) => Promise<T>): Promise<T> {
  try { return await action(getDb()); }
  catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('DATABASE_UNAVAILABLE', 503, '数据库暂时不可用');
  }
}

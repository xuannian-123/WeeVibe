import { Prisma } from '@prisma/client';
import { withDb } from '../db';
import { createIdentityService, type IdentityStore } from './service';
import { exchangeWechatCode } from './wechat';

const store: IdentityStore = {
  findOrCreateUser: async ({ appId, openId }) => withDb(async db => {
    const where = { appId_openId: { appId, openId } };
    const existing = await db.wechatIdentity.findUnique({ where });
    if (existing) return { user_id: existing.userId };
    try {
      const identity = await db.wechatIdentity.create({ data: { appId, openId, user: { create: {} } } });
      return { user_id: identity.userId };
    } catch (error) {
      // Concurrent first login: nested creation rolls back; resolve the unique winner.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const winner = await db.wechatIdentity.findUniqueOrThrow({ where });
      return { user_id: winner.userId };
    }
  }),
  saveSession: (tokenHash, userId, expiresAt) => withDb(async db => { await db.authSession.create({ data: { tokenHash, userId, expiresAt } }); }),
  findSession: tokenHash => withDb(async db => {
    const session = await db.authSession.findUnique({ where: { tokenHash } });
    return session ? { user_id: session.userId, expiresAt: session.expiresAt } : null;
  })
};
export const identityService = createIdentityService(store, exchangeWechatCode);

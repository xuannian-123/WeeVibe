import { createHash, randomBytes } from 'node:crypto';
import { ServiceError } from '../http';
export type VerifiedWechatIdentity = { appId: string; openId: string };
export type IdentityVerifier = (code: string) => Promise<VerifiedWechatIdentity>;
export interface IdentityStore {
  findOrCreateUser(identity: VerifiedWechatIdentity): Promise<{ user_id: string }>;
  saveSession(hash: string, userId: string, expiresAt: Date): Promise<void>;
  findSession(hash: string): Promise<{ user_id: string; expiresAt: Date } | null>;
}
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function createIdentityService(store: IdentityStore, verify: IdentityVerifier, now: () => Date = () => new Date()) {
  return {
    async login(code: string) {
      const verified = await verify(code);
      const user = await store.findOrCreateUser(verified);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(now().getTime() + 24 * 60 * 60 * 1000);
      await store.saveSession(hashToken(token), user.user_id, expiresAt);
      return { token, expires_at: expiresAt.toISOString(), user };
    },
    async authenticate(authorization: string | null) {
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
      if (!match) throw new ServiceError('UNAUTHENTICATED', 401, '请先登录或重新建立会话');
      const session = await store.findSession(hashToken(match[1]));
      if (!session || session.expiresAt.getTime() <= now().getTime()) throw new ServiceError('UNAUTHENTICATED', 401, '会话已失效，请重新登录');
      return { user_id: session.user_id };
    }
  };
}

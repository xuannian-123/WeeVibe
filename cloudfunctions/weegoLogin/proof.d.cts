import type { KeyObject } from 'node:crypto';
type BaseConfig = { appId: string; envId: string; keyId: string; allowDevtools: boolean };
export type SignerConfig = BaseConfig & { privateKey: KeyObject };
export type VerifierConfig = BaseConfig & { publicKey: KeyObject };
export const LOGIN_PATH: '/api/v1/auth/cloud-wechat';
export const MAX_PROOF_BYTES: number;
export class CloudProofError extends Error { readonly kind: 'configuration' | 'identity'; }
export function readSignerConfig(env: NodeJS.ProcessEnv): SignerConfig;
export function readVerifierConfig(env: NodeJS.ProcessEnv): VerifierConfig;
export function createSignedProof(identity: { appId: string; openId: string; source: 'wx_client' | 'wx_devtools' }, config: SignerConfig, now?: number): { body: string; signature: string };
export function verifySignedProof(body: string, signature: string, config: VerifierConfig, now?: number): { identity: { appId: string; openId: string }; proof: { digest: string; expiresAt: Date } };

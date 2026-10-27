import { activityIdSchema } from '@weevibe/contracts';

export type ActivityEntry =
  | { kind: 'standard' }
  | { kind: 'scene'; invitationId: string; scene: string }
  | { kind: 'invalid' };

export function invitationSceneFromId(raw: unknown): string | undefined {
  const result = activityIdSchema.safeParse(raw);
  return result.success ? result.data.replaceAll('-', '') : undefined;
}

export function invitationIdFromScene(raw: unknown): string | undefined {
  // A fully URI-encoded 32-character scene is at most 96 characters.
  if (typeof raw !== 'string' || raw.length > 96) return undefined;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  // Decode exactly once; never trim or treat '+' as a space.
  if (decoded.length !== 32 || !/^[0-9a-f]{32}$/i.test(decoded)) return undefined;
  const id = `${decoded.slice(0, 8)}-${decoded.slice(8, 12)}-${decoded.slice(12, 16)}-${decoded.slice(16, 20)}-${decoded.slice(20)}`;
  const result = activityIdSchema.safeParse(id);
  return result.success ? result.data : undefined;
}

export function activityEntryFromParams(params: Record<string, unknown>): ActivityEntry {
  if (!Object.prototype.hasOwnProperty.call(params, 'scene')) return { kind: 'standard' };
  // Scene entry is intentionally disjoint from legacy id/invitation_id routes.
  if (Reflect.ownKeys(params).length !== 1) return { kind: 'invalid' };
  const invitationId = invitationIdFromScene(params.scene);
  return invitationId
    ? { kind: 'scene', invitationId, scene: invitationId.replaceAll('-', '') }
    : { kind: 'invalid' };
}

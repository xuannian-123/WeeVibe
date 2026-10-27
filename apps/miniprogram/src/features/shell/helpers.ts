import { invitationIdFromScene, invitationSceneFromId } from '../invitations/scene';

export const COMMON_CITIES = ['北京','天津','上海','苏州','深圳','南京','重庆','成都','杭州','武汉','南昌','青岛'] as const;
// Only an internal activity path is accepted. Never navigate to QR supplied hosts.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
export function activityPathFromScan(value: string): string | undefined {
  const sceneMatch = /^\/?pages\/activity\/index\?scene=([^&?#]*)$/.exec(value);
  if (sceneMatch) {
    const invitationId = invitationIdFromScene(sceneMatch[1]);
    return invitationId ? `/pages/activity/index?scene=${invitationSceneFromId(invitationId)}` : undefined;
  }
  const match = new RegExp(`^(?:/)?pages/activity/index\\?id=(${UUID})(?:&invitation_id=(${UUID}))?$`, 'i').exec(value.trim());
  if (!match) return undefined;
  return `/pages/activity/index?id=${encodeURIComponent(match[1]!)}${match[2] ? `&invitation_id=${encodeURIComponent(match[2])}` : ''}`;
}

export function validCity(value: string): boolean { return /^[\u3400-\u9fffA-Za-z ·-]{1,30}$/.test(value.trim()); }

import { z } from 'zod';
import { activityIdSchema, type ActivityDetail } from '@weevibe/contracts';
import { invitationSourceSchema } from '@weevibe/contracts/src/invitations';
import { invitationSceneFromId } from '../invitations/scene';

const environmentSchema = z.enum(['trial', 'develop', 'release']);
export type RegistrationCodeEnvironment = z.infer<typeof environmentSchema>;
export const REGISTRATION_CODE_PAGE = 'pages/activity/index' as const;

/** Proposed provider boundary only: no deployed endpoint or provider is enabled by this module. */
export function registrationCodeTarget(detail: ActivityDetail, source: unknown, environment: RegistrationCodeEnvironment) {
  const activityId = activityIdSchema.parse(detail.activity_id);
  const invitation = invitationSourceSchema.parse(source);
  const env = environmentSchema.parse(environment);
  if (invitation.activity_id !== activityId || invitation.cancelled || detail.cancelled_at || !detail.segments.some(segment => !segment.cancelled_at)) throw new Error('CODE_TARGET_UNAVAILABLE');
  return {
    activity_id: activityId, invitation_id: invitation.invitation_id,
    page: REGISTRATION_CODE_PAGE, scene: invitationSceneFromId(invitation.invitation_id)!,
    env_version: env, check_path: true as const, width: 430 as const,
  };
}
export type RegistrationCodeTarget = ReturnType<typeof registrationCodeTarget>;

const codeResponseSchema = z.object({
  activity_id: activityIdSchema, invitation_id: activityIdSchema,
  page: z.literal(REGISTRATION_CODE_PAGE), scene: z.string().regex(/^[a-f0-9]{32}$/),
  env_version: environmentSchema,
  image: z.object({
    content_type: z.enum(['image/png', 'image/jpeg']),
    base64: z.string().min(32).max(700000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  }).strict(),
}).strict();

/**
 * Isolated client wiring for a future reviewed backend. The caller supplies the existing public
 * source reader and a server adapter; never call the WeChat provider or pass credentials here.
 * Actual image decoding, dimensions and provider success must also be validated by the server.
 */
export async function loadRegistrationCode(detail: ActivityDetail, invitationId: string, environment: RegistrationCodeEnvironment, ports: {
  readSource: (id: string) => Promise<unknown>;
  generate: (target: RegistrationCodeTarget) => Promise<unknown>;
  assertCurrent: () => void;
}) {
  const id = activityIdSchema.parse(invitationId);
  environmentSchema.parse(environment);
  ports.assertCurrent();
  const source = invitationSourceSchema.parse(await ports.readSource(id));
  ports.assertCurrent();
  if (source.invitation_id !== id) throw new Error('CODE_SOURCE_MISMATCH');
  const target = registrationCodeTarget(detail, source, environment);
  ports.assertCurrent();
  const response = codeResponseSchema.parse(await ports.generate(target));
  ports.assertCurrent();
  if (response.activity_id !== target.activity_id || response.invitation_id !== target.invitation_id || response.scene !== target.scene || response.env_version !== target.env_version) throw new Error('CODE_RESPONSE_MISMATCH');
  const prefix = response.image.content_type === 'image/png' ? 'iVBORw0KGgo' : '/9j/';
  if (!response.image.base64.startsWith(prefix)) throw new Error('CODE_IMAGE_INVALID');
  return response;
}

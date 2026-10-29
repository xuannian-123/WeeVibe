import { z } from 'zod';
import { ApiClientError, createApiClient, type Transport } from '@weevibe/api-client';
import { activityIdSchema, createHandoverInputSchema, handoverCommandSchema, handoverStateSchema,
  type CreateHandoverInput, type HandoverCommand, type HandoverOffer, type HandoverState } from '@weevibe/contracts';
import { getToken, transport } from '../../platform/api';

const offerIdentitySchema = z.object({ handover_id: activityIdSchema, activity_id: activityIdSchema,
  from_user_id: activityIdSchema, to_user_id: activityIdSchema, from_management_revision: z.number().int().positive() }).strict();
const operationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), input: createHandoverInputSchema }).strict(),
  z.object({ kind: z.literal('command'), offer: offerIdentitySchema, input: handoverCommandSchema }).strict()
]);
export type OfferIdentity = z.infer<typeof offerIdentitySchema>;
export type HandoverOperation = z.infer<typeof operationSchema>;
export const parseHandoverOperation = (raw: unknown): HandoverOperation => operationSchema.parse(raw);
export function offerIdentity(offer: HandoverOffer): OfferIdentity {
  const { handover_id, activity_id, from_user_id, to_user_id, from_management_revision } = offer;
  return { handover_id, activity_id, from_user_id, to_user_id, from_management_revision };
}
const invalid = () => new ApiClientError('INVALID_RESPONSE', '交接响应与原活动、身份或交接记录不一致，结果未确认；请保留原请求并刷新核对。', 200);
async function execute<T>(activityId: string, actorId: string, expectedSession: string | undefined, assertCanSend: () => void,
  run: (client: ReturnType<typeof createApiClient>) => Promise<T>) {
  const id = activityIdSchema.parse(activityId), actor = activityIdSchema.parse(actorId);
  const assertSession = () => {
    if (!expectedSession || getToken() !== expectedSession) throw new ApiClientError('UNAUTHENTICATED', '账号已变化，请重新读取本人交接；原请求不会提交给新账号。', 401);
  };
  const bound: Transport = async request => {
    // No await between the final source/lifecycle/session checks and dispatch.
    assertCanSend(); assertSession();
    const response = await transport({ ...request, headers: { ...request.headers, Authorization: `Bearer ${expectedSession}` } });
    assertCanSend(); assertSession();
    return response;
  };
  const client = createApiClient(bound, () => expectedSession);
  const identity = await client.me(); assertCanSend(); assertSession();
  if (activityIdSchema.parse(identity.user_id) !== actor) throw new ApiClientError('UNAUTHENTICATED', '当前身份与交接页面来源不一致，请重新读取。', 401);
  let value: unknown;
  try { value = await run(client); }
  catch (error) { if (error instanceof ApiClientError) throw error; throw invalid(); }
  assertCanSend(); assertSession();
  const parsed = handoverStateSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const data = parsed.data;
  if (data.activity.activity_id !== id || data.activity.viewer.user_id !== actor) throw invalid();
  if (data.candidates.some(candidate => candidate.user_id === actor || candidate.segment_ids.some(segmentId => {
    const segment = data.activity.segments.find(item => item.segment_id === segmentId);
    return !segment || !!segment.cancelled_at || segment.has_started || Date.parse(segment.starts_at) <= Date.parse(data.activity.server_time);
  }))) throw invalid();
  if (data.pending && (data.activity.cancelled_at || data.pending.from_management_revision !== data.management_revision
    || (data.activity.viewer.is_manager ? data.pending.from_user_id !== actor : data.pending.to_user_id !== actor))) throw invalid();
  for (const offer of [data.pending, data.offer]) {
    if (!offer) continue;
    if (offer.from_management_revision > data.management_revision || (!data.activity.viewer.is_manager && offer.from_user_id !== actor && offer.to_user_id !== actor)) throw invalid();
    if ((offer.can_accept || offer.can_reject || offer.can_withdraw) && (data.activity.cancelled_at || offer.from_management_revision !== data.management_revision)) throw invalid();
  }
  return data;
}
function assertOffer(data: HandoverState, identity: OfferIdentity) {
  const offer = data.offer;
  if (!offer || Object.entries(identity).some(([key, value]) => offer[key as keyof OfferIdentity] !== value)) throw invalid();
}
export async function readHandovers(id: string, actor: string, session: string | undefined, guard: () => void) {
  const data = await execute(id, actor, session, guard, client => client.getHandovers(id));
  if (data.offer !== null) throw invalid();
  return data;
}
export async function readHandover(id: string, rawOffer: OfferIdentity, actor: string, session: string | undefined, guard: () => void) {
  const identity = offerIdentitySchema.parse(rawOffer);
  if (identity.activity_id !== activityIdSchema.parse(id)) throw invalid();
  const data = await execute(id, actor, session, guard, client => client.getHandover(id, identity.handover_id));
  assertOffer(data, identity); return data;
}
export async function submitHandover(id: string, raw: HandoverOperation, actorId: string, session: string | undefined, guard: () => void) {
  const operation = parseHandoverOperation(raw), actor = activityIdSchema.parse(actorId), activity = activityIdSchema.parse(id);
  if (operation.kind === 'command' && (operation.offer.activity_id !== activity
    || operation.offer.from_management_revision !== operation.input.expected_management_revision)) throw invalid();
  const data = await execute(id, actor, session, guard, client => operation.kind === 'create'
    ? client.createHandover(id, operation.input) : client.commandHandover(id, operation.offer.handover_id, operation.input));
  if (data.activity.revision <= operation.input.expected_revision || !data.offer) throw invalid();
  if (operation.kind === 'create') {
    if (data.offer.from_user_id !== actor || data.offer.to_user_id !== operation.input.target_user_id
      || data.offer.from_management_revision !== operation.input.expected_management_revision || !data.activity.viewer.is_manager) throw invalid();
  } else {
    assertOffer(data, operation.offer);
    const targetStatus = { accept: 'accepted', reject: 'rejected', withdraw: 'withdrawn' }[operation.input.action];
    if (data.offer.status !== targetStatus || (operation.input.action === 'withdraw'
      ? data.offer.from_user_id !== actor || !data.activity.viewer.is_manager : data.offer.to_user_id !== actor)) throw invalid();
    if (operation.input.action === 'accept' && data.management_revision <= operation.input.expected_management_revision) throw invalid();
    // A historical accepted key after B→C is allowed to return B as NON-manager.
    // It reports history and current permissions, never re-applies the old offer.
  }
  return data;
}
export function handoverErrorMessage(error: unknown) {
  if (!(error instanceof ApiClientError)) return undefined;
  const messages: Record<string, string> = {
    HANDOVER_SCOPE_UNAVAILABLE: '接任人须仍参加至少一个未取消、尚未结束的有效环节。待接记录不会因此自动删除。',
    HANDOVER_ALREADY_PENDING: '已有一份待接交接，请先处理或由当前管理者撤回，不能同时邀请多人竞争接任。',
    HANDOVER_ALREADY_RESOLVED: '这份交接已有处理结果，请刷新核对；不会重复切换管理权。',
    ACTIVITY_CANCELLED: '整场活动已取消，待接交接不能再生效；已生效的管理归属不会因此回到原发起人。'
  };
  return messages[error.code];
}

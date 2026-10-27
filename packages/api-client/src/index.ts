import { declareBookingInputSchema, bookingHistorySchema, type DeclareBookingInput } from '@weevibe/contracts';
import { extendDeadlineInputSchema, type ExtendDeadlineInput } from '@weevibe/contracts';
import { changeCapacityInputSchema, type ChangeCapacityInput } from '@weevibe/contracts';
import { publicRosterSnapshotSchema } from '@weevibe/contracts';
import { changeMainSegmentInputSchema, type ChangeMainSegmentInput } from '@weevibe/contracts';
import { todoPageSchema, todoCursorSchema } from '@weevibe/contracts';
import { rebookSourceSchema } from '@weevibe/contracts';
import { handoverStateSchema, createHandoverInputSchema, handoverCommandSchema, type CreateHandoverInput, type HandoverCommand } from '@weevibe/contracts';
import { apiErrorSchema, healthSchema, sessionSchema, userSchema, testRecordInputSchema, testRecordSchema, activityIdSchema, activityDetailSchema, createActivityInputSchema, applyToActivityInputSchema, decideApplicationInputSchema, withdrawApplicationInputSchema, cancelActivityInputSchema, type CreateActivityInput, type ApplyToActivityInput, type DecideApplicationInput, type WithdrawApplicationInput, type CancelActivityInput } from '@weevibe/contracts';

import { venueSearchSchema, venueNearbySchema, venueWalkSchema, venueListSchema, venueWalkResultSchema,
  type VenueSearchInput, type VenueNearbyInput, type VenueWalkInput } from '@weevibe/contracts';
import { aiCreateRequestSchema, aiCreateResponseSchema, type AiCreateRequest } from '@weevibe/contracts';

export type TransportRequest = { method: 'GET' | 'POST' | 'PUT'; path: string; headers: Record<string, string>; body?: unknown; timeoutMs?: number };
export type Transport = (request: TransportRequest) => Promise<{ status: number; body: unknown }>;
export class ApiClientError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}
export function createApiClient(transport: Transport, getToken: () => string | undefined = () => undefined) {
  async function request(method: TransportRequest['method'], path: string, body?: unknown, authenticated = false, timeoutMs?: number) {
    const token = authenticated ? getToken() : undefined;
    const response = await transport({ method, path, body, ...(timeoutMs ? { timeoutMs } : {}), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (response.status < 200 || response.status >= 300) {
      const error = apiErrorSchema.safeParse(response.body);
      throw new ApiClientError(error.success ? error.data.error.code : 'INVALID_RESPONSE', error.success ? error.data.error.message : '服务返回了无法识别的错误', response.status);
    }
    return response.body;
  }
  return {
    health: async () => healthSchema.parse(await request('GET', '/api/v1/health')),
    login: async (code: string) => sessionSchema.parse(await request('POST', '/api/v1/auth/wechat', { code })),
    me: async () => userSchema.parse(await request('GET', '/api/v1/me', undefined, true)),
    getTestRecord: async () => testRecordSchema.parse(await request('GET', '/api/v1/me/test-record', undefined, true)),
    putTestRecord: async (value: string) => testRecordSchema.parse(await request('PUT', '/api/v1/me/test-record', testRecordInputSchema.parse({ value }), true)),
    createActivity: async (input: CreateActivityInput) => activityDetailSchema.parse(await request('POST', '/api/v1/activities', createActivityInputSchema.parse(input), true)),
    getActivityRoster: async (id: string) => publicRosterSnapshotSchema.parse(await request('GET', `/api/v1/activities/${activityIdSchema.parse(id)}/roster`, undefined, true)),
    getActivity: async (id: string) => activityDetailSchema.parse(await request('GET', `/api/v1/activities/${activityIdSchema.parse(id)}`, undefined, true)),
    applyToActivity: async (id: string, input: ApplyToActivityInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/applications`, applyToActivityInputSchema.parse(input), true)),
    decideApplication: async (id: string, applicationId: string, input: DecideApplicationInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/applications/${activityIdSchema.parse(applicationId)}/decision`, decideApplicationInputSchema.parse(input), true)),
    withdrawApplication: async (id: string, applicationId: string, input: WithdrawApplicationInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/applications/${activityIdSchema.parse(applicationId)}/withdraw`, withdrawApplicationInputSchema.parse(input), true)),
    cancelActivity: async (id: string, input: CancelActivityInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/cancel`, cancelActivityInputSchema.parse(input), true)),
    declareBooking: async (id: string, segmentId: string, input: DeclareBookingInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/segments/${activityIdSchema.parse(segmentId)}/booking`, declareBookingInputSchema.parse(input), true)),
    readBookingHistory: async (id: string, segmentId: string) => bookingHistorySchema.parse(await request('GET', `/api/v1/activities/${activityIdSchema.parse(id)}/segments/${activityIdSchema.parse(segmentId)}/booking`, undefined, true)),
    extendDeadline: async (id: string, segmentId: string, input: ExtendDeadlineInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/segments/${activityIdSchema.parse(segmentId)}/deadline`, extendDeadlineInputSchema.parse(input), true)),
    changeCapacity: async (id: string, segmentId: string, input: ChangeCapacityInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/segments/${activityIdSchema.parse(segmentId)}/capacity`, changeCapacityInputSchema.parse(input), true)),
    changeMainSegment: async (id: string, input: ChangeMainSegmentInput) => activityDetailSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/main-segment`, changeMainSegmentInputSchema.parse(input), true)),
    getTodos: async (cursor?: string) => todoPageSchema.parse(await request('GET', `/api/v1/todos${cursor === undefined ? '' : `?cursor=${encodeURIComponent(todoCursorSchema.parse(cursor))}`}`, undefined, true)),
    getRebookSource: async (id: string) => rebookSourceSchema.parse(await request('GET', `/api/v1/activities/${activityIdSchema.parse(id)}/rebook`, undefined, true)),
    getHandovers: async (id: string) => handoverStateSchema.parse(await request('GET', `/api/v1/activities/${activityIdSchema.parse(id)}/handovers`, undefined, true)),
    getHandover: async (id: string, handoverId: string) => handoverStateSchema.parse(await request('GET', `/api/v1/activities/${activityIdSchema.parse(id)}/handovers/${activityIdSchema.parse(handoverId)}`, undefined, true)),
    createHandover: async (id: string, input: CreateHandoverInput) => handoverStateSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/handovers`, createHandoverInputSchema.parse(input), true)),
    commandHandover: async (id: string, handoverId: string, input: HandoverCommand) => handoverStateSchema.parse(await request('POST', `/api/v1/activities/${activityIdSchema.parse(id)}/handovers/${activityIdSchema.parse(handoverId)}`, handoverCommandSchema.parse(input), true)),
    searchVenues: async (input: VenueSearchInput) => venueListSchema.parse(await request('POST', '/api/v1/venues/search', venueSearchSchema.parse(input), true)),
    generateActivityDraft: async (input: AiCreateRequest) => aiCreateResponseSchema.parse(await request('POST', '/api/v1/ai/creation-draft', aiCreateRequestSchema.parse(input), true, 35000)),
    nearbyVenues: async (input: VenueNearbyInput) => venueListSchema.parse(await request('POST', '/api/v1/venues/nearby', venueNearbySchema.parse(input), true)),
    walkRoute: async (input: VenueWalkInput) => venueWalkResultSchema.parse(await request('POST', '/api/v1/venues/walk', venueWalkSchema.parse(input), true))
  };
}

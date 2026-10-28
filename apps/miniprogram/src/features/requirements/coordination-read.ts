import { coordinationContextSchema, type CoordinationContext } from '@weevibe/contracts';
import { ApiClientError } from '@weevibe/api-client';
import { extensionRequest } from '../../platform/extension-api';

export async function readCoordination(collectionId: string, activityId: string): Promise<CoordinationContext> {
  const result = coordinationContextSchema.safeParse(await extensionRequest<unknown>(`/api/v1/requirements/${collectionId}/coordination`));
  if (!result.success || result.data.collection_id.toLowerCase() !== collectionId.toLowerCase() || result.data.activity_id.toLowerCase() !== activityId.toLowerCase()) {
    throw new ApiClientError('INVALID_RESPONSE', '协调资料与当前活动不匹配，请刷新核对。', 200);
  }
  return result.data;
}

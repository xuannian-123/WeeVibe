import { ApiClientError } from '@weevibe/api-client';

// A retry may be rejected BEFORE its idempotency record is read (for example,
// after the previous response was lost and the session expired). Keep that key.
export function uncertain(error: unknown) {
  return !(error instanceof ApiClientError) || error.status === 0 || error.status >= 500
    || [401, 403, 429].includes(error.status) || error.code === 'INVALID_RESPONSE';
}

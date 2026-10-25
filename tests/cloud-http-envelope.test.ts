import { describe, expect, it } from 'vitest';
import { CLOUD_HTTP_ENVELOPE_HEADER, cloudHttpEnvelopeSchema, type ErrorCode } from '../packages/contracts/src';
import { handle, ServiceError } from '../apps/web/src/server/http';

const request = (version = '1') => new Request('https://api.example/api/v1/activities', { headers: { [CLOUD_HTTP_ENVELOPE_HEADER]: version } });
const reject = (code: ErrorCode, status: number) => async () => { throw new ServiceError(code, status, '已拒绝'); };

describe('explicit cloud HTTP response transport', () => {
  it.each([[400, 'INVALID_INPUT'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [409, 'SEGMENT_APPLICATION_CLOSED'], [503, 'DATABASE_UNAVAILABLE']] as const)(
    'preserves HTTP %s and the business error inside a successful SDK response', async (status, code) => {
      const response = await handle(reject(code, status), request());
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const envelope = cloudHttpEnvelopeSchema.parse(await response.json());
      expect(envelope.status).toBe(status);
      expect(envelope.body).toMatchObject({ error: { code, message: '已拒绝' } });
    }
  );
  it('preserves ordinary HTTP semantics without an explicit supported opt-in', async () => {
    for (const incoming of [undefined, request('2')]) {
      const response = await handle(reject('SEGMENT_APPLICATION_CLOSED', 409), incoming);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: 'SEGMENT_APPLICATION_CLOSED' } });
    }
  });
  it('does not expose unexpected exception details', async () => {
    const response = await handle(async () => { throw new Error('private exception fixture'); }, request());
    const body = await response.json();
    expect(body).toMatchObject({ status: 500, body: { error: { code: 'INTERNAL_ERROR' } } });
    expect(JSON.stringify(body)).not.toContain('private exception fixture');
  });
  it('preserves successful business payloads without inventing a new result', async () => {
    const payload = { value: 'fixture' };
    const response = await handle(async () => payload, request());
    expect(await response.json()).toEqual({ transport: 'weego.http.v1', status: 200, body: payload });
  });
});

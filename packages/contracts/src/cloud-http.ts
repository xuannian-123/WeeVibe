import { z } from 'zod';

// The native SDK can discard non-2xx response bodies. This opt-in transport
// envelope carries the original HTTP result without changing business rules.
export const CLOUD_HTTP_ENVELOPE_HEADER = 'X-Weego-Response-Envelope';
export const CLOUD_HTTP_ENVELOPE_VERSION = '1';
export const cloudHttpEnvelopeSchema = z.object({
  transport: z.literal('weego.http.v1'),
  status: z.number().int().min(100).max(599),
  body: z.unknown()
}).strict().refine(value => Object.prototype.hasOwnProperty.call(value, 'body'), 'Missing HTTP response body');

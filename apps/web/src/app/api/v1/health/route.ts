import { healthSchema } from '@weevibe/contracts';
import { ok } from '../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  return ok(healthSchema.parse({ service: 'weego-api', version: '0.0.1', status: 'alive', server_time: new Date().toISOString(), database: 'not_checked', identity: 'not_checked' }));
}

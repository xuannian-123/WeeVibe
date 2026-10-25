import { withDb } from '../../../../server/db';
import { handle } from '../../../../server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request: Request) {
  return handle(async () => {
    await withDb(db => db.$queryRaw`SELECT 1`);
    return { status: 'database_connected', identity: 'not_checked' };
  }, request);
}
